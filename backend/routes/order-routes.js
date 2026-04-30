const { parsePositiveInt, parseStation } = require("../http/validation");

async function handleOrderRoutes(req, res, url, ctx) {
  const {
    requireAuth,
    requireStationAccess,
    json,
    stationLabels,
    getOrderDetails,
    canAccessOrderDetails,
    listStationOrders,
    getQcLiveMetrics
  } = ctx;

  if (req.method === "GET" && url.pathname.startsWith("/api/orders/")) {
    const session = requireAuth(req, res);
    if (!session) return true;

    const id = parsePositiveInt(url.pathname.split("/").pop());
    if (!id) {
      json(res, 400, { error: "Invalid order id" });
      return true;
    }

    const order = await getOrderDetails(id);
    if (!order) {
      json(res, 404, { error: "Order not found" });
      return true;
    }
    if (!canAccessOrderDetails(session, order)) {
      json(res, 403, { error: "No access to this order details" });
      return true;
    }

    json(res, 200, order);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/orders") {
    const session = requireAuth(req, res);
    if (!session) return true;

    const station = parseStation(stationLabels, url.searchParams.get("station"));
    if (!station) {
      json(res, 400, { error: "Unknown station" });
      return true;
    }
    if (!requireStationAccess(session, station, res)) return true;

    const orders = await listStationOrders(station);
    if (station === "qc") {
      json(res, 200, {
        orders,
        metrics: await getQcLiveMetrics()
      });
      return true;
    }

    json(res, 200, { orders });
    return true;
  }

  return false;
}

module.exports = {
  handleOrderRoutes
};
