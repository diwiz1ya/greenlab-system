function createWorkflowService(options) {
  const {
    db,
    nowIso,
    getOrderDetails,
    getStationLabel,
    queueSync,
    getPickupScanProgress,
    productionFlow,
    flowIndex,
    holdStation,
    holdCloudStatus,
    pickupScanOkMessage,
    qcIssueLabels
  } = options;

  function getOrderProgressFromBaskets(orderId) {
    const rows = db.prepare(`
      SELECT station, COUNT(*) AS count
      FROM baskets
      WHERE order_id = ?
      GROUP BY station
    `).all(orderId);

    if (!rows.length) {
      return {
        status: "sorting",
        cleancloudStatus: "Новый заказ",
        readyForPickup: false
      };
    }

    if (rows.some((row) => row.station === holdStation)) {
      return {
        status: holdStation,
        cleancloudStatus: holdCloudStatus,
        readyForPickup: false
      };
    }

    let minIndex = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      const index = flowIndex[row.station];
      if (index === undefined) {
        continue;
      }
      if (index < minIndex) {
        minIndex = index;
      }
    }

    if (!Number.isFinite(minIndex)) {
      minIndex = flowIndex.washing;
    }

    const status = productionFlow[minIndex];
    const readyForPickup = status === "pickup";

    return {
      status,
      cleancloudStatus: readyForPickup ? "Готов к выдаче" : "В работе",
      readyForPickup
    };
  }

  function refreshOrderStatusFromBaskets(orderId, cleancloudOrderId, timestamp) {
    const previous = db.prepare("SELECT ready_for_pickup FROM orders WHERE id = ?").get(orderId);
    const next = getOrderProgressFromBaskets(orderId);

    db.prepare(`
      UPDATE orders
      SET status = ?, cleancloud_status = ?, ready_for_pickup = ?, updated_at = ?
      WHERE id = ?
    `).run(next.status, next.cleancloudStatus, next.readyForPickup ? 1 : 0, timestamp, orderId);

    if (next.readyForPickup && !previous.ready_for_pickup) {
      queueSync(orderId, "cleancloud.status", {
        orderId: cleancloudOrderId,
        status: "Готов к выдаче"
      });
    }

    return next;
  }

  function createBaskets(orderId, types, actor) {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
    if (!order) {
      return { error: "Заказ не найден", status: 404 };
    }
    if (order.status !== "sorting") {
      return { error: "Заказ не находится на сортировке", status: 400 };
    }

    const existing = db.prepare("SELECT COUNT(*) AS count FROM baskets WHERE order_id = ?").get(orderId).count;
    if (existing > 0) {
      return { error: "Корзины уже созданы", status: 400 };
    }

    const normalizedTypes = Array.isArray(types)
      ? types
          .map((type) => String(type || "").trim())
          .filter(Boolean)
          .slice(0, 20)
      : [];
    if (!normalizedTypes.length) {
      return { error: "Укажите минимум одну корзину перед запуском сортировки", status: 400 };
    }

    const timestamp = nowIso();
    const insertBasket = db.prepare(`
      INSERT INTO baskets (order_id, basket_code, basket_type, station, status, qr_code, created_at, updated_at)
      VALUES (?, ?, ?, 'washing', 'washing', ?, ?, ?)
    `);

    normalizedTypes.forEach((type, index) => {
      const basketCode = `B-${order.public_id.slice(3)}-${index + 1}`;
      insertBasket.run(orderId, basketCode, type, `QR:${basketCode}`, timestamp, timestamp);
    });

    db.prepare(`
      UPDATE orders
      SET status = 'sorted', cleancloud_status = 'В работе', ready_for_pickup = 0, updated_at = ?
      WHERE id = ?
    `).run(timestamp, orderId);

    db.prepare(`
      INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
      VALUES (?, NULL, 'sorting', ?, 'ok', 'Корзины созданы, QR-этикетки подготовлены. Заказ ожидает стирку.', ?)
    `).run(orderId, actor, timestamp);

    queueSync(orderId, "cleancloud.status", {
      orderId: order.cleancloud_order_id,
      status: "В работе"
    });

    return { ok: true, order: getOrderDetails(orderId) };
  }

  function normalizeQcIssue(value) {
    const key = String(value || "").trim().toLowerCase();
    return qcIssueLabels[key] ? key : "stain";
  }

  function inspectQcBasket(qrCode) {
    const basket = db.prepare(`
      SELECT b.*, o.id AS order_db_id, o.public_id, o.customer_name, o.order_weight, o.customer_phone, o.customer_email, o.cleancloud_status
      FROM baskets b
      JOIN orders o ON o.id = b.order_id
      WHERE b.qr_code = ?
    `).get(qrCode);

    if (!basket) {
      return { status: 404, payload: { ok: false, message: "QR-код не найден." } };
    }

    if (basket.status !== basket.station) {
      return {
        status: 409,
        payload: {
          ok: false,
          message: "Состояние корзины неконсистентно: status не совпадает со station."
        }
      };
    }

    if (basket.station !== "qc") {
      return {
        status: 409,
        payload: {
          ok: false,
          message: `Корзина на станции ${getStationLabel(basket.station)}. Проверка QC доступна только на QC.`
        }
      };
    }

    return {
      status: 200,
      payload: {
        ok: true,
        message: `Корзина ${basket.basket_code} готова к решению QC.`,
        order: {
          id: basket.order_db_id,
          public_id: basket.public_id,
          customer_name: basket.customer_name,
          order_weight: basket.order_weight,
          customer_phone: basket.customer_phone,
          customer_email: basket.customer_email,
          cleancloud_status: basket.cleancloud_status
        },
        basket: {
          id: basket.id,
          basket_code: basket.basket_code,
          basket_type: basket.basket_type,
          qr_code: basket.qr_code
        }
      }
    };
  }

  function scanBasket(station, qrCode, actor) {
    const basket = db.prepare(`
      SELECT b.*, o.cleancloud_order_id, o.id AS order_db_id
      FROM baskets b
      JOIN orders o ON o.id = b.order_id
      WHERE b.qr_code = ?
    `).get(qrCode);

    if (!basket) {
      return { status: 404, payload: { ok: false, message: "QR-код не найден." } };
    }

    const timestamp = nowIso();
    const orderId = basket.order_db_id;

    if (basket.status !== basket.station) {
      db.prepare(`
        INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
        VALUES (?, ?, ?, ?, 'error', ?, ?)
      `).run(
        orderId,
        basket.id,
        station,
        actor,
        "Скан отклонён: неконсистентное состояние корзины (status != station).",
        timestamp
      );

      return {
        status: 409,
        payload: {
          ok: false,
          message: "Скан отклонён: состояние корзины неконсистентно (status != station)."
        }
      };
    }

    if (basket.station !== station) {
      db.prepare(`
        INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
        VALUES (?, ?, ?, ?, 'error', ?, ?)
      `).run(orderId, basket.id, station, actor, `Корзина относится к станции ${getStationLabel(basket.station)}.`, timestamp);

      return {
        status: 409,
        payload: { ok: false, message: `Корзина на станции ${getStationLabel(basket.station)}, а не ${getStationLabel(station)}.` }
      };
    }

    if (station === "pickup") {
      db.prepare(`
        INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
        VALUES (?, ?, ?, ?, 'ok', ?, ?)
      `).run(orderId, basket.id, station, actor, pickupScanOkMessage, timestamp);

      const pickupProgress = getPickupScanProgress(orderId);

      return {
        status: 200,
        payload: {
          ok: true,
          message: "Корзина подтверждена. Подтвердите выдачу в системе, закрытие выполняется в CleanCloud.",
          order: getOrderDetails(orderId),
          basket: {
            id: basket.id,
            basket_code: basket.basket_code,
            qr_code: basket.qr_code
          },
          pickupProgress
        }
      };
    }

    const currentIndex = flowIndex[station];
    if (currentIndex === undefined || currentIndex >= productionFlow.length - 1) {
      return { status: 400, payload: { ok: false, message: "На этой станции сканирование недоступно." } };
    }

    const nextStation = productionFlow[currentIndex + 1];
    db.prepare(`
      UPDATE baskets
      SET station = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(nextStation, nextStation, timestamp, basket.id);

    refreshOrderStatusFromBaskets(orderId, basket.cleancloud_order_id, timestamp);

    db.prepare(`
      INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
      VALUES (?, ?, ?, ?, 'ok', ?, ?)
    `).run(orderId, basket.id, station, actor, `Корзина переведена на станцию ${getStationLabel(nextStation)}.`, timestamp);

    return {
      status: 200,
      payload: {
        ok: true,
        message: `Корзина переведена на станцию ${getStationLabel(nextStation)}.`,
        order: getOrderDetails(orderId)
      }
    };
  }

  function rejectBasketFromQc(qrCode, actor, issueCode) {
    const basket = db.prepare(`
      SELECT b.*, o.cleancloud_order_id, o.id AS order_db_id
      FROM baskets b
      JOIN orders o ON o.id = b.order_id
      WHERE b.qr_code = ?
    `).get(qrCode);

    if (!basket) {
      return { status: 404, payload: { ok: false, message: "QR-код не найден." } };
    }

    const issue = normalizeQcIssue(issueCode);
    const issueLabel = qcIssueLabels[issue];
    const timestamp = nowIso();
    const orderId = basket.order_db_id;

    if (basket.status !== basket.station) {
      db.prepare(`
        INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
        VALUES (?, ?, 'qc', ?, 'error', ?, ?)
      `).run(
        orderId,
        basket.id,
        actor,
        "QC-возврат отклонён: неконсистентное состояние корзины (status != station).",
        timestamp
      );

      return {
        status: 409,
        payload: {
          ok: false,
          message: "QC-операция отклонена: состояние корзины неконсистентно (status != station)."
        }
      };
    }

    if (basket.station !== "qc") {
      db.prepare(`
        INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
        VALUES (?, ?, 'qc', ?, 'error', ?, ?)
      `).run(
        orderId,
        basket.id,
        actor,
        `QC-возврат отклонён: корзина находится на станции ${getStationLabel(basket.station)}.`,
        timestamp
      );

      return {
        status: 409,
        payload: {
          ok: false,
          message: `Корзина на станции ${getStationLabel(basket.station)}. QC-возврат доступен только на QC.`
        }
      };
    }

    if (issue === "damage") {
      db.prepare(`
        UPDATE baskets
        SET station = ?, status = ?, updated_at = ?
        WHERE order_id = ?
      `).run(holdStation, holdStation, timestamp, orderId);

      db.prepare(`
        UPDATE orders
        SET status = ?, cleancloud_status = ?, ready_for_pickup = 0, updated_at = ?
        WHERE id = ?
      `).run(holdStation, holdCloudStatus, timestamp, orderId);

      db.prepare(`
        INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
        VALUES (?, ?, 'qc', ?, 'error', ?, ?)
      `).run(
        orderId,
        basket.id,
        actor,
        `QC: обнаружена проблема (${issueLabel}). Заказ переведён в HOLD, требуется решение менеджера.`,
        timestamp
      );

      return {
        status: 200,
        payload: {
          ok: true,
          message: `QC: ${issueLabel}. Заказ переведён в HOLD, требуется менеджер.`,
          issue: { code: issue, label: issueLabel },
          order: getOrderDetails(orderId),
          basket: {
            id: basket.id,
            basket_code: basket.basket_code,
            qr_code: basket.qr_code
          }
        }
      };
    }

    db.prepare(`
      UPDATE baskets
      SET station = 'washing', status = 'washing', updated_at = ?
      WHERE id = ?
    `).run(timestamp, basket.id);

    refreshOrderStatusFromBaskets(orderId, basket.cleancloud_order_id, timestamp);

    db.prepare(`
      INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
      VALUES (?, ?, 'qc', ?, 'error', ?, ?)
    `).run(
      orderId,
      basket.id,
      actor,
      `QC: обнаружена проблема (${issueLabel}). Корзина возвращена на стирку.`,
      timestamp
    );

    return {
      status: 200,
      payload: {
        ok: true,
        message: `QC: ${issueLabel}. Корзина возвращена на стирку.`,
        issue: { code: issue, label: issueLabel },
        order: getOrderDetails(orderId),
        basket: {
          id: basket.id,
          basket_code: basket.basket_code,
          qr_code: basket.qr_code
        }
      }
    };
  }

  function releaseOrderFromHold(orderId, actor) {
    const order = db.prepare(`
      SELECT id, status, cleancloud_order_id
      FROM orders
      WHERE id = ?
    `).get(orderId);
    if (!order) {
      return { error: "Заказ не найден", status: 404 };
    }
    if (order.status !== holdStation) {
      return { error: "Заказ не находится в HOLD", status: 400 };
    }

    const basketCount = db.prepare("SELECT COUNT(*) AS count FROM baskets WHERE order_id = ?").get(orderId).count;
    if (!basketCount) {
      return { error: "У заказа нет корзин для возврата в работу", status: 400 };
    }

    const timestamp = nowIso();
    db.prepare(`
      UPDATE baskets
      SET station = 'washing', status = 'washing', updated_at = ?
      WHERE order_id = ?
    `).run(timestamp, orderId);

    db.prepare(`
      UPDATE orders
      SET status = 'washing', cleancloud_status = 'В работе', ready_for_pickup = 0, updated_at = ?
      WHERE id = ?
    `).run(timestamp, orderId);

    db.prepare(`
      INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
      VALUES (?, NULL, 'overview', ?, 'ok', 'HOLD снят менеджером. Заказ возвращён на стирку.', ?)
    `).run(orderId, actor, timestamp);

    queueSync(orderId, "cleancloud.status", {
      orderId: order.cleancloud_order_id,
      status: "В работе"
    });

    return { ok: true, order: getOrderDetails(orderId) };
  }

  function completePickup(orderId, actor) {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
    if (!order) {
      return { error: "Заказ не найден", status: 404 };
    }
    if (order.status !== "pickup" || !order.ready_for_pickup) {
      return { error: "Заказ не готов к подтверждению выдачи", status: 400 };
    }
    const progress = getPickupScanProgress(orderId);
    if (!progress.complete) {
      return {
        error: `Сначала отсканируйте все корзины (${progress.scannedBaskets}/${progress.totalBaskets})`,
        status: 400
      };
    }

    const timestamp = nowIso();
    db.prepare(`
      UPDATE orders
      SET status = 'pickup', cleancloud_status = 'Выдано (ожидает закрытия в CleanCloud)', ready_for_pickup = 0, updated_at = ?
      WHERE id = ?
    `).run(timestamp, orderId);

    db.prepare(`
      INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
      VALUES (?, NULL, 'pickup', ?, 'ok', 'Выдача подтверждена. Закройте заказ в CleanCloud менеджером.', ?)
    `).run(orderId, actor, timestamp);

    return { ok: true, order: getOrderDetails(orderId) };
  }

  return {
    createBaskets,
    scanBasket,
    inspectQcBasket,
    rejectBasketFromQc,
    releaseOrderFromHold,
    completePickup
  };
}

module.exports = {
  createWorkflowService
};
