const assert = require("node:assert/strict");
const {
  POSTGRES_NOT_READY_MESSAGE,
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

assert.throws(
  () => openPostgresDatabase({ connectionString: "postgres://localhost/greenlab" }),
  new RegExp(POSTGRES_NOT_READY_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
);
assert.throws(
  () => openDatabase({ client: "postgres", databaseUrl: "postgres://localhost/greenlab" }),
  new RegExp(POSTGRES_NOT_READY_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
);

console.log("DB runtime config tests: OK");
