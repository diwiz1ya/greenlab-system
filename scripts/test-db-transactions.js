const assert = require("node:assert/strict");
const { runAsyncTransaction } = require("../backend/db/transaction");

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

  console.log("DB transaction tests: OK");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
