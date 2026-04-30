const { createSqliteCoreRepository } = require("./sqlite-core-repository");
const { createSqliteCleanCloudRepository } = require("./sqlite-cleancloud-repository");
const { createSqliteDemoSeedRepository } = require("./sqlite-demo-seed-repository");
const { createSqliteIdempotencyRepository } = require("./sqlite-idempotency-repository");
const { createSqliteOrderQueryRepository } = require("./sqlite-order-query-repository");
const { createSqlitePickupWorkbenchRepository } = require("./sqlite-pickup-workbench-repository");
const { createSqliteReworkRepository } = require("./sqlite-rework-repository");
const { createSqliteUserRepository } = require("./sqlite-user-repository");
const { createSqliteSecurityEventRepository } = require("./sqlite-security-event-repository");
const { createSqliteScanRepository } = require("./sqlite-scan-repository");
const { createSqliteSortingRepository } = require("./sqlite-sorting-repository");
const { createSqliteSystemRepository } = require("./sqlite-system-repository");
const { createSqliteWorkflowRepository } = require("./sqlite-workflow-repository");
const { createPostgresCleanCloudRepository } = require("./postgres-cleancloud-repository");
const { createPostgresCoreRepository } = require("./postgres-core-repository");
const { createPostgresDemoSeedRepository } = require("./postgres-demo-seed-repository");
const { createPostgresIdempotencyRepository } = require("./postgres-idempotency-repository");
const { createPostgresOrderQueryRepository } = require("./postgres-order-query-repository");
const { createPostgresPickupWorkbenchRepository } = require("./postgres-pickup-workbench-repository");
const { createPostgresScanRepository } = require("./postgres-scan-repository");
const { createPostgresSecurityEventRepository } = require("./postgres-security-event-repository");
const { createPostgresSystemRepository } = require("./postgres-system-repository");
const { createPostgresUserRepository } = require("./postgres-user-repository");

const POSTGRES_READY_REPOSITORIES = [
  "cleanCloudRepository",
  "coreRepository",
  "demoSeedRepository",
  "idempotencyRepository",
  "orderQueryRepository",
  "pickupWorkbenchRepository",
  "scanRepository",
  "securityEventRepository",
  "systemRepository",
  "userRepository"
];

const POSTGRES_BLOCKED_REPOSITORIES = [
  "reworkRepository",
  "sortingRepository",
  "workflowRepository"
];

function createSqliteRepositories(db) {
  return {
    cleanCloudRepository: createSqliteCleanCloudRepository(db),
    coreRepository: createSqliteCoreRepository(db),
    demoSeedRepository: createSqliteDemoSeedRepository(db),
    idempotencyRepository: createSqliteIdempotencyRepository(db),
    orderQueryRepository: createSqliteOrderQueryRepository(db),
    pickupWorkbenchRepository: createSqlitePickupWorkbenchRepository(db),
    reworkRepository: createSqliteReworkRepository(db),
    scanRepository: createSqliteScanRepository(db),
    securityEventRepository: createSqliteSecurityEventRepository(db),
    sortingRepository: createSqliteSortingRepository(db),
    systemRepository: createSqliteSystemRepository(db),
    userRepository: createSqliteUserRepository(db),
    workflowRepository: createSqliteWorkflowRepository(db)
  };
}

function createPostgresRepositories(options = {}) {
  if (!options.allowPartialPostgres) {
    throw new Error(
      `PostgreSQL repository factory is incomplete. Missing repositories: ${POSTGRES_BLOCKED_REPOSITORIES.join(", ")}.`
    );
  }

  return {
    cleanCloudRepository: createPostgresCleanCloudRepository(options.db),
    coreRepository: createPostgresCoreRepository(options.db),
    demoSeedRepository: createPostgresDemoSeedRepository(options.db),
    idempotencyRepository: createPostgresIdempotencyRepository(options.db),
    orderQueryRepository: createPostgresOrderQueryRepository(options.db),
    pickupWorkbenchRepository: createPostgresPickupWorkbenchRepository(options.db),
    scanRepository: createPostgresScanRepository(options.db),
    securityEventRepository: createPostgresSecurityEventRepository(options.db),
    systemRepository: createPostgresSystemRepository(options.db),
    userRepository: createPostgresUserRepository(options.db)
  };
}

function createRepositories(options = {}) {
  const client = String(options.client || "sqlite").trim().toLowerCase();
  if (client === "sqlite") {
    return createSqliteRepositories(options.db);
  }
  if (client === "postgres") {
    return createPostgresRepositories(options);
  }

  throw new Error(`Repository factory does not support database client yet: ${client}`);
}

module.exports = {
  POSTGRES_BLOCKED_REPOSITORIES,
  POSTGRES_READY_REPOSITORIES,
  createPostgresRepositories,
  createRepositories,
  createSqliteRepositories
};
