function createPostgresSecurityEventRepository(queryable) {
  async function insertSecurityEvent(event) {
    const result = await queryable.query(
      `
        INSERT INTO security_events (category, actor, ip, path, method, status, message, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        event.category,
        event.actor,
        event.ip,
        event.path,
        event.method,
        event.status,
        event.message,
        event.createdAt
      ]
    );
    return { changes: result.rowCount };
  }

  async function listSecurityEvents(limit, category = null) {
    const normalizedCategory = String(category || "").trim();
    if (normalizedCategory) {
      const result = await queryable.query(
        `
          SELECT id, category, actor, ip, path, method, status, message, created_at
          FROM security_events
          WHERE category = $1
          ORDER BY id DESC
          LIMIT $2
        `,
        [normalizedCategory, limit]
      );
      return result.rows;
    }

    const result = await queryable.query(
      `
        SELECT id, category, actor, ip, path, method, status, message, created_at
        FROM security_events
        ORDER BY id DESC
        LIMIT $1
      `,
      [limit]
    );
    return result.rows;
  }

  return {
    insertSecurityEvent,
    listSecurityEvents
  };
}

module.exports = {
  createPostgresSecurityEventRepository
};
