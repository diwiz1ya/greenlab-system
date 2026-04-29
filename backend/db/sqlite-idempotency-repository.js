function createSqliteIdempotencyRepository(db) {
  const purgeExpiredStmt = db.prepare(`
    DELETE FROM idempotency_records
    WHERE expires_at <= ?
  `);
  const findCachedRecordStmt = db.prepare(`
    SELECT status_code, response_json
    FROM idempotency_records
    WHERE idem_key = ?
      AND route_key = ?
      AND actor = ?
      AND expires_at > ?
    LIMIT 1
  `);
  const saveRecordStmt = db.prepare(`
    INSERT INTO idempotency_records (
      idem_key, route_key, actor, status_code, response_json, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(idem_key, route_key, actor) DO UPDATE SET
      status_code = excluded.status_code,
      response_json = excluded.response_json,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at
  `);

  function purgeExpired(nowStamp) {
    return purgeExpiredStmt.run(nowStamp);
  }

  function findCachedRecord({ key, routeKey, actor, nowStamp }) {
    return findCachedRecordStmt.get(key, routeKey, actor, nowStamp);
  }

  function saveRecord({ key, routeKey, actor, statusCode, responseJson, nowStamp, expiresAt }) {
    return saveRecordStmt.run(key, routeKey, actor, statusCode, responseJson, nowStamp, expiresAt);
  }

  return {
    purgeExpired,
    findCachedRecord,
    saveRecord
  };
}

module.exports = {
  createSqliteIdempotencyRepository
};
