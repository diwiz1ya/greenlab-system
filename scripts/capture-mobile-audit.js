const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3011";
const PASSWORD = "demo123";
const VIEWPORT = { width: 390, height: 844 };
const OUT_DIR = path.join(__dirname, "..", "output", "mobile-audit");
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9p0nX5sAAAAASUVORK5CYII=";

async function api(pathname, options = {}) {
  const { method = "GET", token = "", body } = options;
  const payloadBody = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      ...(payloadBody !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: payloadBody
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const message = data.error || data.message || response.statusText || "Request failed";
    throw new Error(`${method} ${pathname}: ${response.status} ${message}`);
  }

  return data;
}

async function loginApi(username) {
  const result = await api("/api/login", {
    method: "POST",
    body: { username, password: PASSWORD }
  });
  if (!result.token) {
    throw new Error(`Login for ${username} did not return token.`);
  }
  return String(result.token);
}

async function resetDemo() {
  const managerToken = await loginApi("manager");
  await api("/api/demo/reset", { method: "POST", token: managerToken, body: {} });
}

async function setupScenario() {
  await resetDemo();
  const roles = ["sorting", "washing", "drying", "qc", "ironing", "pickup", "manager"];
  const tokens = Object.fromEntries(await Promise.all(roles.map(async (role) => [role, await loginApi(role)])));

  const sortingOrdersPayload = await api("/api/orders?station=sorting", { token: tokens.manager });
  const sortingOrders = Array.isArray(sortingOrdersPayload.orders) ? sortingOrdersPayload.orders : [];
  const [orderSorting, orderFlow] = sortingOrders;
  if (!orderSorting?.id || !orderFlow?.id) {
    throw new Error("Need at least two sorting orders after demo reset.");
  }

  await api("/api/sorting/create-baskets", {
    method: "POST",
    token: tokens.sorting,
    body: {
      orderId: Number(orderSorting.id),
      baskets: [
        {
          type: "Mixed #1",
          itemCounts: { top: 2, bottom: 1, underwear: 1, socksPairs: 1 },
          qrCode: "QR:BIN-001"
        }
      ]
    }
  });

  await api("/api/sorting/create-baskets", {
    method: "POST",
    token: tokens.sorting,
    body: {
      orderId: Number(orderFlow.id),
      baskets: [
        {
          type: "White #1",
          itemCounts: { top: 1, bottom: 1, underwear: 0, socksPairs: 0 },
          qrCode: "QR:BIN-002"
        }
      ]
    }
  });

  for (const station of ["washing", "drying"]) {
    await api("/api/scan", {
      method: "POST",
      token: tokens[station],
      body: { station, qrCode: "QR:BIN-002" }
    });
  }

  await api("/api/scan", {
    method: "POST",
    token: tokens.qc,
    body: { station: "qc", qrCode: "QR:BIN-002" }
  });

  await api("/api/scan", {
    method: "POST",
    token: tokens.ironing,
    body: { station: "ironing", qrCode: "QR:BIN-002" }
  });

  await api("/api/scan", {
    method: "POST",
    token: tokens.pickup,
    body: { station: "pickup", qrCode: "QR:BIN-002" }
  });

  const placeWorkbench = await api("/api/pickup/workbench", { token: tokens.manager });
  const readyOrder = Array.isArray(placeWorkbench.readyToPlaceOrders)
    ? placeWorkbench.readyToPlaceOrders.find((entry) => Number(entry.id) === Number(orderFlow.id))
    : null;
  if (!readyOrder) {
    throw new Error("Pickup scenario setup failed: order did not reach ready-to-place.");
  }

  return {
    tokens,
    sortingOrderId: Number(orderSorting.id),
    sortingOrderPublicId: String(orderSorting.public_id),
    flowOrderId: Number(orderFlow.id),
    flowOrderPublicId: String(orderFlow.public_id)
  };
}

async function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function capture(page, filename, locator = null) {
  const fullPath = path.join(OUT_DIR, filename);
  if (locator) {
    await page.locator(locator).first().screenshot({ path: fullPath });
  } else {
    await page.screenshot({ path: fullPath, fullPage: true });
  }
  return fullPath;
}

async function openLogin(page) {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForSelector("#login-submit", { timeout: 20000 });
}

async function loginUi(page, username) {
  await openLogin(page);
  await page.fill("#login-username", username);
  await page.fill("#login-password", PASSWORD);
  await page.click("#login-submit");
  await page.waitForLoadState("networkidle");
}

async function withRolePage(browser, role, callback) {
  const context = await browser.newContext({ viewport: VIEWPORT, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await loginUi(page, role);
    await callback(page);
  } finally {
    await context.close();
  }
}

async function run() {
  await ensureOutDir();
  const scenario = await setupScenario();
  const browser = await chromium.launch({ headless: true });
  const files = [];

  try {
    await withRolePage(browser, "sorting", async (page) => {
      await page.waitForSelector("[data-select-sorting-order], [data-edit-sorted-baskets]", { timeout: 20000 });
      files.push(await capture(page, "01-sorting-inbox-mobile.png"));

      const openButton = page.locator("[data-select-sorting-order], [data-edit-sorted-baskets]").first();
      if (await openButton.count()) {
        await openButton.click();
        await page.waitForSelector(".sorting-modal-sheet", { timeout: 10000 });
        files.push(await capture(page, "02-sorting-modal-mobile.png", ".sorting-modal-sheet"));
      }
    });

    await withRolePage(browser, "qc", async (page) => {
      await page.waitForSelector(".qc-shell, .qc-root, [data-open-qc-transfer-panel]", { timeout: 20000 });
      files.push(await capture(page, "03-qc-workbench-mobile.png"));
    });

    await withRolePage(browser, "pickup", async (page) => {
      await page.waitForSelector("[data-pickup-mode='assembly']", { timeout: 20000 });
      files.push(await capture(page, "04-pickup-assembly-mobile.png"));
      await page.click("[data-pickup-mode='placement']");
      await page.waitForTimeout(600);
      files.push(await capture(page, "05-pickup-placement-mobile.png"));
    });

    await withRolePage(browser, "manager", async (page) => {
      await page.waitForSelector("[data-manager-filter], .manager-shell, .manager-root", { timeout: 20000 });
      files.push(await capture(page, "06-manager-dashboard-mobile.png"));

      const readyCard = page.locator("[data-manager-flow-card='pickup'], [data-manager-ready-card], .manager-ready-card button").first();
      if (await readyCard.count()) {
        await readyCard.click();
        await page.waitForTimeout(800);
        files.push(await capture(page, "07-manager-dashboard-after-click-mobile.png"));
      }

      const detailButton = page.locator("[data-manager-open-order], [data-manager-case-open], .manager-case-card button").first();
      if (await detailButton.count()) {
        await detailButton.click();
        await page.waitForSelector(".manager-modal-sheet, .manager-order-modal, .manager-case-modal", { timeout: 10000 });
        const modalSelector = ".manager-modal-sheet, .manager-order-modal, .manager-case-modal";
        files.push(await capture(page, "08-manager-modal-mobile.png", modalSelector));
      }
    });

    console.log(JSON.stringify({ ok: true, baseUrl: BASE_URL, scenario, files }, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
