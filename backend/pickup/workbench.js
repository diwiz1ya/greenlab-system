function createPickupWorkbenchService(pickupWorkbenchRepository, options = {}) {
  void options;

  async function getOrderAssemblyProgress(orderId) {
    const row = await pickupWorkbenchRepository.getOrderAssemblyProgressRow(orderId);

    const totalOrderBaskets = Number(row?.total_baskets || 0);
    const basketsAtPickup = Number(row?.baskets_at_pickup || 0);
    return {
      totalOrderBaskets,
      basketsAtPickup,
      assemblyComplete: totalOrderBaskets > 0 && basketsAtPickup >= totalOrderBaskets
    };
  }

  async function getPickupScanProgress(orderId) {
    const rows = await pickupWorkbenchRepository.listPickupScanProgressRows(orderId);

    const baskets = rows.map((row) => ({
      id: row.id,
      basket_code: row.basket_code,
      route_sheet_code: row.basket_code,
      qr_code: row.qr_code,
      route_sheet_qr_code: row.qr_code,
      scanned: Boolean(row.scanned)
    }));
    const totalBaskets = baskets.length;
    const scannedBaskets = baskets.filter((basket) => basket.scanned).length;

    return {
      totalBaskets,
      scannedBaskets,
      complete: totalBaskets > 0 && scannedBaskets >= totalBaskets,
      baskets,
      routeSheets: baskets,
      route_sheets: baskets
    };
  }

  async function getPickupPlacementRows(orderId) {
    const rows = await pickupWorkbenchRepository.listPickupPlacementRows(orderId);
    return rows.map((row) => ({
      slot_index: Number(row.slot_index || 0),
      bin_qr_code: String(row.bin_qr_code || "").trim(),
      location_qr_code: String(row.location_qr_code || "").trim(),
      location_label: String(row.location_label || "").trim() || null,
      placed_by: row.placed_by || null,
      placed_at: row.placed_at || null
    }));
  }

  async function buildPickupOrderRow(row) {
    const progress = await getPickupScanProgress(row.id);
    const assembly = await getOrderAssemblyProgress(row.id);
    const placements = await getPickupPlacementRows(row.id);
    return {
      ...row,
      ready_to_place: Boolean(row.ready_to_place),
      ready_for_pickup: Boolean(row.ready_for_pickup),
      can_confirm: Boolean(row.ready_for_pickup),
      total_baskets: progress.totalBaskets,
      total_route_sheets: progress.totalBaskets,
      scanned_baskets: progress.scannedBaskets,
      scanned_route_sheets: progress.scannedBaskets,
      remaining_to_scan: Math.max(0, progress.totalBaskets - progress.scannedBaskets),
      baskets: progress.baskets,
      route_sheets: progress.baskets,
      routeSheets: progress.baskets,
      total_order_baskets: assembly.totalOrderBaskets,
      baskets_at_pickup: assembly.basketsAtPickup,
      remaining_to_pickup: Math.max(0, assembly.totalOrderBaskets - assembly.basketsAtPickup),
      placements,
      placement_count: placements.length
    };
  }

  async function listAssemblyOrders() {
    const rows = await pickupWorkbenchRepository.listAssemblyOrders();
    return Promise.all(rows.map(buildPickupOrderRow));
  }

  async function listReadyToPlaceOrders() {
    const rows = await pickupWorkbenchRepository.listReadyToPlaceOrders();
    return Promise.all(rows.map(buildPickupOrderRow));
  }

  async function listPlacedOrders() {
    const rows = await pickupWorkbenchRepository.listPlacedOrders();
    return Promise.all(rows.map(buildPickupOrderRow));
  }

  async function getPickupWorkbenchSnapshot() {
    const [assemblyOrders, readyToPlaceOrders, placedOrders] = await Promise.all([
      listAssemblyOrders(),
      listReadyToPlaceOrders(),
      listPlacedOrders()
    ]);

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
