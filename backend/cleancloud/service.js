const crypto = require("crypto");

function createCleanCloudService(options) {
  const {
    db,
    apiBase,
    apiToken,
    syncRetryLimit = 5,
    nowIso,
    getOrderDetails
  } = options;

  let syncInProgress = false;

  function isCleanCloudSuccess(value) {
    if (value === true) return true;
    if (typeof value === "string") return value.toLowerCase() === "true";
    return false;
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function normalizeStatusCode(value) {
    const asText = String(value ?? "").trim();
    if (asText === "0" || asText === "1" || asText === "2" || asText === "4" || asText === "5") {
      return asText;
    }
    return null;
  }

  function mapLocalStatusToCleanCloudStatusCode(value, options = {}) {
    const allowCompleted = Boolean(options.allowCompleted);
    const normalizedCode = normalizeStatusCode(value);
    if (normalizedCode) {
      if (normalizedCode === "2" && !allowCompleted) {
        return null;
      }
      return normalizedCode;
    }

    const normalizedText = String(value ?? "").trim().toLowerCase();
    if (!normalizedText) return null;

    if (
      normalizedText === "новый заказ" ||
      normalizedText === "в работе" ||
      normalizedText === "sorting" ||
      normalizedText === "sorted" ||
      normalizedText === "washing" ||
      normalizedText === "qc" ||
      normalizedText === "drying" ||
      normalizedText === "ironing"
    ) {
      return "0";
    }
    if (normalizedText === "готов к выдаче" || normalizedText === "pickup") {
      return "1";
    }
    if (allowCompleted && (normalizedText === "завершён" || normalizedText === "завершен" || normalizedText === "overview" || normalizedText === "completed")) {
      return "2";
    }
    return null;
  }

  function mapCleanCloudStatusToLocalOrderState(statusCode) {
    const code = normalizeStatusCode(statusCode);
    if (code === "0") {
      return {
        status: "washing",
        cleancloudStatus: "В работе",
        readyForPickup: false
      };
    }
    if (code === "1") {
      return {
        status: "pickup",
        cleancloudStatus: "Готов к выдаче",
        readyForPickup: true
      };
    }
    if (code === "2") {
      return {
        status: "overview",
        cleancloudStatus: "Завершён",
        readyForPickup: false
      };
    }
    if (code === "4" || code === "5") {
      return {
        status: "overview",
        cleancloudStatus: "Отменён",
        readyForPickup: false
      };
    }
    return null;
  }

  function isLikelyNumericOrderId(orderId) {
    return /^\d+$/.test(String(orderId ?? ""));
  }

  function toNullableTrimmedText(value) {
    const text = String(value ?? "").trim();
    return text ? text : null;
  }

  function toNullableWeight(value) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).replace(",", ".").trim();
    if (!normalized) return null;
    const weight = Number(normalized);
    if (!Number.isFinite(weight) || weight <= 0) return null;
    return Number(weight.toFixed(2));
  }

  function queueSync(orderId, action, payload) {
    const createdAt = nowIso();
    const payloadJson = JSON.stringify(payload);
    const duplicate = db.prepare(`
      SELECT id
      FROM sync_queue
      WHERE order_id = ? AND action = ? AND payload = ? AND status IN ('pending', 'processing')
      LIMIT 1
    `).get(orderId, action, payloadJson);

    if (duplicate) {
      return { ok: true, queued: false, reason: "duplicate" };
    }

    db.prepare(`
      INSERT INTO sync_queue (order_id, action, payload, status, created_at, processed_at, attempts, last_error)
      VALUES (?, ?, ?, 'pending', ?, NULL, 0, NULL)
    `).run(orderId, action, payloadJson, createdAt);
    return { ok: true, queued: true };
  }

  async function callCleanCloudUpdateOrder(orderId, statusCode) {
    const response = await fetch(`${apiBase}/updateOrder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_token: apiToken,
        orderID: String(orderId),
        status: String(statusCode)
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}`, details: data };
    }
    if (!isCleanCloudSuccess(data.Success)) {
      return { ok: false, error: data.Error || "CleanCloud returned Success=false", details: data };
    }

    return { ok: true, data };
  }

  async function callCleanCloudGetOrders(params = {}) {
    const response = await fetch(`${apiBase}/getOrders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_token: apiToken,
        ...params
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}`, details: data };
    }
    if (!isCleanCloudSuccess(data.Success)) {
      return { ok: false, error: data.Error || "CleanCloud getOrders returned Success=false", details: data };
    }

    return { ok: true, data };
  }

  async function callCleanCloudGetCustomer(customerId) {
    const response = await fetch(`${apiBase}/getCustomer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_token: apiToken,
        customerID: String(customerId)
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}`, details: data };
    }
    if (!isCleanCloudSuccess(data.Success)) {
      return { ok: false, error: data.Error || "CleanCloud getCustomer returned Success=false", details: data };
    }

    return { ok: true, data };
  }

  async function enrichOrderContactFromCleanCloud(orderId, actor) {
    const order = db.prepare(`
      SELECT id, public_id, cleancloud_order_id, customer_name, customer_id, order_weight, customer_phone, customer_email
      FROM orders
      WHERE id = ?
    `).get(orderId);
    if (!order) {
      return { error: "Заказ не найден", status: 404 };
    }
    if (!apiToken) {
      return { error: "CLEAN_CLOUD_API_TOKEN is not set", status: 400 };
    }
    if (!isLikelyNumericOrderId(order.cleancloud_order_id)) {
      return { error: "cleancloud_order_id должен быть числовым для getOrders", status: 400 };
    }

    const orderResult = await callCleanCloudGetOrders({ orderID: String(order.cleancloud_order_id) });
    if (!orderResult.ok) {
      return { error: `Не удалось получить заказ из CleanCloud: ${orderResult.error}`, status: 502 };
    }

    const cleanCloudOrder = Array.isArray(orderResult.data?.Orders) ? orderResult.data.Orders[0] : null;
    if (!cleanCloudOrder) {
      return { error: "CleanCloud не вернул заказ по orderID", status: 404 };
    }

    const customerId = toNullableTrimmedText(cleanCloudOrder.customerID);
    const weight = toNullableWeight(cleanCloudOrder.weight);

    let customerName = null;
    let customerPhone = null;
    let customerEmail = null;
    if (customerId) {
      const customerResult = await callCleanCloudGetCustomer(customerId);
      if (customerResult.ok) {
        const customer = customerResult.data?.Customer && typeof customerResult.data.Customer === "object"
          ? customerResult.data.Customer
          : customerResult.data;
        customerName = toNullableTrimmedText(customer.Name);
        customerPhone = toNullableTrimmedText(customer.Tel);
        customerEmail = toNullableTrimmedText(customer.Email);
      }
    }

    const updatedParts = [];
    const updates = [];
    const params = [];

    const oldCustomerId = toNullableTrimmedText(order.customer_id);
    const oldWeight = toNullableWeight(order.order_weight);
    const oldPhone = toNullableTrimmedText(order.customer_phone);
    const oldEmail = toNullableTrimmedText(order.customer_email);
    const oldName = toNullableTrimmedText(order.customer_name);

    if (customerId && customerId !== oldCustomerId) {
      updates.push("customer_id = ?");
      params.push(customerId);
    }
    if (weight !== null && weight !== oldWeight) {
      updates.push("order_weight = ?");
      params.push(weight);
      updatedParts.push(`вес: ${weight} кг`);
    }
    if (customerPhone && customerPhone !== oldPhone) {
      updates.push("customer_phone = ?");
      params.push(customerPhone);
      updatedParts.push(`телефон: ${customerPhone}`);
    }
    if (customerEmail && customerEmail !== oldEmail) {
      updates.push("customer_email = ?");
      params.push(customerEmail);
      updatedParts.push(`email: ${customerEmail}`);
    }
    if (customerName && customerName !== oldName) {
      updates.push("customer_name = ?");
      params.push(customerName);
      updatedParts.push(`имя: ${customerName}`);
    }

    const timestamp = nowIso();
    if (updates.length > 0) {
      updates.push("updated_at = ?");
      params.push(timestamp, orderId);
      db.prepare(`
        UPDATE orders
        SET ${updates.join(", ")}
        WHERE id = ?
      `).run(...params);
    }

    const updateSummary = updatedParts.length
      ? `Обновлены данные из CleanCloud: ${updatedParts.join(", ")}.`
      : "CleanCloud ответил, но новых данных (вес/телефон/email) не было.";

    if (updatedParts.length > 0) {
      db.prepare(`
        INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
        VALUES (?, NULL, 'overview', ?, 'ok', ?, ?)
      `).run(orderId, actor, updateSummary, timestamp);
    }

    return {
      ok: true,
      message: updateSummary,
      order: getOrderDetails(orderId)
    };
  }

  function markSyncQueueProcessed(id, note = null) {
    db.prepare(`
      UPDATE sync_queue
      SET status = 'processed', processed_at = ?, last_error = ?
      WHERE id = ?
    `).run(nowIso(), note, id);
  }

  function normalizeSyncQueueError(errorText) {
    const text = String(errorText || "").trim();
    if (!text) return "";

    const lower = text.toLowerCase();
    if (lower.includes("clean_cloud_api_token is not set")) {
      return "Токен CleanCloud не задан (CLEAN_CLOUD_API_TOKEN).";
    }
    if (lower.includes("fetch failed")) {
      return "Нет соединения с CleanCloud (fetch failed).";
    }
    if (lower.includes("timed out")) {
      return "Таймаут запроса к CleanCloud.";
    }
    if (lower.includes("unknown status mapping")) {
      return "Не удалось сопоставить локальный статус со статусом CleanCloud.";
    }
    if (lower.includes("invalid payload json")) {
      return "Некорректный payload в очереди sync.";
    }
    if (lower.includes("returned success=false")) {
      return `CleanCloud отклонил запрос: ${text}`;
    }

    return text;
  }

  function markSyncQueueRetry(id, attempts, errorText) {
    const nextAttempts = attempts + 1;
    const shouldFail = nextAttempts >= syncRetryLimit;
    const status = shouldFail ? "failed" : "pending";
    const processedAt = shouldFail ? nowIso() : null;
    const errorMessage = normalizeSyncQueueError(errorText);
    db.prepare(`
      UPDATE sync_queue
      SET status = ?, attempts = ?, last_error = ?, processed_at = ?
      WHERE id = ?
    `).run(status, nextAttempts, errorMessage, processedAt, id);
  }

  function keepSyncQueuePending(id, errorText) {
    const errorMessage = normalizeSyncQueueError(errorText);
    db.prepare(`
      UPDATE sync_queue
      SET status = 'pending', last_error = ?, processed_at = NULL
      WHERE id = ?
    `).run(errorMessage, id);
  }

  function listPendingSyncItems(limit = 20, orderId = null) {
    if (Number.isFinite(orderId) && orderId > 0) {
      return db.prepare(`
        SELECT id, action, payload, attempts
        FROM sync_queue
        WHERE status = 'pending' AND order_id = ?
        ORDER BY id
        LIMIT ?
      `).all(orderId, limit);
    }

    return db.prepare(`
      SELECT id, action, payload, attempts
      FROM sync_queue
      WHERE status = 'pending'
      ORDER BY id
      LIMIT ?
    `).all(limit);
  }

  function retryFailedSyncByOrder(orderId) {
    const totalRows = db.prepare(`
      SELECT COUNT(*) AS count
      FROM sync_queue
      WHERE order_id = ?
    `).get(orderId).count;

    if (!totalRows) {
      return {
        error: `Для заказа #${orderId} в очереди синка записей нет.`,
        status: 404
      };
    }

    const failedRows = db.prepare(`
      UPDATE sync_queue
      SET status = 'pending', attempts = 0, last_error = NULL, processed_at = NULL
      WHERE order_id = ? AND status = 'failed'
    `).run(orderId).changes;

    return {
      ok: true,
      orderId,
      retried: failedRows,
      message: failedRows > 0
        ? `Заказ #${orderId}: в retry отправлено ${failedRows} записей sync.`
        : `Заказ #${orderId}: failed-записей нет, нечего отправлять в retry.`
    };
  }

  async function processSyncQueue(options = {}) {
    if (syncInProgress) return;
    syncInProgress = true;

    const orderIdFilter = Number(options?.orderId);
    const scopedOrderId = Number.isFinite(orderIdFilter) && orderIdFilter > 0
      ? orderIdFilter
      : null;
    const pending = listPendingSyncItems(20, scopedOrderId);

    try {
      for (const item of pending) {
        db.prepare("UPDATE sync_queue SET status = 'processing' WHERE id = ? AND status = 'pending'").run(item.id);

        if (item.action !== "cleancloud.status") {
          markSyncQueueProcessed(item.id, "Skipped unsupported action");
          continue;
        }

        const payload = safeJsonParse(item.payload);
        if (!payload) {
          markSyncQueueRetry(item.id, item.attempts, "Invalid payload JSON");
          continue;
        }

        const statusCode = mapLocalStatusToCleanCloudStatusCode(payload.status);
        if (!statusCode) {
          markSyncQueueRetry(item.id, item.attempts, "Unknown status mapping");
          continue;
        }

        if (!apiToken) {
          keepSyncQueuePending(item.id, "Blocked: CLEAN_CLOUD_API_TOKEN is not set");
          break;
        }

        if (!isLikelyNumericOrderId(payload.orderId)) {
          markSyncQueueProcessed(item.id, "Skipped: cleancloud order id is not numeric");
          continue;
        }

        try {
          const result = await callCleanCloudUpdateOrder(payload.orderId, statusCode);
          if (result.ok) {
            markSyncQueueProcessed(item.id, null);
          } else {
            markSyncQueueRetry(item.id, item.attempts, result.error);
          }
        } catch (error) {
          markSyncQueueRetry(item.id, item.attempts, error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      syncInProgress = false;
    }
  }

  function listSyncQueueItems(limit = 25) {
    return db.prepare(`
      SELECT id, order_id, action, payload, status, attempts, last_error, created_at, processed_at
      FROM sync_queue
      ORDER BY id DESC
      LIMIT ?
    `).all(limit).map((item) => ({
      ...item,
      last_error: item.last_error ? normalizeSyncQueueError(item.last_error) : null
    }));
  }

  function listWebhookEvents(limit = 25) {
    return db.prepare(`
      SELECT id, source, event_key, status, message, received_at, processed_at
      FROM webhook_events
      ORDER BY id DESC
      LIMIT ?
    `).all(limit);
  }

  function getWebhookEventKey(payload) {
    const candidates = [
      payload?.event_id,
      payload?.eventID,
      payload?.eventId,
      payload?.webhook_id,
      payload?.webhookID,
      payload?.idempotencyKey
    ].filter(Boolean);

    if (candidates.length > 0) {
      return String(candidates[0]);
    }

    return crypto.createHash("sha256").update(JSON.stringify(payload || {})).digest("hex");
  }

  function applyCleanCloudWebhookPayload(payload) {
    const cleanCloudOrderId = String(payload?.orderID || payload?.orderId || "").trim();
    const localStatus = mapCleanCloudStatusToLocalOrderState(payload?.status);

    if (!cleanCloudOrderId) {
      return { status: "ignored", message: "Missing orderID in webhook payload." };
    }

    if (!localStatus) {
      return { status: "ignored", message: "Unsupported or missing webhook status." };
    }

    const order = db.prepare(`
      SELECT id, public_id
      FROM orders
      WHERE cleancloud_order_id = ?
    `).get(cleanCloudOrderId);

    if (!order) {
      return { status: "ignored", message: `No local order mapped to cleancloud_order_id=${cleanCloudOrderId}.` };
    }

    const timestamp = nowIso();
    db.prepare(`
      UPDATE orders
      SET status = ?, cleancloud_status = ?, ready_for_pickup = ?, updated_at = ?
      WHERE id = ?
    `).run(localStatus.status, localStatus.cleancloudStatus, localStatus.readyForPickup ? 1 : 0, timestamp, order.id);

    db.prepare(`
      INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
      VALUES (?, NULL, 'overview', 'cleancloud_webhook', 'ok', ?, ?)
    `).run(order.id, `Webhook обновил статус заказа ${order.public_id}: ${localStatus.cleancloudStatus}.`, timestamp);

    return {
      status: "processed",
      message: `Order ${order.public_id} updated from webhook status ${payload.status}.`
    };
  }

  function handleCleanCloudWebhook(payload, source) {
    const eventKey = getWebhookEventKey(payload);
    const receivedAt = nowIso();

    try {
      db.prepare(`
        INSERT INTO webhook_events (source, event_key, payload, status, message, received_at, processed_at)
        VALUES (?, ?, ?, 'received', 'Received webhook', ?, NULL)
      `).run(source, eventKey, JSON.stringify(payload || {}), receivedAt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("UNIQUE constraint failed")) {
        return {
          ok: true,
          duplicate: true,
          eventKey,
          message: "Duplicate webhook ignored."
        };
      }
      throw error;
    }

    const result = applyCleanCloudWebhookPayload(payload || {});
    db.prepare(`
      UPDATE webhook_events
      SET status = ?, message = ?, processed_at = ?
      WHERE event_key = ?
    `).run(result.status, result.message, nowIso(), eventKey);

    return {
      ok: true,
      duplicate: false,
      eventKey,
      ...result
    };
  }

  return {
    mapLocalStatusToCleanCloudStatusCode,
    isLikelyNumericOrderId,
    callCleanCloudUpdateOrder,
    enrichOrderContactFromCleanCloud,
    queueSync,
    normalizeSyncQueueError,
    processSyncQueue,
    retryFailedSyncByOrder,
    listSyncQueueItems,
    listWebhookEvents,
    handleCleanCloudWebhook
  };
}

module.exports = {
  createCleanCloudService
};
