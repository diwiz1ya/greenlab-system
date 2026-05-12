const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3010";
const OUT_DIR = path.join(__dirname, "..", "presentation", "assets", "training-ru");
const VIEWPORT = { width: 1600, height: 1000 };
const PASSWORD = "demo123";
const TINY_PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2H9wAAAABJRU5ErkJggg==";

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function api(pathname, options = {}) {
  const { token, body, method = "GET", headers = {} } = options;
  const isStringBody = typeof body === "string";
  const payloadBody = body === undefined || body === null
    ? undefined
    : (isStringBody ? body : JSON.stringify(body));

  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      ...(payloadBody !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: payloadBody
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const message = payload.error || response.statusText || "Request failed";
    throw new Error(`${pathname}: ${response.status} ${message}`);
  }

  return payload;
}

async function loginApi(username) {
  const result = await api("/api/login", {
    method: "POST",
    body: { username, password: PASSWORD }
  });
  return String(result.token || "");
}

async function resetDemo() {
  const health = await fetch(`${BASE_URL}/healthz`);
  if (!health.ok) {
    throw new Error(`Service is not available at ${BASE_URL}. Start it first with "npm start".`);
  }

  const managerToken = await loginApi("manager");
  await api("/api/demo/reset", { method: "POST", token: managerToken });
  await api("/api/logout", { method: "POST", token: managerToken });
}

async function getRoleTokens() {
  const roles = ["sorting", "washing", "drying", "qc", "rework", "ironing", "pickup", "manager"];
  const entries = await Promise.all(roles.map(async (role) => [role, await loginApi(role)]));
  return Object.fromEntries(entries);
}

async function createSingleBasketOrder(tokens, orderId, qrCode, topCount = 1) {
  await api("/api/sorting/create-baskets", {
    method: "POST",
    token: tokens.sorting,
    body: {
      orderId,
      baskets: [
        {
          type: "Mixed #1",
          itemCounts: { top: topCount, bottom: 0, underwear: 0, socksPairs: 0 },
          qrCode
        }
      ]
    }
  });
}

async function scanAtStation(tokens, station, qrCode) {
  return api("/api/scan", {
    method: "POST",
    token: tokens[station],
    body: { station, qrCode }
  });
}

async function prepareScenario(tokens) {
  const sortingOrdersPayload = await api("/api/orders?station=sorting", { token: tokens.sorting });
  const sortingOrders = Array.isArray(sortingOrdersPayload.orders) ? sortingOrdersPayload.orders : [];
  const actionable = sortingOrders.filter((row) => String(row?.status || "") === "sorting");
  if (actionable.length < 2) {
    throw new Error("Scenario setup failed: less than 2 sorting orders after demo reset.");
  }

  const orderA = actionable[0];
  const orderB = actionable[1];
  const qrA = "QR:BIN-001";
  const qrB = "QR:BIN-002";

  await createSingleBasketOrder(tokens, Number(orderA.id), qrA, 2);
  await createSingleBasketOrder(tokens, Number(orderB.id), qrB, 1);

  // Move both orders from washing -> drying -> qc.
  await scanAtStation(tokens, "washing", qrA);
  await scanAtStation(tokens, "washing", qrB);
  await scanAtStation(tokens, "drying", qrA);
  await scanAtStation(tokens, "drying", qrB);

  return {
    orderAId: Number(orderA.id),
    orderBId: Number(orderB.id),
    qrA,
    qrB
  };
}

async function buildReworkApprovalBranch(tokens, qrCode) {
  const reworkResult = await api("/api/qc/rework", {
    method: "POST",
    token: tokens.qc,
    body: {
      qrCode,
      reason: "spot_treatment",
      itemCategory: "top",
      quantity: 1,
      qcPhotoDataUrl: TINY_PNG_DATA_URL
    }
  });

  const requestId = Number(reworkResult?.request?.id || 0);
  if (!Number.isFinite(requestId) || requestId <= 0) {
    throw new Error("Failed to obtain rework request id.");
  }

  await api(`/api/rework-requests/${requestId}/approve`, {
    method: "POST",
    token: tokens.manager,
    body: {}
  });

  return requestId;
}

