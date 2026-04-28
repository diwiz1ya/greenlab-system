const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const process = require("node:process");

const rootDir = path.resolve(__dirname, "..");
const requestedPort = Number(process.env.TEST_PORT || 0);
const localPort = Number.isFinite(requestedPort) && requestedPort > 0
  ? requestedPort
  : 3300 + Math.floor(Math.random() * 500);
const baseUrl = `http://127.0.0.1:${localPort}`;
const tempRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "greenlab-tests-"));
const testDataDir = path.join(tempRootDir, "data");
const testUploadsDir = path.join(tempRootDir, "uploads", "baskets");
const testDbPath = path.join(testDataDir, "greenlab-test.sqlite");

fs.mkdirSync(testDataDir, { recursive: true });
fs.mkdirSync(testUploadsDir, { recursive: true });

const cleanCloudTokenArg = process.argv.find((arg) => arg.startsWith("--cleancloud-token="));
const cleanCloudToken = cleanCloudTokenArg
  ? cleanCloudTokenArg.split("=")[1]
  : (process.env.CLEAN_CLOUD_API_TOKEN || process.env.CLEANCLOUD_API_TOKEN || "");
const cleanCloudWebhookToken = process.env.CLEAN_CLOUD_WEBHOOK_TOKEN || "test-webhook-token";
const cleanCloudWebhookHeaders = cleanCloudWebhookToken
  ? { "x-webhook-token": cleanCloudWebhookToken }
  : {};
const tinyPngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnHCq8AAAAASUVORK5CYII=";
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
    expectedContentType,
    headers: extraHeaders = {}
  } = options;

  const headers = { ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  const isFormDataBody = typeof FormData !== "undefined" && body instanceof FormData;
  const hasContentTypeHeader = Object.keys(headers).some((key) => key.toLowerCase() === "content-type");
  if (body !== undefined && !isFormDataBody && !hasContentTypeHeader) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${url}${pathName}`, {
    method,
    headers,
    body: body === undefined ? undefined : (isFormDataBody ? body : JSON.stringify(body))
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

function dataUrlToBlob(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(String(dataUrl || "").trim());
  if (!match) return null;
  return new Blob([Buffer.from(match[2], "base64")], { type: match[1] });
}

function photoExtensionByMimeType(mimeType) {
  const type = String(mimeType || "").toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  return "jpg";
}

function buildSortingMultipartBody(payload) {
  const orderId = Number(payload?.orderId || 0);
  const basketsSource = Array.isArray(payload?.baskets) ? payload.baskets : [];
  const formData = new FormData();
  const baskets = basketsSource.map((basket, basketIndex) => {
    const photosSource = Array.isArray(basket?.photos) ? basket.photos : [];
    const photos = [];
    for (let photoIndex = 0; photoIndex < photosSource.length; photoIndex += 1) {
      const photo = photosSource[photoIndex];
      const role = String(photo?.role || "").trim().toLowerCase() === "overview" ? "overview" : "issue";
      const note = String(photo?.note || "").trim();
      const dataUrl = String(photo?.dataUrl || photo?.data_url || "").trim();
      const blob = dataUrlToBlob(dataUrl);
      if (!blob) continue;
      const fieldName = `basket_photo_${basketIndex}_${photoIndex}`;
      const extension = photoExtensionByMimeType(blob.type);
      formData.append(fieldName, blob, `${fieldName}.${extension}`);
      photos.push({
        role,
        note,
        uploadField: fieldName
      });
    }
    return {
      type: String(basket?.type || "").trim(),
      itemCounts: basket?.itemCounts || null,
      photos,
      qrCode: basket?.qrCode || null,
      labelPrintedAt: basket?.labelPrintedAt || null,
      labelPrintCount: Number(basket?.labelPrintCount ?? 0)
    };
  });

  formData.append(
    "payload",
    JSON.stringify({
      orderId,
      baskets
    })
  );
  return formData;
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

function getUnexpectedServerStderr(stderr) {
  const unexpected = [];

  for (const line of String(stderr || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\(node:\d+\) ExperimentalWarning: SQLite is an experimental feature/i.test(trimmed)) continue;
    if (/^ExperimentalWarning: SQLite is an experimental feature/i.test(trimmed)) continue;
    if (/^\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)$/i.test(trimmed)) continue;
    if (/^Use `node --trace-warnings \.\.\.` to show where the warning was created/i.test(trimmed)) continue;
    unexpected.push(trimmed);
  }

  return unexpected.join("\n");
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

  await run("Stations include QC and rework", async () => {
    const stations = await apiRequest(baseUrl, "/api/stations", { token: managerToken });
    const keys = stations.data.stations.map((station) => station.key);
    if (!keys.includes("qc")) throw new Error(`qc station missing: ${keys.join(", ")}`);
    if (!keys.includes("rework")) throw new Error(`rework station missing: ${keys.join(", ")}`);
  });

  await run("Machine cycle moves baskets washing -> drying -> qc", async () => {
    const reset = await apiRequest(baseUrl, "/api/demo/reset", {
      method: "POST",
      token: managerToken,
      body: {}
    });
    if (reset.status !== 200 || !reset.data.ok) throw new Error("Reset failed before machine cycle test");

    const sortingOrders = await apiRequest(baseUrl, "/api/orders?station=sorting", { token: managerToken });
    const orderId = sortingOrders.data?.orders?.[0]?.id;
    if (!orderId) throw new Error("No sorting order for machine cycle test");

    const create = await apiRequest(baseUrl, "/api/sorting/create-baskets", {
      method: "POST",
      token: managerToken,
      body: {
        orderId,
        baskets: [
          { type: "Black", itemCounts: { top: 1, bottom: 1, underwear: 0, socksPairs: 0 } },
          { type: "Delicate", itemCounts: { top: 1, bottom: 0, underwear: 0, socksPairs: 0 } }
        ]
      }
    });
    if (create.status !== 200 || !create.data.ok) throw new Error("Create baskets failed");
    const qrCodes = create.data.order.baskets.map((basket) => basket.qr_code);
    if (qrCodes.length !== 2) throw new Error(`Expected 2 baskets, got ${qrCodes.length}`);

    const washingWorkbench = await apiRequest(baseUrl, "/api/machines/workbench?station=washing", { token: managerToken });
    if (washingWorkbench.status !== 200) throw new Error("Washing machine workbench failed");
    if (!Array.isArray(washingWorkbench.data.machines) || !washingWorkbench.data.machines.length) {
      throw new Error("No washing machines in workbench");
    }

    const startWashLoadInvalid = await apiRequest(baseUrl, "/api/machines/loads/start", {
      method: "POST",
      token: managerToken,
      body: {
        station: "washing",
        machineCode: "QR:W01",
        basketQrs: qrCodes
      }
    });
    if (startWashLoadInvalid.status !== 400) {
      throw new Error(`Expected 400 for multi-basket washing load, got ${startWashLoadInvalid.status}`);
    }

    const startWashLoadWithBasketAsMachine = await apiRequest(baseUrl, "/api/machines/loads/start", {
      method: "POST",
      token: managerToken,
      body: {
        station: "washing",
        machineCode: qrCodes[0],
        basketQrs: [qrCodes[0]]
      }
    });
    if (startWashLoadWithBasketAsMachine.status !== 400) {
      throw new Error(`Expected 400 when basket QR is used as washing machine QR, got ${startWashLoadWithBasketAsMachine.status}`);
    }

    const startWashLoadWithMachineAsBasket = await apiRequest(baseUrl, "/api/machines/loads/start", {
      method: "POST",
      token: managerToken,
      body: {
        station: "washing",
        machineCode: "QR:W01",
        basketQrs: ["QR:W01"]
      }
    });
    if (startWashLoadWithMachineAsBasket.status !== 400) {
      throw new Error(`Expected 400 when machine QR is used as basket QR, got ${startWashLoadWithMachineAsBasket.status}`);
    }

    for (const qrCode of qrCodes) {
      const startWashLoad = await apiRequest(baseUrl, "/api/machines/loads/start", {
        method: "POST",
        token: managerToken,
        body: {
          station: "washing",
          machineCode: "QR:W01",
          basketQrs: [qrCode]
        }
      });
      if (startWashLoad.status !== 200 || !startWashLoad.data.ok) {
        throw new Error(`Start washing load failed for ${qrCode}: ${startWashLoad.status}`);
      }
      const washLoadId = Number(startWashLoad.data.load?.id || 0);
      if (!washLoadId) throw new Error(`No wash load id for ${qrCode}`);

      const unloadWithMachineQr = await apiRequest(baseUrl, `/api/machines/loads/${washLoadId}/unload-basket`, {
        method: "POST",
        token: managerToken,
        body: {
          station: "washing",
          basketQr: "QR:W01"
        }
      });
      if (unloadWithMachineQr.status !== 400) {
        throw new Error(`Expected 400 when machine QR is used on unload, got ${unloadWithMachineQr.status}`);
      }

      const unloadFromWash = await apiRequest(baseUrl, `/api/machines/loads/${washLoadId}/unload-basket`, {
        method: "POST",
        token: managerToken,
        body: {
          station: "washing",
          basketQr: qrCode
        }
      });
      if (unloadFromWash.status !== 200 || !unloadFromWash.data.ok) {
        throw new Error(`Unload washing basket failed for ${qrCode}: ${unloadFromWash.status}`);
      }

      const dryStart = await apiRequest(baseUrl, "/api/machines/loads/start", {
        method: "POST",
        token: managerToken,
        body: {
          station: "drying",
          machineCode: "QR:D01",
          basketQrs: [qrCode]
        }
      });
      if (dryStart.status !== 200 || !dryStart.data.ok) {
        throw new Error(`Start drying load failed for ${qrCode}: ${dryStart.status}`);
      }
      const dryLoadId = Number(dryStart.data.load?.id || 0);
      if (!dryLoadId) throw new Error(`No dry load id for ${qrCode}`);

      const unloadFromDry = await apiRequest(baseUrl, `/api/machines/loads/${dryLoadId}/unload-basket`, {
        method: "POST",
        token: managerToken,
        body: {
          station: "drying",
          basketQr: qrCode
        }
      });
      if (unloadFromDry.status !== 200 || !unloadFromDry.data.ok) {
        throw new Error(`Unload drying basket failed for ${qrCode}: ${unloadFromDry.status}`);
      }
    }

    const wrongRescan = await apiRequest(baseUrl, "/api/scan", {
      method: "POST",
      token: managerToken,
      body: { station: "drying", qrCode: qrCodes[0] }
    });
    if (wrongRescan.status !== 409) {
      throw new Error(`Expected drying rescan 409 after machine cycle, got ${wrongRescan.status}`);
    }

    const qcScan = await apiRequest(baseUrl, "/api/scan", {
      method: "POST",
      token: managerToken,
      body: { station: "qc", qrCode: qrCodes[0] }
    });
    if (qcScan.status !== 200 || !qcScan.data.ok) {
      throw new Error(`QC scan failed after drying cycle: ${qcScan.status}`);
    }
  });

  await run("Machine unload allows moving to another free BIN QR", async () => {
    const reset = await apiRequest(baseUrl, "/api/demo/reset", {
      method: "POST",
      token: managerToken,
      body: {}
    });
    if (reset.status !== 200 || !reset.data.ok) throw new Error("Reset failed before QR rebind test");

    const sortingOrders = await apiRequest(baseUrl, "/api/orders?station=sorting", { token: managerToken });
    const orderId = sortingOrders.data?.orders?.[0]?.id;
    if (!orderId) throw new Error("No sorting order for QR rebind test");

    const create = await apiRequest(baseUrl, "/api/sorting/create-baskets", {
      method: "POST",
      token: managerToken,
      body: {
        orderId,
        baskets: [
          { type: "Black", itemCounts: { top: 1, bottom: 1, underwear: 0, socksPairs: 0 } }
        ]
      }
    });
    if (create.status !== 200 || !create.data.ok) throw new Error("Create baskets failed in QR rebind test");
    const originalQr = create.data.order?.baskets?.[0]?.qr_code;
    if (!originalQr) throw new Error("Missing original basket QR");

    const replacementQr = originalQr === "QR:BIN-050" ? "QR:BIN-049" : "QR:BIN-050";

    const startWashLoad = await apiRequest(baseUrl, "/api/machines/loads/start", {
      method: "POST",
      token: managerToken,
      body: {
        station: "washing",
        machineCode: "QR:W01",
        basketQrs: [originalQr]
      }
    });
    if (startWashLoad.status !== 200 || !startWashLoad.data.ok) {
      throw new Error(`Start washing load failed in QR rebind test: ${startWashLoad.status}`);
    }
    const washLoadId = Number(startWashLoad.data.load?.id || 0);
    if (!washLoadId) throw new Error("Missing washing load id in QR rebind test");

    const unloadFromWash = await apiRequest(baseUrl, `/api/machines/loads/${washLoadId}/unload-basket`, {
      method: "POST",
      token: managerToken,
      body: {
        station: "washing",
        basketQr: replacementQr
      }
    });
    if (unloadFromWash.status !== 200 || !unloadFromWash.data.ok) {
      throw new Error(`Unload with replacement QR failed: ${unloadFromWash.status}`);
    }
    if (unloadFromWash.data?.basket?.qr_code !== replacementQr) {
      throw new Error(`Expected replacement QR ${replacementQr}, got ${unloadFromWash.data?.basket?.qr_code}`);
    }

    const dryStartOldQr = await apiRequest(baseUrl, "/api/machines/loads/start", {
      method: "POST",
      token: managerToken,
      body: {
        station: "drying",
        machineCode: "QR:D01",
        basketQrs: [originalQr]
      }
    });
    if (dryStartOldQr.status !== 404) {
      throw new Error(`Expected 404 for old QR after rebind, got ${dryStartOldQr.status}`);
    }

    const dryStartNewQr = await apiRequest(baseUrl, "/api/machines/loads/start", {
      method: "POST",
      token: managerToken,
      body: {
        station: "drying",
        machineCode: "QR:D01",
        basketQrs: [replacementQr]
      }
    });
    if (dryStartNewQr.status !== 200 || !dryStartNewQr.data.ok) {
      throw new Error(`Dry start with replacement QR failed: ${dryStartNewQr.status}`);
    }
  });

  await run("Machine cycle rejects empty basket", async () => {
    const reset = await apiRequest(baseUrl, "/api/demo/reset", {
      method: "POST",
      token: managerToken,
      body: {}
    });
    if (reset.status !== 200 || !reset.data.ok) throw new Error("Reset failed before empty basket test");

    const sortingOrders = await apiRequest(baseUrl, "/api/orders?station=sorting", { token: managerToken });
    const orderId = sortingOrders.data?.orders?.[0]?.id;
    if (!orderId) throw new Error("No sorting order for empty basket test");

    const create = await apiRequest(baseUrl, "/api/sorting/create-baskets", {
      method: "POST",
      token: managerToken,
      body: {
        orderId,
        types: ["Black"]
      }
    });
    if (create.status !== 200 || !create.data.ok) throw new Error("Create baskets failed for empty basket test");
    const qrCode = create.data.order?.baskets?.[0]?.qr_code;
    if (!qrCode) throw new Error("No basket QR for empty basket test");

    const startWashLoad = await apiRequest(baseUrl, "/api/machines/loads/start", {
      method: "POST",
      token: managerToken,
      body: {
        station: "washing",
        machineCode: "QR:W01",
        basketQrs: [qrCode]
      }
    });
    if (startWashLoad.status !== 409) {
      throw new Error(`Expected 409 for empty basket load, got ${startWashLoad.status}`);
    }
  });

  await run("Sorting operator has restricted access", async () => {
    const reset = await apiRequest(baseUrl, "/api/demo/reset", {
      method: "POST",
      token: managerToken,
      body: {}
    });
    if (reset.status !== 200 || !reset.data.ok) throw new Error("Reset failed before access test");

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

    const sortingOrdersForForeignCheck = await apiRequest(baseUrl, "/api/orders?station=sorting", { token: managerToken });
    const foreignOrderId = sortingOrdersForForeignCheck.data.orders?.[0]?.id;
    if (!foreignOrderId) throw new Error("Expected at least one sorting order for access check");

    const createForeignBasket = await apiRequest(baseUrl, "/api/sorting/create-baskets", {
      method: "POST",
      token: managerToken,
      body: {
        orderId: foreignOrderId,
        baskets: [
          { type: "White", itemCounts: { top: 1, bottom: 0, underwear: 0, socksPairs: 0 } }
        ]
      }
    });
    if (createForeignBasket.status !== 200 || !createForeignBasket.data.ok) {
      throw new Error("Failed to create basket for foreign-station access check");
    }

    const foreignQrCode = createForeignBasket.data.order?.baskets?.[0]?.qr_code;
    if (!foreignQrCode) throw new Error("Missing QR for foreign-station access check");

    const moveForeignOrderToWashing = await apiRequest(baseUrl, "/api/scan", {
      method: "POST",
      token: managerToken,
      body: { station: "washing", qrCode: foreignQrCode }
    });
    if (moveForeignOrderToWashing.status !== 200 || !moveForeignOrderToWashing.data.ok) {
      throw new Error("Failed to move foreign order to washing");
    }

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

  await run("Sorting create supports multipart photos and idempotent replay", async () => {
    const reset = await apiRequest(baseUrl, "/api/demo/reset", {
      method: "POST",
      token: managerToken,
      body: {}
    });
    if (reset.status !== 200 || !reset.data.ok) throw new Error("Reset failed");

    const sortingOrders = await apiRequest(baseUrl, "/api/orders?station=sorting", { token: managerToken });
    const targetOrderId = sortingOrders.data.orders?.[0]?.id;
    if (!targetOrderId) throw new Error("No sorting order for multipart test");

    const payload = {
      orderId: targetOrderId,
      baskets: [
        {
          type: "Mixed",
          itemCounts: { top: 1, bottom: 1, underwear: 0, socksPairs: 0 },
          photos: [{ role: "overview", note: "overview", dataUrl: tinyPngDataUrl }]
        }
      ]
    };
    const idempotencyKey = `test-sorting-multipart-${Date.now()}`;

    const create = await apiRequest(baseUrl, "/api/sorting/create-baskets", {
      method: "POST",
      token: managerToken,
      headers: {
        "X-Idempotency-Key": idempotencyKey
      },
      body: buildSortingMultipartBody(payload)
    });
    if (create.status !== 200 || !create.data.ok) {
      throw new Error(`Multipart create failed: ${create.status}`);
    }
    const firstBasket = create.data.order?.baskets?.[0];
    if (!firstBasket?.qr_code) throw new Error("Multipart create response has no basket qr_code");
    if (!Array.isArray(firstBasket.images) || firstBasket.images.length < 1) {
      throw new Error("Expected at least one basket image after multipart create");
    }

    const replay = await apiRequest(baseUrl, "/api/sorting/create-baskets", {
      method: "POST",
      token: managerToken,
      headers: {
        "X-Idempotency-Key": idempotencyKey
      },
      body: buildSortingMultipartBody(payload)
    });
    if (replay.status !== 200 || !replay.data.ok) {
      throw new Error(`Multipart idempotent replay failed: ${replay.status}`);
    }
    const replayBasket = replay.data.order?.baskets?.[0];
    if (replayBasket?.qr_code !== firstBasket.qr_code) {
      throw new Error(`Expected same basket qr on replay, got ${replayBasket?.qr_code} vs ${firstBasket.qr_code}`);
    }
  });

  await run("Machine start/unload use idempotency key safely", async () => {
    const reset = await apiRequest(baseUrl, "/api/demo/reset", {
      method: "POST",
      token: managerToken,
      body: {}
    });
    if (reset.status !== 200 || !reset.data.ok) throw new Error("Reset failed");

    const sortingOrders = await apiRequest(baseUrl, "/api/orders?station=sorting", { token: managerToken });
    const targetOrderId = sortingOrders.data.orders?.[0]?.id;
    if (!targetOrderId) throw new Error("No sorting order for machine idempotency test");

    const create = await apiRequest(baseUrl, "/api/sorting/create-baskets", {
      method: "POST",
      token: managerToken,
      body: {
        orderId: targetOrderId,
        baskets: [{ type: "Mixed", itemCounts: { top: 1, bottom: 0, underwear: 0, socksPairs: 0 } }]
      }
    });
    if (create.status !== 200 || !create.data.ok) throw new Error("Create baskets failed");
    const basketQr = create.data.order?.baskets?.[0]?.qr_code;
    if (!basketQr) throw new Error("Missing basket QR for machine idempotency test");

    const startKey = `test-machine-start-${Date.now()}`;
    const startBody = {
      station: "washing",
      machineCode: "QR:W01",
      basketQrs: [basketQr]
    };
    const start = await apiRequest(baseUrl, "/api/machines/loads/start", {
      method: "POST",
      token: managerToken,
      headers: {
        "X-Idempotency-Key": startKey
      },
      body: startBody
    });
    if (start.status !== 200 || !start.data.ok) throw new Error(`Machine start failed: ${start.status}`);
    const loadId = Number(start.data.load?.id || 0);
    if (!loadId) throw new Error("Missing load id in machine start response");

    const replayStart = await apiRequest(baseUrl, "/api/machines/loads/start", {
      method: "POST",
      token: managerToken,
      headers: {
        "X-Idempotency-Key": startKey
      },
      body: startBody
    });
    if (replayStart.status !== 200 || !replayStart.data.ok) {
      throw new Error(`Machine start replay failed: ${replayStart.status}`);
    }
    if (Number(replayStart.data.load?.id || 0) !== loadId) {
      throw new Error("Machine start replay returned different load id");
    }

    const unloadKey = `test-machine-unload-${Date.now()}`;
    const unloadBody = {
      station: "washing",
      basketQr
    };
    const unload = await apiRequest(baseUrl, `/api/machines/loads/${loadId}/unload-basket`, {
      method: "POST",
      token: managerToken,
      headers: {
        "X-Idempotency-Key": unloadKey
      },
      body: unloadBody
    });
    if (unload.status !== 200 || !unload.data.ok) throw new Error(`Unload failed: ${unload.status}`);

    const replayUnload = await apiRequest(baseUrl, `/api/machines/loads/${loadId}/unload-basket`, {
      method: "POST",
      token: managerToken,
      headers: {
        "X-Idempotency-Key": unloadKey
      },
      body: unloadBody
    });
    if (replayUnload.status !== 200 || !replayUnload.data.ok) {
      throw new Error(`Unload replay failed: ${replayUnload.status}`);
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
      body: {
        orderId,
        baskets: [
          { type: "White", itemCounts: { top: 2, bottom: 0, underwear: 0, socksPairs: 0 } },
          { type: "Color", itemCounts: { top: 1, bottom: 1, underwear: 0, socksPairs: 0 } },
          { type: "Delicate", itemCounts: { top: 1, bottom: 0, underwear: 0, socksPairs: 1 } }
        ]
      }
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
    const moveRejectedToQcByDrying = await apiRequest(baseUrl, "/api/scan", {
      method: "POST",
      token: managerToken,
      body: { station: "drying", qrCode: rejectedQr }
    });
    if (moveRejectedToQcByDrying.status !== 200 || !moveRejectedToQcByDrying.data.ok) {
      throw new Error(`Drying scan failed for ${rejectedQr}: ${moveRejectedToQcByDrying.status}`);
    }

    const qcRework = await apiRequest(baseUrl, "/api/qc/rework", {
      method: "POST",
      token: managerToken,
      body: {
        qrCode: rejectedQr,
        reason: "spot_treatment",
        itemCategory: "top",
        itemLabel: "White shirt",
        quantity: 1,
        qcPhotoDataUrl: tinyPngDataUrl
      }
    });
    if (qcRework.status !== 200 || !qcRework.data.ok) {
      throw new Error(`QC rework failed for ${rejectedQr}: ${qcRework.status}`);
    }
    const requestId = qcRework.data.request?.id;
    if (!requestId) throw new Error("Expected request id after QC customer approval request");
    if (!qcRework.data.request?.qc_photo_url) {
      throw new Error("Expected QC evidence photo url after rework request");
    }
    if (qcRework.data.basket?.station !== "customer_approval" || qcRework.data.basket?.status !== "customer_approval") {
      throw new Error(`Expected source basket to move into customer_approval, got ${qcRework.data.basket?.station}/${qcRework.data.basket?.status}`);
    }
    if (qcRework.data.order?.status !== "customer_approval") {
      throw new Error(`Expected order status customer_approval after QC rework request, got ${qcRework.data.order?.status}`);
    }

    const blockedQcPass = await apiRequest(baseUrl, "/api/scan", {
      method: "POST",
      token: managerToken,
      body: { station: "qc", qrCode: rejectedQr }
    });
    if (blockedQcPass.status !== 409) {
      throw new Error(`QC pass must be blocked while approval is pending, got ${blockedQcPass.status}`);
    }
    if (!String(blockedQcPass.data?.message || "").toLowerCase().includes("доработ")) {
      throw new Error(`Expected QC blocked message to mention rework case, got ${blockedQcPass.data?.message}`);
    }

    const approveRequest = await apiRequest(baseUrl, `/api/rework-requests/${requestId}/approve`, {
      method: "POST",
      token: managerToken,
      body: {}
    });
    if (approveRequest.status !== 200 || !approveRequest.data.ok) {
      throw new Error(`Approve request failed: ${approveRequest.status}`);
    }
    if (approveRequest.data.request?.request_status !== "approved_waiting_transfer") {
      throw new Error(`Expected request status approved_waiting_transfer, got ${approveRequest.data.request?.request_status}`);
    }
    if (approveRequest.data.request?.rework_basket_qr_code) {
      throw new Error("Rework basket QR must not exist before QC transfer confirmation");
    }

    const updatedSourceBasket = (approveRequest.data.order.baskets || []).find((basket) => basket.qr_code === rejectedQr);
    if (!updatedSourceBasket) throw new Error("Source basket missing after approval");
    if (Number(updatedSourceBasket.item_counts?.top || 0) !== 2) {
      throw new Error(`Expected source basket top count to stay at 2 before transfer, got ${updatedSourceBasket.item_counts?.top}`);
    }
    if (updatedSourceBasket.station !== "customer_approval" || updatedSourceBasket.status !== "customer_approval") {
      throw new Error(`Expected source basket to remain in customer_approval before transfer, got ${updatedSourceBasket.station}/${updatedSourceBasket.status}`);
    }

    const transferTasks = await apiRequest(baseUrl, "/api/qc/transfer-tasks", { token: managerToken });
    if (transferTasks.status !== 200 || !Array.isArray(transferTasks.data.tasks) || !transferTasks.data.tasks.length) {
      throw new Error("Expected QC transfer tasks after manager approval");
    }
    const transferTask = transferTasks.data.tasks.find((task) => Number(task.id) === Number(requestId));
    if (!transferTask) throw new Error(`Transfer task for request ${requestId} not found`);

    const confirmTransfer = await apiRequest(baseUrl, `/api/qc/transfer-tasks/${requestId}/confirm`, {
      method: "POST",
      token: managerToken,
      body: {
        sourceQrCode: transferTask.source_basket_qr_code,
        targetQrCode: transferTask.planned_rework_basket_qr_code || transferTask.rework_basket_qr_code
      }
    });
    if (confirmTransfer.status !== 200 || !confirmTransfer.data.ok) {
      throw new Error(`Confirm transfer failed: ${confirmTransfer.status}`);
    }
    const reworkQr = confirmTransfer.data.task?.rework_basket_qr_code
      || confirmTransfer.data.order?.rework_requests?.find((row) => Number(row.id) === Number(requestId))?.rework_basket_qr_code;
    if (!reworkQr) throw new Error("Expected rework basket QR after transfer confirmation");

    const transferedSourceBasket = (confirmTransfer.data.order.baskets || []).find((basket) => basket.qr_code === rejectedQr);
    if (!transferedSourceBasket) throw new Error("Source basket missing after transfer confirmation");
    if (Number(transferedSourceBasket.item_counts?.top || 0) !== 1) {
      throw new Error(`Expected source basket top count to shrink to 1 after transfer, got ${transferedSourceBasket.item_counts?.top}`);
    }
    if (transferedSourceBasket.station !== "qc" || transferedSourceBasket.status !== "qc") {
      throw new Error(`Expected source basket to return to qc after transfer, got ${transferedSourceBasket.station}/${transferedSourceBasket.status}`);
    }

    const sourceQcPass = await apiRequest(baseUrl, "/api/scan", {
      method: "POST",
      token: managerToken,
      body: { station: "qc", qrCode: rejectedQr }
    });
    if (sourceQcPass.status !== 200 || !sourceQcPass.data.ok) {
      throw new Error(`QC pass failed for source basket after approval: ${sourceQcPass.status}`);
    }

    for (const qrCode of qrCodes.slice(1)) {
      const dryingScan = await apiRequest(baseUrl, "/api/scan", {
        method: "POST",
        token: managerToken,
        body: { station: "drying", qrCode }
      });
      if (dryingScan.status !== 200 || !dryingScan.data.ok) {
        throw new Error(`Scan failed at drying for ${qrCode}: ${dryingScan.status}`);
      }

      const qcScan = await apiRequest(baseUrl, "/api/scan", {
        method: "POST",
        token: managerToken,
        body: { station: "qc", qrCode }
      });
      if (qcScan.status !== 200 || !qcScan.data.ok) {
        throw new Error(`Scan failed at qc for ${qrCode}: ${qcScan.status}`);
      }
    }

    const reworkScan = await apiRequest(baseUrl, "/api/scan", {
      method: "POST",
      token: managerToken,
      body: { station: "rework", qrCode: reworkQr }
    });
    if (reworkScan.status !== 200 || !reworkScan.data.ok) {
      throw new Error(`Scan failed at rework for ${reworkQr}: ${reworkScan.status}`);
    }

    const qcRescan = await apiRequest(baseUrl, "/api/scan", {
      method: "POST",
      token: managerToken,
      body: { station: "qc", qrCode: reworkQr }
    });
    if (qcRescan.status !== 200 || !qcRescan.data.ok) {
      throw new Error(`Rescan failed at qc for ${reworkQr}: ${qcRescan.status}`);
    }

    const activeQrCodes = [rejectedQr, ...qrCodes.slice(1), reworkQr];
    for (const station of ["ironing"]) {
      for (const qrCode of activeQrCodes) {
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

    for (const qrCode of activeQrCodes) {
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
    const readyToPlaceOrder = (pickupWorkbench.data.readyToPlaceOrders || []).find((order) => order.id === orderId);
    if (!readyToPlaceOrder) throw new Error("Order missing in ready-to-place workbench list");
    if (readyToPlaceOrder.ready_for_pickup) throw new Error("Order should not be ready_for_pickup before placement");

    const placeOrder = await apiRequest(baseUrl, "/api/pickup/place-order", {
      method: "POST",
      token: managerToken,
      body: {
        orderId,
        containerCount: 1,
        placements: [
          { binQr: "QR:BIN-049", locationQr: "QR:LOC-A01" }
        ]
      }
    });
    if (placeOrder.status !== 200 || !placeOrder.data.ok) {
      throw new Error(`Pickup placement failed: ${placeOrder.status}`);
    }

    const placedWorkbench = await apiRequest(baseUrl, "/api/pickup/workbench", { token: managerToken });
    const placedOrder = (placedWorkbench.data.placedOrders || []).find((order) => order.id === orderId);
    if (!placedOrder) throw new Error("Order missing in placed workbench list after placement");
    if (!placedOrder.ready_for_pickup) throw new Error("Order should be ready_for_pickup after placement");

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

    const blockedPickupRescan = await apiRequest(baseUrl, "/api/scan", {
      method: "POST",
      token: managerToken,
      body: { station: "pickup", qrCode: activeQrCodes[0] }
    });
    if (blockedPickupRescan.status !== 409 && blockedPickupRescan.status !== 404) {
      throw new Error(`Pickup rescan after handover confirmation must be blocked (409/404), got ${blockedPickupRescan.status}`);
    }
  });

  await run("Pickup allows pre-scan when only part of order reached pickup", async () => {
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
      body: {
        orderId: targetOrderId,
        baskets: [
          { type: "White", itemCounts: { top: 1, bottom: 0, underwear: 0, socksPairs: 0 } },
          { type: "Color", itemCounts: { top: 1, bottom: 0, underwear: 0, socksPairs: 0 } }
        ]
      }
    });
    if (create.status !== 200 || !create.data.ok) throw new Error("Create baskets failed");
    const basketA = create.data.order?.baskets?.[0]?.qr_code;
    const basketB = create.data.order?.baskets?.[1]?.qr_code;
    if (!basketA || !basketB) throw new Error("Expected two basket QR codes");

    for (const station of ["washing", "drying", "qc", "ironing"]) {
      const scan = await apiRequest(baseUrl, "/api/scan", {
        method: "POST",
        token: managerToken,
        body: { station, qrCode: basketA }
      });
      if (scan.status !== 200 || !scan.data.ok) {
        throw new Error(`Failed to move basketA via ${station}: ${scan.status}`);
      }
    }

    const prePickupScan = await apiRequest(baseUrl, "/api/scan", {
      method: "POST",
      token: managerToken,
      body: { station: "pickup", qrCode: basketA }
    });
    if (prePickupScan.status !== 200 || !prePickupScan.data.ok) {
      throw new Error(`Expected pre-pickup scan success, got ${prePickupScan.status}`);
    }
    if (!String(prePickupScan.data.message || "").toLowerCase().includes("сборк")) {
      throw new Error(`Expected pre-pickup message to mention assembly progress, got ${prePickupScan.data.message}`);
    }

    const pickupWorkbench = await apiRequest(baseUrl, "/api/pickup/workbench", { token: managerToken });
    const inReadyToPlace = (pickupWorkbench.data.readyToPlaceOrders || []).some((order) => Number(order.id) === Number(targetOrderId));
    if (inReadyToPlace) {
      throw new Error("Partially delivered order must not appear in ready-to-place list");
    }
    const inAssembly = (pickupWorkbench.data.assemblyOrders || []).some((order) => Number(order.id) === Number(targetOrderId));
    if (!inAssembly) {
      throw new Error("Partially delivered order must appear in assembly list");
    }

    const complete = await apiRequest(baseUrl, "/api/pickup/complete", {
      method: "POST",
      token: managerToken,
      body: { orderId: targetOrderId }
    });
    if (complete.status !== 400) {
      throw new Error(`Expected pickup complete to be blocked for partial order, got ${complete.status}`);
    }
  });

  await run("Client decline creates QC return task and requires confirmation", async () => {
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
      body: {
        orderId: targetOrderId,
        baskets: [
          { type: "White", itemCounts: { top: 2, bottom: 0, underwear: 0, socksPairs: 0 } }
        ]
      }
    });
    if (create.status !== 200 || !create.data.ok) throw new Error("Create baskets failed");
    const sourceQrCode = create.data.order?.baskets?.[0]?.qr_code;
    if (!sourceQrCode) throw new Error("Missing source basket qr_code");

    const wash = await apiRequest(baseUrl, "/api/scan", {
      method: "POST",
      token: managerToken,
      body: { station: "washing", qrCode: sourceQrCode }
    });
    if (wash.status !== 200 || !wash.data.ok) throw new Error("Washing scan failed");

    const dry = await apiRequest(baseUrl, "/api/scan", {
      method: "POST",
      token: managerToken,
      body: { station: "drying", qrCode: sourceQrCode }
    });
    if (dry.status !== 200 || !dry.data.ok) throw new Error("Drying scan failed");

    const qcRework = await apiRequest(baseUrl, "/api/qc/rework", {
      method: "POST",
      token: managerToken,
      body: {
        qrCode: sourceQrCode,
        reason: "hand_wash",
        itemCategory: "top",
        itemLabel: "White shirt",
        quantity: 1,
        qcPhotoDataUrl: tinyPngDataUrl
      }
    });
    if (qcRework.status !== 200 || !qcRework.data.ok) throw new Error("QC rework request failed");
    const requestId = qcRework.data.request?.id;
    if (!requestId) throw new Error("Expected request id");

    const decline = await apiRequest(baseUrl, `/api/rework-requests/${requestId}/decline`, {
      method: "POST",
      token: managerToken,
      body: {}
    });
    if (decline.status !== 200 || !decline.data.ok) throw new Error(`Decline request failed: ${decline.status}`);
    if (decline.data.request?.request_status !== "declined_waiting_return") {
      throw new Error(`Expected declined_waiting_return, got ${decline.data.request?.request_status}`);
    }

    const blockedQcPass = await apiRequest(baseUrl, "/api/scan", {
      method: "POST",
      token: managerToken,
      body: { station: "qc", qrCode: sourceQrCode }
    });
    if (blockedQcPass.status !== 409) {
      throw new Error(`QC pass must be blocked before return confirmation, got ${blockedQcPass.status}`);
    }

    const tasks = await apiRequest(baseUrl, "/api/qc/transfer-tasks", { token: managerToken });
    if (tasks.status !== 200 || !Array.isArray(tasks.data.tasks) || !tasks.data.tasks.length) {
      throw new Error("Expected QC tasks after decline");
    }
    const returnTask = tasks.data.tasks.find((task) => Number(task.id) === Number(requestId));
    if (!returnTask) throw new Error(`Return task not found for request ${requestId}`);
    if (returnTask.task_kind !== "return_to_flow") {
      throw new Error(`Expected task_kind return_to_flow, got ${returnTask.task_kind}`);
    }

    const confirm = await apiRequest(baseUrl, `/api/qc/transfer-tasks/${requestId}/confirm`, {
      method: "POST",
      token: managerToken,
      body: {}
    });
    if (confirm.status !== 200 || !confirm.data.ok) {
      throw new Error(`Confirm return task failed: ${confirm.status}`);
    }
    const requestAfterConfirm = (confirm.data.order?.rework_requests || []).find((row) => Number(row.id) === Number(requestId));
    if (!requestAfterConfirm || requestAfterConfirm.request_status !== "declined") {
      throw new Error(`Expected request status declined after confirmation, got ${requestAfterConfirm?.request_status}`);
    }

    const qcPass = await apiRequest(baseUrl, "/api/scan", {
      method: "POST",
      token: managerToken,
      body: { station: "qc", qrCode: sourceQrCode }
    });
    if (qcPass.status !== 200 || !qcPass.data.ok) {
      throw new Error(`QC pass must succeed after return confirmation, got ${qcPass.status}`);
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

    const dryingScan = await apiRequest(baseUrl, "/api/scan", {
      method: "POST",
      token: managerToken,
      body: { station: "drying", qrCode }
    });
    if (dryingScan.status !== 200 || !dryingScan.data.ok) {
      throw new Error(`Scan failed at drying for ${qrCode}: ${dryingScan.status}`);
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

    const dry = await apiRequest(baseUrl, "/api/scan", {
      method: "POST",
      token: managerToken,
      body: { station: "drying", qrCode }
    });
    if (dry.status !== 200 || !dry.data.ok) throw new Error("Drying scan failed");

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
      headers: cleanCloudWebhookHeaders,
      body: payload
    });
    if (first.status !== 200 || !first.data.ok) throw new Error("First webhook call failed");
    if (first.data.duplicate) throw new Error("First webhook call marked as duplicate");

    const second = await apiRequest(baseUrl, "/api/cleancloud/webhook", {
      method: "POST",
      headers: cleanCloudWebhookHeaders,
      body: payload
    });
    if (second.status !== 200 || !second.data.ok || !second.data.duplicate) {
      throw new Error("Second webhook call must be marked duplicate");
    }
  });

  await run("Webhook pickup status is ignored when local order is not ready for pickup", async () => {
    const reset = await apiRequest(baseUrl, "/api/demo/reset", {
      method: "POST",
      token: managerToken,
      body: {}
    });
    if (reset.status !== 200 || !reset.data.ok) throw new Error("Reset failed");

    const payload = { event_id: "demo-webhook-pickup-not-ready", orderID: "CC-2601", status: "1" };
    const webhook = await apiRequest(baseUrl, "/api/cleancloud/webhook", {
      method: "POST",
      headers: cleanCloudWebhookHeaders,
      body: payload
    });
    if (webhook.status !== 200 || !webhook.data.ok) throw new Error("Webhook call failed");
    if (webhook.data.duplicate) throw new Error("Webhook must not be marked duplicate on first call");
    if (webhook.data.status !== "ignored") {
      throw new Error(`Expected ignored webhook status for not-ready pickup, got ${webhook.data.status}`);
    }

    const sortingOrders = await apiRequest(baseUrl, "/api/orders?station=sorting", { token: managerToken });
    const targetOrder = (sortingOrders.data.orders || []).find((order) => order.cleancloud_order_id === "CC-2601");
    if (!targetOrder) throw new Error("Target sorting order CC-2601 not found after reset");

    const details = await apiRequest(baseUrl, `/api/orders/${targetOrder.id}`, { token: managerToken });
    if (details.status !== 200) throw new Error(`Expected 200 for order details, got ${details.status}`);
    if (details.data.status === "pickup" || details.data.ready_for_pickup === true) {
      throw new Error("Order must stay outside pickup after ignored webhook");
    }

    const pickupWorkbench = await apiRequest(baseUrl, "/api/pickup/workbench", { token: managerToken });
    const leakedToPickup = (pickupWorkbench.data.orders || []).some((order) => order.cleancloud_order_id === "CC-2601");
    if (leakedToPickup) {
      throw new Error("Order with ignored webhook pickup status must not appear in pickup workbench");
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

  const unexpectedServerStderr = getUnexpectedServerStderr(serverLogs.stderr);
  if (unexpectedServerStderr) {
    const stderrPreview = unexpectedServerStderr.trim().split("\n").slice(-3).join(" | ");
    printCase("Server stderr check", false, stderrPreview);
    results.push({ name: "Server stderr check", passed: false, details: stderrPreview });
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
    env: {
      ...process.env,
      PORT: String(localPort),
      GREENLAB_PORT: String(localPort),
      GREENLAB_DATA_DIR: testDataDir,
      GREENLAB_DB_PATH: testDbPath,
      GREENLAB_BASKET_UPLOADS_DIR: testUploadsDir,
      GREENLAB_DEMO_RESET_ON_BOOT: "1",
      GREENLAB_SYNC_POLL_INTERVAL_MS: "0",
      GREENLAB_REQUIRE_WEBHOOK_TOKEN: "1",
      CLEAN_CLOUD_WEBHOOK_TOKEN: cleanCloudWebhookToken,
      NODE_ENV: "test"
    },
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
    fs.rmSync(tempRootDir, { recursive: true, force: true });
  }
}

main();
