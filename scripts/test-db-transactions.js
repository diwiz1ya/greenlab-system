const assert = require("node:assert/strict");
const {
  runAsyncTransaction,
  runImmediateAsyncTransaction
} = require("../backend/db/transaction");

function createFakePool(options = {}) {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (options.failOn === sql) {
        throw new Error(`failed ${sql}`);
      }
      return { rows: [] };
    },
    release() {
      calls.push("release");
    }
  };

  return {
    calls,
    async connect() {
      calls.push("connect");
      return client;
    }
  };
}

(async () => {
  const successPool = createFakePool();
  const success = await runAsyncTransaction(successPool, async (client) => {
    await client.query("SELECT 1");
    return "ok";
  });
  assert.equal(success, "ok");
  assert.deepEqual(successPool.calls, ["connect", "BEGIN", "SELECT 1", "COMMIT", "release"]);

  const failurePool = createFakePool();
  await assert.rejects(
    () => runAsyncTransaction(failurePool, async (client) => {
      await client.query("UPDATE orders");
      throw new Error("work failed");
    }),
    /work failed/
  );
  assert.deepEqual(failurePool.calls, ["connect", "BEGIN", "UPDATE orders", "ROLLBACK", "release"]);

  const rollbackFailurePool = createFakePool({ failOn: "ROLLBACK" });
  await assert.rejects(
    () => runAsyncTransaction(rollbackFailurePool, async () => {
      throw new Error("original failure");
    }),
    /original failure/
  );
  assert.deepEqual(rollbackFailurePool.calls, ["connect", "BEGIN", "ROLLBACK", "release"]);

  await assert.rejects(() => runAsyncTransaction({}, async () => {}), /connect/);
  await assert.rejects(() => runAsyncTransaction(createFakePool(), null), /callback/);

  const sqliteCalls = [];
  const sqliteBeginImmediate = ["BEGIN", "IMMEDIATE;"].join(" ");
  const fakeSqlite = {
    exec(sql) {
      sqliteCalls.push(sql);
    }
  };
  const sqliteResult = await runImmediateAsyncTransaction(fakeSqlite, async () => {
    sqliteCalls.push("work");
    return "sqlite-ok";
  });
  assert.equal(sqliteResult, "sqlite-ok");
  assert.deepEqual(sqliteCalls, [sqliteBeginImmediate, "work", "COMMIT;"]);

  const sqliteRollbackCalls = [];
  await assert.rejects(
    () => runImmediateAsyncTransaction(
      {
        exec(sql) {
          sqliteRollbackCalls.push(sql);
        }
      },
      async () => {
        sqliteRollbackCalls.push("work");
        throw new Error("sqlite work failed");
      }
    ),
    /sqlite work failed/
  );
  assert.deepEqual(sqliteRollbackCalls, [sqliteBeginImmediate, "work", "ROLLBACK;"]);

  const asyncOnlyResult = await runImmediateAsyncTransaction(
    {},
    async () => "async-only-ok"
  );
  assert.equal(asyncOnlyResult, "async-only-ok");

  console.log("DB transaction tests: OK");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
