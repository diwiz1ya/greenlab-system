const { parsePositiveInt, parseRequiredString } = require("../http/validation");

function handleCleanCloudSyncRoutes(req, res, url, ctx) {
  const {
    readJson,
    json,
    requireAuth,
    requireManager,
    getSyncQueueSummary,
    handleCleanCloudWebhook,
    processSyncQueue,
    retryFailedSyncByOrder,
    listSyncQueueItems,
    listWebhookEvents,
    mapLocalStatusToCleanCloudStatusCode,
    isLikelyNumericOrderId,
    callCleanCloudUpdateOrder,
    enrichOrderContactFromCleanCloud,
    cleanCloudWebhookToken,
    cleanCloudApiToken
  } = ctx;

  if (req.method === "POST" && url.pathname === "/api/cleancloud/webhook") {
    if (cleanCloudWebhookToken) {
      const providedToken = req.headers["x-webhook-token"] || url.searchParams.get("token");
      if (String(providedToken || "") !== cleanCloudWebhookToken) {
        json(res, 401, { error: "Invalid webhook token" });
        return true;
      }
    }

    readJson(req)
      .then((body) => {
        const source = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
        const result = handleCleanCloudWebhook(body, String(source));
        json(res, 200, result);
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/sync-queue") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireManager(session, res)) return true;

    json(res, 200, {
      items: listSyncQueueItems(25),
      summary: getSyncQueueSummary()
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/sync/run") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireManager(session, res)) return true;

    readJson(req)
      .then(async (body) => {
        try {
          const hasOrderId = body && Object.prototype.hasOwnProperty.call(body, "orderId");
          const scopedOrderId = hasOrderId ? parsePositiveInt(body.orderId) : null;
          if (hasOrderId && !scopedOrderId) {
            json(res, 400, { error: "Нужен корректный orderId для sync run." });
            return;
          }

          await processSyncQueue({ orderId: scopedOrderId });
          json(res, 200, {
            ok: true,
            message: scopedOrderId
              ? `Sync запущен для заказа #${scopedOrderId}.`
              : "Очередь синхронизации запущена.",
            summary: getSyncQueueSummary()
          });
        } catch (error) {
          json(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      })
      .catch((error) => {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/sync/retry-order") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireManager(session, res)) return true;

    readJson(req)
      .then(async (body) => {
        try {
          const orderId = parsePositiveInt(body?.orderId);
          if (!orderId) {
            json(res, 400, { error: "Нужен корректный orderId для retry." });
            return;
          }

          const retryResult = retryFailedSyncByOrder(orderId);
          if (retryResult.error) {
            json(res, retryResult.status, { error: retryResult.error });
            return;
          }

          if (retryResult.retried > 0) {
            await processSyncQueue({ orderId });
          }

          json(res, 200, {
            ok: true,
            orderId,
            retried: retryResult.retried,
            message: retryResult.message,
            summary: getSyncQueueSummary()
          });
        } catch (error) {
          json(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      })
      .catch((error) => {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/webhooks/events") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireManager(session, res)) return true;

    const limitRaw = Number(url.searchParams.get("limit") || 25);
    const limit = Number.isInteger(limitRaw) ? Math.max(1, Math.min(limitRaw, 100)) : 25;
    json(res, 200, {
      total: limit,
      rows: listWebhookEvents(limit)
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/cleancloud/test-update") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireManager(session, res)) return true;

    readJson(req)
      .then(async (body) => {
        if (!cleanCloudApiToken) {
          json(res, 400, { error: "CLEAN_CLOUD_API_TOKEN is not set" });
          return;
        }

        const cleanCloudOrderId = parseRequiredString(body.orderId, { minLength: 1, maxLength: 64 });
        if (!cleanCloudOrderId || !isLikelyNumericOrderId(cleanCloudOrderId)) {
          json(res, 400, { error: "orderId must be a numeric CleanCloud order id" });
          return;
        }

        const statusText = parseRequiredString(body.status, { minLength: 1, maxLength: 64 });
        const statusCode = mapLocalStatusToCleanCloudStatusCode(statusText);
        if (!statusCode) {
          json(res, 400, { error: "Unknown status mapping. Use 0/1 or local status text (in-progress/ready)." });
          return;
        }

        const result = await callCleanCloudUpdateOrder(cleanCloudOrderId, statusCode);
        if (!result.ok) {
          json(res, 502, { ok: false, error: result.error });
          return;
        }

        json(res, 200, {
          ok: true,
          orderId: cleanCloudOrderId,
          status: statusCode
        });
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === "POST" && /^\/api\/orders\/\d+\/enrich-contact$/.test(url.pathname)) {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireManager(session, res)) return true;

    const parts = url.pathname.split("/");
    const orderId = parsePositiveInt(parts[3]);
    if (!orderId) {
      json(res, 400, { error: "Некорректный id заказа" });
      return true;
    }

    enrichOrderContactFromCleanCloud(orderId, session.username)
      .then((result) => {
        if (result.error) {
          json(res, result.status, { error: result.error });
          return;
        }
        json(res, 200, result);
      })
      .catch((error) => json(res, 500, { error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  return false;
}

module.exports = {
  handleCleanCloudSyncRoutes
};
