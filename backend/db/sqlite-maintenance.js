const fs = require("node:fs");
const { openSqliteDatabase } = require("./sqlite");

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function validateSqliteFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`SQLite file does not exist: ${filePath}`);
  }

  const db = openSqliteDatabase({
    dbPath: filePath,
    readOnly: true,
    applySchema: false
  });
  try {
    const row = db.prepare("PRAGMA integrity_check;").get();
    const ok = row && String(row.integrity_check || "").toLowerCase() === "ok";
    if (!ok) {
      throw new Error(`integrity_check failed for ${filePath}`);
    }
  } finally {
    db.close();
  }
}

function createSqliteBackup(dbPath, backupPath) {
  const db = openSqliteDatabase({
    dbPath,
    applySchema: false
  });
  try {
    db.exec("PRAGMA busy_timeout = 5000;");
    db.exec("PRAGMA wal_checkpoint(PASSIVE);");
    db.exec(`VACUUM INTO ${sqlLiteral(backupPath)};`);
  } finally {
    db.close();
  }
}

module.exports = {
  createSqliteBackup,
  validateSqliteFile
};
