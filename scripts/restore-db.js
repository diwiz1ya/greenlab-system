const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const targetDbPath = path.join(dataDir, "greenlab-demo.sqlite");
const backupDir = path.join(rootDir, "backups", "sqlite");
const snapshotDir = path.join(dataDir, "recovery-snapshots");

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function getFlagValue(name) {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : "";
}

function nowStamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function listBackups() {
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sqlite"))
    .map((entry) => {
      const fullPath = path.join(backupDir, entry.name);
      return { fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function resolveBackupPath() {
  const explicit = getFlagValue("file");
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.resolve(rootDir, explicit);
  }

  if (hasFlag("latest")) {
    const latest = listBackups()[0];
    return latest ? latest.fullPath : "";
  }

  return "";
}

function validateSqliteFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Backup file does not exist: ${filePath}`);
  }
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

function snapshotCurrentDb() {
  if (!fs.existsSync(targetDbPath)) return null;
  fs.mkdirSync(snapshotDir, { recursive: true });
  const snapshotPath = path.join(snapshotDir, `greenlab-demo-before-restore-${nowStamp()}.sqlite`);
  fs.copyFileSync(targetDbPath, snapshotPath);
  return snapshotPath;
}

function cleanupWalFiles() {
  for (const suffix of ["-wal", "-shm"]) {
    const file = `${targetDbPath}${suffix}`;
    if (fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
    }
  }
}

function restoreFromBackup(backupPath) {
  fs.mkdirSync(dataDir, { recursive: true });
  const snapshotPath = snapshotCurrentDb();
  cleanupWalFiles();
  fs.copyFileSync(backupPath, targetDbPath);
  cleanupWalFiles();
  return snapshotPath;
}

function run() {
  const backupPath = resolveBackupPath();
  if (!backupPath) {
    throw new Error("Specify backup file via --file=<path> or use --latest");
  }

  validateSqliteFile(backupPath);
  const snapshot = restoreFromBackup(backupPath);

  console.log(`Restore completed: ${backupPath} -> ${targetDbPath}`);
  if (snapshot) {
    console.log(`Snapshot saved: ${snapshot}`);
  } else {
    console.log("Snapshot skipped: current DB file was absent.");
  }
}

try {
  run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("restore-db failed:", message);
  if (message.includes("EBUSY") || message.includes("EPERM") || message.includes("EACCES")) {
    console.error("Tip: stop the server before restore and retry.");
  }
  process.exit(1);
}
