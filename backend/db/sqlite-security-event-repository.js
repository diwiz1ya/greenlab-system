function createSqliteSecurityEventRepository(db) {
  const insertSecurityEventStmt = db.prepare(`
    INSERT INTO security_events (category, actor, ip, path, method, status, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const listSecurityEventsByCategoryStmt = db.prepare(`
    SELECT id, category, actor, ip, path, method, status, message, created_at
    FROM security_events
    WHERE category = ?
    ORDER BY id DESC
    LIMIT ?
  `);
  const listSecurityEventsStmt = db.prepare(`
    SELECT id, category, actor, ip, path, method, status, message, created_at
    FROM security_events
    ORDER BY id DESC
    LIMIT ?
  `);

  function insertSecurityEvent(event) {
    return insertSecurityEventStmt.run(
      event.category,
      event.actor,
      event.ip,
      event.path,
      event.method,
      event.status,
      event.message,
      event.createdAt
    );
  }

  function listSecurityEvents(limit, category = null) {
    const normalizedCategory = String(category || "").trim();
    if (normalizedCategory) {
      return listSecurityEventsByCategoryStmt.all(normalizedCategory, limit);
    }
    return listSecurityEventsStmt.all(limit);
  }

  return {
    insertSecurityEvent,
    listSecurityEvents
  };
}

module.exports = {
  createSqliteSecurityEventRepository
};
