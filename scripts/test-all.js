const { spawn } = require("node:child_process");
const path = require("node:path");
const process = require("node:process");

const rootDir = path.resolve(__dirname, "..");
const requestedPort = Number(process.env.TEST_PORT || 0);
const localPort = Number.isFinite(requestedPort) && requestedPort > 0
  ? requestedPort
  : 3300 + Math.floor(Math.random() * 500);
const baseUrl = `http://127.0.0.1:${localPort}`;

const cleanCloudTokenArg = process.argv.find((arg) => arg.startsWith("--cleancloud-token="));
const cleanCloudToken = cleanCloudTokenArg
  ? cleanCloudTokenArg.split("=")[1]
  : (process.env.CLEAN_CLOUD_API_TOKEN || process.env.CLEANCLOUD_API_TOKEN || "");
let lastCleanCloudRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.status >= 200 && response.status < 500) return;
    } catch {
      // Server still booting.
    }
    await sleep(200);
  }
  throw new Error(`Server did not start within ${timeoutMs}ms on ${url}`);
}

async function apiRequest(url, pathName, options = {}) {
  const {
    method = "GET",
    token = "",
    body,
    expectedContentType
  } = options;

  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${url}${pathName}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const contentType = response.headers.get("content-type") || "";
  let data;
  if (contentType.includes("application/json")) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (expectedContentType && !contentType.includes(expectedContentType)) {
    throw new Error(`Unexpected content type for ${method} ${pathName}: ${contentType}`);
  }

  return {
    status: response.status,
    ok: response.ok,
    contentType,
    data
  };
}

function printCase(name, passed, details) {
  const label = passed ? "PASS" : "FAIL";
  const suffix = details ? ` - ${details}` : "";
  console.log(`[${label}] ${name}${suffix}`);
}

function printSkip(name, details) {
  const suffix = details ? ` - ${details}` : "";
  console.log(`[SKIP] ${name}${suffix}`);
}

function isCleanCloudSuccess(value) {
  if (value === true) return true;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
}

function formatError(error) {
  if (!error) return "Unknown error";
  if (error instanceof Error) return error.message;
  return String(error);
}

async function postCleanCloudGetOrders(payload) {
  const elapsed = Date.now() - lastCleanCloudRequestAt;
  const minIntervalMs = 700;
  if (elapsed < minIntervalMs) {
    await sleep(minIntervalMs - elapsed);
  }

  const response = await fetch("https://cleancloudapp.com/api/getOrders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_token: cleanCloudToken,
      ...payload
    })
  });
  lastCleanCloudRequestAt = Date.now();
  const data = await response.json();
  return { status: response.status, data };
}

async function postCleanCloudUpdateOrder(payload) {
  const elapsed = Date.now() - lastCleanCloudRequestAt;
  const minIntervalMs = 700;
  if (elapsed < minIntervalMs) {
    await sleep(minIntervalMs - elapsed);
  }

  const response = await fetch("https://cleancloudapp.com/api/updateOrder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_token: cleanCloudToken,
      ...payload
    })
  });
  lastCleanCloudRequestAt = Date.now();
  const data = await response.json();
  return { status: response.status, data };
}

