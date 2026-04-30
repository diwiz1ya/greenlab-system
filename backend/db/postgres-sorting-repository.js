function createPlaceholders(values) {
  return values.map((_, index) => `$${index + 1}`).join(", ");
}

function createPostgresSortingRepository(queryable) {
  async function listKnownCatalogQrs() {
    const result = await queryable.query(`
      SELECT qr_code
      FROM basket_catalog
      WHERE is_active = 1
      ORDER BY label ASC
    `);
    return result.rows;
  }

  async function listFreeCatalogQrs({ limit, excludeOrderId }) {
    if (Number(excludeOrderId || 0) > 0) {
      const result = await queryable.query(
        `
          SELECT c.qr_code
          FROM basket_catalog c
          LEFT JOIN baskets b
            ON b.qr_code = c.qr_code
           AND b.order_id != $1
          WHERE c.is_active = 1
            AND b.id IS NULL
          ORDER BY c.label ASC
          LIMIT $2
        `,
        [excludeOrderId, limit]
      );
      return result.rows;
    }

    const result = await queryable.query(
      `
        SELECT c.qr_code
        FROM basket_catalog c
        LEFT JOIN baskets b ON b.qr_code = c.qr_code
        WHERE c.is_active = 1
          AND b.id IS NULL
        ORDER BY c.label ASC
        LIMIT $1
      `,
      [limit]
    );
    return result.rows;
  }

  async function findConflictingQrCode({ qrCode, excludeOrderId }) {
    if (Number(excludeOrderId || 0) > 0) {
      const result = await queryable.query(
        "SELECT qr_code FROM baskets WHERE qr_code = $1 AND order_id != $2 LIMIT 1",
        [qrCode, excludeOrderId]
      );
      return result.rows[0] || null;
    }

    const result = await queryable.query("SELECT qr_code FROM baskets WHERE qr_code = $1 LIMIT 1", [qrCode]);
    return result.rows[0] || null;
  }

  async function findOrderById(orderId) {
    const result = await queryable.query("SELECT * FROM orders WHERE id = $1", [orderId]);
    return result.rows[0] || null;
  }

  async function countBasketsByOrder(orderId) {
    const result = await queryable.query("SELECT COUNT(*)::int AS count FROM baskets WHERE order_id = $1", [orderId]);
    return Number(result.rows[0]?.count || 0);
  }

  async function listBasketIdsByOrder(orderId) {
    const result = await queryable.query("SELECT id FROM baskets WHERE order_id = $1", [orderId]);
    return result.rows.map((row) => row.id);
  }

  async function listBasketImagesByBasketIds(basketIds) {
    if (!Array.isArray(basketIds) || !basketIds.length) return [];
    const result = await queryable.query(
      `
        SELECT id, file_path
        FROM basket_images
        WHERE basket_id IN (${createPlaceholders(basketIds)})
      `,
      basketIds
    );
    return result.rows;
  }

  async function deleteBasketImagesByBasketIds(basketIds) {
    if (!Array.isArray(basketIds) || !basketIds.length) return { changes: 0 };
    const result = await queryable.query(
      `DELETE FROM basket_images WHERE basket_id IN (${createPlaceholders(basketIds)})`,
      basketIds
    );
    return { changes: result.rowCount };
  }

  async function insertBasketImage({ basketId, role, sortOrder, note, filePath, publicUrl, timestamp }) {
    const result = await queryable.query(
      `
        INSERT INTO basket_images (basket_id, image_role, sort_order, note, file_path, public_url, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `,
      [basketId, role, sortOrder, note, filePath, publicUrl, timestamp]
    );
    const rowId = Number(result.rows[0]?.id || 0);
    if (!Number.isInteger(rowId) || rowId <= 0) {
      throw new Error("Failed to read inserted basket image id.");
    }
    return rowId;
  }

  async function insertBasket({
    orderId,
    basketCode,
    basketType,
    basketItemsJson,
    qrCode,
    labelPrintedAt,
    labelPrintCount,
    timestamp
  }) {
    const result = await queryable.query(
      `
        INSERT INTO baskets (
          order_id, basket_code, basket_type, basket_items_json, station, status, qr_code,
          label_printed_at, label_print_count, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, 'washing', 'washing', $5, $6, $7, $8, $9)
        RETURNING id
      `,
      [
        orderId,
        basketCode,
        basketType,
        basketItemsJson,
        qrCode,
        labelPrintedAt,
        labelPrintCount,
        timestamp,
        timestamp
      ]
    );
    const rowId = Number(result.rows[0]?.id || 0);
    if (!Number.isInteger(rowId) || rowId <= 0) {
      throw new Error("Failed to read inserted basket id.");
    }
    return rowId;
  }

  async function deleteBasketsByOrder(orderId) {
    const result = await queryable.query("DELETE FROM baskets WHERE order_id = $1", [orderId]);
    return { changes: result.rowCount };
  }

  async function markOrderSorted({ orderId, timestamp }) {
    const result = await queryable.query(
      `
        UPDATE orders
        SET status = 'sorted', cleancloud_status = 'In progress', ready_to_place = 0, ready_for_pickup = 0, updated_at = $1
        WHERE id = $2
      `,
      [timestamp, orderId]
    );
    return { changes: result.rowCount };
  }

  async function markOrderReturnedToSorting({ orderId, timestamp }) {
    const result = await queryable.query(
      `
        UPDATE orders
        SET status = 'sorting', cleancloud_status = 'New order', ready_to_place = 0, ready_for_pickup = 0, updated_at = $1
        WHERE id = $2
      `,
      [timestamp, orderId]
    );
    return { changes: result.rowCount };
  }

  async function insertSortingScanEvent({ orderId, actor, message, timestamp }) {
    const result = await queryable.query(
      `
        INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
        VALUES ($1, NULL, 'sorting', $2, 'ok', $3, $4)
      `,
      [orderId, actor, message, timestamp]
    );
    return { changes: result.rowCount };
  }

  return {
    listKnownCatalogQrs,
    listFreeCatalogQrs,
    findConflictingQrCode,
    findOrderById,
    countBasketsByOrder,
    listBasketIdsByOrder,
    listBasketImagesByBasketIds,
    deleteBasketImagesByBasketIds,
    insertBasketImage,
    insertBasket,
    deleteBasketsByOrder,
    markOrderSorted,
    markOrderReturnedToSorting,
    insertSortingScanEvent
  };
}

module.exports = {
  createPostgresSortingRepository
};
