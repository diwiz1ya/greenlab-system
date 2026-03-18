const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3011";
const OUT_DIR = path.join(__dirname, "..", "presentation", "assets");
const VIEWPORT = { width: 1600, height: 1000 };

const MANAGER_CREDENTIALS = { username: "manager", password: "demo123" };

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
  const token = login.token;
  await api("/api/demo/reset", { method: "POST", token });
  await api("/api/logout", { method: "POST", token });
}

async function loginUi(page, username, password) {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForSelector("#login-username");
  await page.fill("#login-username", username);
  await page.fill("#login-password", password);
  await page.click("#login-submit");
  await page.waitForSelector("#logout-button");
}

async function captureLogin(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForSelector("#login-submit");
  await page.screenshot({
    path: path.join(OUT_DIR, "01-login.png"),
    fullPage: true
  });
  await context.close();
}

async function captureSorting(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await loginUi(page, "sorting", "demo123");

  await page.waitForSelector("text=Входящие заказы");
  await page.screenshot({
    path: path.join(OUT_DIR, "02-sorting-inbox.png"),
    fullPage: true
  });

  const firstOrderButton = page.locator("[data-select-sorting-order]").first();
  if (await firstOrderButton.count()) {
    await firstOrderButton.click();
    await page.waitForSelector(".sorting-modal-sheet");
    await page.screenshot({
      path: path.join(OUT_DIR, "03-sorting-modal.png"),
      fullPage: true
    });
  }

  await context.close();
}

async function captureQc(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await loginUi(page, "qc", "demo123");

  await page.waitForSelector("#simple-scan-input");
  await page.fill("#simple-scan-input", "QR:B-2403-1");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".qc-modal-sheet");
  await page.screenshot({
    path: path.join(OUT_DIR, "04-qc-decision.png"),
    fullPage: true
  });

  await context.close();
}

async function capturePickup(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await loginUi(page, "pickup", "demo123");

  await page.waitForSelector("text=Выдача");
  await page.screenshot({
    path: path.join(OUT_DIR, "05-pickup-workbench.png"),
    fullPage: true
  });

  await context.close();
}

async function captureManager(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await loginUi(page, "manager", "demo123");

  await page.waitForSelector("text=Пульт смены");
  await page.screenshot({
    path: path.join(OUT_DIR, "06-manager-dashboard.png"),
    fullPage: true
  });

  const openOrderButton = page.locator("[data-open-order]").first();
  if (await openOrderButton.count()) {
    await openOrderButton.click();
    await page.waitForSelector(".order-details-compact h2");
    await page.screenshot({
      path: path.join(OUT_DIR, "07-manager-order-details.png"),
      fullPage: true
    });
  }

  await context.close();
}

async function run() {
  ensureOutDir();
  await resetDemoState();

  const browser = await chromium.launch({ headless: true });
  try {
    await captureLogin(browser);
    await captureSorting(browser);
    await captureQc(browser);
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
