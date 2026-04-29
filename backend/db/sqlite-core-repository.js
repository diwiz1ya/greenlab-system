function createSqliteCoreRepository(db) {
  const countOrdersStmt = db.prepare("SELECT COUNT(*) AS count FROM orders");
  const countScansStmt = db.prepare("SELECT COUNT(*) AS count FROM scan_events");

  function getDemoResetCounts() {
    return {
      orders: countOrdersStmt.get().count,
      scans: countScansStmt.get().count
    };
  }

  return {
    getDemoResetCounts
  };
}

module.exports = {
  createSqliteCoreRepository
};
