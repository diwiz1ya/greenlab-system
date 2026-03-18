function createOrderQueryService(db, options = {}) {
  const stationLabels = options.stationLabels || {};
  const holdStation = options.holdStation || "hold";

  function getOrderDetails(orderId) {
    const order = db.prepare(`
      SELECT id, public_id, cleancloud_order_id, customer_name, customer_id, order_weight, customer_phone, customer_email, service_tier, status,
             cleancloud_status, ready_for_pickup, created_at, updated_at
      FROM orders
      WHERE id = ?
    `).get(orderId);

    if (!order) {
      return null;
    }

    const baskets = db.prepare(`
      SELECT id, basket_code, basket_type, station, status, qr_code, created_at, updated_at
      FROM baskets
      WHERE order_id = ?
      ORDER BY id
    `).all(orderId);

    const scans = db.prepare(`
      SELECT id, station, actor, result, message, created_at, basket_id
      FROM scan_events
      WHERE order_id = ?
      ORDER BY datetime(created_at) DESC
      LIMIT 10
    `).all(orderId);

    return {
      ...order,
      ready_for_pickup: Boolean(order.ready_for_pickup),
      baskets,
      scans
    };
  }

  function getOverview() {
    const counts = {};
    for (const station of Object.keys(stationLabels)) {
      counts[station] = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE status = ?").get(station).count;
    }
    counts.sorting = db.prepare(`
      SELECT COUNT(*) AS count
      FROM orders
      WHERE status IN ('sorting', 'sorted')
    `).get().count;
    counts.hold = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE status = ?").get(holdStation).count;
    counts.ready = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE ready_for_pickup = 1").get().count;

    const orders = db.prepare(`
      SELECT id, public_id, cleancloud_order_id, customer_name, customer_id, order_weight, customer_phone, customer_email, service_tier, status, cleancloud_status, ready_for_pickup, updated_at
      FROM orders
      ORDER BY id
    `).all().map((row) => ({ ...row, ready_for_pickup: Boolean(row.ready_for_pickup) }));

    return { counts, orders };
  }

  function listStationOrders(station) {
    if (station === "sorting") {
      return db.prepare(`
        SELECT id, public_id, cleancloud_order_id, customer_name, customer_id, order_weight, customer_phone, customer_email, service_tier, status, cleancloud_status, ready_for_pickup, updated_at
        FROM orders
        WHERE status IN ('sorting', 'sorted')
        ORDER BY CASE WHEN status = 'sorting' THEN 0 ELSE 1 END, id
      `).all().map((row) => ({ ...row, ready_for_pickup: Boolean(row.ready_for_pickup) }));
    }

    return db.prepare(`
      SELECT id, public_id, cleancloud_order_id, customer_name, customer_id, order_weight, customer_phone, customer_email, service_tier, status, cleancloud_status, ready_for_pickup, updated_at
      FROM orders
      WHERE status = ?
      ORDER BY id
    `).all(station).map((row) => ({ ...row, ready_for_pickup: Boolean(row.ready_for_pickup) }));
  }

  return {
    getOrderDetails,
    getOverview,
    listStationOrders
  };
}

module.exports = {
  createOrderQueryService
};