async function runLocalTests(serverLogs) {
  const results = [];
  const run = async (name, fn) => {
    try {
      await fn();
      results.push({ name, passed: true });
      printCase(name, true);
    } catch (error) {
      results.push({ name, passed: false, details: formatError(error) });
      printCase(name, false, formatError(error));
    }
  };

  await run("Unauthorized session returns 401", async () => {
    const session = await apiRequest(baseUrl, "/api/session");
    if (session.status !== 401) {
      throw new Error(`Expected 401, got ${session.status}`);
    }
  });

  await run("Health endpoint returns service status", async () => {
    const health = await apiRequest(baseUrl, "/healthz");
    if (health.status !== 200) {
      throw new Error(`Expected 200, got ${health.status}`);
    }
    if (!health.data || health.data.ok !== true) {
      throw new Error("Expected ok=true in /healthz payload");
    }
    if (!health.data.syncQueue || typeof health.data.syncQueue !== "object") {
      throw new Error("Expected syncQueue object in /healthz payload");
    }
  });

  await run("Invalid login payload returns 400", async () => {
    const login = await apiRequest(baseUrl, "/api/login", {
      method: "POST",
      body: { username: "manager" }
    });
    if (login.status !== 400) throw new Error(`Expected 400, got ${login.status}`);
  });

  let managerToken = "";
  await run("Manager login works", async () => {
    const login = await apiRequest(baseUrl, "/api/login", {
      method: "POST",
      body: { username: "manager", password: "demo123" }
    });
    if (login.status !== 200) throw new Error(`Expected 200, got ${login.status}`);
    if (!login.data.token) throw new Error("No token in login response");
    managerToken = login.data.token;
  });

  await run("Stations include QC", async () => {
    const stations = await apiRequest(baseUrl, "/api/stations", { token: managerToken });
    const keys = stations.data.stations.map((station) => station.key);
    if (!keys.includes("qc")) throw new Error(`qc station missing: ${keys.join(", ")}`);
  });

  await run("Sorting operator has restricted access", async () => {
    const sortingLogin = await apiRequest(baseUrl, "/api/login", {
      method: "POST",
      body: { username: "sorting", password: "demo123" }
    });
    const sortingToken = sortingLogin.data.token;
    const ownOrders = await apiRequest(baseUrl, "/api/orders?station=sorting", { token: sortingToken });
    if (ownOrders.status !== 200) throw new Error(`Sorting own access expected 200, got ${ownOrders.status}`);

    const forbiddenOrders = await apiRequest(baseUrl, "/api/orders?station=washing", { token: sortingToken });
    if (forbiddenOrders.status !== 403) {
      throw new Error(`Expected 403 for foreign station, got ${forbiddenOrders.status}`);
    }

    const forbiddenReset = await apiRequest(baseUrl, "/api/demo/reset", {
      method: "POST",
      token: sortingToken,
      body: {}
    });
    if (forbiddenReset.status !== 403) {
      throw new Error(`Expected 403 for reset by sorting user, got ${forbiddenReset.status}`);
    }

    const forbiddenSyncQueue = await apiRequest(baseUrl, "/api/sync-queue", {
      token: sortingToken
    });
    if (forbiddenSyncQueue.status !== 403) {
      throw new Error(`Expected 403 for sync queue by sorting user, got ${forbiddenSyncQueue.status}`);
    }

    const managerWashingOrders = await apiRequest(baseUrl, "/api/orders?station=washing", { token: managerToken });
    const foreignOrderId = managerWashingOrders.data.orders?.[0]?.id;
    if (!foreignOrderId) throw new Error("Expected at least one washing order for access check");

    const forbiddenOrderDetails = await apiRequest(baseUrl, `/api/orders/${foreignOrderId}`, {
      token: sortingToken
    });
    if (forbiddenOrderDetails.status !== 403) {
      throw new Error(`Expected 403 for foreign order details by sorting user, got ${forbiddenOrderDetails.status}`);
    }

    const forbiddenExport = await apiRequest(baseUrl, "/api/export/scans?format=csv", {
      token: sortingToken
    });
    if (forbiddenExport.status !== 403) {
      throw new Error(`Expected 403 for scan export by sorting user, got ${forbiddenExport.status}`);
    }

    const forbiddenSecurity = await apiRequest(baseUrl, "/api/security/events", {
      token: sortingToken
    });
    if (forbiddenSecurity.status !== 403) {
      throw new Error(`Expected 403 for security events by sorting user, got ${forbiddenSecurity.status}`);
    }

    const invalidOrderId = await apiRequest(baseUrl, "/api/orders/not-a-number", {
      token: sortingToken
    });
    if (invalidOrderId.status !== 400) {
      throw new Error(`Expected 400 for invalid order id path, got ${invalidOrderId.status}`);
    }
  });

  let orderId = 0;
  let qrCodes = [];
  await run("Workflow can run from sorting to pickup", async () => {
    const reset = await apiRequest(baseUrl, "/api/demo/reset", {
      method: "POST",
      token: managerToken,
      body: {}
    });
    if (reset.status !== 200 || !reset.data.ok) throw new Error("Reset failed");

    const sortingOrders = await apiRequest(baseUrl, "/api/orders?station=sorting", { token: managerToken });
    if (!sortingOrders.data.orders.length) throw new Error("No sorting orders after reset");
    orderId = sortingOrders.data.orders[0].id;

    const create = await apiRequest(baseUrl, "/api/sorting/create-baskets", {
      method: "POST",
      token: managerToken,
      body: { orderId, types: ["White", "Color", "Delicate"] }
    });
    if (create.status !== 200 || !create.data.ok) throw new Error("Create baskets failed");
    qrCodes = create.data.order.baskets.map((basket) => basket.qr_code);
    if (qrCodes.length !== 3) throw new Error(`Expected 3 baskets, got ${qrCodes.length}`);

    const duplicateCreate = await apiRequest(baseUrl, "/api/sorting/create-baskets", {
      method: "POST",
      token: managerToken,
      body: { orderId, types: ["One"] }
    });
    if (duplicateCreate.status !== 400) {
      throw new Error(`Duplicate create should be 400, got ${duplicateCreate.status}`);
    }

    const wrongScan = await apiRequest(baseUrl, "/api/scan", {
      method: "POST",
      token: managerToken,
      body: { station: "drying", qrCode: qrCodes[0] }
    });
    if (wrongScan.status !== 409) {
      throw new Error(`Wrong station scan should be 409, got ${wrongScan.status}`);
    }

    for (const qrCode of qrCodes) {
      const scan = await apiRequest(baseUrl, "/api/scan", {
        method: "POST",
        token: managerToken,
        body: { station: "washing", qrCode }
      });
      if (scan.status !== 200 || !scan.data.ok) {
        throw new Error(`Scan failed at washing for ${qrCode}: ${scan.status}`);
      }
    }

    const rejectedQr = qrCodes[0];
    const qcReject = await apiRequest(baseUrl, "/api/qc/reject", {
      method: "POST",
      token: managerToken,
      body: { qrCode: rejectedQr, reason: "stain" }
    });
    if (qcReject.status !== 200 || !qcReject.data.ok) {
      throw new Error(`QC reject failed for ${rejectedQr}: ${qcReject.status}`);
    }

    for (const qrCode of qrCodes.slice(1)) {
      const scan = await apiRequest(baseUrl, "/api/scan", {
        method: "POST",
        token: managerToken,
        body: { station: "qc", qrCode }
      });
      if (scan.status !== 200 || !scan.data.ok) {
        throw new Error(`Scan failed at qc for ${qrCode}: ${scan.status}`);
      }
    }

    const rewashScan = await apiRequest(baseUrl, "/api/scan", {
      method: "POST",
      token: managerToken,
      body: { station: "washing", qrCode: rejectedQr }
    });
    if (rewashScan.status !== 200 || !rewashScan.data.ok) {
      throw new Error(`Rescan failed at washing for ${rejectedQr}: ${rewashScan.status}`);
    }

    const qcRescan = await apiRequest(baseUrl, "/api/scan", {
      method: "POST",
      token: managerToken,
      body: { station: "qc", qrCode: rejectedQr }
    });
    if (qcRescan.status !== 200 || !qcRescan.data.ok) {
      throw new Error(`Rescan failed at qc for ${rejectedQr}: ${qcRescan.status}`);
    }

    for (const station of ["drying", "ironing"]) {
      for (const qrCode of qrCodes) {
        const scan = await apiRequest(baseUrl, "/api/scan", {
          method: "POST",
          token: managerToken,
          body: { station, qrCode }
        });
        if (scan.status !== 200 || !scan.data.ok) {
          throw new Error(`Scan failed at ${station} for ${qrCode}: ${scan.status}`);
        }
      }
    }

    const pickupOrders = await apiRequest(baseUrl, "/api/orders?station=pickup", { token: managerToken });
    const target = pickupOrders.data.orders.find((order) => order.id === orderId);
    if (!target) throw new Error("Order did not reach pickup station");

    const prematureComplete = await apiRequest(baseUrl, "/api/pickup/complete", {
      method: "POST",
      token: managerToken,
      body: { orderId }
    });
    if (prematureComplete.status !== 400) {
      throw new Error(`Pickup complete must be blocked before scans, got ${prematureComplete.status}`);
    }

    const invalidComplete = await apiRequest(baseUrl, "/api/pickup/complete", {
      method: "POST",
      token: managerToken,
      body: { orderId: "oops" }
    });
    if (invalidComplete.status !== 400) {
      throw new Error(`Expected 400 for invalid pickup orderId, got ${invalidComplete.status}`);
    }

    for (const qrCode of qrCodes) {
      const pickupScan = await apiRequest(baseUrl, "/api/scan", {
        method: "POST",
        token: managerToken,
        body: { station: "pickup", qrCode }
      });
      if (pickupScan.status !== 200 || !pickupScan.data.ok) {
        throw new Error(`Pickup scan failed for ${qrCode}: ${pickupScan.status}`);
      }
    }

    const pickupWorkbench = await apiRequest(baseUrl, "/api/pickup/workbench", { token: managerToken });
    const readyOrder = (pickupWorkbench.data.orders || []).find((order) => order.id === orderId);
    if (!readyOrder) throw new Error("Order missing in pickup workbench");
    if (!readyOrder.can_confirm) throw new Error("Order is not confirmable after full pickup scans");

    const complete = await apiRequest(baseUrl, "/api/pickup/complete", {
      method: "POST",
      token: managerToken,
      body: { orderId }
    });
    if (complete.status !== 200 || !complete.data.ok) throw new Error("Pickup complete failed after full scan");
    if (complete.data.order.status !== "pickup") {
      throw new Error(`Expected status pickup after handover confirmation, got ${complete.data.order.status}`);
    }
    if (complete.data.order.ready_for_pickup !== false) {
      throw new Error("Expected ready_for_pickup=false after handover confirmation");
    }
  });

  await run("QC damage puts order on HOLD and manager can release it", async () => {
    const reset = await apiRequest(baseUrl, "/api/demo/reset", {
      method: "POST",
      token: managerToken,
      body: {}
    });
    if (reset.status !== 200 || !reset.data.ok) throw new Error("Reset failed");

    const sortingOrders = await apiRequest(baseUrl, "/api/orders?station=sorting", { token: managerToken });
    if (!sortingOrders.data.orders.length) throw new Error("No sorting orders after reset");
    const targetOrderId = sortingOrders.data.orders[0].id;

    const create = await apiRequest(baseUrl, "/api/sorting/create-baskets", {
      method: "POST",
      token: managerToken,
      body: { orderId: targetOrderId, types: ["White"] }
    });
    if (create.status !== 200 || !create.data.ok) throw new Error("Create baskets failed");
    const qrCode = create.data.order.baskets?.[0]?.qr_code;
    if (!qrCode) throw new Error("Missing qr_code for created basket");

    const washingScan = await apiRequest(baseUrl, "/api/scan", {
      method: "POST",
      token: managerToken,
      body: { station: "washing", qrCode }
    });
    if (washingScan.status !== 200 || !washingScan.data.ok) {
      throw new Error(`Scan failed at washing for ${qrCode}: ${washingScan.status}`);
    }

    const qcReject = await apiRequest(baseUrl, "/api/qc/reject", {
      method: "POST",
      token: managerToken,
      body: { qrCode, reason: "damage" }
    });
    if (qcReject.status !== 200 || !qcReject.data.ok) {
      throw new Error(`QC reject failed for ${qrCode}: ${qcReject.status}`);
    }
    if (qcReject.data.order.status !== "hold") {
      throw new Error(`Expected order status hold, got ${qcReject.data.order.status}`);
    }

    const blockedScan = await apiRequest(baseUrl, "/api/scan", {
      method: "POST",
      token: managerToken,
      body: { station: "washing", qrCode }
    });
    if (blockedScan.status !== 409) {
      throw new Error(`Expected 409 while order is in HOLD, got ${blockedScan.status}`);
    }

    const release = await apiRequest(baseUrl, `/api/orders/${targetOrderId}/release-hold`, {
      method: "POST",
      token: managerToken,
      body: {}
    });
    if (release.status !== 200 || !release.data.ok) {
      throw new Error(`Release HOLD failed: ${release.status}`);
    }
    if (release.data.order.status !== "washing") {
      throw new Error(`Expected status washing after release, got ${release.data.order.status}`);
    }

    const resumedScan = await apiRequest(baseUrl, "/api/scan", {
      method: "POST",
      token: managerToken,
      body: { station: "washing", qrCode }
    });
    if (resumedScan.status !== 200 || !resumedScan.data.ok) {
      throw new Error(`Expected scan success after release, got ${resumedScan.status}`);
    }
  });

  await run("QC inspect returns basket card before decision", async () => {
    const reset = await apiRequest(baseUrl, "/api/demo/reset", {
      method: "POST",
      token: managerToken,
      body: {}
    });
    if (reset.status !== 200 || !reset.data.ok) throw new Error("Reset failed");

    const sortingOrders = await apiRequest(baseUrl, "/api/orders?station=sorting", { token: managerToken });
    const targetOrderId = sortingOrders.data.orders?.[0]?.id;
    if (!targetOrderId) throw new Error("No sorting orders after reset");

    const create = await apiRequest(baseUrl, "/api/sorting/create-baskets", {
      method: "POST",
      token: managerToken,
      body: { orderId: targetOrderId, types: ["Mixed"] }
    });
    if (create.status !== 200 || !create.data.ok) throw new Error("Create baskets failed");
    const qrCode = create.data.order.baskets?.[0]?.qr_code;
    if (!qrCode) throw new Error("Missing qr_code");

    const wash = await apiRequest(baseUrl, "/api/scan", {
      method: "POST",
      token: managerToken,
      body: { station: "washing", qrCode }
    });
    if (wash.status !== 200 || !wash.data.ok) throw new Error("Washing scan failed");

    const inspect = await apiRequest(baseUrl, "/api/qc/inspect", {
      method: "POST",
      token: managerToken,
      body: { qrCode }
    });
    if (inspect.status !== 200 || !inspect.data.ok) throw new Error("QC inspect failed");
    if (!inspect.data.order || !inspect.data.basket) throw new Error("QC inspect payload missing order/basket");
    if (inspect.data.basket.qr_code !== qrCode) throw new Error("QC inspect returned different basket");
  });

  await run("Scan export returns CSV", async () => {
    const exportCsv = await apiRequest(baseUrl, "/api/export/scans?format=csv", {
      token: managerToken,
      expectedContentType: "text/csv"
    });
    if (exportCsv.status !== 200) throw new Error(`Expected 200, got ${exportCsv.status}`);
    if (typeof exportCsv.data !== "string" || !exportCsv.data.includes("order_public_id")) {
      throw new Error("CSV header is missing");
    }
  });

  await run("Sync queue endpoint returns data", async () => {
    const syncQueue = await apiRequest(baseUrl, "/api/sync-queue", { token: managerToken });
    if (syncQueue.status !== 200) throw new Error(`Expected 200, got ${syncQueue.status}`);
    if (!Array.isArray(syncQueue.data.items)) throw new Error("sync queue payload has no items array");
    if (!syncQueue.data.summary) throw new Error("sync queue summary is missing");
  });

  await run("Manual sync run endpoint works", async () => {
    const runSync = await apiRequest(baseUrl, "/api/sync/run", {
      method: "POST",
      token: managerToken,
      body: {}
    });
    if (runSync.status !== 200 || !runSync.data.ok) {
      throw new Error(`Expected 200 with ok=true, got ${runSync.status}`);
    }
  });

  await run("Manual sync run validates explicit order id", async () => {
    const runSync = await apiRequest(baseUrl, "/api/sync/run", {
      method: "POST",
      token: managerToken,
      body: { orderId: "bad" }
    });
    if (runSync.status !== 400) {
      throw new Error(`Expected 400 for invalid sync order id, got ${runSync.status}`);
    }
  });

  await run("Retry sync by order validates order id", async () => {
    const retryInvalid = await apiRequest(baseUrl, "/api/sync/retry-order", {
      method: "POST",
      token: managerToken,
      body: { orderId: 0 }
    });
    if (retryInvalid.status !== 400) {
      throw new Error(`Expected 400 for invalid order id, got ${retryInvalid.status}`);
    }
  });

  await run("Webhook endpoint deduplicates by event key", async () => {
    const payload = { event_id: "demo-webhook-001", orderID: "CC-DOES-NOT-EXIST", status: "0" };
    const first = await apiRequest(baseUrl, "/api/cleancloud/webhook", {
      method: "POST",
      body: payload
    });
    if (first.status !== 200 || !first.data.ok) throw new Error("First webhook call failed");
    if (first.data.duplicate) throw new Error("First webhook call marked as duplicate");

    const second = await apiRequest(baseUrl, "/api/cleancloud/webhook", {
      method: "POST",
      body: payload
    });
    if (second.status !== 200 || !second.data.ok || !second.data.duplicate) {
      throw new Error("Second webhook call must be marked duplicate");
    }
  });

  await run("Manager can read webhook events", async () => {
    const events = await apiRequest(baseUrl, "/api/webhooks/events?limit=5", {
      method: "GET",
      token: managerToken
    });
    if (events.status !== 200) throw new Error(`Expected 200, got ${events.status}`);
    if (!Array.isArray(events.data.rows)) throw new Error("rows is not an array");
    if (events.data.rows.length < 1) throw new Error("No webhook rows returned");
  });

  await run("Manager can read security events", async () => {
    const events = await apiRequest(baseUrl, "/api/security/events?limit=10", {
      method: "GET",
      token: managerToken
    });
    if (events.status !== 200) throw new Error(`Expected 200, got ${events.status}`);
    if (!Array.isArray(events.data.rows)) throw new Error("rows is not an array");
    if (events.data.rows.length < 1) throw new Error("No security rows returned");

    const hasAuthEvent = events.data.rows.some((row) =>
      typeof row.category === "string" && row.category.startsWith("auth.login")
    );
    if (!hasAuthEvent) throw new Error("Expected auth.login* event in security log");
  });

  await run("Logout invalidates session", async () => {
    const logout = await apiRequest(baseUrl, "/api/logout", {
      method: "POST",
      token: managerToken,
      body: {}
    });
    if (logout.status !== 200) throw new Error(`Expected 200, got ${logout.status}`);
    const afterLogout = await apiRequest(baseUrl, "/api/session", { token: managerToken });
    if (afterLogout.status !== 401) throw new Error(`Expected 401, got ${afterLogout.status}`);
  });

  if (serverLogs.stderr) {
    const stderrPreview = serverLogs.stderr.trim().split("\n").slice(-3).join(" | ");
    printCase("Server stderr check", true, stderrPreview || "No stderr output");
    results.push({ name: "Server stderr check", passed: true, details: stderrPreview });
  }

  return results;
}

