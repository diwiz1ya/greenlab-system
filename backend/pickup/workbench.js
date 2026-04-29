function createPickupWorkbenchService(pickupWorkbenchRepository, options = {}) {
  void options;

  function getOrderAssemblyProgress(orderId) {
    const row = pickupWorkbenchRepository.getOrderAssemblyProgressRow(orderId);

    const totalOrderBaskets = Number(row?.total_baskets || 0);
    const basketsAtPickup = Number(row?.baskets_at_pickup || 0);
    return {
      totalOrderBaskets,
      basketsAtPickup,
      assemblyComplete: totalOrderBaskets > 0 && basketsAtPickup >= totalOrderBaskets
    };
  }

  function getPickupScanProgress(orderId) {
    const rows = pickupWorkbenchRepository.listPickupScanProgressRows(orderId);

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
    return pickupWorkbenchRepository.listPickupPlacementRows(orderId).map((row) => ({
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
    const rows = pickupWorkbenchRepository.listAssemblyOrders();
    return rows.map(buildPickupOrderRow);
  }

  function listReadyToPlaceOrders() {
    const rows = pickupWorkbenchRepository.listReadyToPlaceOrders();
    return rows.map(buildPickupOrderRow);
  }

  function listPlacedOrders() {
    const rows = pickupWorkbenchRepository.listPlacedOrders();
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
