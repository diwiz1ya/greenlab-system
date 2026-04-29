const { createSqliteUserRepository } = require("./sqlite-user-repository");
const { createSqliteSecurityEventRepository } = require("./sqlite-security-event-repository");

function createRepositories(options = {}) {
  const client = String(options.client || "sqlite").trim().toLowerCase();
  if (client !== "sqlite") {
    throw new Error(`Repository factory does not support database client yet: ${client}`);
  }

  return {
    securityEventRepository: createSqliteSecurityEventRepository(options.db),
    userRepository: createSqliteUserRepository(options.db)
  };
}

module.exports = {
  createRepositories
};
