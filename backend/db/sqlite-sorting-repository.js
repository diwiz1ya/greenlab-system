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
  const listBasketIdsByOrderStmt = db.prepare("SELECT id FROM baskets WHERE order_id = ?");
  const insertBasketImageStmt = db.prepare(`
    INSERT INTO basket_images (basket_id, image_role, sort_order, note, file_path, public_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
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
    }
  };
}

module.exports = {
  createSqliteSortingRepository
};
