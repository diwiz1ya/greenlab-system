"use strict";

const fs = require("fs");
const path = require("path");
const { parseImageDataUrl, validateImageBuffer } = require("./image-safety");

function createReworkWorkflow(options) {
  const {
    db,
    nowIso,
    publicUploadsDir,
    getOrderDetails,
    getStationLabel,
    refreshOrderStatusFromBaskets,
    reworkStation,
    awaitingApprovalStation,
    inactiveReworkSourceState,
    pendingCustomerApprovalStatus,
    approvedWaitingTransferStatus,
    declinedWaitingReturnStatus,
    approvedRequestStatus,
    declinedRequestStatus,
    basketItemKeys,
    qcIssueLabels,
    holdStation,
    holdCloudStatus,
    reworkServiceCatalog,
    parseBasketItemCounts,
    buildSingleItemCounts,
    getRemainingItemCounts,
    itemCountsToJson
  } = options;
  const reworkEvidenceReasons = new Set(["stain_not_removed", "spot_treatment", "hand_wash", "extra_treatment"]);
  const customerApprovalStation = awaitingApprovalStation || "customer_approval";
  const maxReworkEvidenceImageBytes = 8 * 1024 * 1024;

  fs.mkdirSync(publicUploadsDir, { recursive: true });

  function normalizeQcIssue(value) {
    const key = String(value || "").trim().toLowerCase();
    if (!key) return "stain_not_removed";
    if (key === "stain") return "stain_not_removed";
    return qcIssueLabels[key] ? key : "stain_not_removed";
  }

  function normalizeReworkReason(value) {
    const issue = normalizeQcIssue(value);
    return issue === "damage" ? null : issue;
  }

  function normalizeRequestQuantity(value) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 999) return null;
    return parsed;
  }

  function normalizeItemCategory(value) {
    const raw = String(value || "").trim();
    if (basketItemKeys.includes(raw)) return raw;
    if (raw === "socks_pairs") return "socksPairs";
    return null;
  }

  function sanitizeItemLabel(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    return text.slice(0, 120);
  }

  function normalizeQrCodeValue(value) {
    return String(value || "").trim().toUpperCase();
  }

  function normalizeIssueImageId(value) {
    const text = String(value || "").trim();
    return text || null;
  }

  function normalizeQcPhotoDataUrl(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    return text.startsWith("data:image/") ? text : null;
  }

  function reasonNeedsEvidencePhoto(reasonCode) {
    return reworkEvidenceReasons.has(normalizeReworkReason(reasonCode));
  }

  function getReworkServiceDetails(reasonCode) {
    const reason = normalizeReworkReason(reasonCode);
    return reworkServiceCatalog[reason] || reworkServiceCatalog.stain_not_removed;
  }

  function getBasketImages(basketId) {
    if (!basketId) return [];
    return db.prepare(`
      SELECT id, image_role, sort_order, note, public_url, created_at
      FROM basket_images
      WHERE basket_id = ?
      ORDER BY sort_order, id
    `).all(basketId).map((row) => ({
      id: row.id,
      role: row.image_role,
      sort_order: Number(row.sort_order || 0),
      note: row.note || null,
      public_url: row.public_url,
      created_at: row.created_at
    }));
  }

  function getIssueImageSelection(basketId, issueImageId) {
    if (!basketId) return { issueImages: [], selectedImage: null };
    const issueImages = getBasketImages(basketId).filter((image) => image.role === "issue");
    if (!issueImages.length) {
      return { issueImages, selectedImage: null };
    }
    const selectedImage = issueImages.find((image) => String(image.id) === String(issueImageId || ""));
    return { issueImages, selectedImage: selectedImage || null };
  }

  function writeQcEvidencePhotoFile(orderId, basketCode, photoDataUrl) {
    const parsed = parseImageDataUrl(photoDataUrl);
    const checked = validateImageBuffer(parsed.buffer, {
      declaredMimeType: parsed.declaredMimeType,
      maxBytes: maxReworkEvidenceImageBytes
    });
    const extension = checked.extension;
    const fileName = `qc-${orderId}-${basketCode}-${Date.now()}.${extension}`;
    const absolutePath = path.join(publicUploadsDir, fileName);
    fs.writeFileSync(absolutePath, parsed.buffer);
    return {
      filePath: absolutePath,
      publicUrl: `/uploads/baskets/${fileName}`
    };
  }

  function getBasketPayload(basket, options = {}) {
    const images = Array.isArray(options.images)
      ? options.images
      : (Array.isArray(basket.images) ? basket.images : []);
    return {
      id: basket.id,
      basket_code: basket.basket_code,
      basket_type: basket.basket_type,
      basket_kind: basket.basket_kind || "main",
      parent_basket_id: basket.parent_basket_id || null,
      rework_reason: basket.rework_reason || null,
      rework_attempt: Number(basket.rework_attempt || 0),
      station: basket.station,
      status: basket.status,
      qr_code: basket.qr_code,
      item_counts: parseBasketItemCounts(basket.basket_items_json),
      images
    };
  }

  function buildReworkRequestPayload(row) {
    if (!row) return null;
    return {
      id: row.id,
      order_id: row.order_id,
      source_basket_id: row.source_basket_id,
      source_basket_code: row.source_basket_code || null,
      rework_basket_id: row.rework_basket_id || null,
      rework_basket_code: row.rework_basket_code || null,
      rework_basket_qr_code: row.rework_basket_qr_code || null,
      item_category: row.item_category,
      item_label: row.item_label || null,
      source_image_id: row.source_image_id || null,
      source_image_url: row.source_image_url || null,
      source_image_note: row.source_image_note || null,
      qc_photo_url: row.qc_photo_url || null,
      quantity: Number(row.quantity || 0),
      reason_code: row.reason_code,
      service_label: row.service_label,
      extra_days: Number(row.extra_days || 0),
      request_status: row.request_status,
      requested_by: row.requested_by,
      requested_at: row.requested_at,
      decision_actor: row.decision_actor || null,
      decision_at: row.decision_at || null,
      decision_note: row.decision_note || null,
      handoff_confirmed_by: row.handoff_confirmed_by || null,
      handoff_confirmed_at: row.handoff_confirmed_at || null,
      handoff_note: row.handoff_note || null,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  function buildQcTransferTaskPayload(row) {
    if (!row) return null;
    const request = buildReworkRequestPayload(row);
    const taskKind = request.request_status === declinedWaitingReturnStatus
      ? "return_to_flow"
      : "transfer_to_rework";
    let plannedReworkBasketCode = row.rework_basket_code || null;
    let plannedReworkBasketQrCode = row.rework_basket_qr_code || null;

    if (!plannedReworkBasketCode && request.request_status === approvedWaitingTransferStatus) {
      const rootBasketId = getRootBasketId({
        id: row.source_basket_id,
        basket_kind: row.source_basket_kind,
        parent_basket_id: row.source_parent_basket_id
      });
      const attempt = getNextReworkAttempt(row.order_id, rootBasketId);
      plannedReworkBasketCode = buildReworkBasketCode(row.order_public_id, attempt);
      plannedReworkBasketQrCode = `QR:${plannedReworkBasketCode}`;
    }

    return {
      ...request,
      order_public_id: row.order_public_id || null,
      order_customer_name: row.order_customer_name || null,
      source_basket_code: row.source_basket_code || request.source_basket_code || null,
      source_basket_qr_code: row.source_basket_qr_code || null,
      source_basket_type: row.source_basket_type || null,
      source_station: row.source_station || null,
      source_status: row.source_status || null,
      rework_basket_code: row.rework_basket_code || request.rework_basket_code || null,
      rework_basket_qr_code: row.rework_basket_qr_code || request.rework_basket_qr_code || null,
      planned_rework_basket_code: plannedReworkBasketCode,
      planned_rework_basket_qr_code: plannedReworkBasketQrCode,
      task_kind: taskKind,
      rework_station: row.rework_station || null,
      rework_status: row.rework_status || null
    };
  }

  function listReworkRequestsByOrder(orderId) {
    return db.prepare(`
      SELECT
        rr.*,
        source.basket_code AS source_basket_code,
        rework.basket_code AS rework_basket_code,
        rework.qr_code AS rework_basket_qr_code
      FROM rework_requests rr
      JOIN baskets source ON source.id = rr.source_basket_id
      LEFT JOIN baskets rework ON rework.id = rr.rework_basket_id
      WHERE rr.order_id = ?
      ORDER BY rr.id DESC
    `).all(orderId).map(buildReworkRequestPayload);
  }

  function listPendingReworkRequestsByBasketId(basketId) {
    return db.prepare(`
      SELECT
        rr.*,
        source.basket_code AS source_basket_code,
        rework.basket_code AS rework_basket_code,
        rework.qr_code AS rework_basket_qr_code
      FROM rework_requests rr
      JOIN baskets source ON source.id = rr.source_basket_id
      LEFT JOIN baskets rework ON rework.id = rr.rework_basket_id
      WHERE rr.source_basket_id = ?
        AND rr.request_status IN (?, ?, ?)
      ORDER BY rr.id DESC
    `).all(
      basketId,
      pendingCustomerApprovalStatus,
      approvedWaitingTransferStatus,
      declinedWaitingReturnStatus
    ).map(buildReworkRequestPayload);
  }

  function getReworkRequestWithContext(requestId) {
    return db.prepare(`
      SELECT
        rr.*,
        source.order_id AS source_order_id,
        source.basket_code AS source_basket_code,
        source.basket_type AS source_basket_type,
        source.basket_items_json AS source_basket_items_json,
        source.basket_kind AS source_basket_kind,
        source.parent_basket_id AS source_parent_basket_id,
        source.station AS source_station,
        source.status AS source_status,
        source.qr_code AS source_qr_code,
        o.public_id AS order_public_id,
        o.cleancloud_order_id
      FROM rework_requests rr
      JOIN baskets source ON source.id = rr.source_basket_id
      JOIN orders o ON o.id = rr.order_id
      WHERE rr.id = ?
    `).get(requestId);
  }

  function getQcTransferTaskWithContext(requestId) {
    return db.prepare(`
      SELECT
        rr.*,
        source.basket_code AS source_basket_code,
        source.qr_code AS source_basket_qr_code,
        source.basket_type AS source_basket_type,
        source.basket_items_json AS source_basket_items_json,
        source.basket_kind AS source_basket_kind,
        source.parent_basket_id AS source_parent_basket_id,
        source.station AS source_station,
        source.status AS source_status,
        rework.basket_code AS rework_basket_code,
        rework.qr_code AS rework_basket_qr_code,
        rework.station AS rework_station,
        rework.status AS rework_status,
        o.public_id AS order_public_id,
        o.customer_name AS order_customer_name,
        o.cleancloud_order_id
      FROM rework_requests rr
      JOIN baskets source ON source.id = rr.source_basket_id
      LEFT JOIN baskets rework ON rework.id = rr.rework_basket_id
      JOIN orders o ON o.id = rr.order_id
      WHERE rr.id = ?
    `).get(requestId);
  }

  function listPendingQcTransferTasks() {
    return db.prepare(`
      SELECT
        rr.*,
        source.basket_code AS source_basket_code,
        source.qr_code AS source_basket_qr_code,
        source.basket_type AS source_basket_type,
        source.basket_kind AS source_basket_kind,
        source.parent_basket_id AS source_parent_basket_id,
        source.station AS source_station,
        source.status AS source_status,
        rework.basket_code AS rework_basket_code,
        rework.qr_code AS rework_basket_qr_code,
        rework.station AS rework_station,
        rework.status AS rework_status,
        o.public_id AS order_public_id,
        o.customer_name AS order_customer_name
      FROM rework_requests rr
      JOIN baskets source ON source.id = rr.source_basket_id
      LEFT JOIN baskets rework ON rework.id = rr.rework_basket_id
      JOIN orders o ON o.id = rr.order_id
      WHERE rr.request_status IN (?, ?)
        AND rr.rework_basket_id IS NULL
        AND rr.handoff_confirmed_at IS NULL
      ORDER BY datetime(rr.decision_at) DESC, rr.id DESC
    `).all(approvedWaitingTransferStatus, declinedWaitingReturnStatus).map(buildQcTransferTaskPayload);
  }

  function formatAllowedStationsForError(stations) {
    const labels = (Array.isArray(stations) ? stations : [])
      .map((station) => getStationLabel(station))
      .filter(Boolean);
    return labels.join(" или ");
  }

  function validateRequestSourceBasketState(request, allowedStations, actionLabel) {
    if (request.source_status !== request.source_station) {
      return `${actionLabel}: исходная корзина находится в неконсистентном состоянии (status != station).`;
    }
    const allowed = Array.isArray(allowedStations) ? allowedStations : [];
    if (!allowed.includes(request.source_station)) {
      const stationsLabel = formatAllowedStationsForError(allowed);
      return `${actionLabel}: источник должен быть на станции ${stationsLabel}.`;
    }
    return "";
  }

  function confirmQcTransferTask(requestId, actor, payload = {}) {
    const sourceQrCodeInput = String(payload.sourceQrCode || "").trim();
    const targetQrCodeInput = String(payload.targetQrCode || "").trim();
    const handoffNoteInput = payload.handoffNote || "";
    const request = getQcTransferTaskWithContext(requestId);
    if (!request) {
      return { error: "Запрос на доработку не найден", status: 404 };
    }
    const isTransferToRework = request.request_status === approvedWaitingTransferStatus;
    const isReturnToFlow = request.request_status === declinedWaitingReturnStatus;
    if (!isTransferToRework && !isReturnToFlow) {
      return { error: "Запрос не находится в статусе задачи QC после решения клиента", status: 400 };
    }
    if (request.handoff_confirmed_at) {
      return { error: "Передача в доработку уже подтверждена", status: 400 };
    }
    if (isTransferToRework && request.rework_basket_id) {
      return { error: "По этому запросу уже создана корзина доработки.", status: 409 };
    }

    const sourceStateError = isTransferToRework
      ? validateRequestSourceBasketState(
          request,
          [customerApprovalStation],
          "Перенос в доработку"
        )
      : validateRequestSourceBasketState(
          request,
          ["qc", customerApprovalStation],
          "Возврат в поток"
        );
    if (sourceStateError) {
      return { error: sourceStateError, status: 409 };
    }

    const timestamp = nowIso();
    const note = sanitizeItemLabel(handoffNoteInput);

    if (isReturnToFlow) {
      if (request.source_station !== "qc") {
        const moveSourceToQc = db.prepare(`
          UPDATE baskets
          SET station = 'qc', status = 'qc', updated_at = ?
          WHERE id = ?
            AND station = ?
            AND status = ?
        `).run(timestamp, request.source_basket_id, customerApprovalStation, customerApprovalStation);
        if (!moveSourceToQc.changes) {
          return { error: "Источник изменился во время подтверждения. Обновите задачи и повторите.", status: 409 };
        }
      }

      const updateReturnTask = db.prepare(`
        UPDATE rework_requests
        SET request_status = ?, decision_actor = ?, decision_at = ?,
            decision_note = ?, handoff_confirmed_by = ?, handoff_confirmed_at = ?, handoff_note = ?, updated_at = ?
        WHERE id = ?
          AND request_status = ?
          AND handoff_confirmed_at IS NULL
      `).run(
        declinedRequestStatus,
        request.decision_actor || actor,
        request.decision_at || timestamp,
        request.decision_note,
        actor,
        timestamp,
        note,
        timestamp,
        requestId,
        declinedWaitingReturnStatus
      );
      if (!updateReturnTask.changes) {
        return { error: "Задача уже обработана или изменена другим пользователем.", status: 409 };
      }

      refreshOrderStatusFromBaskets(request.order_id, request.cleancloud_order_id, timestamp);

      db.prepare(`
        INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
        VALUES (?, ?, 'qc', ?, 'ok', ?, ?)
      `).run(
        request.order_id,
        request.source_basket_id,
        actor,
        "QC подтвердил возврат вещи в основной поток после отказа клиента от доработки.",
        timestamp
      );

      return {
        ok: true,
        message: "Возврат в основной поток подтвержден. Корзина остается на QC.",
        order: getOrderDetails(request.order_id),
        task: buildQcTransferTaskPayload(getQcTransferTaskWithContext(requestId))
      };
    }

    const expectedSourceQrCode = String(request.source_basket_qr_code || "").trim();
    if (!sourceQrCodeInput) {
      return { error: "Сначала отсканируйте исходную корзину.", status: 400 };
    }
    if (normalizeQrCodeValue(sourceQrCodeInput) !== normalizeQrCodeValue(expectedSourceQrCode)) {
      return {
        error: `Скан исходной корзины не совпадает. Ожидается ${expectedSourceQrCode}.`,
        status: 400
      };
    }

    const quantity = Number(request.quantity || 0);
    const itemCategory = normalizeItemCategory(request.item_category);
    const sourceCounts = parseBasketItemCounts(request.source_basket_items_json);
    const remainingCounts = getRemainingItemCounts(sourceCounts, itemCategory, quantity);
    if (!remainingCounts) {
      return { error: "Невозможно выделить вещь в доработку: состав корзины уже изменился", status: 409 };
    }

    const rootBasketId = getRootBasketId({
      id: request.source_basket_id,
      basket_kind: request.source_basket_kind,
      parent_basket_id: request.source_parent_basket_id
    });
    const attempt = getNextReworkAttempt(request.order_id, rootBasketId);
    const reworkBasketCode = buildReworkBasketCode(request.order_public_id, attempt);
    const expectedTargetQrCode = `QR:${reworkBasketCode}`;

    if (!targetQrCodeInput) {
      return { error: "Сначала отсканируйте целевую rework-корзину.", status: 400 };
    }
    if (normalizeQrCodeValue(targetQrCodeInput) !== normalizeQrCodeValue(expectedTargetQrCode)) {
      return {
        error: `Скан целевой корзины не совпадает. Ожидается ${expectedTargetQrCode}.`,
        status: 400
      };
    }

    const reworkItemCounts = buildSingleItemCounts(itemCategory, quantity);
    const nextSourceStation = remainingCounts.total > 0 ? "qc" : inactiveReworkSourceState;

    db.prepare(`
      INSERT INTO baskets (
        order_id, basket_code, basket_type, basket_items_json, basket_kind, parent_basket_id,
        rework_reason, rework_attempt, station, status, qr_code, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, 'rework', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      request.order_id,
      reworkBasketCode,
      request.source_basket_type,
      itemCountsToJson(reworkItemCounts),
      rootBasketId,
      request.reason_code,
      attempt,
      reworkStation,
      reworkStation,
      expectedTargetQrCode,
      timestamp,
      timestamp
    );

    const reworkBasketId = db.prepare("SELECT last_insert_rowid() AS id").get().id;

    const updateSourceBasketAfterTransfer = db.prepare(`
      UPDATE baskets
      SET basket_items_json = ?, station = ?, status = ?, updated_at = ?
      WHERE id = ?
        AND station = ?
        AND status = ?
    `).run(
      itemCountsToJson(remainingCounts),
      nextSourceStation,
      nextSourceStation,
      timestamp,
      request.source_basket_id,
      customerApprovalStation,
      customerApprovalStation
    );
    if (!updateSourceBasketAfterTransfer.changes) {
      return { error: "Источник изменился во время подтверждения. Обновите задачи и повторите.", status: 409 };
    }

    const updateTransferTask = db.prepare(`
      UPDATE rework_requests
      SET rework_basket_id = ?, request_status = ?, decision_actor = ?, decision_at = ?,
          decision_note = ?, handoff_confirmed_by = ?, handoff_confirmed_at = ?, handoff_note = ?, updated_at = ?
      WHERE id = ?
        AND request_status = ?
        AND rework_basket_id IS NULL
        AND handoff_confirmed_at IS NULL
    `).run(
      reworkBasketId,
      approvedRequestStatus,
      request.decision_actor || actor,
      request.decision_at || timestamp,
      request.decision_note,
      actor,
      timestamp,
      note,
      timestamp,
      requestId,
      approvedWaitingTransferStatus
    );
    if (!updateTransferTask.changes) {
      return { error: "Задача уже обработана или изменена другим пользователем.", status: 409 };
    }

    refreshOrderStatusFromBaskets(request.order_id, request.cleancloud_order_id, timestamp);

    db.prepare(`
      INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
      VALUES (?, ?, 'qc', ?, 'ok', ?, ?)
    `).run(
      request.order_id,
      request.source_basket_id,
      actor,
      `QC подтвердил передачу проблемной вещи в корзину доработки ${reworkBasketCode}.`,
      timestamp
    );

    return {
      ok: true,
      message: `Передача подтверждена. Создана корзина ${reworkBasketCode}.`,
      order: getOrderDetails(request.order_id),
      task: buildQcTransferTaskPayload(getQcTransferTaskWithContext(requestId))
    };
  }

  function getBasketWithOrderByQr(qrCode) {
    return db.prepare(`
      SELECT b.*, o.cleancloud_order_id, o.id AS order_db_id, o.public_id
      FROM baskets b
      JOIN orders o ON o.id = b.order_id
      WHERE b.qr_code = ?
    `).get(qrCode);
  }

  function validateQcActionBasket(basket, actor, timestamp, failurePrefix) {
    const orderId = basket.order_db_id;

    if (basket.status !== basket.station) {
      db.prepare(`
        INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
        VALUES (?, ?, 'qc', ?, 'error', ?, ?)
      `).run(
        orderId,
        basket.id,
        actor,
        `${failurePrefix}: неконсистентное состояние корзины (status != station).`,
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
        `${failurePrefix}: корзина находится на станции ${getStationLabel(basket.station)}.`,
        timestamp
      );

      return {
        status: 409,
        payload: {
          ok: false,
          message: `Корзина на станции ${getStationLabel(basket.station)}. QC-операция доступна только на QC.`
        }
      };
    }

    return null;
  }

  function getRootBasketId(basket) {
    return basket.basket_kind === "rework" && basket.parent_basket_id
      ? basket.parent_basket_id
      : basket.id;
  }

  function getNextReworkAttempt(orderId, rootBasketId) {
    const row = db.prepare(`
      SELECT COALESCE(MAX(rework_attempt), 0) AS max_attempt
      FROM baskets
      WHERE order_id = ? AND parent_basket_id = ?
    `).get(orderId, rootBasketId);
    return Number(row?.max_attempt || 0) + 1;
  }

  function buildReworkBasketCode(orderPublicId, attempt) {
    const suffix = String(orderPublicId || "").startsWith("GL-")
      ? String(orderPublicId).slice(3)
      : String(orderPublicId || "");
    return `RW-${suffix}-${attempt}`;
  }

  function inspectQcBasket(qrCode) {
    const basket = db.prepare(`
      SELECT
        b.*,
        o.id AS order_db_id,
        o.public_id,
        o.customer_name,
        o.order_weight,
        o.customer_phone,
        o.customer_email,
        o.cleancloud_status
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
      const stationLabel = getStationLabel(basket.station);
      const message = basket.station === customerApprovalStation
        ? "Корзина сейчас на согласовании клиента. Дождитесь решения менеджера и обработайте через «Задачи после согласования»."
        : `Корзина на станции ${stationLabel}. Проверка QC доступна только на QC.`;
      return {
        status: 409,
        payload: {
          ok: false,
          message
        }
      };
    }

    const pendingRequests = listPendingReworkRequestsByBasketId(basket.id);
    const images = getBasketImages(basket.id);

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
          ...getBasketPayload(basket, { images })
        },
        pending_rework_requests: pendingRequests
      }
    };
  }

  function createReworkRequestFromQc(qrCode, actor, payload = {}) {
    const basket = getBasketWithOrderByQr(qrCode);

    if (!basket) {
      return { status: 404, payload: { ok: false, message: "QR-код не найден." } };
    }

    const reason = normalizeReworkReason(payload.reason || payload.reasonCode);
    const itemCategory = normalizeItemCategory(payload.itemCategory || payload.item_category);
    const itemLabel = sanitizeItemLabel(payload.itemLabel || payload.item_label);
    const issueImageId = normalizeIssueImageId(payload.issueImageId || payload.issue_image_id);
    const qcPhotoDataUrl = normalizeQcPhotoDataUrl(payload.qcPhotoDataUrl || payload.qc_photo_data_url);
    const quantity = normalizeRequestQuantity(payload.quantity || 1);
    const timestamp = nowIso();
    const orderId = basket.order_db_id;
    const validationError = validateQcActionBasket(basket, actor, timestamp, "QC-согласование отклонено");
    if (validationError) {
      return validationError;
    }

    if (!reason) {
      return {
        status: 400,
        payload: {
          ok: false,
          message: "Выберите причину доработки."
        }
      };
    }

    if (!itemCategory) {
      return {
        status: 400,
        payload: {
          ok: false,
          message: "Выберите вещь, которая требует доработки."
        }
      };
    }

    const { issueImages, selectedImage } = getIssueImageSelection(basket.id, issueImageId);
    if (issueImages.length && !selectedImage) {
      return {
        status: 400,
        payload: {
          ok: false,
          message: "Выберите проблемную вещь для согласования."
        }
      };
    }

    if (!quantity) {
      return {
        status: 400,
        payload: {
          ok: false,
          message: "Количество вещей для доработки указано неверно."
        }
      };
    }

    if (reasonNeedsEvidencePhoto(reason) && !qcPhotoDataUrl) {
      return {
        status: 400,
        payload: {
          ok: false,
            message: "Для этой причины добавьте фото текущего состояния вещи после сушки."
        }
      };
    }

    const itemCounts = parseBasketItemCounts(basket.basket_items_json);
    if (!itemCounts || itemCounts.total <= 0) {
      return {
        status: 400,
        payload: {
          ok: false,
          message: "У этой корзины не заполнен состав вещей. Сначала укажите состав на сортировке."
        }
      };
    }

    if (Number(itemCounts[itemCategory] || 0) < quantity) {
      return {
        status: 400,
        payload: {
          ok: false,
          message: "В корзине нет такого количества выбранных вещей для доработки."
        }
      };
    }

    const pendingRequests = listPendingReworkRequestsByBasketId(basket.id);
    if (pendingRequests.length) {
      return {
        status: 409,
        payload: {
          ok: false,
          message: "По этой корзине уже есть незавершённый кейс доработки."
        }
      };
    }

    const serviceDetails = getReworkServiceDetails(reason);
    let qcPhoto = null;
    if (qcPhotoDataUrl) {
      try {
        qcPhoto = writeQcEvidencePhotoFile(orderId, basket.basket_code, qcPhotoDataUrl);
      } catch (error) {
        return {
          status: 400,
          payload: {
            ok: false,
            message: error.message || "Не удалось сохранить фото после сушки."
          }
        };
      }
    }
    db.prepare(`
      INSERT INTO rework_requests (
        order_id, source_basket_id, item_category, item_label, quantity,
        source_image_id, source_image_url, source_image_note, qc_photo_path, qc_photo_url,
        reason_code, service_label, extra_days, request_status,
        requested_by, requested_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      basket.order_id,
      basket.id,
      itemCategory,
      itemLabel,
      quantity,
      selectedImage?.id || null,
      selectedImage?.public_url || null,
      selectedImage?.note || null,
      qcPhoto?.filePath || null,
      qcPhoto?.publicUrl || null,
      reason,
      serviceDetails.serviceLabel,
      serviceDetails.extraDays,
      pendingCustomerApprovalStatus,
      actor,
      timestamp,
      timestamp,
      timestamp
    );

    const requestId = db.prepare("SELECT last_insert_rowid() AS id").get().id;
    const request = buildReworkRequestPayload(db.prepare(`
      SELECT
        rr.*,
        source.basket_code AS source_basket_code,
        rework.basket_code AS rework_basket_code,
        rework.qr_code AS rework_basket_qr_code
      FROM rework_requests rr
      JOIN baskets source ON source.id = rr.source_basket_id
      LEFT JOIN baskets rework ON rework.id = rr.rework_basket_id
      WHERE rr.id = ?
    `).get(requestId));

    db.prepare(`
      UPDATE baskets
      SET station = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(customerApprovalStation, customerApprovalStation, timestamp, basket.id);

    refreshOrderStatusFromBaskets(orderId, basket.cleancloud_order_id, timestamp);

    db.prepare(`
      INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
      VALUES (?, ?, ?, ?, 'ok', ?, ?)
    `).run(
      orderId,
      basket.id,
      customerApprovalStation,
      actor,
      `Корзина переведена в ожидание согласования клиента (${serviceDetails.serviceLabel}, +${serviceDetails.extraDays} day).`,
      timestamp
    );

    return {
      status: 200,
      payload: {
        ok: true,
        message: `Запрос на доп обработку отправлен на согласование клиента. Корзина ожидает решения менеджера: ${serviceDetails.serviceLabel}, +${serviceDetails.extraDays} day.`,
        order: getOrderDetails(orderId),
        basket: getBasketPayload({
          ...basket,
          station: customerApprovalStation,
          status: customerApprovalStation
        }),
        request
      }
    };
  }

  function approveReworkRequest(requestId, actor, decisionNote = "") {
    const request = getReworkRequestWithContext(requestId);
    if (!request) {
      return { error: "Запрос на доработку не найден", status: 404 };
    }
    if (request.request_status !== pendingCustomerApprovalStatus) {
      return { error: "Этот запрос уже обработан", status: 400 };
    }
    const sourceStateError = validateRequestSourceBasketState(
      request,
      [customerApprovalStation, "qc"],
      "Согласование клиента"
    );
    if (sourceStateError) {
      return { error: sourceStateError, status: 409 };
    }
    const timestamp = nowIso();

    const lockBasketInApproval = db.prepare(`
      UPDATE baskets
      SET station = ?, status = ?, updated_at = ?
      WHERE id = ?
        AND station = ?
        AND status = ?
    `).run(
      customerApprovalStation,
      customerApprovalStation,
      timestamp,
      request.source_basket_id,
      request.source_station,
      request.source_status
    );
    if (!lockBasketInApproval.changes) {
      return { error: "Состояние корзины изменилось. Обновите кейс и попробуйте снова.", status: 409 };
    }

    const updateRequestAfterApprove = db.prepare(`
      UPDATE rework_requests
      SET request_status = ?, decision_actor = ?, decision_at = ?, decision_note = ?, updated_at = ?
      WHERE id = ?
        AND request_status = ?
    `).run(
      approvedWaitingTransferStatus,
      actor,
      timestamp,
      sanitizeItemLabel(decisionNote),
      timestamp,
      requestId,
      pendingCustomerApprovalStatus
    );
    if (!updateRequestAfterApprove.changes) {
      return { error: "Запрос уже обработан другим пользователем.", status: 409 };
    }

    refreshOrderStatusFromBaskets(request.order_id, request.cleancloud_order_id, timestamp);

    db.prepare(`
      INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
      VALUES (?, ?, ?, ?, 'ok', ?, ?)
    `).run(
      request.order_id,
      request.source_basket_id,
      customerApprovalStation,
      actor,
      "Клиент согласовал доп обработку. Ожидается физическая передача вещи в доработку на станции QC.",
      timestamp
    );

    return {
      ok: true,
      message: "Клиент согласовал доп обработку. QC должен подтвердить физическую передачу вещи в доработку.",
      order: getOrderDetails(request.order_id),
      request: buildReworkRequestPayload(db.prepare(`
        SELECT
          rr.*,
          source.basket_code AS source_basket_code,
          rework.basket_code AS rework_basket_code,
          rework.qr_code AS rework_basket_qr_code
        FROM rework_requests rr
        JOIN baskets source ON source.id = rr.source_basket_id
        LEFT JOIN baskets rework ON rework.id = rr.rework_basket_id
        WHERE rr.id = ?
      `).get(requestId))
    };
  }

  function declineReworkRequest(requestId, actor, decisionNote = "") {
    const request = getReworkRequestWithContext(requestId);
    if (!request) {
      return { error: "Запрос на доработку не найден", status: 404 };
    }
    if (request.request_status !== pendingCustomerApprovalStatus) {
      return { error: "Этот запрос уже обработан", status: 400 };
    }

    const sourceStateError = validateRequestSourceBasketState(
      request,
      [customerApprovalStation, "qc"],
      "Отказ клиента"
    );
    if (sourceStateError) {
      return { error: sourceStateError, status: 409 };
    }
    const timestamp = nowIso();

    if (request.source_station === customerApprovalStation) {
      const moveSourceBackToQc = db.prepare(`
        UPDATE baskets
        SET station = 'qc', status = 'qc', updated_at = ?
        WHERE id = ?
          AND station = ?
          AND status = ?
      `).run(timestamp, request.source_basket_id, customerApprovalStation, customerApprovalStation);
      if (!moveSourceBackToQc.changes) {
        return { error: "Состояние корзины изменилось. Обновите кейс и попробуйте снова.", status: 409 };
      }
    }

    const updateRequestAfterDecline = db.prepare(`
      UPDATE rework_requests
      SET request_status = ?, decision_actor = ?, decision_at = ?, decision_note = ?, updated_at = ?
      WHERE id = ?
        AND request_status = ?
    `).run(
      declinedWaitingReturnStatus,
      actor,
      timestamp,
      sanitizeItemLabel(decisionNote),
      timestamp,
      requestId,
      pendingCustomerApprovalStatus
    );
    if (!updateRequestAfterDecline.changes) {
      return { error: "Запрос уже обработан другим пользователем.", status: 409 };
    }

    refreshOrderStatusFromBaskets(request.order_id, request.cleancloud_order_id, timestamp);

    db.prepare(`
      INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
      VALUES (?, ?, ?, ?, 'ok', ?, ?)
    `).run(
      request.order_id,
      request.source_basket_id,
      customerApprovalStation,
      actor,
      request.source_station === customerApprovalStation
        ? "Клиент отказался от дополнительной обработки. Нужна QC-задача: подтвердить возврат вещи в основной поток."
        : "Клиент отказался от дополнительной обработки. Нужна QC-задача: подтвердить возврат вещи в основной поток.",
      timestamp
    );

    return {
      ok: true,
      message: "Клиент отказался от дополнительной обработки. QC должен подтвердить возврат вещи в основной поток.",
      order: getOrderDetails(request.order_id),
      request: buildReworkRequestPayload(db.prepare(`
        SELECT
          rr.*,
          source.basket_code AS source_basket_code,
          rework.basket_code AS rework_basket_code,
          rework.qr_code AS rework_basket_qr_code
        FROM rework_requests rr
        JOIN baskets source ON source.id = rr.source_basket_id
        LEFT JOIN baskets rework ON rework.id = rr.rework_basket_id
        WHERE rr.id = ?
      `).get(requestId))
    };
  }

  function rejectBasketFromQc(qrCode, actor, issueCode) {
    const basket = getBasketWithOrderByQr(qrCode);

    if (!basket) {
      return { status: 404, payload: { ok: false, message: "QR-код не найден." } };
    }

    const issue = normalizeQcIssue(issueCode);
    if (issue !== "damage") {
      return {
        status: 400,
        payload: {
          ok: false,
          message: "Для доработки используйте сценарий согласования клиента."
        }
      };
    }

    const issueLabel = qcIssueLabels[issue];
    const timestamp = nowIso();
    const orderId = basket.order_db_id;
    const validationError = validateQcActionBasket(basket, actor, timestamp, "QC-HOLD отклонён");
    if (validationError) {
      return validationError;
    }

    db.prepare(`
      UPDATE baskets
      SET station = ?, status = ?, updated_at = ?
      WHERE order_id = ?
        AND station = status
    `).run(holdStation, holdStation, timestamp, orderId);

    db.prepare(`
      UPDATE orders
      SET status = ?, cleancloud_status = ?, ready_to_place = 0, ready_for_pickup = 0, updated_at = ?
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
        basket: getBasketPayload({
          ...basket,
          station: holdStation,
          status: holdStation
        })
      }
    };
  }

  return {
    getBasketPayload,
    getBasketWithOrderByQr,
    listReworkRequestsByOrder,
    listPendingReworkRequestsByBasketId,
    listPendingQcTransferTasks,
    inspectQcBasket,
    createReworkRequestFromQc,
    approveReworkRequest,
    declineReworkRequest,
    confirmQcTransferTask,
    rejectBasketFromQc
  };
}

module.exports = {
  createReworkWorkflow
};
