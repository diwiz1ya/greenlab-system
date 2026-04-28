const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3010";
const OUT_DIR = path.join(__dirname, "..", "presentation", "assets");
const VIEWPORT = { width: 1600, height: 1000 };
const PASSWORD = "demo123";
const MANAGER_CREDENTIALS = { username: "manager", password: PASSWORD };

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function api(pathname, options = {}) {
  const { token, body, method = "GET" } = options;
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(`${pathname}: ${response.status} ${payload.error || response.statusText}`);
  }

  return payload;
}

async function resetDemoState() {
  const health = await fetch(`${BASE_URL}/healthz`);
  if (!health.ok) {
    throw new Error(`Service is not available at ${BASE_URL}. Start it first with "npm start".`);
  }

  const login = await api("/api/login", {
    method: "POST",
    body: MANAGER_CREDENTIALS
  });

  await api("/api/demo/reset", { method: "POST", token: login.token });
  await api("/api/logout", { method: "POST", token: login.token });
}

async function openLogin(page) {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForSelector("#login-submit");
}

async function loginUi(page, username, password = PASSWORD) {
  await openLogin(page);
  await page.fill("#login-username", username);
  await page.fill("#login-password", password);
  await page.click("#login-submit");
  await page.waitForSelector("#logout-button", { timeout: 20000 });
}

async function capture(page, fileName) {
  await page.screenshot({
    path: path.join(OUT_DIR, fileName),
    fullPage: true
  });
}

async function withLoggedContext(browser, username, fn) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  try {
    await loginUi(page, username);
    await fn(page);
  } finally {
    await context.close();
  }
}

async function captureLogin(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  try {
    await openLogin(page);
    await capture(page, "01-login.png");
  } finally {
    await context.close();
  }
}

async function captureSorting(browser) {
  await withLoggedContext(browser, "sorting", async (page) => {
    await page.waitForSelector("[data-select-sorting-order], [data-edit-sorted-baskets]", { timeout: 20000 });
    await capture(page, "02-sorting-inbox.png");

    const firstOrderButton = page.locator("[data-select-sorting-order]").first();
    if (await firstOrderButton.count()) {
      await firstOrderButton.click();
      await page.waitForSelector(".sorting-modal-sheet", { timeout: 10000 });
      await page.waitForTimeout(250);
      const modal = page.locator(".sorting-modal-sheet").first();
      await modal.screenshot({
        path: path.join(OUT_DIR, "03-sorting-modal.png")
      });
    }
  });
}

async function captureWashing(browser) {
  await withLoggedContext(browser, "washing", async (page) => {
    await page.waitForSelector("[data-machine-open-flow='washing'][data-machine-flow-mode='load']", { timeout: 20000 });
    await page.click("[data-machine-open-flow='washing'][data-machine-flow-mode='load']");
    await page.waitForSelector(".machine-flow-sheet", { timeout: 10000 });
    await capture(page, "04-washing-load.png");
  });
}

async function captureDrying(browser) {
  await withLoggedContext(browser, "drying", async (page) => {
    await page.waitForSelector("[data-machine-open-flow='drying'][data-machine-flow-mode='load']", { timeout: 20000 });
    await page.click("[data-machine-open-flow='drying'][data-machine-flow-mode='load']");
    await page.waitForSelector(".machine-flow-sheet", { timeout: 10000 });
    await capture(page, "05-drying-load.png");
  });
}

async function captureQc(browser) {
  await withLoggedContext(browser, "qc", async (page) => {
    await page.waitForSelector("#simple-scan-input", { timeout: 20000 });
    await capture(page, "06-qc-workbench.png");

    await page.fill("#simple-scan-input", "QR:B-2403-1");
    await page.keyboard.press("Enter");
    try {
      await page.waitForSelector(".qc-modal-sheet", { timeout: 3500 });
      await capture(page, "06-qc-decision.png");
    } catch {
      // Keep flow deterministic when no basket is available for QC decision modal.
    }
  });
}

async function captureRework(browser) {
  await withLoggedContext(browser, "rework", async (page) => {
    await page.waitForSelector("[data-scan-input-for='rework']", { timeout: 20000 });
    await capture(page, "07-rework-scan.png");
  });
}

async function captureIroning(browser) {
  await withLoggedContext(browser, "ironing", async (page) => {
    await page.waitForSelector("[data-scan-input-for='ironing']", { timeout: 20000 });
    await capture(page, "08-ironing-scan.png");
  });
}

async function capturePickup(browser) {
  await withLoggedContext(browser, "pickup", async (page) => {
    await page.waitForSelector("[data-pickup-mode='assembly']", { timeout: 20000 });
    await capture(page, "09-pickup-workbench.png");
  });
}

async function captureManager(browser) {
  await withLoggedContext(browser, "manager", async (page) => {
    await page.waitForSelector("[data-manager-filter], .manager-shell, .manager-root", { timeout: 20000 });
    await capture(page, "10-manager-dashboard.png");

    const openOrderButton = page.locator("[data-open-order]").first();
    if (await openOrderButton.count()) {
      await openOrderButton.click();
      await page.waitForSelector(".order-details-compact h2, .order-details-sheet h2, .order-modal-sheet h2", { timeout: 10000 });
      await capture(page, "11-manager-order-details.png");
    }
  });
}

async function run() {
  ensureOutDir();
  await resetDemoState();

  const browser = await chromium.launch({ headless: true });
  try {
    await captureLogin(browser);
    await captureSorting(browser);
    await captureWashing(browser);
    await captureDrying(browser);
    await captureQc(browser);
    await captureRework(browser);
    await captureIroning(browser);
    await capturePickup(browser);
    await captureManager(browser);
  } finally {
    await browser.close();
  }

  console.log(`Presentation screenshots saved to: ${OUT_DIR}`);
}

run().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