async function runCleanCloudTests() {
  const results = [];
  const run = async (name, fn) => {
    try {
      await fn();
      results.push({ name, passed: true });
      printCase(name, true);
    } catch (error) {
      results.push({ name, passed: false, details: formatError(error) });
      printCase(name, false, formatError(error));
    }
  };

  if (!cleanCloudToken) {
    results.push({ name: "CleanCloud token provided", passed: false, skipped: true, details: "Token not provided" });
    printSkip("CleanCloud token provided", "No token");
    return results;
  }

  let referenceOrder = null;

  await run("CleanCloud getOrders by dateFrom/dateTo", async () => {
    const now = new Date();
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const toDate = now.toISOString().slice(0, 10);
    const fromDate = from.toISOString().slice(0, 10);
    const response = await postCleanCloudGetOrders({ dateFrom: fromDate, dateTo: toDate });
    if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);
    if (!isCleanCloudSuccess(response.data.Success)) {
      throw new Error(response.data.Error || "Success=false");
    }
    const orders = Array.isArray(response.data.Orders) ? response.data.Orders : [];
    if (!orders.length) throw new Error("No orders returned for date range");
    referenceOrder = orders[0];
  });

  await run("CleanCloud getOrders by updatedSecondsAgoFrom", async () => {
    const response = await postCleanCloudGetOrders({ updatedSecondsAgoFrom: 86400 });
    if (!isCleanCloudSuccess(response.data.Success)) throw new Error(response.data.Error || "Success=false");
    const orders = response.data.Orders || [];
    if (!referenceOrder && Array.isArray(orders) && orders.length) {
      referenceOrder = orders[0];
    }
  });

  await run("CleanCloud getOrders by orderID", async () => {
    if (!referenceOrder || !referenceOrder.id) throw new Error("Missing reference order");
    const response = await postCleanCloudGetOrders({ orderID: referenceOrder.id });
    if (!isCleanCloudSuccess(response.data.Success)) throw new Error(response.data.Error || "Success=false");
    const orders = response.data.Orders || [];
    if (!orders.length) throw new Error("No order returned for orderID");
  });

  await run("CleanCloud getOrders by customerID", async () => {
    if (!referenceOrder || !referenceOrder.customerID) throw new Error("Missing reference customerID");
    const response = await postCleanCloudGetOrders({ customerID: referenceOrder.customerID });
    if (!isCleanCloudSuccess(response.data.Success)) throw new Error(response.data.Error || "Success=false");
    const orders = response.data.Orders || [];
    if (!orders.length) throw new Error("No orders returned for customerID");
  });

  await run("CleanCloud updateOrder safe write test", async () => {
    if (!referenceOrder || !referenceOrder.id) throw new Error("Missing reference order for update");
    const response = await postCleanCloudUpdateOrder({
      orderID: referenceOrder.id,
      status: referenceOrder.status
    });
    if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);
    if (!isCleanCloudSuccess(response.data.Success)) {
      throw new Error(response.data.Error || "Success=false");
    }
  });

  return results;
}

