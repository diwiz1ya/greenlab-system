const { createSqliteCoreRepository } = require("./sqlite-core-repository");
const { createSqliteDemoSeedRepository } = require("./sqlite-demo-seed-repository");
const { createSqliteIdempotencyRepository } = require("./sqlite-idempotency-repository");
const { createSqliteOrderQueryRepository } = require("./sqlite-order-query-repository");
const { createSqlitePickupWorkbenchRepository } = require("./sqlite-pickup-workbench-repository");
const { createSqliteUserRepository } = require("./sqlite-user-repository");
const { createSqliteSecurityEventRepository } = require("./sqlite-security-event-repository");
const { createSqliteScanRepository } = require("./sqlite-scan-repository");
const { createSqliteSystemRepository } = require("./sqlite-system-repository");

function createRepositories(options = {}) {
  const client = String(options.client || "sqlite").trim().toLowerCase();
  if (client !== "sqlite") {
    throw new Error(`Repository factory does not support database client yet: ${client}`);
  }

  return {
    coreRepository: createSqliteCoreRepository(options.db),
    demoSeedRepository: createSqliteDemoSeedRepository(options.db),
    idempotencyRepository: createSqliteIdempotencyRepository(options.db),
    orderQueryRepository: createSqliteOrderQueryRepository(options.db),
    pickupWorkbenchRepository: createSqlitePickupWorkbenchRepository(options.db),
    scanRepository: createSqliteScanRepository(options.db),
    securityEventRepository: createSqliteSecurityEventRepository(options.db),
    systemRepository: createSqliteSystemRepository(options.db),
    userRepository: createSqliteUserRepository(options.db)
  };
}

module.exports = {
  createRepositories
};
