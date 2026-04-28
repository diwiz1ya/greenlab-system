function createPickupWorkbenchService(db, options = {}) {
  void options;
  const excludedAssemblyStations = ["rework_transferred", "archived"];
  const excludedPlaceholders = excludedAssemblyStations.map(() => "?").join(", ");

  function getOrderAssemblyProgress(orderId) {
    const row = db.prepare(`
      SELECT
        COUNT(*) AS total_baskets,
        SUM(CASE WHEN station = 'pickup' AND status = 'pickup' THEN 1 ELSE 0 END) AS baskets_at_pickup
      FROM baskets
      WHERE order_id = ?
        AND station = status
        AND station NOT IN (${excludedPlaceholders})
    `).get(orderId, ...excludedAssemblyStations);

    const totalOrderBaskets = Number(row?.total_baskets || 0);
    const basketsAtPickup = Number(row?.baskets_at_pickup || 0);
    return {
      totalOrderBaskets,
      basketsAtPickup,
      assemblyComplete: totalOrderBaskets > 0 && basketsAtPickup >= totalOrderBaskets
    };
  }

  function getPickupScanProgress(orderId) {
    const rows = db.prepare(`
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
    `).all(orderId, ...excludedAssemblyStations);

    const baskets = rows.map((row) => ({
      id: row.id,
      basket_code: row.basket_code,
      qr_code: row.qr_code,
      scanned: Boolean(row.scanned)
    }));
    const totalBaskets = baskets.length;
    const scannedBaskets = baskets.filter((basket) => basket.scanned).length;

    return {
      totalBaskets,
      scannedBaskets,
      complete: totalBaskets > 0 && scannedBaskets >= totalBaskets,
      baskets
    };
  }

  function getPickupPlacementRows(orderId) {
    return db.prepare(`
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
    `).all(orderId).map((row) => ({
      slot_index: Number(row.slot_index || 0),
      bin_qr_code: String(row.bin_qr_code || "").trim(),
      location_qr_code: String(row.location_qr_code || "").trim(),
      location_label: String(row.location_label || "").trim() || null,
      placed_by: row.placed_by || null,
      placed_at: row.placed_at || null
    }));
  }

  function buildPickupOrderRow(row) {
    const progress = getPickupScanProgress(row.id);
    const assembly = getOrderAssemblyProgress(row.id);
    const placements = getPickupPlacementRows(row.id);
    return {
      ...row,
      ready_to_place: Boolean(row.ready_to_place),
      ready_for_pickup: Boolean(row.ready_for_pickup),
      can_confirm: Boolean(row.ready_for_pickup),
      total_baskets: progress.totalBaskets,
      scanned_baskets: progress.scannedBaskets,
      remaining_to_scan: Math.max(0, progress.totalBaskets - progress.scannedBaskets),
      baskets: progress.baskets,
      total_order_baskets: assembly.totalOrderBaskets,
      baskets_at_pickup: assembly.basketsAtPickup,
      remaining_to_pickup: Math.max(0, assembly.totalOrderBaskets - assembly.basketsAtPickup),
      placements,
      placement_count: placements.length
    };
  }

  function listAssemblyOrders() {
    const rows = db.prepare(`
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
    `).all();
    return rows.map(buildPickupOrderRow);
  }

  function listReadyToPlaceOrders() {
    const rows = db.prepare(`
      SELECT
        id, public_id, cleancloud_order_id, customer_name, customer_id, order_weight,
        customer_phone, customer_email, service_tier, status, cleancloud_status,
        ready_to_place, ready_for_pickup, updated_at
      FROM orders
      WHERE COALESCE(ready_for_pickup, 0) = 0
        AND COALESCE(ready_to_place, 0) = 1
      ORDER BY id
    `).all();
    return rows.map(buildPickupOrderRow);
  }

  function listPlacedOrders() {
    const rows = db.prepare(`
      SELECT
        id, public_id, cleancloud_order_id, customer_name, customer_id, order_weight,
        customer_phone, customer_email, service_tier, status, cleancloud_status,
        ready_to_place, ready_for_pickup, updated_at
      FROM orders
      WHERE status = 'pickup'
        AND COALESCE(ready_for_pickup, 0) = 1
      ORDER BY id
    `).all();
    return rows.map(buildPickupOrderRow);
  }

  function getPickupWorkbenchSnapshot() {
    const assemblyOrders = listAssemblyOrders();
    const readyToPlaceOrders = listReadyToPlaceOrders();
    const placedOrders = listPlacedOrders();

    return {
      assemblyOrders,
      readyToPlaceOrders,
      placedOrders,
      // Backward-compatible aliases for legacy frontend.
      orders: placedOrders,
      stagingOrders: [...assemblyOrders, ...readyToPlaceOrders]
    };
  }

  return {
    getOrderAssemblyProgress,
    getPickupScanProgress,
    listAssemblyOrders,
    listReadyToPlaceOrders,
    listPlacedOrders,
    getPickupWorkbenchSnapshot
  };
}

module.exports = {
  createPickupWorkbenchService
};
