function runImmediateTransaction(db, work) {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const result = work();
    db.exec("COMMIT;");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // ignore rollback failure
    }
    throw error;
  }
}

module.exports = {
  runImmediateTransaction
};
