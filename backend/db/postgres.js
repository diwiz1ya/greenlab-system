const { Pool } = require("pg");

function normalizePostgresConnectionString(value) {
  const connectionString = String(value || "").trim();
  if (!connectionString) {
    throw new Error("GREENLAB_DATABASE_URL is required when GREENLAB_DB_CLIENT=postgres.");
  }

  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("GREENLAB_DATABASE_URL must be a valid PostgreSQL connection URL.");
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("GREENLAB_DATABASE_URL must use postgres:// or postgresql://.");
  }

  if (!parsed.hostname) {
    throw new Error("GREENLAB_DATABASE_URL must include a host.");
  }

  if (!parsed.pathname || parsed.pathname === "/") {
    throw new Error("GREENLAB_DATABASE_URL must include a database name.");
  }

  return parsed.toString();
}

function buildPostgresConfig(options = {}) {
  const connectionString = normalizePostgresConnectionString(
    options.connectionString || process.env.GREENLAB_DATABASE_URL || process.env.DATABASE_URL
  );

  return {
    connectionString,
    max: Number.isInteger(options.maxConnections) && options.maxConnections > 0
      ? options.maxConnections
      : 10,
    ssl: options.ssl || false
  };
}

function openPostgresDatabase(options = {}) {
  return new Pool(buildPostgresConfig(options));
}

module.exports = {
  buildPostgresConfig,
  normalizePostgresConnectionString,
  openPostgresDatabase
};
