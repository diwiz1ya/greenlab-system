function createScanExportService(db) {
  function getScanExportRows(orderId) {
    if (orderId) {
      return db.prepare(`
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
      `).all(orderId);
    }

    return db.prepare(`
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
    `).all();
  }

  function getRecentScansByStation(station, limit) {
    return db.prepare(`
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
    `).all(station, limit);
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    if (text.includes(",") || text.includes("\"") || text.includes("\n") || text.includes("\r")) {
      return `"${text.replaceAll("\"", "\"\"")}"`;
    }
    return text;
  }

  function scanRowsToCsv(rows) {
    const columns = [
      "id",
      "order_public_id",
      "customer_name",
      "basket_code",
      "station",
      "actor",
      "result",
      "message",
      "created_at"
    ];

    const lines = [columns.join(",")];
    for (const row of rows) {
      lines.push(columns.map((column) => csvEscape(row[column])).join(","));
    }
    return lines.join("\n");
  }

  return {
    getScanExportRows,
    getRecentScansByStation,
    scanRowsToCsv
  };
}

module.exports = {
  createScanExportService
};