async function confirmQcTransferToRework(tokens, expectedSourceQr) {
  const tasksPayload = await api("/api/qc/transfer-tasks", {
    token: tokens.qc
  });
  const tasks = Array.isArray(tasksPayload.tasks) ? tasksPayload.tasks : [];
  const task = tasks.find((entry) => String(entry?.source_basket_qr_code || "") === expectedSourceQr) || tasks[0];
  if (!task) {
    throw new Error("No QC transfer task found after manager approval.");
  }

  const requestId = Number(task.id || 0);
  const sourceQrCode = String(task.source_basket_qr_code || "").trim();
  const targetQrCode = String(task.planned_rework_basket_qr_code || task.rework_basket_qr_code || "").trim();
  if (!requestId || !sourceQrCode || !targetQrCode) {
    throw new Error("QC transfer task data is incomplete.");
  }

  await api(`/api/qc/transfer-tasks/${requestId}/confirm`, {
    method: "POST",
    token: tokens.qc,
    body: {
      sourceQrCode,
      targetQrCode
    }
  });
}

async function openLogin(page) {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForSelector("#login-submit");
}

async function loginUi(page, username) {
  await openLogin(page);
  await page.fill("#login-username", username);
  await page.fill("#login-password", PASSWORD);
  await page.click("#login-submit");
  await page.waitForSelector("#logout-button", { timeout: 20000 });
}

async function captureFull(page, fileName) {
  await page.screenshot({
    path: path.join(OUT_DIR, fileName),
    fullPage: true
  });
}

async function captureElement(page, selector, fileName, timeout = 12000) {
  await page.waitForSelector(selector, { timeout });
  const locator = page.locator(selector).first();
  await locator.screenshot({
    path: path.join(OUT_DIR, fileName)
  });
}

async function withRolePage(browser, role, fn) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  try {
    await loginUi(page, role);
    await fn(page);
  } finally {
    await context.close();
  }
}

async function captureLoginScreen(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  try {
    await openLogin(page);
    await captureFull(page, "01-login.png");
  } finally {
    await context.close();
  }
}

