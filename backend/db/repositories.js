const { createSqliteCoreRepository } = require("./sqlite-core-repository");
const { createSqliteUserRepository } = require("./sqlite-user-repository");
const { createSqliteSecurityEventRepository } = require("./sqlite-security-event-repository");
const { createSqliteScanRepository } = require("./sqlite-scan-repository");

function createRepositories(options = {}) {
  const client = String(options.client || "sqlite").trim().toLowerCase();
  if (client !== "sqlite") {
    throw new Error(`Repository factory does not support database client yet: ${client}`);
  }

  return {
    coreRepository: createSqliteCoreRepository(options.db),
    scanRepository: createSqliteScanRepository(options.db),
    securityEventRepository: createSqliteSecurityEventRepository(options.db),
    userRepository: createSqliteUserRepository(options.db)
  };
}

module.exports = {
  createRepositories
};
