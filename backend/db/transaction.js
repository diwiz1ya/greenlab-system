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

async function runImmediateAsyncTransaction(db, work) {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const result = await work();
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

async function runAsyncTransaction(pool, work) {
  if (!pool || typeof pool.connect !== "function") {
    throw new Error("PostgreSQL transaction pool must expose connect().");
  }
  if (typeof work !== "function") {
    throw new Error("Transaction work callback is required.");
  }

  const client = await pool.connect();
  if (!client || typeof client.query !== "function" || typeof client.release !== "function") {
    throw new Error("PostgreSQL transaction client must expose query() and release().");
  }

  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure; preserve the original transaction error
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  runAsyncTransaction,
  runImmediateAsyncTransaction,
  runImmediateTransaction
};
