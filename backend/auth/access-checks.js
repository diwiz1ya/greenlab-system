function hasManagerRole(session) {
  return session?.role === "manager";
}

function hasStationAccess(session, station) {
  const allowedStations = Array.isArray(session?.allowedStations) ? session.allowedStations : [];
  return allowedStations.includes(station);
}

function canAccessOrderDetails(session, order) {
  if (!session || !order) return false;
  if (hasManagerRole(session)) return true;

  const orderStatus = String(order.status || "").trim();
  const normalizedStation = orderStatus === "sorted" ? "sorting" : orderStatus;

  if (hasStationAccess(session, normalizedStation)) {
    return true;
  }

  const baskets = Array.isArray(order.baskets) ? order.baskets : [];
  return baskets.some((basket) => hasStationAccess(session, basket.station));
}

module.exports = {
  hasManagerRole,
  hasStationAccess,
  canAccessOrderDetails
};
