function createSecurityEventService(db, options = {}) {
  const nowIso = options.nowIso || (() => new Date().toISOString());

  function logSecurityEvent(event = {}) {
    const createdAt = nowIso();
    const category = String(event.category || "security.unknown");
    const actor = String(event.actor || "anonymous");
    const ip = String(event.ip || "unknown");
    const path = String(event.path || "");
    const method = String(event.method || "");
    const status = Number.isInteger(event.status) ? event.status : 0;
    const message = String(event.message || "");

    db.prepare(`
      INSERT INTO security_events (category, actor, ip, path, method, status, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(category, actor, ip, path, method, status, message, createdAt);
  }

  function listSecurityEvents(limit = 50, category = null) {
    const normalizedLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 200)) : 50;
    if (category && String(category).trim()) {
      return db.prepare(`
        SELECT id, category, actor, ip, path, method, status, message, created_at
        FROM security_events
        WHERE category = ?
        ORDER BY id DESC
        LIMIT ?
      `).all(String(category).trim(), normalizedLimit);
    }

    return db.prepare(`
      SELECT id, category, actor, ip, path, method, status, message, created_at
      FROM security_events
      ORDER BY id DESC
      LIMIT ?
    `).all(normalizedLimit);
  }

  return {
    logSecurityEvent,
    listSecurityEvents
  };
}

module.exports = {
  createSecurityEventService
};
