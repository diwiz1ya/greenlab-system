const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const rootDir = path.join(__dirname, "..");
const inputPath = process.env.TECHDOC_HTML
  ? path.resolve(process.env.TECHDOC_HTML)
  : path.join(rootDir, "docs", "greenlab-state-techdoc.html");
const outputPath = process.env.TECHDOC_PDF
  ? path.resolve(process.env.TECHDOC_PDF)
  : path.join(rootDir, "output", "GreenLab_State_TechDoc.pdf");

async function run() {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Techdoc HTML not found: ${inputPath}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 1800 }
    });

    await page.goto(pathToFileURL(inputPath).href, { waitUntil: "networkidle" });
    await page.addStyleTag({
      content: `
        @media print {
          @page {
            size: A4 landscape;
            margin: 8mm;
          }

          html, body {
            background: #fff !important;
          }

          .page {
            width: auto !important;
            margin: 0 !important;
            border: none !important;
            border-radius: 0 !important;
            padding: 0 !important;
          }

          .diagram {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          table {
            break-inside: auto;
            page-break-inside: auto;
          }

          tr, td, th {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `
    });

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
