const assert = require("node:assert/strict");
const { toPostgresPlaceholders } = require("../backend/db/sql-placeholders");

function check(name, input, expectedSql, expectedCount) {
  const result = toPostgresPlaceholders(input);
  assert.equal(result.sql, expectedSql, name);
  assert.equal(result.parameterCount, expectedCount, `${name} count`);
}

check(
  "basic placeholders",
  "SELECT * FROM orders WHERE id = ? AND status = ?",
  "SELECT * FROM orders WHERE id = $1 AND status = $2",
  2
);

check(
  "single quoted question mark",
  "INSERT INTO scan_events (message, actor) VALUES ('why?', ?)",
  "INSERT INTO scan_events (message, actor) VALUES ('why?', $1)",
  1
);

check(
  "escaped single quote",
  "SELECT 'it''s ?' AS text, ? AS id",
  "SELECT 'it''s ?' AS text, $1 AS id",
  1
);

check(
  "comments are ignored",
  "SELECT ? -- keep ? in comment\nFROM orders /* ? */ WHERE id = ?",
  "SELECT $1 -- keep ? in comment\nFROM orders /* ? */ WHERE id = $2",
  2
);

check(
  "quoted identifier",
  'SELECT "field?" FROM orders WHERE public_id = ?',
  'SELECT "field?" FROM orders WHERE public_id = $1',
  1
);

console.log("SQL placeholder tests: OK");
