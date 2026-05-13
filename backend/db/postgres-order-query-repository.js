function readCount(row) {
  return Number(row?.count || 0);
}

function createPostgresOrderQueryRepository(queryable) {
  async function findOrderById(orderId) {
    const result = await queryable.query(
      `
        SELECT id, public_id, cleancloud_order_id, customer_name, customer_id, order_weight, customer_phone, customer_email, service_tier, status,
               cleancloud_status, ready_to_place, ready_for_pickup, created_at, updated_at
        FROM orders
        WHERE id = $1
      `,
      [orderId]
    );
    return result.rows[0] || null;
  }

  async function listBasketsByOrderId(orderId) {
    const result = await queryable.query(
      `
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
        WHERE order_id = $1
        ORDER BY id
      `,
      [orderId]
    );
    return result.rows;
  }

  async function listBasketImagesByBasketIds(basketIds) {
    if (!basketIds.length) return [];
    const placeholders = basketIds.map((_, index) => `$${index + 1}`).join(", ");
    const result = await queryable.query(
      `
        SELECT id, basket_id, image_role, sort_order, note, public_url, created_at
        FROM basket_images
        WHERE basket_id IN (${placeholders})
        ORDER BY basket_id, sort_order, id
      `,
      basketIds
    );
    return result.rows;
  }

  async function listRecentScansByOrderId(orderId) {
    const result = await queryable.query(
      `
        SELECT id, station, actor, result, message, created_at, basket_id
        FROM scan_events
        WHERE order_id = $1
        ORDER BY created_at DESC
        LIMIT 10
      `,
      [orderId]
    );
    return result.rows;
  }

  async function listPickupPlacementsByOrderId(orderId) {
    const result = await queryable.query(
      `
        SELECT
          slot_index,
          bin_qr_code,
          location_qr_code,
          placed_at
        FROM pickup_order_placements
        WHERE order_id = $1
          AND released_at IS NULL
        ORDER BY slot_index, id
      `,
      [orderId]
    );
    return result.rows;
  }

  async function listMachineUsageByOrderId(orderId) {
    const result = await queryable.query(
      `
        SELECT
          ml.station,
          m.machine_code,
          m.display_name,
          MAX(COALESCE(ml.completed_at, ml.updated_at, ml.started_at)) AS last_used_at
        FROM machine_load_baskets mlb
        JOIN machine_loads ml ON ml.id = mlb.load_id
        JOIN laundry_machines m ON m.id = ml.machine_id
        WHERE mlb.order_id = $1
          AND ml.status IN ('active', 'completed')
        GROUP BY ml.station, m.machine_code, m.display_name
        ORDER BY
          CASE ml.station
            WHEN 'washing' THEN 0
            WHEN 'drying' THEN 1
            ELSE 2
          END,
          last_used_at DESC,
          m.machine_code ASC
      `,
      [orderId]
    );
    return result.rows;
  }

  async function listReworkRequestsByOrderId(orderId) {
    const result = await queryable.query(
      `
        SELECT
          rr.*,
          source.basket_code AS source_basket_code,
          rework.basket_code AS rework_basket_code,
          rework.qr_code AS rework_basket_qr_code
        FROM rework_requests rr
        JOIN baskets source ON source.id = rr.source_basket_id
        LEFT JOIN baskets rework ON rework.id = rr.rework_basket_id
        WHERE rr.order_id = $1
        ORDER BY rr.id DESC
      `,
      [orderId]
    );
    return result.rows;
  }

  async function countSortingOrders() {
    const result = await queryable.query(`
      SELECT COUNT(*)::int AS count
      FROM orders
      WHERE status IN ('sorting', 'sorted')
    `);
    return readCount(result.rows[0]);
  }

  async function countOrdersByBasketStation(station) {
    const result = await queryable.query(
      `
        SELECT COUNT(DISTINCT o.id)::int AS count
        FROM orders o
        JOIN baskets b ON b.order_id = o.id
        WHERE b.station = $1 AND b.status = $2
      `,
      [station, station]
    );
    return readCount(result.rows[0]);
  }

  async function countReadyOrders() {
    const result = await queryable.query("SELECT COUNT(*)::int AS count FROM orders WHERE ready_for_pickup = 1");
    return readCount(result.rows[0]);
  }

  async function listOverviewOrders() {
    const result = await queryable.query(`
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
          SELECT COUNT(*)::int
          FROM baskets b
          WHERE b.order_id = o.id
        ) AS basket_count,
        (
          SELECT COALESCE(json_agg(json_build_object(
            'id', b.id,
            'basket_code', b.basket_code,
            'basket_type', b.basket_type,
            'basket_kind', COALESCE(b.basket_kind, 'main'),
            'station', b.station,
            'status', b.status,
            'qr_code', b.qr_code
          ) ORDER BY b.id), '[]'::json)
          FROM baskets b
          WHERE b.order_id = o.id
        ) AS route_sheets_json,
        (
          SELECT COUNT(*)::int
          FROM baskets b
          WHERE b.order_id = o.id AND COALESCE(b.basket_kind, 'main') = 'rework'
        ) AS rework_basket_count,
        (
          SELECT COUNT(*)::int
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
          ORDER BY COALESCE(rr.decision_at, rr.updated_at) ASC, rr.id ASC
          LIMIT 1
        ) AS pending_qc_task_kind,
        (
          SELECT COUNT(*)::int
          FROM rework_requests rr
          WHERE rr.order_id = o.id
        ) AS rework_request_count,
        (
          SELECT COUNT(*)::int
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
    return result.rows;
  }

  async function listActivePickupPlacements() {
    const result = await queryable.query(`
      SELECT
        p.order_id,
        p.slot_index,
        p.bin_qr_code,
        p.location_qr_code
      FROM pickup_order_placements p
      WHERE p.released_at IS NULL
      ORDER BY p.order_id, p.slot_index, p.id
    `);
    return result.rows;
  }

  async function getManagerKpiCore() {
    const result = await queryable.query(`
      SELECT
        COUNT(*)::int AS decisions_total,
        SUM(CASE WHEN rr.request_status IN ('declined', 'declined_waiting_return') THEN 1 ELSE 0 END)::int AS declined_total,
        SUM(CASE WHEN rr.request_status IN ('approved', 'approved_waiting_transfer') THEN 1 ELSE 0 END)::int AS approved_total,
        AVG(EXTRACT(EPOCH FROM ((rr.decision_at)::timestamp - (rr.requested_at)::timestamp)) / 60) AS approval_minutes_avg
      FROM rework_requests rr
      WHERE rr.decision_at IS NOT NULL
    `);
    return result.rows[0] || {};
  }

  async function getManagerKpiRework() {
    const result = await queryable.query(`
      SELECT
        COUNT(*)::int AS total_rework_baskets,
        SUM(CASE WHEN COALESCE(b.rework_attempt, 0) > 1 THEN 1 ELSE 0 END)::int AS repeated_rework_baskets
      FROM baskets b
      WHERE COALESCE(b.basket_kind, 'main') = 'rework'
    `);
    return result.rows[0] || {};
  }

  async function getManagerKpiPickup() {
    const result = await queryable.query(`
      SELECT
        COUNT(*)::int AS handoff_count,
        AVG(EXTRACT(EPOCH FROM ((p.completed_at)::timestamp - (o.created_at)::timestamp)) / 60) AS pickup_cycle_minutes_avg
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
    return result.rows[0] || {};
  }

  async function listSortingStationOrders() {
    const result = await queryable.query(`
      SELECT id, public_id, cleancloud_order_id, customer_name, customer_id, order_weight, customer_phone, customer_email, service_tier, status, cleancloud_status, ready_to_place, ready_for_pickup, updated_at
      FROM orders
      WHERE status IN ('sorting', 'sorted')
      ORDER BY CASE WHEN status = 'sorting' THEN 0 ELSE 1 END, id
    `);
    return result.rows;
  }

  async function listActiveStationOrders(station) {
    const result = await queryable.query(
      `
        SELECT
          o.id, o.public_id, o.cleancloud_order_id, o.customer_name, o.customer_id, o.order_weight,
          o.customer_phone, o.customer_email, o.service_tier, o.status, o.cleancloud_status,
          o.ready_to_place, o.ready_for_pickup, o.updated_at,
          (
            SELECT COUNT(*)::int
            FROM baskets b
            WHERE b.order_id = o.id AND b.station = $1 AND b.status = $2
          ) AS baskets_in_station
        FROM orders o
        WHERE EXISTS (
          SELECT 1
          FROM baskets b
          WHERE b.order_id = o.id AND b.station = $3 AND b.status = $4
        )
        ORDER BY id
      `,
      [station, station, station, station]
    );
    return result.rows;
  }

  async function countQcBaskets() {
    const result = await queryable.query(`
      SELECT COUNT(*)::int AS count
      FROM baskets
      WHERE station = 'qc' AND status = 'qc'
    `);
    return readCount(result.rows[0]);
  }

  async function countQcOrdersFromBaskets() {
    const result = await queryable.query(`
      SELECT COUNT(DISTINCT order_id)::int AS count
      FROM baskets
      WHERE station = 'qc' AND status = 'qc'
    `);
    return readCount(result.rows[0]);
  }

  async function countQcStatusOrders() {
    const result = await queryable.query(`
      SELECT COUNT(*)::int AS count
      FROM orders
      WHERE status = 'qc'
    `);
    return readCount(result.rows[0]);
  }

  return {
    findOrderById,
    listBasketsByOrderId,
    listBasketImagesByBasketIds,
    listRecentScansByOrderId,
    listPickupPlacementsByOrderId,
    listMachineUsageByOrderId,
    listReworkRequestsByOrderId,
    countSortingOrders,
    countOrdersByBasketStation,
    countReadyOrders,
    listOverviewOrders,
    listActivePickupPlacements,
    getManagerKpiCore,
    getManagerKpiRework,
    getManagerKpiPickup,
    listSortingStationOrders,
    listActiveStationOrders,
    countQcBaskets,
    countQcOrdersFromBaskets,
    countQcStatusOrders
  };
}

module.exports = {
  createPostgresOrderQueryRepository
};
