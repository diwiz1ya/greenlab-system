function createPostgresScanRepository(queryable) {
  async function listExportRows(orderId) {
    if (orderId) {
      const result = await queryable.query(
        `
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
          WHERE se.order_id = $1
          ORDER BY se.created_at DESC, se.id DESC
        `,
        [orderId]
      );
      return result.rows;
    }

    const result = await queryable.query(`
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
      ORDER BY se.created_at DESC, se.id DESC
    `);
    return result.rows;
  }

  async function listRecentByStation(station, limit) {
    const result = await queryable.query(
      `
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
        WHERE se.station = $1
        ORDER BY se.created_at DESC, se.id DESC
        LIMIT $2
      `,
      [station, limit]
    );
    return result.rows;
  }

  return {
    listExportRows,
    listRecentByStation
  };
}

module.exports = {
  createPostgresScanRepository
};
