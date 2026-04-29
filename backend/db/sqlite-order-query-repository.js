function createSqliteOrderQueryRepository(db) {
  const findOrderByIdStmt = db.prepare(`
    SELECT id, public_id, cleancloud_order_id, customer_name, customer_id, order_weight, customer_phone, customer_email, service_tier, status,
           cleancloud_status, ready_to_place, ready_for_pickup, created_at, updated_at
    FROM orders
    WHERE id = ?
  `);
  const listBasketsByOrderIdStmt = db.prepare(`
    SELECT
      id,
      basket_code,
      basket_type,
      basket_items_json,
      basket_kind,
      parent_basket_id,
      rework_reason,
      rework_attempt,
      label_printed_at,
      label_print_count,
      station,
      status,
      qr_code,
      created_at,
      updated_at
    FROM baskets
    WHERE order_id = ?
    ORDER BY id
  `);
  const listRecentScansByOrderIdStmt = db.prepare(`
    SELECT id, station, actor, result, message, created_at, basket_id
    FROM scan_events
    WHERE order_id = ?
    ORDER BY datetime(created_at) DESC
    LIMIT 10
  `);
  const listPickupPlacementsByOrderIdStmt = db.prepare(`
    SELECT
      slot_index,
      bin_qr_code,
      location_qr_code,
      placed_at
    FROM pickup_order_placements
    WHERE order_id = ?
      AND released_at IS NULL
    ORDER BY slot_index, id
  `);
  const listMachineUsageByOrderIdStmt = db.prepare(`
    SELECT
      ml.station,
      m.machine_code,
      m.display_name,
      MAX(COALESCE(ml.completed_at, ml.updated_at, ml.started_at)) AS last_used_at
    FROM machine_load_baskets mlb
    JOIN machine_loads ml ON ml.id = mlb.load_id
    JOIN laundry_machines m ON m.id = ml.machine_id
    WHERE mlb.order_id = ?
      AND ml.status IN ('active', 'completed')
    GROUP BY ml.station, m.machine_code, m.display_name
    ORDER BY
      CASE ml.station
        WHEN 'washing' THEN 0
        WHEN 'drying' THEN 1
        ELSE 2
      END,
      datetime(last_used_at) DESC,
      m.machine_code ASC
  `);
  const listReworkRequestsByOrderIdStmt = db.prepare(`
    SELECT
      rr.*,
      source.basket_code AS source_basket_code,
      rework.basket_code AS rework_basket_code,
      rework.qr_code AS rework_basket_qr_code
    FROM rework_requests rr
    JOIN baskets source ON source.id = rr.source_basket_id
    LEFT JOIN baskets rework ON rework.id = rr.rework_basket_id
    WHERE rr.order_id = ?
    ORDER BY rr.id DESC
  `);
  const countSortingOrdersStmt = db.prepare(`
    SELECT COUNT(*) AS count
    FROM orders
    WHERE status IN ('sorting', 'sorted')
  `);
  const countOrdersByBasketStationStmt = db.prepare(`
    SELECT COUNT(DISTINCT o.id) AS count
    FROM orders o
    JOIN baskets b ON b.order_id = o.id
    WHERE b.station = ? AND b.status = ?
  `);
  const countReadyOrdersStmt = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE ready_for_pickup = 1");
  const listOverviewOrdersStmt = db.prepare(`
    SELECT
      o.id,
      o.public_id,
      o.cleancloud_order_id,
      o.customer_name,
      o.customer_id,
      o.order_weight,
      o.customer_phone,
      o.customer_email,
      o.service_tier,
      o.status,
      o.cleancloud_status,
      o.ready_to_place,
      o.ready_for_pickup,
      o.created_at,
      o.updated_at,
      (
        SELECT COUNT(*)
        FROM baskets b
        WHERE b.order_id = o.id
      ) AS basket_count,
      (
        SELECT COUNT(*)
        FROM baskets b
        WHERE b.order_id = o.id AND COALESCE(b.basket_kind, 'main') = 'rework'
      ) AS rework_basket_count,
      (
        SELECT COUNT(*)
        FROM rework_requests rr
        WHERE rr.order_id = o.id AND rr.request_status = 'pending_customer_approval'
      ) AS pending_customer_approval_count,
      (
        SELECT MIN(rr.requested_at)
        FROM rework_requests rr
        WHERE rr.order_id = o.id AND rr.request_status = 'pending_customer_approval'
      ) AS pending_approval_since,
      (
        SELECT MIN(COALESCE(rr.decision_at, rr.updated_at))
        FROM rework_requests rr
        WHERE rr.order_id = o.id
          AND rr.request_status IN ('approved_waiting_transfer', 'declined_waiting_return')
          AND rr.handoff_confirmed_at IS NULL
      ) AS pending_qc_task_since,
      (
        SELECT rr.request_status
        FROM rework_requests rr
        WHERE rr.order_id = o.id
          AND rr.request_status IN ('approved_waiting_transfer', 'declined_waiting_return')
          AND rr.handoff_confirmed_at IS NULL
        ORDER BY datetime(COALESCE(rr.decision_at, rr.updated_at)) ASC, rr.id ASC
        LIMIT 1
      ) AS pending_qc_task_kind,
      (
        SELECT COUNT(*)
        FROM rework_requests rr
        WHERE rr.order_id = o.id
      ) AS rework_request_count,
      (
        SELECT COUNT(*)
        FROM rework_requests rr
        WHERE rr.order_id = o.id
          AND rr.request_status IN ('declined', 'declined_waiting_return')
      ) AS rework_declined_count,
      (
        SELECT COALESCE(MAX(b.rework_attempt), 0)
        FROM baskets b
        WHERE b.order_id = o.id
          AND COALESCE(b.basket_kind, 'main') = 'rework'
      ) AS max_rework_attempt
    FROM orders o
    ORDER BY o.id
  `);
  const listActivePickupPlacementsStmt = db.prepare(`
    SELECT
      p.order_id,
      p.slot_index,
      p.bin_qr_code,
      p.location_qr_code
    FROM pickup_order_placements p
    WHERE p.released_at IS NULL
    ORDER BY p.order_id, p.slot_index, p.id
  `);
  const getManagerKpiCoreStmt = db.prepare(`
    SELECT
      COUNT(*) AS decisions_total,
      SUM(CASE WHEN rr.request_status IN ('declined', 'declined_waiting_return') THEN 1 ELSE 0 END) AS declined_total,
      SUM(CASE WHEN rr.request_status IN ('approved', 'approved_waiting_transfer') THEN 1 ELSE 0 END) AS approved_total,
      AVG((julianday(rr.decision_at) - julianday(rr.requested_at)) * 24 * 60) AS approval_minutes_avg
    FROM rework_requests rr
    WHERE rr.decision_at IS NOT NULL
  `);
  const getManagerKpiReworkStmt = db.prepare(`
    SELECT
      COUNT(*) AS total_rework_baskets,
      SUM(CASE WHEN COALESCE(b.rework_attempt, 0) > 1 THEN 1 ELSE 0 END) AS repeated_rework_baskets
    FROM baskets b
    WHERE COALESCE(b.basket_kind, 'main') = 'rework'
  `);
  const getManagerKpiPickupStmt = db.prepare(`
    SELECT
      COUNT(*) AS handoff_count,
      AVG((julianday(p.completed_at) - julianday(o.created_at)) * 24 * 60) AS pickup_cycle_minutes_avg
    FROM (
      SELECT se.order_id, MAX(se.created_at) AS completed_at
      FROM scan_events se
      WHERE se.station = 'pickup'
        AND se.result = 'ok'
        AND se.message LIKE 'Выдача подтверждена%'
      GROUP BY se.order_id
    ) p
    JOIN orders o ON o.id = p.order_id
  `);
  const listSortingStationOrdersStmt = db.prepare(`
    SELECT id, public_id, cleancloud_order_id, customer_name, customer_id, order_weight, customer_phone, customer_email, service_tier, status, cleancloud_status, ready_to_place, ready_for_pickup, updated_at
    FROM orders
    WHERE status IN ('sorting', 'sorted')
    ORDER BY CASE WHEN status = 'sorting' THEN 0 ELSE 1 END, id
  `);
  const listActiveStationOrdersStmt = db.prepare(`
    SELECT
      o.id, o.public_id, o.cleancloud_order_id, o.customer_name, o.customer_id, o.order_weight,
      o.customer_phone, o.customer_email, o.service_tier, o.status, o.cleancloud_status,
      o.ready_to_place, o.ready_for_pickup, o.updated_at,
      (
        SELECT COUNT(*)
        FROM baskets b
        WHERE b.order_id = o.id AND b.station = ? AND b.status = ?
      ) AS baskets_in_station
    FROM orders o
    WHERE EXISTS (
      SELECT 1
      FROM baskets b
      WHERE b.order_id = o.id AND b.station = ? AND b.status = ?
    )
    ORDER BY id
  `);
  const countQcBasketsStmt = db.prepare(`
    SELECT COUNT(*) AS count
    FROM baskets
    WHERE station = 'qc' AND status = 'qc'
  `);
  const countQcOrdersFromBasketsStmt = db.prepare(`
    SELECT COUNT(DISTINCT order_id) AS count
    FROM baskets
    WHERE station = 'qc' AND status = 'qc'
  `);
  const countQcStatusOrdersStmt = db.prepare(`
    SELECT COUNT(*) AS count
    FROM orders
    WHERE status = 'qc'
  `);

  function listBasketImagesByBasketIds(basketIds) {
    if (!basketIds.length) return [];
    const placeholders = basketIds.map(() => "?").join(", ");
    return db.prepare(`
      SELECT id, basket_id, image_role, sort_order, note, public_url, created_at
      FROM basket_images
      WHERE basket_id IN (${placeholders})
      ORDER BY basket_id, sort_order, id
    `).all(...basketIds);
  }

  return {
    findOrderById: (orderId) => findOrderByIdStmt.get(orderId),
    listBasketsByOrderId: (orderId) => listBasketsByOrderIdStmt.all(orderId),
    listBasketImagesByBasketIds,
    listRecentScansByOrderId: (orderId) => listRecentScansByOrderIdStmt.all(orderId),
    listPickupPlacementsByOrderId: (orderId) => listPickupPlacementsByOrderIdStmt.all(orderId),
    listMachineUsageByOrderId: (orderId) => listMachineUsageByOrderIdStmt.all(orderId),
    listReworkRequestsByOrderId: (orderId) => listReworkRequestsByOrderIdStmt.all(orderId),
    countSortingOrders: () => countSortingOrdersStmt.get().count,
    countOrdersByBasketStation: (station) => countOrdersByBasketStationStmt.get(station, station).count,
    countReadyOrders: () => countReadyOrdersStmt.get().count,
    listOverviewOrders: () => listOverviewOrdersStmt.all(),
    listActivePickupPlacements: () => listActivePickupPlacementsStmt.all(),
    getManagerKpiCore: () => getManagerKpiCoreStmt.get() || {},
    getManagerKpiRework: () => getManagerKpiReworkStmt.get() || {},
    getManagerKpiPickup: () => getManagerKpiPickupStmt.get() || {},
    listSortingStationOrders: () => listSortingStationOrdersStmt.all(),
    listActiveStationOrders: (station) => listActiveStationOrdersStmt.all(station, station, station, station),
    countQcBaskets: () => countQcBasketsStmt.get().count,
    countQcOrdersFromBaskets: () => countQcOrdersFromBasketsStmt.get().count,
    countQcStatusOrders: () => countQcStatusOrdersStmt.get().count
  };
}

module.exports = {
  createSqliteOrderQueryRepository
};
