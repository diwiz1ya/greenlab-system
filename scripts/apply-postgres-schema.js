const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { buildPostgresConfig } = require("../backend/db/postgres");

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..");
  loadDotEnv(path.join(repoRoot, ".env"));

  const schemaPath = path.join(repoRoot, "backend", "db", "postgres-schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  const dryRun = process.argv.includes("--dry-run");
  const config = buildPostgresConfig({
    connectionString: process.env.GREENLAB_DATABASE_URL || process.env.DATABASE_URL,
    maxConnections: 1,
    ssl: false
  });

  if (dryRun) {
    console.log(`PostgreSQL schema dry run OK: ${schemaPath}`);
    console.log(`Target: ${config.connectionString.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@")}`);
    return;
  }

  const pool = new Pool(config);
  try {
    await pool.query(schemaSql);
    console.log("PostgreSQL schema applied successfully.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
