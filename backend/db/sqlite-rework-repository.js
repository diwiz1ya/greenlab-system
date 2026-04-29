function createSqliteReworkRepository(db) {
  const listBasketImagesStmt = db.prepare(`
    SELECT id, image_role, sort_order, note, public_url, created_at
    FROM basket_images
    WHERE basket_id = ?
    ORDER BY sort_order, id
  `);
  const listReworkRequestsByOrderStmt = db.prepare(`
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
  const listPendingReworkRequestsByBasketIdStmt = db.prepare(`
    SELECT
      rr.*,
      source.basket_code AS source_basket_code,
      rework.basket_code AS rework_basket_code,
      rework.qr_code AS rework_basket_qr_code
    FROM rework_requests rr
    JOIN baskets source ON source.id = rr.source_basket_id
    LEFT JOIN baskets rework ON rework.id = rr.rework_basket_id
    WHERE rr.source_basket_id = ?
      AND rr.request_status IN (?, ?, ?)
    ORDER BY rr.id DESC
  `);
  const getReworkRequestWithContextStmt = db.prepare(`
    SELECT
      rr.*,
      source.order_id AS source_order_id,
      source.basket_code AS source_basket_code,
      source.basket_type AS source_basket_type,
      source.basket_items_json AS source_basket_items_json,
      source.basket_kind AS source_basket_kind,
      source.parent_basket_id AS source_parent_basket_id,
      source.station AS source_station,
      source.status AS source_status,
      source.qr_code AS source_qr_code,
      o.public_id AS order_public_id,
      o.cleancloud_order_id
    FROM rework_requests rr
    JOIN baskets source ON source.id = rr.source_basket_id
    JOIN orders o ON o.id = rr.order_id
    WHERE rr.id = ?
  `);
  const getQcTransferTaskWithContextStmt = db.prepare(`
    SELECT
      rr.*,
      source.basket_code AS source_basket_code,
      source.qr_code AS source_basket_qr_code,
      source.basket_type AS source_basket_type,
      source.basket_items_json AS source_basket_items_json,
      source.basket_kind AS source_basket_kind,
      source.parent_basket_id AS source_parent_basket_id,
      source.station AS source_station,
      source.status AS source_status,
      rework.basket_code AS rework_basket_code,
      rework.qr_code AS rework_basket_qr_code,
      rework.station AS rework_station,
      rework.status AS rework_status,
      o.public_id AS order_public_id,
      o.customer_name AS order_customer_name,
      o.cleancloud_order_id
    FROM rework_requests rr
    JOIN baskets source ON source.id = rr.source_basket_id
    LEFT JOIN baskets rework ON rework.id = rr.rework_basket_id
    JOIN orders o ON o.id = rr.order_id
    WHERE rr.id = ?
  `);
  const listPendingQcTransferTasksStmt = db.prepare(`
    SELECT
      rr.*,
      source.basket_code AS source_basket_code,
      source.qr_code AS source_basket_qr_code,
      source.basket_type AS source_basket_type,
      source.basket_kind AS source_basket_kind,
      source.parent_basket_id AS source_parent_basket_id,
      source.station AS source_station,
      source.status AS source_status,
      rework.basket_code AS rework_basket_code,
      rework.qr_code AS rework_basket_qr_code,
      rework.station AS rework_station,
      rework.status AS rework_status,
      o.public_id AS order_public_id,
      o.customer_name AS order_customer_name
    FROM rework_requests rr
    JOIN baskets source ON source.id = rr.source_basket_id
    LEFT JOIN baskets rework ON rework.id = rr.rework_basket_id
    JOIN orders o ON o.id = rr.order_id
    WHERE rr.request_status IN (?, ?)
      AND rr.rework_basket_id IS NULL
      AND rr.handoff_confirmed_at IS NULL
    ORDER BY datetime(rr.decision_at) DESC, rr.id DESC
  `);

  return {
    listBasketImages: (basketId) => listBasketImagesStmt.all(basketId),
    listReworkRequestsByOrder: (orderId) => listReworkRequestsByOrderStmt.all(orderId),
    listPendingReworkRequestsByBasketId: ({ basketId, statuses }) => listPendingReworkRequestsByBasketIdStmt.all(basketId, ...statuses),
    getReworkRequestWithContext: (requestId) => getReworkRequestWithContextStmt.get(requestId),
    getQcTransferTaskWithContext: (requestId) => getQcTransferTaskWithContextStmt.get(requestId),
    listPendingQcTransferTasks: ({ statuses }) => listPendingQcTransferTasksStmt.all(...statuses)
  };
}

module.exports = {
  createSqliteReworkRepository
};
