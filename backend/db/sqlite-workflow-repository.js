function createSqliteWorkflowRepository(db) {
  const normalizeMachineLoadStatusesStmt = db.prepare(`
    UPDATE machine_loads
    SET status = 'active'
    WHERE status NOT IN ('active', 'completed', 'cancelled')
  `);
  const listOrderProgressStationsStmt = db.prepare(`
    SELECT station, COUNT(*) AS count
    FROM baskets
    WHERE order_id = ?
      AND station = status
      AND station != 'archived'
    GROUP BY station
  `);
  const findPickupAssemblyOrderStmt = db.prepare(`
    SELECT id, status, ready_for_pickup
    FROM orders
    WHERE id = ?
  `);
  const updateOrderReadyToPlaceStmt = db.prepare(`
    UPDATE orders
    SET ready_to_place = ?, updated_at = ?
    WHERE id = ?
  `);
  const findPickupInvariantOrderStmt = db.prepare(`
    SELECT id, public_id, status, ready_to_place, ready_for_pickup
    FROM orders
    WHERE id = ?
    LIMIT 1
  `);
  const listActiveBasketsByOrderStmt = db.prepare(`
    SELECT id, basket_code, qr_code, station, status
    FROM baskets
    WHERE order_id = ?
      AND status != 'archived'
    ORDER BY id ASC
  `);
  const listActivePickupPlacementsByOrderStmt = db.prepare(`
    SELECT slot_index, bin_qr_code, location_qr_code
    FROM pickup_order_placements
    WHERE order_id = ?
      AND released_at IS NULL
    ORDER BY slot_index ASC, id ASC
  `);
  const updateOrderStatusForPickupStmt = db.prepare(`
    UPDATE orders
    SET status = ?, cleancloud_status = ?, updated_at = ?
    WHERE id = ?
  `);
  const updateOrderStatusAndClearPickupFlagsStmt = db.prepare(`
    UPDATE orders
    SET status = ?, cleancloud_status = ?, ready_to_place = 0, ready_for_pickup = 0, updated_at = ?
    WHERE id = ?
  `);
  const listPickupAssemblyBasketsStmt = db.prepare(`
    SELECT id, basket_code, qr_code
    FROM baskets
    WHERE order_id = ?
      AND station = 'pickup'
      AND status = 'pickup'
  `);
  const updateBasketQrStmt = db.prepare(`
    UPDATE baskets
    SET qr_code = ?, updated_at = ?
    WHERE id = ?
  `);

  return {
    normalizeMachineLoadStatuses: () => normalizeMachineLoadStatusesStmt.run(),
    listOrderProgressStations: (orderId) => listOrderProgressStationsStmt.all(orderId),
    findPickupAssemblyOrder: (orderId) => findPickupAssemblyOrderStmt.get(orderId),
    updateOrderReadyToPlace: ({ orderId, readyToPlace, timestamp }) => updateOrderReadyToPlaceStmt.run(readyToPlace ? 1 : 0, timestamp, orderId),
    findPickupInvariantOrder: (orderId) => findPickupInvariantOrderStmt.get(orderId),
    listActiveBasketsByOrder: (orderId) => listActiveBasketsByOrderStmt.all(orderId),
    listActivePickupPlacementsByOrder: (orderId) => listActivePickupPlacementsByOrderStmt.all(orderId),
    updateOrderStatusForPickup: ({ orderId, status, cleancloudStatus, timestamp }) => updateOrderStatusForPickupStmt.run(status, cleancloudStatus, timestamp, orderId),
    updateOrderStatusAndClearPickupFlags: ({ orderId, status, cleancloudStatus, timestamp }) => updateOrderStatusAndClearPickupFlagsStmt.run(status, cleancloudStatus, timestamp, orderId),
    listPickupAssemblyBaskets: (orderId) => listPickupAssemblyBasketsStmt.all(orderId),
    updateBasketQr: ({ basketId, qrCode, timestamp }) => updateBasketQrStmt.run(qrCode, timestamp, basketId)
  };
}

module.exports = {
  createSqliteWorkflowRepository
};
