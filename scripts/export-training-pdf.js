const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const rootDir = path.join(__dirname, "..");
const inputPath = path.join(rootDir, "docs", "greenlab-training-manual-en.html");
const outputPath = path.join(rootDir, "output", "GreenLab_Training_Manual_EN.pdf");

async function run() {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Training HTML not found: ${inputPath}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1500, height: 1000 }
    });

    await page.goto(pathToFileURL(inputPath).href, { waitUntil: "networkidle" });
    await page.pdf({
      path: outputPath,
      format: "A4",
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false
    });
  } finally {
    await browser.close();
  }

  console.log(`PDF exported: ${outputPath}`);
}

run().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
