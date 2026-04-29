function createPostgresSystemRepository(queryable) {
  async function checkConnection() {
    const result = await queryable.query("SELECT 1 AS ok");
    return result.rows[0] || null;
  }

  async function listSyncQueueStatusCounts() {
    const result = await queryable.query(`
      SELECT status, COUNT(*)::int AS count
      FROM sync_queue
      GROUP BY status
    `);
    return result.rows;
  }

  return {
    checkConnection,
    listSyncQueueStatusCounts
  };
}

module.exports = {
  createPostgresSystemRepository
};
