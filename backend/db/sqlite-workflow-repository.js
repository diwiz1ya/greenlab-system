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
  const getMachineWithActiveLoadStmt = db.prepare(`
    SELECT
      m.id,
      m.machine_code,
      m.station,
      m.machine_type,
      m.display_name,
      m.is_active,
      ml.id AS active_load_id,
      ml.started_at AS active_load_started_at,
      ml.started_by AS active_load_started_by
    FROM laundry_machines m
    LEFT JOIN machine_loads ml
      ON ml.machine_id = m.id
     AND ml.status = 'active'
    WHERE m.station = ?
      AND m.machine_code = ?
      AND m.is_active = 1
    LIMIT 1
  `);
  const listMachineWorkbenchRowsStmt = db.prepare(`
    SELECT
      m.id,
      m.machine_code,
      m.station,
      m.machine_type,
      m.display_name,
      ml.id AS active_load_id,
      ml.status AS active_load_status,
      ml.started_at AS active_load_started_at,
      ml.started_by AS active_load_started_by,
      ml.completed_at AS active_load_completed_at,
      ml.completed_by AS active_load_completed_by,
      (
        SELECT COUNT(*)
        FROM machine_load_baskets mlb
        WHERE mlb.load_id = ml.id
      ) AS active_load_baskets_count,
      (
        SELECT COUNT(*)
        FROM machine_load_baskets mlb
        WHERE mlb.load_id = ml.id
          AND mlb.unloaded_at IS NOT NULL
      ) AS active_load_unloaded_count
    FROM laundry_machines m
    LEFT JOIN machine_loads ml
      ON ml.id = (
        SELECT ml2.id
        FROM machine_loads ml2
        WHERE ml2.machine_id = m.id
          AND ml2.status = 'active'
        ORDER BY ml2.created_at DESC, ml2.id DESC
        LIMIT 1
      )
    WHERE m.station = ?
      AND m.is_active = 1
    ORDER BY m.machine_code ASC
  `);
  const listLoadBasketsStmt = db.prepare(`
    SELECT
      b.id,
      b.basket_code,
      b.qr_code,
      b.station,
      b.status,
      o.public_id,
      mlb.unloaded_at,
      mlb.unloaded_by
    FROM machine_load_baskets mlb
    JOIN baskets b ON b.id = mlb.basket_id
    JOIN orders o ON o.id = b.order_id
    WHERE mlb.load_id = ?
    ORDER BY mlb.id ASC
  `);
  const findMachineFlowBasketByQrStmt = db.prepare(`
    SELECT
      b.id,
      b.order_id,
      b.basket_code,
      b.qr_code,
      b.basket_items_json,
      b.station,
      b.status,
      o.public_id,
      o.cleancloud_order_id
    FROM baskets b
    JOIN orders o ON o.id = b.order_id
    WHERE b.qr_code = ?
    LIMIT 1
  `);
  const findActiveMachineLoadByBasketIdStmt = db.prepare(`
    SELECT
      ml.id AS load_id,
      m.machine_code
    FROM machine_load_baskets mlb
    JOIN machine_loads ml
      ON ml.id = mlb.load_id
     AND ml.status = 'active'
    JOIN laundry_machines m ON m.id = ml.machine_id
    WHERE mlb.basket_id = ?
      AND mlb.unloaded_at IS NULL
    LIMIT 1
  `);
  const insertMachineLoadStmt = db.prepare(`
    INSERT INTO machine_loads (
      machine_id, station, status, started_by, started_at, created_at, updated_at
    ) VALUES (?, ?, 'active', ?, ?, ?, ?)
  `);
  const insertMachineLoadBasketStmt = db.prepare(`
    INSERT INTO machine_load_baskets (load_id, basket_id, order_id, added_at)
    VALUES (?, ?, ?, ?)
  `);
  const insertScanEventStmt = db.prepare(`
    INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
    VALUES (?, ?, ?, ?, 'ok', ?, ?)
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
    updateBasketQr: ({ basketId, qrCode, timestamp }) => updateBasketQrStmt.run(qrCode, timestamp, basketId),
    getMachineWithActiveLoad: ({ station, machineCode }) => getMachineWithActiveLoadStmt.get(station, machineCode),
    listMachineWorkbenchRows: (station) => listMachineWorkbenchRowsStmt.all(station),
    listLoadBaskets: (loadId) => listLoadBasketsStmt.all(loadId),
    findMachineFlowBasketByQr: (qrCode) => findMachineFlowBasketByQrStmt.get(qrCode),
    findActiveMachineLoadByBasketId: (basketId) => findActiveMachineLoadByBasketIdStmt.get(basketId),
    insertMachineLoad: ({ machineId, station, actor, timestamp }) => insertMachineLoadStmt.run(machineId, station, actor, timestamp, timestamp, timestamp),
    insertMachineLoadBasket: ({ loadId, basketId, orderId, timestamp }) => insertMachineLoadBasketStmt.run(loadId, basketId, orderId, timestamp),
    insertScanEvent: ({ orderId, basketId, station, actor, message, timestamp }) => insertScanEventStmt.run(orderId, basketId, station, actor, message, timestamp)
  };
}

module.exports = {
  createSqliteWorkflowRepository
};
