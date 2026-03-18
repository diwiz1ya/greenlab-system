const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const rootDir = path.join(__dirname, "..");
const inputPath = process.env.PRESENTATION_HTML
  ? path.resolve(process.env.PRESENTATION_HTML)
  : path.join(rootDir, "presentation", "greenlab-prod-presentation.html");
const outputPath = process.env.PRESENTATION_PDF
  ? path.resolve(process.env.PRESENTATION_PDF)
  : path.join(rootDir, "presentation", "greenlab-prod-presentation.pdf");

async function run() {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Presentation HTML not found: ${inputPath}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 }
    });

    await page.goto(pathToFileURL(inputPath).href, { waitUntil: "networkidle" });
    await page.addStyleTag({
      content: `
        @media print {
          @page {
            size: A4 landscape;
            margin: 10mm;
          }

          html, body {
            background: #fff !important;
          }

          .deck {
            width: auto !important;
            margin: 0 !important;
            gap: 0 !important;
            display: block !important;
          }
          .slide {
            break-inside: avoid;
            page-break-inside: avoid;
            break-after: page;
            page-break-after: always;
            box-shadow: none !important;
            padding: 14px 16px !important;
            margin: 0 0 6mm 0 !important;
          }

          .slide:last-child {
            break-after: auto !important;
            page-break-after: auto !important;
          }

          .slide h1 { font-size: 30px !important; }
          .slide h2 { font-size: 24px !important; }
          .lead { font-size: 18px !important; line-height: 1.35 !important; }

          figure {
            break-inside: avoid;
            page-break-inside: avoid;
            margin-top: 6px !important;
          }

          figure img {
            width: auto !important;
            max-width: 100% !important;
            max-height: 360px !important;
            object-fit: contain !important;
            background: #f7fbf9 !important;
            margin: 0 auto !important;
          }

          figure figcaption {
            break-inside: avoid;
            page-break-inside: avoid;
            font-size: 12px !important;
            line-height: 1.35 !important;
            padding: 8px 10px !important;
          }

          .kpi-row {
            grid-template-columns: repeat(4, minmax(120px, 1fr)) !important;
            gap: 8px !important;
          }

          .checklist {
            font-size: 17px !important;
            line-height: 1.45 !important;
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
