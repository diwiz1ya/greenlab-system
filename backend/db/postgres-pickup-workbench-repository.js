const excludedAssemblyStations = ["rework_transferred", "archived"];

function createPostgresPickupWorkbenchRepository(queryable) {
  async function getOrderAssemblyProgressRow(orderId) {
    const result = await queryable.query(
      `
        SELECT
          COUNT(*)::int AS total_baskets,
          SUM(CASE WHEN station = 'pickup' AND status = 'pickup' THEN 1 ELSE 0 END)::int AS baskets_at_pickup
        FROM baskets
        WHERE order_id = $1
          AND station = status
          AND station NOT IN ($2, $3)
      `,
      [orderId, ...excludedAssemblyStations]
    );
    return result.rows[0] || null;
  }

  async function listPickupScanProgressRows(orderId) {
    const result = await queryable.query(
      `
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
        WHERE b.order_id = $1
          AND b.station = b.status
          AND b.station NOT IN ($2, $3)
        ORDER BY b.id
      `,
      [orderId, ...excludedAssemblyStations]
    );
    return result.rows;
  }

  async function listPickupPlacementRows(orderId) {
    const result = await queryable.query(
      `
        SELECT
          p.slot_index,
          p.bin_qr_code,
          p.location_qr_code,
          l.label AS location_label,
          p.placed_by,
          p.placed_at
        FROM pickup_order_placements p
        LEFT JOIN pickup_locations l ON l.qr_code = p.location_qr_code
        WHERE p.order_id = $1
          AND p.released_at IS NULL
        ORDER BY p.slot_index ASC, p.id ASC
      `,
      [orderId]
    );
    return result.rows;
  }

  async function listAssemblyOrders() {
    const result = await queryable.query(`
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
    return result.rows;
  }

  async function listReadyToPlaceOrders() {
    const result = await queryable.query(`
      SELECT
        id, public_id, cleancloud_order_id, customer_name, customer_id, order_weight,
        customer_phone, customer_email, service_tier, status, cleancloud_status,
        ready_to_place, ready_for_pickup, updated_at
      FROM orders
      WHERE COALESCE(ready_for_pickup, 0) = 0
        AND COALESCE(ready_to_place, 0) = 1
      ORDER BY id
    `);
    return result.rows;
  }

  async function listPlacedOrders() {
    const result = await queryable.query(`
      SELECT
        id, public_id, cleancloud_order_id, customer_name, customer_id, order_weight,
        customer_phone, customer_email, service_tier, status, cleancloud_status,
        ready_to_place, ready_for_pickup, updated_at
      FROM orders
      WHERE status = 'pickup'
        AND COALESCE(ready_for_pickup, 0) = 1
      ORDER BY id
    `);
    return result.rows;
  }

  return {
    getOrderAssemblyProgressRow,
    listPickupScanProgressRows,
    listPickupPlacementRows,
    listAssemblyOrders,
    listReadyToPlaceOrders,
    listPlacedOrders
  };
}

module.exports = {
  createPostgresPickupWorkbenchRepository
};
