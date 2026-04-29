const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const sqliteSchemaPath = path.join(rootDir, "backend", "db", "sqlite-schema.js");
const postgresSchemaPath = path.join(rootDir, "backend", "db", "postgres-schema.sql");

function stripSqlComments(sql) {
  return String(sql || "")
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractSqliteBootstrapSql(source) {
  const match = /const\s+SQLITE_BOOTSTRAP_SQL\s*=\s*`([\s\S]*?)`;/m.exec(source);
  if (!match) {
    throw new Error("Could not find SQLITE_BOOTSTRAP_SQL in sqlite-schema.js");
  }
  return match[1];
}

function splitSqlDefinitions(body) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = "";

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === quote && body[index - 1] !== "\\") quote = "";
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(body.slice(start, index).trim());
      start = index + 1;
    }
  }

  const tail = body.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function parseCreateTables(sql) {
  const cleanSql = stripSqlComments(sql);
  const tables = new Map();
  const pattern = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gi;
  let match;

  while ((match = pattern.exec(cleanSql))) {
    const tableName = match[1];
    let index = pattern.lastIndex;
    let depth = 1;
    let quote = "";

    while (index < cleanSql.length && depth > 0) {
      const char = cleanSql[index];
      if (quote) {
        if (char === quote && cleanSql[index - 1] !== "\\") quote = "";
        index += 1;
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        index += 1;
        continue;
      }
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      index += 1;
    }

    const body = cleanSql.slice(pattern.lastIndex, index - 1);
    const columns = tables.get(tableName) || new Set();
    for (const definition of splitSqlDefinitions(body)) {
      const columnMatch = /^([a-zA-Z_][a-zA-Z0-9_]*)\b/i.exec(definition);
      if (!columnMatch) continue;
      const columnName = columnMatch[1];
      if (/^(CONSTRAINT|FOREIGN|PRIMARY|UNIQUE|CHECK|KEY)$/i.test(columnName)) continue;
      columns.add(columnName);
    }
    tables.set(tableName, columns);
    pattern.lastIndex = index;
  }

  return tables;
}

function parseAlterTableAddedColumns(source) {
  const additions = [];
  const pattern = /ALTER\s+TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+ADD\s+COLUMN\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/gi;
  let match;
  while ((match = pattern.exec(source))) {
    additions.push({ tableName: match[1], columnName: match[2] });
  }
  return additions;
}

function parseSqliteSchema(source) {
  const tables = parseCreateTables(extractSqliteBootstrapSql(source));
  for (const addition of parseAlterTableAddedColumns(source)) {
    if (!tables.has(addition.tableName)) {
      tables.set(addition.tableName, new Set());
    }
    tables.get(addition.tableName).add(addition.columnName);
  }
  return tables;
}

function sortedSetValues(set) {
  return [...set].sort((left, right) => left.localeCompare(right));
}

function diffSchemas(expected, actual) {
  const findings = [];
  const expectedTables = sortedSetValues(new Set(expected.keys()));
  const actualTables = sortedSetValues(new Set(actual.keys()));

  for (const tableName of expectedTables) {
    if (!actual.has(tableName)) {
      findings.push(`Missing PostgreSQL table: ${tableName}`);
    }
  }
  for (const tableName of actualTables) {
    if (!expected.has(tableName)) {
      findings.push(`Unexpected PostgreSQL table: ${tableName}`);
    }
  }

  for (const tableName of expectedTables) {
    if (!actual.has(tableName)) continue;
    const expectedColumns = expected.get(tableName);
    const actualColumns = actual.get(tableName);
    for (const columnName of sortedSetValues(expectedColumns)) {
      if (!actualColumns.has(columnName)) {
        findings.push(`Missing PostgreSQL column: ${tableName}.${columnName}`);
      }
    }
    for (const columnName of sortedSetValues(actualColumns)) {
      if (!expectedColumns.has(columnName)) {
        findings.push(`Unexpected PostgreSQL column: ${tableName}.${columnName}`);
      }
    }
  }

  return findings;
}

const sqliteSource = fs.readFileSync(sqliteSchemaPath, "utf8");
const postgresSql = fs.readFileSync(postgresSchemaPath, "utf8");
const findings = diffSchemas(parseSqliteSchema(sqliteSource), parseCreateTables(postgresSql));

if (findings.length) {
  console.error("DB schema parity audit failed:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log("DB schema parity audit: OK");
