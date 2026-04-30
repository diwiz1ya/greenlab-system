const assert = require("node:assert/strict");
const {
  POSTGRES_BLOCKED_REPOSITORIES,
  POSTGRES_READY_REPOSITORIES,
  createRepositories
} = require("../backend/db/repositories");

const fakeQueryable = {
  async query() {
    return { rows: [], rowCount: 0 };
  }
};

assert.deepEqual(POSTGRES_BLOCKED_REPOSITORIES, [
  "workflowRepository"
]);
assert.deepEqual(POSTGRES_READY_REPOSITORIES, [
  "cleanCloudRepository",
  "coreRepository",
  "demoSeedRepository",
  "idempotencyRepository",
  "orderQueryRepository",
  "pickupWorkbenchRepository",
  "reworkRepository",
  "scanRepository",
  "securityEventRepository",
  "sortingRepository",
  "systemRepository",
  "userRepository"
]);

assert.throws(
  () => createRepositories({ client: "postgres", db: fakeQueryable }),
  /Missing repositories: workflowRepository/
);

const partialPostgresRepositories = createRepositories({
  client: "postgres",
  db: fakeQueryable,
  allowPartialPostgres: true
});
for (const name of POSTGRES_READY_REPOSITORIES) {
  assert.equal(typeof partialPostgresRepositories[name], "object", `${name} should be created`);
}
for (const name of POSTGRES_BLOCKED_REPOSITORIES) {
  assert.equal(partialPostgresRepositories[name], undefined, `${name} should remain blocked`);
}

assert.throws(
  () => createRepositories({ client: "mysql", db: fakeQueryable }),
  /does not support database client/
);

console.log("Repository factory tests: OK");
