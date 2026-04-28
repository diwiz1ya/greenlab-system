const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const DEFAULT_PORT_CANDIDATES = [3011, 3010, 3012];
const PASSWORD = "demo123";
const VIEWPORT = { width: 1600, height: 1000 };
const TINY_PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2H9wAAAABJRU5ErkJggg==";
const REPORT_PATH = path.join(__dirname, "..", "output", "ui-language-audit.json");
const CYRILLIC_RE = /[А-Яа-яЁё]/;
const TRANSLIT_HINT_RE = /\b(?:razbivka|zakaza|korzin|smeshann|tsvetn|temn|delikat|obshch|veshch|nizhnee|sdelat|dobavit|sokhran|zakryt|vydach|otchet|segodnya|dney|svodka|zagruzka|stirka|sushka|glazhka|klient|telefon|vydann|isklyuch|prosroch|soglasovan|dorabot|snyat|pauz|poisk|arhiv)\b/i;

function ensureOutputDir() {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
}

async function api(pathname, options = {}) {
  const { token, body, method = "GET", headers = {} } = options;
  const isStringBody = typeof body === "string";
  const payloadBody = body === undefined || body === null
    ? undefined
    : (isStringBody ? body : JSON.stringify(body));

  const response = await fetch(`${resolvedBaseUrl}${pathname}`, {
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
  const health = await fetch(`${resolvedBaseUrl}/healthz`);
  if (!health.ok) {
    throw new Error(`Service is not available at ${resolvedBaseUrl}. Start it first with "npm start".`);
  }
  const managerToken = await loginApi("manager");
  await api("/api/demo/reset", { method: "POST", token: managerToken });
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
  const tasksPayload = await api("/api/qc/transfer-tasks", { token: tokens.qc });
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
    body: { sourceQrCode, targetQrCode }
  });
}