async function shutdownServer(server) {
  if (!server || server.exitCode !== null) return;

  server.kill("SIGTERM");
  const started = Date.now();
  while (server.exitCode === null && Date.now() - started < 2000) {
    await sleep(100);
  }
  if (server.exitCode === null) {
    server.kill("SIGKILL");
  }
}

async function main() {
  const serverLogs = { stdout: "", stderr: "" };
  const server = spawn(process.execPath, ["server.js"], {
    cwd: rootDir,
    env: { ...process.env, PORT: String(localPort), GREENLAB_PORT: String(localPort) },
    stdio: ["ignore", "pipe", "pipe"]
  });

  server.stdout.on("data", (chunk) => {
    serverLogs.stdout += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverLogs.stderr += chunk.toString();
  });

  try {
    await waitForServer(baseUrl);
    const localResults = await runLocalTests(serverLogs);
    const cleanCloudResults = await runCleanCloudTests();
    const allResults = [...localResults, ...cleanCloudResults];
    const failed = allResults.filter((item) => !item.passed && !item.skipped);
    const skipped = allResults.filter((item) => item.skipped);

    console.log("");
    console.log("Summary:");
    console.log(`Total checks: ${allResults.length}`);
    console.log(`Failed checks: ${failed.length}`);
    console.log(`Skipped checks: ${skipped.length}`);

    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    printCase("Test runner fatal", false, formatError(error));
    process.exitCode = 1;
  } finally {
    await shutdownServer(server);
  }
}

main();
