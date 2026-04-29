const { openSqliteDatabase } = require("./sqlite");
const {
  POSTGRES_NOT_READY_MESSAGE,
  openPostgresDatabase
} = require("./postgres");

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

  return {
    client,
    db: openPostgresDatabase({
      connectionString: options.postgresUrl || options.databaseUrl,
      maxConnections: options.postgresMaxConnections,
      ssl: options.postgresSsl
    })
  };
}

module.exports = {
  POSTGRES_NOT_READY_MESSAGE,
  normalizeDatabaseClient,
  openDatabase
};
