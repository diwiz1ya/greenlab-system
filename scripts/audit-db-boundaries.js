const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const backendDir = path.join(rootDir, "backend");
const allowedDir = path.join(backendDir, "db");
const forbiddenPattern = /\bdb\.(prepare|exec)\s*\(/;

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }
  return files;
}

function isInside(parentDir, filePath) {
  const relative = path.relative(parentDir, filePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

const findings = [];
for (const filePath of walk(backendDir)) {
  if (isInside(allowedDir, filePath)) continue;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!forbiddenPattern.test(line)) continue;
    findings.push({
      file: path.relative(rootDir, filePath).replace(/\\/g, "/"),
      line: index + 1,
      sample: line.trim()
    });
  }
}

if (findings.length) {
  console.error("DB boundary audit failed: direct db.prepare/db.exec found outside backend/db.");
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} ${finding.sample}`);
  }
  process.exit(1);
}

console.log("DB boundary audit: OK");
