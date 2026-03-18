const { parsePositiveInt, parseRequiredString, parseStation } = require("../http/validation");

function handleWorkflowRoutes(req, res, url, ctx) {
  const {
    readJson,
    json,
    requireAuth,
    requireManager,
    requireStationAccess,
    stationLabels,
    listPickupWorkbenchOrders,
    createBaskets,
    scanBasket,
    rejectBasketFromQc,
    inspectQcBasket,
    completePickup,
    releaseOrderFromHold
  } = ctx;

  if (req.method === "POST" && /^\/api\/orders\/\d+\/release-hold$/.test(url.pathname)) {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireManager(session, res)) return true;

    const parts = url.pathname.split("/");
    const orderId = parsePositiveInt(parts[3]);
    if (!orderId) {
      json(res, 400, { error: "Некорректный id заказа" });
      return true;
    }

    const result = releaseOrderFromHold(orderId, session.username);
    if (result.error) {
      json(res, result.status, { error: result.error });
      return true;
    }

    json(res, 200, result);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/pickup/workbench") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireStationAccess(session, "pickup", res)) return true;

    json(res, 200, { orders: listPickupWorkbenchOrders() });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/sorting/create-baskets") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireStationAccess(session, "sorting", res)) return true;

    readJson(req)
      .then((body) => {
        const orderId = parsePositiveInt(body.orderId);
        if (!orderId) {
          json(res, 400, { error: "Некорректный id заказа" });
          return;
        }

        const types = Array.isArray(body.types)
          ? body.types
              .map((type) => String(type || "").trim())
              .filter(Boolean)
              .slice(0, 20)
          : [];
        const result = createBaskets(orderId, types, session.username);
        if (result.error) {
          json(res, result.status, { error: result.error });
          return;
        }
        json(res, 200, result);
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/scan") {
    const session = requireAuth(req, res);
    if (!session) return true;

    readJson(req)
      .then((body) => {
        const station = parseStation(stationLabels, body.station);
        if (!station) {
          json(res, 400, { error: "Неизвестная станция" });
          return;
        }
        if (!requireStationAccess(session, station, res)) return;

        const qrCode = parseRequiredString(body.qrCode, { minLength: 3, maxLength: 128 });
        if (!qrCode) {
          json(res, 400, { error: "QR-код не передан." });
          return;
        }

        const result = scanBasket(station, qrCode, session.username);
        json(res, result.status, result.payload);
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/qc/reject") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireStationAccess(session, "qc", res)) return true;

    readJson(req)
      .then((body) => {
        const qrCode = parseRequiredString(body.qrCode, { minLength: 3, maxLength: 128 });
        if (!qrCode) {
          json(res, 400, { error: "QR-код не передан." });
          return;
        }
        const result = rejectBasketFromQc(qrCode, session.username, body.reason);
        json(res, result.status, result.payload);
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/qc/inspect") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireStationAccess(session, "qc", res)) return true;

    readJson(req)
      .then((body) => {
        const qrCode = parseRequiredString(body.qrCode, { minLength: 3, maxLength: 128 });
        if (!qrCode) {
          json(res, 400, { error: "QR-код не передан." });
          return;
        }
        const result = inspectQcBasket(qrCode);
        json(res, result.status, result.payload);
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/pickup/complete") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireStationAccess(session, "pickup", res)) return true;

    readJson(req)
      .then((body) => {
        const orderId = parsePositiveInt(body.orderId);
        if (!orderId) {
          json(res, 400, { error: "Некорректный id заказа" });
          return;
        }

        const result = completePickup(orderId, session.username);
        if (result.error) {
          json(res, result.status, { error: result.error });
          return;
        }
        json(res, 200, result);
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  return false;
}

module.exports = {
  handleWorkflowRoutes
};
