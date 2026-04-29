const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const sourceEntries = ["server.js", "backend", "scripts"];
const ignoreDirs = new Set([".git", "backups", "data", "logs", "node_modules", "output"]);
const ignoreFiles = new Set(["scripts/audit-db-portability.js"]);
const sqliteBoundaryFiles = new Set([
  "backend/db/sqlite.js",
  "backend/db/sqlite-schema.js",
  "backend/db/statement-result.js",
  "backend/db/transaction.js"
]);

const lineRules = [
  {
    id: "sqlite-runtime",
    severity: "high",
    pattern: /\bDatabaseSync\b|require\(["']node:sqlite["']\)/,
    message: "Direct SQLite runtime dependency. PostgreSQL needs a separate async adapter."
  },
  {
    id: "sqlite-pragma",
    severity: "medium",
    pattern: /\bPRAGMA\b/i,
    message: "SQLite PRAGMA statement. PostgreSQL needs equivalent connection/session configuration."
  },
  {
    id: "sqlite-transaction",
    severity: "high",
    pattern: /\bBEGIN\s+IMMEDIATE\b/i,
    message: "SQLite-specific transaction lock. PostgreSQL needs BEGIN plus row/table-level locking where required."
  },
  {
    id: "sqlite-last-insert-id",
    severity: "high",
    pattern: /\blast_insert_rowid\s*\(/i,
    message: "SQLite last inserted id helper. PostgreSQL should use INSERT ... RETURNING id."
  },
  {
    id: "sqlite-backup",
    severity: "medium",
    pattern: /\bVACUUM\s+INTO\b|\bwal_checkpoint\b/i,
    message: "SQLite backup/checkpoint operation. PostgreSQL needs pg_dump/base backup workflow."
  },
  {
    id: "dynamic-qmark-placeholders",
    severity: "medium",
    pattern: /map\s*\([^)]*=>\s*["']\?["']\s*\)/,
    message: "Dynamic ? placeholder construction. PostgreSQL placeholders are positional: $1, $2, ..."
  },
  {
    id: "sqlite-upsert-review",
    severity: "low",
    pattern: /\bON\s+CONFLICT\s*\(/i,
    message: "Upsert syntax should be checked against PostgreSQL after placeholder conversion."
  }
];

function walk(entryPath, output = []) {
  if (!fs.existsSync(entryPath)) return output;

  const stat = fs.statSync(entryPath);
  if (stat.isDirectory()) {
    if (ignoreDirs.has(path.basename(entryPath))) return output;
    for (const child of fs.readdirSync(entryPath)) {
      walk(path.join(entryPath, child), output);
    }
    return output;
  }

  if (/\.(js|cjs|mjs|sql|md)$/.test(entryPath)) {
    const name = relativePath(entryPath);
    if (!ignoreFiles.has(name)) {
      output.push(entryPath);
    }
  }
  return output;
}

function relativePath(filePath) {
  return path.relative(rootDir, filePath).replace(/\\/g, "/");
}

function createFinding(rule, filePath, lineNumber, sample) {
  const file = relativePath(filePath);
  const severity = sqliteBoundaryFiles.has(file) && rule.severity === "high"
    ? "low"
    : rule.severity;

  return {
    rule: rule.id,
    severity,
    file,
    line: lineNumber,
    message: rule.message,
    sample: String(sample || "").trim().slice(0, 180)
  };
}

function scanLineRules(filePath, text) {
  const findings = [];
  const lines = text.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    for (const rule of lineRules) {
      if (rule.pattern.test(line)) {
        findings.push(createFinding(rule, filePath, index + 1, line));
      }
    }
  }

  return findings;
}

function collectPrepareBlocks(filePath, text) {
  const rule = {
    id: "qmark-placeholders",
    severity: "medium",
    message: "SQLite ? placeholders must become PostgreSQL positional placeholders ($1, $2, ...)."
  };
  const findings = [];
  const lines = text.split(/\r?\n/);
  let block = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!block && /\bdb\.prepare\s*\(/.test(line)) {
      block = { startLine: index + 1, lines: [line] };
    } else if (block) {
      block.lines.push(line);
    }

    if (!block) continue;

    const joined = block.lines.join("\n");
    const statementEnded = /\)\.(get|all|run|iterate)\s*\(/.test(line) || /\)\s*;/.test(line);
    if (!statementEnded) continue;

    if (joined.includes("?")) {
      findings.push(createFinding(rule, filePath, block.startLine, block.lines[0]));
    }
    block = null;
  }

  return findings;
}

function summarize(findings) {
  const bySeverity = { high: 0, medium: 0, low: 0 };
  const byRule = {};

  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    byRule[finding.rule] = (byRule[finding.rule] || 0) + 1;
  }

  return {
    total: findings.length,
    bySeverity,
    byRule: Object.fromEntries(Object.entries(byRule).sort((a, b) => a[0].localeCompare(b[0])))
  };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const json = args.has("--json");
  const failOnHigh = args.has("--fail-on-high");
  const files = sourceEntries.flatMap((entry) => walk(path.join(rootDir, entry)));
  const findings = [];

  for (const filePath of files) {
    const text = fs.readFileSync(filePath, "utf8");
    findings.push(...scanLineRules(filePath, text));
    findings.push(...collectPrepareBlocks(filePath, text));
  }

  findings.sort((a, b) => (
    a.file.localeCompare(b.file)
    || a.line - b.line
    || a.rule.localeCompare(b.rule)
  ));

  const summary = summarize(findings);

  if (json) {
    console.log(JSON.stringify({ ok: summary.bySeverity.high === 0, summary, findings }, null, 2));
  } else {
    console.log("Database portability audit");
    console.log(`Files scanned: ${files.length}`);
    console.log(`Findings: ${summary.total}`);
    console.log(`High: ${summary.bySeverity.high}, medium: ${summary.bySeverity.medium}, low: ${summary.bySeverity.low}`);
    console.log("");

    const preview = findings.slice(0, 80);
    for (const finding of preview) {
      console.log(`[${finding.severity.toUpperCase()}] ${finding.rule} ${finding.file}:${finding.line}`);
      console.log(`  ${finding.message}`);
      console.log(`  ${finding.sample}`);
    }

    if (findings.length > preview.length) {
      console.log("");
      console.log(`... ${findings.length - preview.length} more findings. Use --json for the full machine-readable report.`);
    }
  }

  if (failOnHigh && summary.bySeverity.high > 0) {
    process.exitCode = 1;
  }
}

main();
