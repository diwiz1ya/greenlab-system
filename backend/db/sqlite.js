const { DatabaseSync } = require("node:sqlite");
const {
  applySqliteBootstrapSchema,
  ensureSqliteSchema
} = require("./sqlite-schema");

function openSqliteDatabase(options = {}) {
  const dbPath = String(options.dbPath || "").trim();
  if (!dbPath) {
    throw new Error("SQLite database path is required.");
  }

  const openOptions = {};
  if (options.readOnly) {
    openOptions.readOnly = true;
  }

  const db = new DatabaseSync(dbPath, openOptions);
  const shouldApplySchema = options.applySchema !== false && !options.readOnly;
  if (shouldApplySchema) {
    applySqliteBootstrapSchema(db);
    ensureSqliteSchema(db);
  }
  return db;
}

module.exports = {
  openSqliteDatabase
};
