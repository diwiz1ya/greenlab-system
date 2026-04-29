const fs = require("node:fs");
const path = require("node:path");
const { normalizeDatabaseClient, POSTGRES_NOT_READY_MESSAGE } = require("../backend/db");

function resolveRuntimePath(value, fallbackPath) {
  const raw = String(value || "").trim();
  return raw ? path.resolve(__dirname, "..", raw) : fallbackPath;
}

function main() {
  const rootDir = path.resolve(__dirname, "..");
  const dataDir = resolveRuntimePath(process.env.GREENLAB_DATA_DIR, path.join(rootDir, "data"));
  const sqlitePath = resolveRuntimePath(
    process.env.GREENLAB_DB_PATH,
    path.join(dataDir, "greenlab-demo.sqlite")
  );
  const client = normalizeDatabaseClient(process.env.GREENLAB_DB_CLIENT);

  console.log(`Database client: ${client}`);

  if (client === "sqlite") {
    console.log(`SQLite path: ${sqlitePath}`);
    console.log(`SQLite file: ${fs.existsSync(sqlitePath) ? "exists" : "will be created on app start"}`);
    console.log("Status: ready for demo/MVP runtime");
    return;
  }

  console.log(`PostgreSQL URL: ${process.env.GREENLAB_DATABASE_URL ? "configured" : "missing GREENLAB_DATABASE_URL"}`);
  console.log(`Status: ${POSTGRES_NOT_READY_MESSAGE}`);
}

main();
