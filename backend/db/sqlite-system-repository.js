function createSqliteSystemRepository(db) {
  const healthCheckStmt = db.prepare("SELECT 1 AS ok");
  const listSyncQueueStatusCountsStmt = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM sync_queue
    GROUP BY status
  `);

  function checkConnection() {
    return healthCheckStmt.get();
  }

  function listSyncQueueStatusCounts() {
    return listSyncQueueStatusCountsStmt.all();
  }

  return {
    checkConnection,
    listSyncQueueStatusCounts
  };
}

module.exports = {
  createSqliteSystemRepository
};
