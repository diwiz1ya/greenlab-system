function createSqlitePickupWorkbenchRepository(db) {
  const excludedAssemblyStations = ["rework_transferred", "archived"];
  const excludedPlaceholders = excludedAssemblyStations.map(() => "?").join(", ");

  const getOrderAssemblyProgressStmt = db.prepare(`
    SELECT
      COUNT(*) AS total_baskets,
      SUM(CASE WHEN station = 'pickup' AND status = 'pickup' THEN 1 ELSE 0 END) AS baskets_at_pickup
    FROM baskets
    WHERE order_id = ?
      AND station = status
      AND station NOT IN (${excludedPlaceholders})
  `);
  const listPickupScanProgressRowsStmt = db.prepare(`
    SELECT
      b.id,
      b.basket_code,
      b.qr_code,
      EXISTS (
        SELECT 1
        FROM scan_events se
        WHERE se.order_id = b.order_id
          AND se.basket_id = b.id
          AND se.station = 'pickup'
          AND se.result = 'ok'
        LIMIT 1
      ) AS scanned
    FROM baskets b
    WHERE b.order_id = ?
      AND b.station = b.status
      AND b.station NOT IN (${excludedPlaceholders})
    ORDER BY b.id
  `);
  const listPickupPlacementRowsStmt = db.prepare(`
    SELECT
      p.slot_index,
      p.bin_qr_code,
      p.location_qr_code,
      l.label AS location_label,
      p.placed_by,
      p.placed_at
    FROM pickup_order_placements p
    LEFT JOIN pickup_locations l ON l.qr_code = p.location_qr_code
    WHERE p.order_id = ?
      AND p.released_at IS NULL
    ORDER BY p.slot_index ASC, p.id ASC
  `);
  const listAssemblyOrdersStmt = db.prepare(`
    SELECT
      id, public_id, cleancloud_order_id, customer_name, customer_id, order_weight,
      customer_phone, customer_email, service_tier, status, cleancloud_status,
      ready_to_place, ready_for_pickup, updated_at
    FROM orders
    WHERE COALESCE(ready_for_pickup, 0) = 0
      AND COALESCE(ready_to_place, 0) = 0
      AND EXISTS (
        SELECT 1
        FROM baskets b
        WHERE b.order_id = orders.id
          AND b.station = 'pickup'
          AND b.status = 'pickup'
      )
    ORDER BY id
  `);
  const listReadyToPlaceOrdersStmt = db.prepare(`
    SELECT
      id, public_id, cleancloud_order_id, customer_name, customer_id, order_weight,
      customer_phone, customer_email, service_tier, status, cleancloud_status,
      ready_to_place, ready_for_pickup, updated_at
    FROM orders
    WHERE COALESCE(ready_for_pickup, 0) = 0
      AND COALESCE(ready_to_place, 0) = 1
    ORDER BY id
  `);
  const listPlacedOrdersStmt = db.prepare(`
    SELECT
      id, public_id, cleancloud_order_id, customer_name, customer_id, order_weight,
      customer_phone, customer_email, service_tier, status, cleancloud_status,
      ready_to_place, ready_for_pickup, updated_at
    FROM orders
    WHERE status = 'pickup'
      AND COALESCE(ready_for_pickup, 0) = 1
    ORDER BY id
  `);

  function getOrderAssemblyProgressRow(orderId) {
    return getOrderAssemblyProgressStmt.get(orderId, ...excludedAssemblyStations);
  }

  function listPickupScanProgressRows(orderId) {
    return listPickupScanProgressRowsStmt.all(orderId, ...excludedAssemblyStations);
  }

  function listPickupPlacementRows(orderId) {
    return listPickupPlacementRowsStmt.all(orderId);
  }

  return {
    getOrderAssemblyProgressRow,
    listPickupScanProgressRows,
    listPickupPlacementRows,
    listAssemblyOrders: () => listAssemblyOrdersStmt.all(),
    listReadyToPlaceOrders: () => listReadyToPlaceOrdersStmt.all(),
    listPlacedOrders: () => listPlacedOrdersStmt.all()
  };
}

module.exports = {
  createSqlitePickupWorkbenchRepository
};
