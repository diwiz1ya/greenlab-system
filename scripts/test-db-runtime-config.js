const assert = require("node:assert/strict");
const {
  normalizeDatabaseClient,
  openDatabase
} = require("../backend/db");
const {
  buildPostgresConfig,
  normalizePostgresConnectionString,
  openPostgresDatabase
} = require("../backend/db/postgres");

assert.equal(normalizeDatabaseClient(""), "sqlite");
assert.equal(normalizeDatabaseClient("sqlite"), "sqlite");
assert.equal(normalizeDatabaseClient("postgresql"), "postgres");
assert.equal(normalizeDatabaseClient("pg"), "postgres");
assert.throws(() => normalizeDatabaseClient("mysql"), /Unsupported GREENLAB_DB_CLIENT/);

assert.equal(
  normalizePostgresConnectionString("postgres://user:pass@localhost:5432/greenlab"),
  "postgres://user:pass@localhost:5432/greenlab"
);
assert.equal(
  normalizePostgresConnectionString("postgresql://localhost/greenlab"),
  "postgresql://localhost/greenlab"
);
assert.throws(() => normalizePostgresConnectionString(""), /GREENLAB_DATABASE_URL is required/);
assert.throws(() => normalizePostgresConnectionString("sqlite://local/demo"), /must use postgres/);
assert.throws(() => normalizePostgresConnectionString("postgres://localhost"), /database name/);

assert.deepEqual(
  buildPostgresConfig({
    connectionString: "postgres://localhost/greenlab",
    maxConnections: 4,
    ssl: { rejectUnauthorized: false }
  }),
  {
    connectionString: "postgres://localhost/greenlab",
    max: 4,
    ssl: { rejectUnauthorized: false }
  }
);

const postgresPool = openPostgresDatabase({ connectionString: "postgres://localhost/greenlab" });
assert.equal(typeof postgresPool.query, "function");
assert.equal(typeof postgresPool.connect, "function");
assert.equal(typeof postgresPool.end, "function");
postgresPool.end();

const postgresRuntime = openDatabase({ client: "postgres", databaseUrl: "postgres://localhost/greenlab" });
assert.equal(postgresRuntime.client, "postgres");
assert.equal(typeof postgresRuntime.db.query, "function");
postgresRuntime.db.end();

console.log("DB runtime config tests: OK");
