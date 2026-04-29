function createSqliteScanRepository(db) {
  const listExportRowsByOrderStmt = db.prepare(`
    SELECT
      se.id,
      o.public_id AS order_public_id,
      o.customer_name,
      COALESCE(b.basket_code, '') AS basket_code,
      se.station,
      se.actor,
      se.result,
      se.message,
      se.created_at
    FROM scan_events se
    JOIN orders o ON o.id = se.order_id
    LEFT JOIN baskets b ON b.id = se.basket_id
    WHERE se.order_id = ?
    ORDER BY datetime(se.created_at) DESC, se.id DESC
  `);
  const listExportRowsStmt = db.prepare(`
    SELECT
      se.id,
      o.public_id AS order_public_id,
      o.customer_name,
      COALESCE(b.basket_code, '') AS basket_code,
      se.station,
      se.actor,
      se.result,
      se.message,
      se.created_at
    FROM scan_events se
    JOIN orders o ON o.id = se.order_id
    LEFT JOIN baskets b ON b.id = se.basket_id
    ORDER BY datetime(se.created_at) DESC, se.id DESC
  `);
  const listRecentByStationStmt = db.prepare(`
    SELECT
      se.id,
      o.public_id AS order_public_id,
      COALESCE(b.basket_code, '') AS basket_code,
      se.actor,
      se.result,
      se.message,
      se.created_at
    FROM scan_events se
    JOIN orders o ON o.id = se.order_id
    LEFT JOIN baskets b ON b.id = se.basket_id
    WHERE se.station = ?
    ORDER BY datetime(se.created_at) DESC, se.id DESC
    LIMIT ?
  `);

  function listExportRows(orderId) {
    if (orderId) {
      return listExportRowsByOrderStmt.all(orderId);
    }
    return listExportRowsStmt.all();
  }

  function listRecentByStation(station, limit) {
    return listRecentByStationStmt.all(station, limit);
  }

  return {
    listExportRows,
    listRecentByStation
  };
}

module.exports = {
  createSqliteScanRepository
};