async function openLogin(page) {
  await page.goto(resolvedBaseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("#login-submit");
}

let resolvedBaseUrl = "";

async function detectBaseUrl() {
  if (process.env.BASE_URL) {
    const explicitBaseUrl = String(process.env.BASE_URL || "").trim();
    const response = await fetch(`${explicitBaseUrl}/healthz`);
    if (!response.ok) {
      throw new Error(`Service is not available at ${explicitBaseUrl}.`);
    }
    return explicitBaseUrl;
  }

  for (const port of DEFAULT_PORT_CANDIDATES) {
    const candidate = `http://127.0.0.1:${port}`;
    try {
      const response = await fetch(`${candidate}/healthz`);
      if (response.ok) {
        return candidate;
      }
    } catch {
      // try next candidate
    }
  }

  throw new Error("Service is not available on 3011, 3010, or 3012.");
}

async function loginUi(page, username) {
  await openLogin(page);
  await page.fill("#login-username", username);
  await page.fill("#login-password", PASSWORD);
  await page.click("#login-submit");
  await page.waitForSelector("#logout-button", { timeout: 20000 });
}

async function collectVisibleText(page) {
  return page.evaluate(() => {
    function isVisible(element) {
      if (!(element instanceof Element)) return false;
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    const set = new Set();
    const textWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let textNode = textWalker.nextNode();
    while (textNode) {
      const raw = String(textNode.nodeValue || "").replace(/\s+/g, " ").trim();
      if (raw.length > 1) {
        const parent = textNode.parentElement;
        if (parent && isVisible(parent)) {
          set.add(raw);
        }
      }
      textNode = textWalker.nextNode();
    }

    const attrs = ["placeholder", "title", "aria-label"];
    for (const element of Array.from(document.querySelectorAll("*"))) {
      if (!isVisible(element)) continue;
      for (const attr of attrs) {
        const value = element.getAttribute(attr);
        const normalized = String(value || "").replace(/\s+/g, " ").trim();
        if (normalized.length > 1) set.add(normalized);
      }
    }

    return Array.from(set);
  });
}

function findLanguageIssues(lines, maxCount = 120) {
  const matched = [];
  const dedupe = new Set();
  for (const line of lines) {
    const value = String(line || "").trim();
    if (!value) continue;
    if (!CYRILLIC_RE.test(value) && !TRANSLIT_HINT_RE.test(value)) continue;
    if (dedupe.has(value)) continue;
    dedupe.add(value);
    matched.push(value);
    if (matched.length >= maxCount) break;
  }
  return matched;
}

async function auditStep(report, page, label) {
  await page.waitForTimeout(260);
  const lines = await collectVisibleText(page);
  const issues = findLanguageIssues(lines);
  report.steps.push({
    label,
    issueCount: issues.length,
    issues
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

async function runAudit() {
  ensureOutputDir();
  resolvedBaseUrl = await detectBaseUrl();
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: resolvedBaseUrl,
    steps: []
  };

  await resetDemo();
  let tokens = null;
  let scenario = null;

  const browser = await chromium.launch({ headless: true });
  try {
    const loginContext = await browser.newContext({ viewport: VIEWPORT });
    const loginPage = await loginContext.newPage();
    await openLogin(loginPage);
    await auditStep(report, loginPage, "login.screen");
    await loginContext.close();

    await withRolePage(browser, "sorting", async (page) => {
      await page.waitForSelector("[data-select-sorting-order], [data-edit-sorted-baskets]", { timeout: 20000 });
      await auditStep(report, page, "sorting.inbox");

      const openButton = page.locator("[data-select-sorting-order], [data-edit-sorted-baskets]").first();
      if (await openButton.count()) {
        await openButton.click();
        await auditStep(report, page, "sorting.modal.step1");

        const scanInput = page.locator("[data-sorting-basket-scan-input]").first();
        if (await scanInput.count()) {
          const scanCode = `QR:BIN-92${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
          await scanInput.fill(scanCode);
          await scanInput.press("Enter");
        }

        await page.waitForSelector("[data-sorting-items-input], [data-sorting-step-next][data-sorting-step-next-mode='finish']", { timeout: 12000 });
        await auditStep(report, page, "sorting.modal.step2");

        const plusTopButton = page.locator("[data-sorting-items-step][data-item-key='top'][data-step='1']").first();
        if (await plusTopButton.count()) {
          await plusTopButton.click();
        }
        const finishButton = page.locator("[data-sorting-step-next][data-sorting-step-next-mode='finish']").first();
        if (await finishButton.count()) {
          await finishButton.click();
          await auditStep(report, page, "sorting.modal.step3");
        }
      }
    });

    await resetDemo();
    tokens = await getRoleTokens();
    scenario = await prepareScenario(tokens);

    await withRolePage(browser, "washing", async (page) => {
      await page.waitForSelector("[data-machine-open-flow='washing'][data-machine-flow-mode='load']", { timeout: 20000 });
      await auditStep(report, page, "washing.screen");

      await page.click("[data-machine-open-flow='washing'][data-machine-flow-mode='load']");
      await page.waitForSelector(".machine-flow-sheet", { timeout: 12000 });
      await auditStep(report, page, "washing.modal.load");

      const closeButton = page.locator("[data-machine-close-flow='washing']").first();
      if (await closeButton.count()) await closeButton.click();

      await page.click("[data-machine-open-flow='washing'][data-machine-flow-mode='unload']");
      await page.waitForSelector(".machine-flow-sheet", { timeout: 12000 });
      await auditStep(report, page, "washing.modal.unload");
    });

    await withRolePage(browser, "drying", async (page) => {
      await page.waitForSelector("[data-machine-open-flow='drying'][data-machine-flow-mode='load']", { timeout: 20000 });
      await auditStep(report, page, "drying.screen");

      await page.click("[data-machine-open-flow='drying'][data-machine-flow-mode='load']");
      await page.waitForSelector(".machine-flow-sheet", { timeout: 12000 });
      await auditStep(report, page, "drying.modal.load");

      const closeButton = page.locator("[data-machine-close-flow='drying']").first();
      if (await closeButton.count()) await closeButton.click();

      await page.click("[data-machine-open-flow='drying'][data-machine-flow-mode='unload']");
      await page.waitForSelector(".machine-flow-sheet", { timeout: 12000 });
      await auditStep(report, page, "drying.modal.unload");
    });

    await withRolePage(browser, "qc", async (page) => {
      await page.waitForSelector("#simple-scan-input", { timeout: 20000 });
      await auditStep(report, page, "qc.workbench");

      await page.fill("#simple-scan-input", scenario.qrB);
      await page.keyboard.press("Enter");
      await page.waitForSelector("[data-qc-open-rework-modal], [data-run-qc-pass], .qc-current-basket-card", { timeout: 15000 });
      await auditStep(report, page, "qc.after-scan");

      const openReworkButton = page.locator("[data-qc-open-rework-modal]").first();
      if (await openReworkButton.count()) {
        await openReworkButton.click();
        await page.waitForSelector(".qc-modal-sheet", { timeout: 12000 });
        await auditStep(report, page, "qc.rework-modal.step1");

        const nextButton = page.locator("[data-qc-modal-next-step]").first();
        if (await nextButton.count()) {
          await nextButton.click();
          await auditStep(report, page, "qc.rework-modal.step2");
        }

        const closeButton = page.locator("button[data-qc-modal-close]").first();
        if (await closeButton.count()) await closeButton.click();
      }
    });

    await buildReworkApprovalBranch(tokens, scenario.qrA);

    await withRolePage(browser, "qc", async (page) => {
      await page.waitForSelector("#simple-scan-input", { timeout: 20000 });
      await auditStep(report, page, "qc.transfer.banner");

      const openPanelButton = page.locator("[data-open-qc-transfer-panel]").first();
      if (await openPanelButton.count()) {
        await openPanelButton.click();
        await page.waitForSelector(".qc-transfer-drawer-sheet", { timeout: 12000 });
        await auditStep(report, page, "qc.transfer.drawer");
      }
    });

    await confirmQcTransferToRework(tokens, scenario.qrA);

    await withRolePage(browser, "rework", async (page) => {
      await page.waitForSelector("[data-scan-input-for='rework']", { timeout: 20000 });
      await auditStep(report, page, "rework.screen");
    });

    await scanAtStation(tokens, "qc", scenario.qrB);

    await withRolePage(browser, "ironing", async (page) => {
      await page.waitForSelector("[data-scan-input-for='ironing']", { timeout: 20000 });
      await auditStep(report, page, "ironing.screen");
    });

    await scanAtStation(tokens, "ironing", scenario.qrB);
    await scanAtStation(tokens, "pickup", scenario.qrB);

    await withRolePage(browser, "pickup", async (page) => {
      await page.waitForSelector("[data-pickup-mode='assembly']", { timeout: 20000 });
      await auditStep(report, page, "pickup.assembly");

      await page.click("[data-pickup-mode='placement']");
      await auditStep(report, page, "pickup.placement-list");

      const selectOrderButton = page.locator("[data-pickup-place-order]").first();
      if (await selectOrderButton.count()) {
        await selectOrderButton.click();
        await page.waitForSelector(".pickup-placement-modal-sheet", { timeout: 12000 });
        await auditStep(report, page, "pickup.placement-modal.bin");

        const activeBinInput = page.locator("[data-pickup-placement-input='binQr'][data-pickup-placement-active='true']").first();
        if (await activeBinInput.count()) {
          await activeBinInput.fill(scenario.qrB);
          await activeBinInput.press("Enter");
        }
        await auditStep(report, page, "pickup.placement-modal.loc");

        const activeLocInput = page.locator("[data-pickup-placement-input='locationQr'][data-pickup-placement-active='true']").first();
        if (await activeLocInput.count()) {
          await activeLocInput.fill("QR:LOC-A01");
          await activeLocInput.press("Enter");
        }
        await auditStep(report, page, "pickup.placement-modal.ready");

        const submitButton = page.locator("[data-pickup-place-submit]").first();
        if (await submitButton.count()) {
          await submitButton.click();
          await page.waitForTimeout(700);
          await auditStep(report, page, "pickup.after-placement");
        }
      }
    });

    await withRolePage(browser, "manager", async (page) => {
      await page.waitForSelector("[data-manager-filter], .manager-command-panel", { timeout: 20000 });
      await auditStep(report, page, "manager.dashboard");

      const syncButton = page.locator("[data-open-sync-modal]").first();
      if (await syncButton.count()) {
        await syncButton.click();
        await page.waitForSelector(".manager-sync-modal-sheet", { timeout: 12000 });
        await auditStep(report, page, "manager.sync-modal");
        const closeButton = page.locator("button[data-close-sync-modal]").first();
        if (await closeButton.count()) await closeButton.click();
      }

      const historyButton = page.locator("[data-open-manager-history-modal]").first();
      if (await historyButton.count()) {
        await historyButton.click();
        await page.waitForSelector(".manager-history-sheet", { timeout: 12000 });
        await auditStep(report, page, "manager.history-modal");
        const closeButton = page.locator("button[data-close-manager-history-modal]").first();
        if (await closeButton.count()) await closeButton.click();
      }

      const reportsButton = page.locator("[data-open-manager-reports-modal]").first();
      if (await reportsButton.count()) {
        await reportsButton.click();
        await page.waitForSelector(".manager-reports-sheet", { timeout: 12000 });
        await auditStep(report, page, "manager.reports-modal");
        const closeButton = page.locator("button[data-close-manager-reports-modal]").first();
        if (await closeButton.count()) await closeButton.click();
      }

      const quickViewButton = page.locator("[data-open-manager-quick-view]").first();
      if (await quickViewButton.count()) {
        await quickViewButton.click();
        await page.waitForSelector(".manager-quick-modal-sheet", { timeout: 12000 });
        await auditStep(report, page, "manager.quick-view-modal");
        const closeButton = page.locator("button[data-close-manager-quick-view]").first();
        if (await closeButton.count()) await closeButton.click();
      }

      const readyOrderButton = page.locator("[data-open-manager-ready-order]").first();
      if (await readyOrderButton.count()) {
        await readyOrderButton.click();
        await page.waitForSelector(".manager-ready-order-sheet", { timeout: 12000 });
        await auditStep(report, page, "manager.ready-order-modal");

        const completeButton = page.locator("[data-complete-pickup-order]").first();
        if (await completeButton.count()) {
          await completeButton.click();
          await page.waitForSelector(".manager-action-sheet", { timeout: 12000 });
          await auditStep(report, page, "manager.action-confirm-modal");
          const closeAction = page.locator("button[data-close-manager-action]").first();
          if (await closeAction.count()) await closeAction.click();
        }
      }
    });
  } finally {
    await browser.close();
  }

  report.totalSteps = report.steps.length;
  report.totalIssues = report.steps.reduce((sum, step) => sum + Number(step.issueCount || 0), 0);
  report.failingSteps = report.steps.filter((step) => step.issueCount > 0).map((step) => step.label);
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

  if (report.totalIssues > 0) {
    console.error(`Language audit failed: ${report.totalIssues} issues in ${report.failingSteps.length} steps.`);
    for (const step of report.steps) {
      if (!step.issueCount) continue;
      console.error(`- ${step.label}`);
      for (const issue of step.issues) {
        console.error(`  • ${issue}`);
      }
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Language audit passed: ${report.totalSteps} steps checked, no RU/translit UI strings found.`);
  console.log(`Report: ${REPORT_PATH}`);
}

runAudit().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
