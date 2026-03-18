const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const logNamePattern = /^server(?:-\d+)?(?:\.(?:out|err))?\.log$/i;

function parseNumberFlag(name, fallback) {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!arg) return fallback;
  const value = Number(arg.split("=")[1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function listRootFiles() {
  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

function rotateFile(filePath, keep) {
  for (let index = keep; index >= 1; index -= 1) {
    const src = `${filePath}.${index}`;
    const dst = `${filePath}.${index + 1}`;
    if (fs.existsSync(src)) {
      fs.renameSync(src, dst);
    }
  }

  fs.renameSync(filePath, `${filePath}.1`);
  fs.writeFileSync(filePath, "", "utf8");

  let removed = 0;
  const overflow = `${filePath}.${keep + 1}`;
  if (fs.existsSync(overflow)) {
    fs.rmSync(overflow, { force: true });
    removed += 1;
  }

  return removed;
}

function run() {
  const maxMb = parseNumberFlag("max-mb", 10);
  const keep = parseNumberFlag("keep", 7);
  const maxBytes = Math.floor(maxMb * 1024 * 1024);

  const candidates = listRootFiles()
    .filter((name) => logNamePattern.test(name))
    .map((name) => path.join(rootDir, name));

  let rotated = 0;
  let skipped = 0;
  let removedArchives = 0;

  for (const filePath of candidates) {
    const stat = fs.statSync(filePath);
    if (stat.size < maxBytes) {
      skipped += 1;
      continue;
    }
    removedArchives += rotateFile(filePath, keep);
    rotated += 1;
  }

  console.log(`Log rotation done: rotated=${rotated}, skipped=${skipped}, keep=${keep}, thresholdMB=${maxMb}, removedArchives=${removedArchives}`);
}

try {
  run();
} catch (error) {
  console.error("rotate-logs failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
