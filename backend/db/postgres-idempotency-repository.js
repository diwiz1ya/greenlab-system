function createPostgresIdempotencyRepository(queryable) {
  async function purgeExpired(nowStamp) {
    const result = await queryable.query(
      `
        DELETE FROM idempotency_records
        WHERE expires_at <= $1
      `,
      [nowStamp]
    );
    return { changes: result.rowCount };
  }

  async function findCachedRecord({ key, routeKey, actor, nowStamp }) {
    const result = await queryable.query(
      `
        SELECT status_code, response_json
        FROM idempotency_records
        WHERE idem_key = $1
          AND route_key = $2
          AND actor = $3
          AND expires_at > $4
        LIMIT 1
      `,
      [key, routeKey, actor, nowStamp]
    );
    return result.rows[0] || null;
  }

  async function saveRecord({ key, routeKey, actor, statusCode, responseJson, nowStamp, expiresAt }) {
    const result = await queryable.query(
      `
        INSERT INTO idempotency_records (
          idem_key, route_key, actor, status_code, response_json, created_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT(idem_key, route_key, actor) DO UPDATE SET
          status_code = excluded.status_code,
          response_json = excluded.response_json,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at
      `,
      [key, routeKey, actor, statusCode, responseJson, nowStamp, expiresAt]
    );
    return { changes: result.rowCount };
  }

  return {
    purgeExpired,
    findCachedRecord,
    saveRecord
  };
}

module.exports = {
  createPostgresIdempotencyRepository
};