async function captureSortingScreens(browser) {
  await withRolePage(browser, "sorting", async (page) => {
    await page.waitForSelector("[data-select-sorting-order], [data-edit-sorted-baskets]", { timeout: 20000 });
    await captureFull(page, "02-sorting-inbox.png");

    const openButton = page.locator("[data-select-sorting-order], [data-edit-sorted-baskets]").first();
    if (await openButton.count()) {
      await openButton.click();
      await captureElement(page, ".sorting-modal-sheet", "03-sorting-modal-step1.png");
      const scanInput = page.locator("[data-sorting-basket-scan-input]").first();
      if (await scanInput.count()) {
        const scanCode = `QR:BIN-90${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
        await scanInput.fill(scanCode);
        await scanInput.press("Enter");
      }

      await page.waitForSelector("[data-sorting-items-input], [data-sorting-step-next][data-sorting-step-next-mode='finish']", { timeout: 12000 });
      await page.waitForTimeout(260);
      await captureElement(page, ".sorting-modal-sheet", "04-sorting-modal-step2.png");

      const plusTopButton = page.locator("[data-sorting-items-step][data-item-key='top'][data-step='1']").first();
      if (await plusTopButton.count()) {
        await plusTopButton.click();
      } else {
        const anyItemInput = page.locator("[data-sorting-items-input]").first();
        if (await anyItemInput.count()) {
          await anyItemInput.fill("1");
        }
      }

      const finishButton = page.locator("[data-sorting-step-next][data-sorting-step-next-mode='finish']").first();
      if (await finishButton.count()) {
        await finishButton.click();
        await page.waitForTimeout(320);
        await captureElement(page, ".sorting-modal-sheet", "05-sorting-modal-step3.png");
      }
    }
  });
}

async function captureWashingScreens(browser) {
  await withRolePage(browser, "washing", async (page) => {
    await page.waitForSelector("[data-machine-open-flow='washing'][data-machine-flow-mode='load']", { timeout: 20000 });
    await captureFull(page, "06-washing-screen.png");

    await page.click("[data-machine-open-flow='washing'][data-machine-flow-mode='load']");
    await captureElement(page, ".machine-flow-sheet", "07-washing-load-modal.png");

    const closeButton = page.locator("[data-machine-close-flow='washing']").first();
    if (await closeButton.count()) {
      await closeButton.click();
    }

    await page.click("[data-machine-open-flow='washing'][data-machine-flow-mode='unload']");
    await captureElement(page, ".machine-flow-sheet", "08-washing-unload-modal.png");
  });
}

async function captureDryingScreens(browser) {
  await withRolePage(browser, "drying", async (page) => {
    await page.waitForSelector("[data-machine-open-flow='drying'][data-machine-flow-mode='load']", { timeout: 20000 });
    await captureFull(page, "09-drying-screen.png");

    await page.click("[data-machine-open-flow='drying'][data-machine-flow-mode='load']");
    await captureElement(page, ".machine-flow-sheet", "10-drying-load-modal.png");

    const closeButton = page.locator("[data-machine-close-flow='drying']").first();
    if (await closeButton.count()) {
      await closeButton.click();
    }

    await page.click("[data-machine-open-flow='drying'][data-machine-flow-mode='unload']");
    await captureElement(page, ".machine-flow-sheet", "11-drying-unload-modal.png");
  });
}

async function captureQcInspectScreens(browser, inspectQrCode) {
  await withRolePage(browser, "qc", async (page) => {
    await page.waitForSelector("#simple-scan-input", { timeout: 20000 });
    await captureFull(page, "12-qc-workbench.png");

    await page.fill("#simple-scan-input", inspectQrCode);
    await page.keyboard.press("Enter");
    await page.waitForSelector("[data-qc-open-rework-modal], [data-run-qc-pass], .qc-current-basket-card", { timeout: 15000 });
    await captureFull(page, "13-qc-after-scan.png");

    const openReworkButton = page.locator("[data-qc-open-rework-modal]").first();
    if (!(await openReworkButton.count())) {
      return;
    }
    await openReworkButton.click();
    await captureElement(page, ".qc-modal-sheet", "14-qc-modal-step1.png", 15000);

    const nextButton = page.locator("[data-qc-modal-next-step]").first();
    if (await nextButton.count()) {
      await nextButton.click();
      await page.waitForTimeout(280);
      await captureElement(page, ".qc-modal-sheet", "15-qc-modal-step2.png", 15000);
    }

    const closeButton = page.locator("button[data-qc-modal-close]").first();
    if (await closeButton.count()) {
      await closeButton.click();
    } else {
      await page.keyboard.press("Escape");
    }
  });
}

async function captureQcTransferScreens(browser) {
  await withRolePage(browser, "qc", async (page) => {
    await page.waitForSelector("#simple-scan-input", { timeout: 20000 });
    await captureFull(page, "16-qc-with-transfer-banner.png");

    const openPanelButton = page.locator("[data-open-qc-transfer-panel]").first();
    if (await openPanelButton.count()) {
      await openPanelButton.click();
      await captureElement(page, ".qc-transfer-drawer-sheet", "17-qc-transfer-drawer.png", 15000);
    }
  });
}

async function captureReworkScreen(browser) {
  await withRolePage(browser, "rework", async (page) => {
    await page.waitForSelector("[data-scan-input-for='rework']", { timeout: 20000 });
    await captureFull(page, "18-rework-screen.png");
  });
}

async function captureIroningScreen(browser) {
  await withRolePage(browser, "ironing", async (page) => {
    await page.waitForSelector("[data-scan-input-for='ironing']", { timeout: 20000 });
    await captureFull(page, "19-ironing-screen.png");
  });
}

async function capturePickupScreens(browser) {
  await withRolePage(browser, "pickup", async (page) => {
    await page.waitForSelector("[data-pickup-mode='assembly']", { timeout: 20000 });
    await captureFull(page, "20-pickup-assembly.png");

    await page.click("[data-pickup-mode='placement']");
    await page.waitForTimeout(250);
    await captureFull(page, "21-pickup-placement-list.png");

    const selectOrderButton = page.locator("[data-pickup-place-order]").first();
    if (await selectOrderButton.count()) {
      await selectOrderButton.click();
      await captureElement(page, ".pickup-placement-modal-sheet", "22-pickup-placement-modal-loc-step.png");

      const activeLocInput = page.locator("[data-pickup-placement-input='locationQr'][data-pickup-placement-active='true']").first();
      if (await activeLocInput.count()) {
        await activeLocInput.fill("QR:LOC-A01");
        await activeLocInput.press("Enter");
      }
      await page.waitForTimeout(280);
      await captureElement(page, ".pickup-placement-modal-sheet", "23-pickup-placement-modal-ready.png");

      const submitButton = page.locator("[data-pickup-place-submit]").first();
      if (await submitButton.count()) {
        await submitButton.click();
        await page.waitForTimeout(900);
        await captureFull(page, "24-pickup-after-placement.png");
      }
    }
  });
}

async function captureManagerScreens(browser) {
  await withRolePage(browser, "manager", async (page) => {
    await page.waitForSelector("[data-manager-filter], .manager-command-panel", { timeout: 20000 });
    await captureFull(page, "26-manager-dashboard.png");

    const syncButton = page.locator("[data-open-sync-modal]").first();
    if (await syncButton.count()) {
      await syncButton.click();
      await captureElement(page, ".manager-sync-modal-sheet", "27-manager-sync-modal.png", 15000);
      const closeButton = page.locator("button[data-close-sync-modal]").first();
      if (await closeButton.count()) await closeButton.click();
    }

    const reportsButton = page.locator("[data-open-manager-reports-modal]").first();
    if (await reportsButton.count()) {
      await reportsButton.click();
      await captureElement(page, ".manager-reports-sheet", "29-manager-reports-modal.png", 15000);
      const closeButton = page.locator("button[data-close-manager-reports-modal]").first();
      if (await closeButton.count()) await closeButton.click();
    }

    const quickViewButton = page.locator("[data-open-manager-quick-view]").first();
    if (await quickViewButton.count()) {
      await quickViewButton.click();
      await captureElement(page, ".manager-quick-modal-sheet", "30-manager-quick-view-modal.png", 15000);
      const closeButton = page.locator("button[data-close-manager-quick-view]").first();
      if (await closeButton.count()) await closeButton.click();
    }

    const readyOrderButton = page.locator("[data-open-manager-ready-order]").first();
    if (await readyOrderButton.count()) {
      await readyOrderButton.click();
      await captureElement(page, ".manager-ready-order-sheet", "31-manager-ready-order-modal.png", 15000);

      const completeButton = page.locator("[data-complete-pickup-order]").first();
      if (await completeButton.count()) {
        await completeButton.click();
        try {
          await captureElement(page, ".manager-action-sheet", "32-manager-action-confirm-modal.png", 12000);
          const confirmAction = page.locator("button[data-confirm-manager-action]").first();
          if (await confirmAction.count()) {
            await confirmAction.click();
            await page.waitForTimeout(900);
          } else {
            const closeAction = page.locator("button[data-close-manager-action]").first();
            if (await closeAction.count()) await closeAction.click();
          }
        } catch {
          // Action dialog can be skipped if action is unavailable in current scenario.
        }
      }

      const closeReady = page.locator("button[data-close-manager-ready-modal]").first();
      if (await closeReady.count()) await closeReady.click();
    }

    const historyButton = page.locator("[data-open-manager-history-modal]").first();
    if (await historyButton.count()) {
      const openOrderModalCloseButton = page.locator("button[data-order-modal-close]").first();
      if (await openOrderModalCloseButton.count()) {
        await openOrderModalCloseButton.click();
        await page.waitForTimeout(300);
      } else {
        const openOrderModal = page.locator(".order-modal").first();
        if (await openOrderModal.count()) {
          await page.keyboard.press("Escape");
          await page.waitForTimeout(300);
        }
      }

      await historyButton.click();
      await captureElement(page, ".manager-history-sheet", "28-manager-history-modal.png", 15000);

      const openOrderButton = page.locator(".manager-history-sheet [data-open-order]").first();
      if (await openOrderButton.count()) {
        await openOrderButton.click();
        await captureElement(page, ".order-modal-sheet, .order-details-sheet, .order-details-compact", "33-manager-order-details-modal.png", 15000);
      }
    }
  });
}

async function run() {
  ensureOutDir();
  await resetDemo();
  const tokens = await getRoleTokens();

  const browser = await chromium.launch({ headless: true });
  try {
    await captureLoginScreen(browser);
    await captureSortingScreens(browser);

    const scenario = await prepareScenario(tokens);
    await captureWashingScreens(browser);
    await captureDryingScreens(browser);

    // At this moment both scenario baskets are at QC.
    await captureQcInspectScreens(browser, scenario.qrB);
    await buildReworkApprovalBranch(tokens, scenario.qrA);
    await captureQcTransferScreens(browser);
    await confirmQcTransferToRework(tokens, scenario.qrA);
    await captureReworkScreen(browser);

    // Move second scenario order to pickup and prepare placement flow.
    await scanAtStation(tokens, "qc", scenario.qrB);
    await captureIroningScreen(browser);
    await scanAtStation(tokens, "ironing", scenario.qrB);
    await scanAtStation(tokens, "pickup", scenario.qrB);

    await capturePickupScreens(browser);
    await captureManagerScreens(browser);
  } finally {
    await browser.close();
  }

  console.log(`Training RU screenshots saved to: ${OUT_DIR}`);
}

run().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
