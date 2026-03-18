function createPickupWorkbenchService(db, options = {}) {
  const pickupScanOkMessage = options.pickupScanOkMessage || "Корзина подтверждена для выдачи.";

  function getPickupScanProgress(orderId) {
    const rows = db.prepare(`
      SELECT
        b.id,
        b.basket_code,
        EXISTS (
          SELECT 1
          FROM scan_events se
          WHERE se.order_id = b.order_id
            AND se.basket_id = b.id
            AND se.station = 'pickup'
            AND se.result = 'ok'
            AND se.message = ?
          LIMIT 1
        ) AS scanned
      FROM baskets b
      WHERE b.order_id = ?
      ORDER BY b.id
    `).all(pickupScanOkMessage, orderId);

    const baskets = rows.map((row) => ({
      id: row.id,
      basket_code: row.basket_code,
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

  function listPickupWorkbenchOrders() {
    const orders = db.prepare(`
      SELECT id, public_id, cleancloud_order_id, customer_name, customer_id, order_weight, customer_phone, customer_email, service_tier, status, cleancloud_status, ready_for_pickup, updated_at
      FROM orders
      WHERE status = 'pickup' AND ready_for_pickup = 1
      ORDER BY id
    `).all();

    return orders.map((row) => {
      const progress = getPickupScanProgress(row.id);
      return {
        ...row,
        ready_for_pickup: Boolean(row.ready_for_pickup),
        total_baskets: progress.totalBaskets,
        scanned_baskets: progress.scannedBaskets,
        can_confirm: progress.complete,
        baskets: progress.baskets
      };
    });
  }

  return {
    getPickupScanProgress,
    listPickupWorkbenchOrders
  };
}

module.exports = {
  createPickupWorkbenchService
};
