const { parsePositiveInt, parseStation } = require("../http/validation");

function handleOrderRoutes(req, res, url, ctx) {
  const {
    requireAuth,
    requireStationAccess,
    json,
    stationLabels,
    getOrderDetails,
    canAccessOrderDetails,
    listStationOrders
  } = ctx;

  if (req.method === "GET" && url.pathname.startsWith("/api/orders/")) {
    const session = requireAuth(req, res);
    if (!session) return true;

    const id = parsePositiveInt(url.pathname.split("/").pop());
    if (!id) {
      json(res, 400, { error: "Некорректный id заказа" });
      return true;
    }

    const order = getOrderDetails(id);
    if (!order) {
      json(res, 404, { error: "Заказ не найден" });
      return true;
    }
    if (!canAccessOrderDetails(session, order)) {
      json(res, 403, { error: "Нет доступа к деталям этого заказа" });
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
      json(res, 400, { error: "Неизвестная станция" });
      return true;
    }
    if (!requireStationAccess(session, station, res)) return true;

    json(res, 200, { orders: listStationOrders(station) });
    return true;
  }

  return false;
}

module.exports = {
  handleOrderRoutes
};
