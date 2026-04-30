const crypto = require("crypto");

function createCleanCloudService(options) {
  const {
    cleanCloudRepository,
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
      normalizedText === "new order" ||
      normalizedText === "в работе" ||
      normalizedText === "in progress" ||
      normalizedText === "sorting" ||
      normalizedText === "sorted" ||
      normalizedText === "washing" ||
      normalizedText === "qc" ||
      normalizedText === "drying" ||
      normalizedText === "ironing"
    ) {
      return "0";
    }
    if (normalizedText === "готов к выдаче" || normalizedText === "ready for pickup" || normalizedText === "pickup") {
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
          cleancloudStatus: "In progress",
          readyForPickup: false
        };
    }
    if (code === "1") {
        return {
          status: "pickup",
          cleancloudStatus: "Ready for pickup",
          readyForPickup: true
        };
    }
    if (code === "2") {
        return {
          status: "overview",
          cleancloudStatus: "Completed",
          readyForPickup: false
        };
    }
    if (code === "4" || code === "5") {
        return {
          status: "overview",
          cleancloudStatus: "Cancelled",
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
    const duplicate = cleanCloudRepository.findPendingSyncDuplicate(orderId, action, payloadJson);

    if (duplicate) {
      return { ok: true, queued: false, reason: "duplicate" };
    }

    cleanCloudRepository.insertSyncQueueItem({ orderId, action, payloadJson, createdAt });
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
    const order = cleanCloudRepository.findOrderContactById(orderId);
    if (!order) {
      return { error: "Order not found", status: 404 };
    }
    if (!apiToken) {
      return { error: "CLEAN_CLOUD_API_TOKEN is not set", status: 400 };
    }
    if (!isLikelyNumericOrderId(order.cleancloud_order_id)) {
      return { error: "cleancloud_order_id must be numeric for getOrders", status: 400 };
    }

    const orderResult = await callCleanCloudGetOrders({ orderID: String(order.cleancloud_order_id) });
    if (!orderResult.ok) {
      return { error: `Failed to fetch order from CleanCloud: ${orderResult.error}`, status: 502 };
    }

    const cleanCloudOrder = Array.isArray(orderResult.data?.Orders) ? orderResult.data.Orders[0] : null;
    if (!cleanCloudOrder) {
      return { error: "CleanCloud did not return order by orderID", status: 404 };
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
    const updates = {};

    const oldCustomerId = toNullableTrimmedText(order.customer_id);
    const oldWeight = toNullableWeight(order.order_weight);
    const oldPhone = toNullableTrimmedText(order.customer_phone);
    const oldEmail = toNullableTrimmedText(order.customer_email);
    const oldName = toNullableTrimmedText(order.customer_name);

    if (customerId && customerId !== oldCustomerId) {
      updates.customer_id = customerId;
    }
    if (weight !== null && weight !== oldWeight) {
      updates.order_weight = weight;
      updatedParts.push(`weight: ${weight} kg`);
    }
    if (customerPhone && customerPhone !== oldPhone) {
      updates.customer_phone = customerPhone;
      updatedParts.push(`phone: ${customerPhone}`);
    }
    if (customerEmail && customerEmail !== oldEmail) {
      updates.customer_email = customerEmail;
      updatedParts.push(`email: ${customerEmail}`);
    }
    if (customerName && customerName !== oldName) {
      updates.customer_name = customerName;
      updatedParts.push(`name: ${customerName}`);
    }

    const timestamp = nowIso();
    if (Object.keys(updates).length > 0) {
      cleanCloudRepository.updateOrderContact(orderId, updates, timestamp);
    }

    const updateSummary = updatedParts.length
      ? `Updated from CleanCloud: ${updatedParts.join(", ")}.`
      : "CleanCloud responded, but no new data (weight/phone/email) was found.";

    if (updatedParts.length > 0) {
      cleanCloudRepository.insertOverviewScanEvent({
        orderId,
        actor,
        message: updateSummary,
        timestamp
      });
    }

    return {
      ok: true,
      message: updateSummary,
      order: await getOrderDetails(orderId)
    };
  }

  function markSyncQueueProcessed(id, note = null) {
    cleanCloudRepository.markSyncQueueProcessed({ id, processedAt: nowIso(), note });
  }

  function normalizeSyncQueueError(errorText) {
    const text = String(errorText || "").trim();
    if (!text) return "";

    const lower = text.toLowerCase();
    if (lower.includes("clean_cloud_api_token is not set")) {
      return "CleanCloud token is missing (CLEAN_CLOUD_API_TOKEN).";
    }
    if (lower.includes("fetch failed")) {
      return "No connection to CleanCloud (fetch failed).";
    }
    if (lower.includes("timed out")) {
      return "CleanCloud request timeout.";
    }
    if (lower.includes("unknown status mapping")) {
      return "Failed to map local status to CleanCloud status.";
    }
    if (lower.includes("invalid payload json")) {
      return "Invalid payload in sync queue.";
    }
    if (lower.includes("returned success=false")) {
      return `CleanCloud rejected the request: ${text}`;
    }

    return text;
  }

  function markSyncQueueRetry(id, attempts, errorText) {
    const nextAttempts = attempts + 1;
    const shouldFail = nextAttempts >= syncRetryLimit;
    const status = shouldFail ? "failed" : "pending";
    const processedAt = shouldFail ? nowIso() : null;
    const errorMessage = normalizeSyncQueueError(errorText);
    cleanCloudRepository.markSyncQueueRetry({
      id,
      status,
      attempts: nextAttempts,
      errorMessage,
      processedAt
    });
  }

  function keepSyncQueuePending(id, errorText) {
    const errorMessage = normalizeSyncQueueError(errorText);
    cleanCloudRepository.keepSyncQueuePending({ id, errorMessage });
  }

  function listPendingSyncItems(limit = 20, orderId = null) {
    return cleanCloudRepository.listPendingSyncItems({ limit, orderId });
  }

  function retryFailedSyncByOrder(orderId) {
    const totalRows = cleanCloudRepository.countSyncQueueItemsByOrder(orderId);

    if (!totalRows) {
      return {
      error: `No sync queue records found for order #${orderId}.`,
        status: 404
      };
    }

    const failedRows = cleanCloudRepository.retryFailedSyncItemsByOrder(orderId);

    return {
      ok: true,
      orderId,
      retried: failedRows,
      message: failedRows > 0
      ? `Order #${orderId}: sent ${failedRows} failed sync records to retry.`
      : `Order #${orderId}: no failed records to retry.`
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
        cleanCloudRepository.markSyncQueueProcessing(item.id);

        if (item.action !== "cleancloud.status") {
          markSyncQueueProcessed(item.id, "Skipped unsupported action");
          continue;
        }

        const payload = safeJsonParse(item.payload);
        if (!payload) {
          markSyncQueueRetry(item.id, item.attempts, "Invalid payload JSON");
          continue;
        }

        const statusCode = mapLocalStatusToCleanCloudStatusCode(payload.status, {
          allowCompleted: payload.allowCompleted === true
        });
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
    return cleanCloudRepository.listSyncQueueItems(limit).map((item) => ({
      ...item,
      last_error: item.last_error ? normalizeSyncQueueError(item.last_error) : null
    }));
  }

  function listWebhookEvents(limit = 25) {
    return cleanCloudRepository.listWebhookEvents(limit);
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

    const order = cleanCloudRepository.findOrderByCleanCloudOrderId(cleanCloudOrderId);

    if (!order) {
      return { status: "ignored", message: `No local order mapped to cleancloud_order_id=${cleanCloudOrderId}.` };
    }

    if (localStatus.status === "pickup") {
      const basketSnapshot = cleanCloudRepository.getOrderBasketPickupSnapshot(order.id);
      const totalBaskets = Number(basketSnapshot?.total_baskets || 0);
      const pickupBaskets = Number(basketSnapshot?.pickup_baskets || 0);

      if (totalBaskets <= 0) {
        return {
          status: "ignored",
          message: `Webhook pickup ignored for ${order.public_id}: local order has no baskets.`
        };
      }
      if (pickupBaskets <= 0 || pickupBaskets < totalBaskets) {
        return {
          status: "ignored",
          message: `Webhook pickup ignored for ${order.public_id}: baskets are not fully on pickup (${pickupBaskets}/${totalBaskets}).`
        };
      }
    }

    const timestamp = nowIso();
    cleanCloudRepository.updateOrderFromWebhook({
      orderId: order.id,
      status: localStatus.status,
      cleancloudStatus: localStatus.cleancloudStatus,
      readyForPickup: localStatus.readyForPickup,
      timestamp
    });

    cleanCloudRepository.insertOverviewScanEvent({
      orderId: order.id,
      actor: "cleancloud_webhook",
      message: `Webhook updated order ${order.public_id}: ${localStatus.cleancloudStatus}.`,
      timestamp
    });

    return {
      status: "processed",
      message: `Order ${order.public_id} updated from webhook status ${payload.status}.`
    };
  }

  function handleCleanCloudWebhook(payload, source) {
    const eventKey = getWebhookEventKey(payload);
    const receivedAt = nowIso();

    try {
      cleanCloudRepository.insertWebhookEvent({
        source,
        eventKey,
        payloadJson: JSON.stringify(payload || {}),
        receivedAt
      });
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
    cleanCloudRepository.updateWebhookEvent({
      eventKey,
      status: result.status,
      message: result.message,
      processedAt: nowIso()
    });

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
