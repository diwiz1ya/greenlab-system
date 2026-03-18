const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const dbPath = path.join(dataDir, "greenlab-demo.sqlite");
const backupDir = path.join(rootDir, "backups", "sqlite");
const backupPrefix = "greenlab-demo";

function parseNumberFlag(name, fallback) {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!arg) return fallback;
  const value = Number(arg.split("=")[1]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function nowStamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function listBackupFiles() {
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(`${backupPrefix}-`) && name.endsWith(".sqlite"))
    .map((name) => {
      const fullPath = path.join(backupDir, name);
      return { name, fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function pruneBackups(maxKeep) {
  const files = listBackupFiles();
  const extra = files.slice(maxKeep);
  for (const item of extra) {
    fs.unlinkSync(item.fullPath);
  }
  return extra.length;
}

function validateBackup(filePath) {
  const db = new DatabaseSync(filePath);
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

function run() {
  const keep = parseNumberFlag("keep", 14);

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  fs.mkdirSync(backupDir, { recursive: true });
  const backupName = `${backupPrefix}-${nowStamp()}.sqlite`;
  const backupPath = path.join(backupDir, backupName);

  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 5000;");
    db.exec("PRAGMA wal_checkpoint(PASSIVE);");
    db.exec(`VACUUM INTO ${sqlLiteral(backupPath)};`);
  } finally {
    db.close();
  }

  validateBackup(backupPath);
  const removed = pruneBackups(keep);

  console.log(`Backup created: ${backupPath}`);
  console.log(`Retention: keep=${keep}, removed=${removed}`);
}

try {
  run();
} catch (error) {
  console.error("backup-db failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
