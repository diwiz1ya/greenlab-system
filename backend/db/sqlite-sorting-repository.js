const { getLastInsertRowId } = require("./statement-result");

function createSqliteSortingRepository(db) {
  const listKnownCatalogQrsStmt = db.prepare(`
    SELECT qr_code
    FROM basket_catalog
    WHERE is_active = 1
    ORDER BY label ASC
  `);
  const listFreeCatalogQrsStmt = db.prepare(`
    SELECT c.qr_code
    FROM basket_catalog c
    LEFT JOIN baskets b ON b.qr_code = c.qr_code
    WHERE c.is_active = 1
      AND b.id IS NULL
    ORDER BY c.label ASC
    LIMIT ?
  `);
  const listFreeCatalogQrsExcludingOrderStmt = db.prepare(`
    SELECT c.qr_code
    FROM basket_catalog c
    LEFT JOIN baskets b
      ON b.qr_code = c.qr_code
     AND b.order_id != ?
    WHERE c.is_active = 1
      AND b.id IS NULL
    ORDER BY c.label ASC
    LIMIT ?
  `);
  const findConflictingQrCodeStmt = db.prepare("SELECT qr_code FROM baskets WHERE qr_code = ? LIMIT 1");
  const findConflictingQrCodeExcludingOrderStmt = db.prepare("SELECT qr_code FROM baskets WHERE qr_code = ? AND order_id != ? LIMIT 1");
  const findOrderByIdStmt = db.prepare("SELECT * FROM orders WHERE id = ?");
  const countBasketsByOrderStmt = db.prepare("SELECT COUNT(*) AS count FROM baskets WHERE order_id = ?");
  const listBasketIdsByOrderStmt = db.prepare("SELECT id FROM baskets WHERE order_id = ?");
  const insertBasketImageStmt = db.prepare(`
    INSERT INTO basket_images (basket_id, image_role, sort_order, note, file_path, public_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertBasketStmt = db.prepare(`
    INSERT INTO baskets (
      order_id, basket_code, basket_type, basket_items_json, station, status, qr_code,
      label_printed_at, label_print_count, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, 'washing', 'washing', ?, ?, ?, ?, ?)
  `);
  const deleteBasketsByOrderStmt = db.prepare("DELETE FROM baskets WHERE order_id = ?");
  const markOrderSortedStmt = db.prepare(`
    UPDATE orders
    SET status = 'sorted', cleancloud_status = 'In progress', ready_to_place = 0, ready_for_pickup = 0, updated_at = ?
    WHERE id = ?
  `);
  const markOrderReturnedToSortingStmt = db.prepare(`
    UPDATE orders
    SET status = 'sorting', cleancloud_status = 'New order', ready_to_place = 0, ready_for_pickup = 0, updated_at = ?
    WHERE id = ?
  `);
  const insertSortingScanEventStmt = db.prepare(`
    INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
    VALUES (?, NULL, 'sorting', ?, 'ok', ?, ?)
  `);

  function selectBasketImagesByBasketIds(basketIds) {
    if (!Array.isArray(basketIds) || !basketIds.length) return [];
    const placeholders = basketIds.map(() => "?").join(", ");
    return db.prepare(`
      SELECT id, file_path
      FROM basket_images
      WHERE basket_id IN (${placeholders})
    `).all(...basketIds);
  }

  function deleteBasketImagesByBasketIds(basketIds) {
    if (!Array.isArray(basketIds) || !basketIds.length) return;
    const placeholders = basketIds.map(() => "?").join(", ");
    db.prepare(`DELETE FROM basket_images WHERE basket_id IN (${placeholders})`).run(...basketIds);
  }

  return {
    listKnownCatalogQrs: () => listKnownCatalogQrsStmt.all(),
    listFreeCatalogQrs: ({ limit, excludeOrderId }) => {
      if (Number(excludeOrderId || 0) > 0) {
        return listFreeCatalogQrsExcludingOrderStmt.all(excludeOrderId, limit);
      }
      return listFreeCatalogQrsStmt.all(limit);
    },
    findConflictingQrCode: ({ qrCode, excludeOrderId }) => {
      if (Number(excludeOrderId || 0) > 0) {
        return findConflictingQrCodeExcludingOrderStmt.get(qrCode, excludeOrderId);
      }
      return findConflictingQrCodeStmt.get(qrCode);
    },
    findOrderById: (orderId) => findOrderByIdStmt.get(orderId),
    countBasketsByOrder: (orderId) => Number(countBasketsByOrderStmt.get(orderId)?.count || 0),
    listBasketIdsByOrder: (orderId) => listBasketIdsByOrderStmt.all(orderId).map((row) => row.id),
    listBasketImagesByBasketIds: selectBasketImagesByBasketIds,
    deleteBasketImagesByBasketIds,
    insertBasketImage: ({ basketId, role, sortOrder, note, filePath, publicUrl, timestamp }) => {
      const result = insertBasketImageStmt.run(
        basketId,
        role,
        sortOrder,
        note,
        filePath,
        publicUrl,
        timestamp
      );
      return getLastInsertRowId(result, "basket image");
    },
    insertBasket: ({
      orderId,
      basketCode,
      basketType,
      basketItemsJson,
      qrCode,
      labelPrintedAt,
      labelPrintCount,
      timestamp
    }) => {
      const result = insertBasketStmt.run(
        orderId,
        basketCode,
        basketType,
        basketItemsJson,
        qrCode,
        labelPrintedAt,
        labelPrintCount,
        timestamp,
        timestamp
      );
      return getLastInsertRowId(result, "basket");
    },
    deleteBasketsByOrder: (orderId) => deleteBasketsByOrderStmt.run(orderId),
    markOrderSorted: ({ orderId, timestamp }) => markOrderSortedStmt.run(timestamp, orderId),
    markOrderReturnedToSorting: ({ orderId, timestamp }) => markOrderReturnedToSortingStmt.run(timestamp, orderId),
    insertSortingScanEvent: ({ orderId, actor, message, timestamp }) => insertSortingScanEventStmt.run(
      orderId,
      actor,
      message,
      timestamp
    )
  };
}

module.exports = {
  createSqliteSortingRepository
};
