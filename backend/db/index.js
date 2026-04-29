const { openSqliteDatabase } = require("./sqlite");

const POSTGRES_NOT_READY_MESSAGE = [
  "GREENLAB_DB_CLIENT=postgres is reserved for the PostgreSQL migration branch,",
  "but the application still uses the synchronous SQLite query contract.",
  "Keep GREENLAB_DB_CLIENT=sqlite until repository methods are migrated to an async PostgreSQL adapter."
].join(" ");

function normalizeDatabaseClient(value) {
  const client = String(value || "sqlite").trim().toLowerCase();
  if (!client || client === "sqlite") return "sqlite";
  if (client === "postgres" || client === "postgresql" || client === "pg") return "postgres";
  throw new Error(`Unsupported GREENLAB_DB_CLIENT value: ${client}`);
}

function openDatabase(options = {}) {
  const client = normalizeDatabaseClient(options.client);

  if (client === "sqlite") {
    return {
      client,
      db: openSqliteDatabase({ dbPath: options.sqlitePath })
    };
  }

  throw new Error(POSTGRES_NOT_READY_MESSAGE);
}

module.exports = {
  POSTGRES_NOT_READY_MESSAGE,
  normalizeDatabaseClient,
  openDatabase
};
