const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { openDatabase } = require("./backend/db");
const { runImmediateTransaction } = require("./backend/db/transaction");
const { createRepositories } = require("./backend/db/repositories");
const Busboy = require("busboy");
const { createSessionStore } = require("./backend/auth/session-store");
const { hasManagerRole, hasStationAccess, canAccessOrderDetails } = require("./backend/auth/access-checks");
const { REDACTED_PASSWORD_VALUE, hashPassword, verifyHashedPassword, ensurePasswordHashes } = require("./backend/auth/password-hash");
const { createScanExportService } = require("./backend/scans/export");
const { createPickupWorkbenchService } = require("./backend/pickup/workbench");
const { createDefaultPickupLocationEntries } = require("./backend/pickup/locations");
const { createCleanCloudService } = require("./backend/cleancloud/service");
const { createOrderQueryService } = require("./backend/orders/queries");
const { createWorkflowService } = require("./backend/workflow/service");
const { createDefaultBasketCatalogEntries } = require("./backend/workflow/basket-pool");
const { handleCleanCloudSyncRoutes } = require("./backend/routes/cleancloud-sync-routes");
const { handleWorkflowRoutes } = require("./backend/routes/workflow-routes");
const { handleAuthRoutes } = require("./backend/routes/auth-routes");
const { handleCoreRoutes } = require("./backend/routes/core-routes");
const { handleOrderRoutes } = require("./backend/routes/order-routes");
const { handleSecurityRoutes } = require("./backend/routes/security-routes");
const { createSecurityEventService } = require("./backend/security/events");
const { createSlidingWindowRateLimiter } = require("./backend/security/rate-limit");

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadDotEnv(path.join(__dirname, ".env"));

function parseBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseNonNegativeIntEnv(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.trunc(parsed);
}

function resolveRuntimePath(value, fallbackPath) {
  const raw = String(value || "").trim();
  return raw ? path.resolve(__dirname, raw) : fallbackPath;
}

const PORT = process.env.GREENLAB_PORT || process.env.PORT || 3010;
const NODE_ENV = String(process.env.NODE_ENV || "development").trim().toLowerCase();
const PUBLIC_DIR = path.join(__dirname, "public");
const DEFAULT_DATA_DIR = path.join(__dirname, "data");
const DATA_DIR = resolveRuntimePath(process.env.GREENLAB_DATA_DIR, DEFAULT_DATA_DIR);
const DB_PATH = resolveRuntimePath(process.env.GREENLAB_DB_PATH, path.join(DATA_DIR, "greenlab-demo.sqlite"));
const BASKET_UPLOADS_DIR = resolveRuntimePath(
  process.env.GREENLAB_BASKET_UPLOADS_DIR,
  path.join(PUBLIC_DIR, "uploads", "baskets")
);
const DEMO_RESET_ON_BOOT = parseBooleanEnv(process.env.GREENLAB_DEMO_RESET_ON_BOOT, false);
const SYNC_POLL_INTERVAL_MS = parseNonNegativeIntEnv(process.env.GREENLAB_SYNC_POLL_INTERVAL_MS, 3000);
const TRUST_PROXY = parseBooleanEnv(process.env.GREENLAB_TRUST_PROXY, false);
const CLEAN_CLOUD_API_BASE = process.env.CLEAN_CLOUD_API_BASE || "https://cleancloudapp.com/api";
const CLEAN_CLOUD_API_TOKEN = process.env.CLEAN_CLOUD_API_TOKEN || process.env.CLEANCLOUD_API_TOKEN || "";
const CLEAN_CLOUD_WEBHOOK_TOKEN = process.env.CLEAN_CLOUD_WEBHOOK_TOKEN || "";
const REQUIRE_CLEAN_CLOUD_WEBHOOK_TOKEN = parseBooleanEnv(
  process.env.GREENLAB_REQUIRE_WEBHOOK_TOKEN,
  NODE_ENV === "production"
);
const CLEAN_CLOUD_SYNC_RETRY_LIMIT = Number(process.env.CLEAN_CLOUD_SYNC_RETRY_LIMIT || 5);
const MAX_JSON_BODY_BYTES = Math.max(
  512 * 1024,
  parseNonNegativeIntEnv(process.env.GREENLAB_MAX_JSON_BODY_BYTES, 10 * 1024 * 1024)
);
const MAX_MULTIPART_BODY_BYTES = Math.max(
  5 * 1024 * 1024,
  parseNonNegativeIntEnv(process.env.GREENLAB_MAX_MULTIPART_BODY_BYTES, 25 * 1024 * 1024)
);
const MAX_MULTIPART_FILE_BYTES = Math.max(
  1024 * 1024,
  parseNonNegativeIntEnv(process.env.GREENLAB_MAX_MULTIPART_FILE_BYTES, 8 * 1024 * 1024)
);
const MAX_MULTIPART_FILES = Math.max(
  1,
  parseNonNegativeIntEnv(process.env.GREENLAB_MAX_MULTIPART_FILES, 40)
);
const MAX_MULTIPART_FIELDS = Math.max(
  1,
  parseNonNegativeIntEnv(process.env.GREENLAB_MAX_MULTIPART_FIELDS, 30)
);
const MAX_MULTIPART_FIELD_BYTES = Math.max(
  1024,
  parseNonNegativeIntEnv(process.env.GREENLAB_MAX_MULTIPART_FIELD_BYTES, 1024 * 1024)
);
const IDEMPOTENCY_TTL_HOURS = Math.max(
  1,
  parseNonNegativeIntEnv(process.env.GREENLAB_IDEMPOTENCY_TTL_HOURS, 24)
);

if (REQUIRE_CLEAN_CLOUD_WEBHOOK_TOKEN && !CLEAN_CLOUD_WEBHOOK_TOKEN) {
  throw new Error("CLEAN_CLOUD_WEBHOOK_TOKEN is required when webhook token protection is enabled.");
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(BASKET_UPLOADS_DIR, { recursive: true });

const { db, client: DB_CLIENT } = openDatabase({
  client: process.env.GREENLAB_DB_CLIENT,
  sqlitePath: DB_PATH,
  databaseUrl: process.env.GREENLAB_DATABASE_URL
});
const {
  coreRepository,
  demoSeedRepository,
  idempotencyRepository,
  orderQueryRepository,
  pickupWorkbenchRepository,
  scanRepository,
  securityEventRepository,
  systemRepository,
  userRepository
} = createRepositories({ client: DB_CLIENT, db });

const sessionStore = createSessionStore();
const { getScanExportRows, getRecentScansByStation, scanRowsToCsv } = createScanExportService(scanRepository);

const stationLabels = {
  overview: "Overview",
  sorting: "Sorting",
  washing: "Washing",
  drying: "Drying",
  qc: "Quality Control (QC)",
  rework: "Rework",
  ironing: "Ironing",
  pickup: "Pickup"
};

const productionFlow = ["washing", "drying", "qc", "ironing", "pickup"];
const flowIndex = Object.fromEntries(productionFlow.map((station, index) => [station, index]));
const PICKUP_SCAN_OK_MESSAGE = "Basket confirmed for pickup.";
const HOLD_STATION = "hold";
const HOLD_STATION_LABEL = "HOLD (manager decision)";
const HOLD_CLOUD_STATUS = "HOLD: damage, manager decision";
const CUSTOMER_APPROVAL_STATION = "customer_approval";
const CUSTOMER_APPROVAL_STATION_LABEL = "Customer approval";
const CUSTOMER_APPROVAL_CLOUD_STATUS = "Awaiting customer approval";
const qcIssueLabels = {
  stain: "Stain not removed",
  stain_not_removed: "Stain not removed",
  spot_treatment: "Spot treatment required",
  hand_wash: "Hand wash required",
  extra_treatment: "Extra treatment required",
  damage: "Damage"
};
const { getOrderDetails, getOverview, listStationOrders, getQcLiveMetrics } = createOrderQueryService(orderQueryRepository, {
  stationLabels,
  holdStation: HOLD_STATION
});
const { getPickupScanProgress, getPickupWorkbenchSnapshot } = createPickupWorkbenchService(pickupWorkbenchRepository, {
  pickupScanOkMessage: PICKUP_SCAN_OK_MESSAGE
});
const {
  mapLocalStatusToCleanCloudStatusCode,
  isLikelyNumericOrderId,
  callCleanCloudUpdateOrder,
  enrichOrderContactFromCleanCloud,
  queueSync,
  processSyncQueue,
  retryFailedSyncByOrder,
  listSyncQueueItems,
  listWebhookEvents,
  handleCleanCloudWebhook
} = createCleanCloudService({
  db,
  apiBase: CLEAN_CLOUD_API_BASE,
  apiToken: CLEAN_CLOUD_API_TOKEN,
  syncRetryLimit: CLEAN_CLOUD_SYNC_RETRY_LIMIT,
  nowIso,
  getOrderDetails
});
const {
  createBaskets,
  updateSortedBaskets,
  returnSortedOrderToSorting,
  listMachineWorkbench,
  validateMachineLoadBasket,
  startMachineLoad,
  unloadBasketFromMachineLoad,
  cancelMachineLoad,
  scanBasket,
  inspectQcBasket,
  rejectBasketFromQc,
  createReworkRequestFromQc,
  approveReworkRequest,
  declineReworkRequest,
  listPendingQcTransferTasks,
  confirmQcTransferTask,
  releaseOrderFromHold,
  completePickup,
  placeOrderForPickup
} = createWorkflowService({
  db,
  nowIso,
  basketUploadsDir: BASKET_UPLOADS_DIR,
  getOrderDetails,
  getStationLabel,
  queueSync,
  getPickupScanProgress,
  productionFlow,
  flowIndex,
  holdStation: HOLD_STATION,
  holdCloudStatus: HOLD_CLOUD_STATUS,
  awaitingApprovalStation: CUSTOMER_APPROVAL_STATION,
  awaitingApprovalCloudStatus: CUSTOMER_APPROVAL_CLOUD_STATUS,
  pickupScanOkMessage: PICKUP_SCAN_OK_MESSAGE,
  qcIssueLabels
});
const loginRateLimiter = createSlidingWindowRateLimiter({
  max: 10,
  windowMs: 60000
});
const {
  logSecurityEvent,
  listSecurityEvents
} = createSecurityEventService(securityEventRepository, { nowIso });

seedDemoData({ force: DEMO_RESET_ON_BOOT });

function getStationLabel(station) {
  if (station === HOLD_STATION) return HOLD_STATION_LABEL;
  if (station === CUSTOMER_APPROVAL_STATION) return CUSTOMER_APPROVAL_STATION_LABEL;
  return stationLabels[station] || station;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeLegacyData() {
  demoSeedRepository.normalizeLegacyData();
}

function ensureCurrentUsers() {
  const rows = demoSeedRepository.listUsersAllowedStations();

  for (const row of rows) {
    let allowedStations = [];
    try {
      allowedStations = JSON.parse(row.allowed_stations);
      if (!Array.isArray(allowedStations)) {
        allowedStations = [];
      }
    } catch {
      allowedStations = [];
    }

    let changed = false;

    if (row.username === "manager") {
      const expectedManagerStations = ["overview", "sorting", "washing", "drying", "qc", "rework", "ironing", "pickup"];
      if (JSON.stringify(allowedStations) !== JSON.stringify(expectedManagerStations)) {
        allowedStations = expectedManagerStations;
        changed = true;
      }
    }

    if (row.username === "qc") {
      const expected = ["qc", "overview"];
      if (JSON.stringify(allowedStations) !== JSON.stringify(expected)) {
        allowedStations = expected;
        changed = true;
      }
    }

    if (row.username === "rework") {
      const expected = ["rework", "overview"];
      if (JSON.stringify(allowedStations) !== JSON.stringify(expected)) {
        allowedStations = expected;
        changed = true;
      }
    }

    if (changed) {
      demoSeedRepository.updateAllowedStations(row.id, JSON.stringify(allowedStations));
    }
  }

  if (!demoSeedRepository.userExists("qc")) {
    demoSeedRepository.insertUser({
      username: "qc",
      password: REDACTED_PASSWORD_VALUE,
      passwordHash: hashPassword("demo123"),
      displayName: "Quality control operator",
      role: "qc_operator",
      allowedStationsJson: JSON.stringify(["qc", "overview"])
    });
  }

  if (!demoSeedRepository.userExists("rework")) {
    demoSeedRepository.insertUser({
      username: "rework",
      password: REDACTED_PASSWORD_VALUE,
      passwordHash: hashPassword("demo123"),
      displayName: "Rework operator",
      role: "rework_operator",
      allowedStationsJson: JSON.stringify(["rework", "overview"])
    });
  }
}

function ensureDefaultMachines() {
  const timestamp = nowIso();
  const defaultMachines = [];
  for (let index = 1; index <= 6; index += 1) {
    const suffix = String(index).padStart(2, "0");
    defaultMachines.push({
      code: `W${suffix}`,
      station: "washing",
      type: "washer",
      displayName: `Washer ${suffix}`
    });
    defaultMachines.push({
      code: `D${suffix}`,
      station: "drying",
      type: "dryer",
      displayName: `Dryer ${suffix}`
    });
  }

  for (const machine of defaultMachines) {
    demoSeedRepository.upsertMachine({ ...machine, timestamp });
  }
}

function ensureDefaultBasketCatalog() {
  const timestamp = nowIso();
  const catalogEntries = createDefaultBasketCatalogEntries(50);
  for (const entry of catalogEntries) {
    demoSeedRepository.upsertBasketCatalogEntry({ ...entry, timestamp });
  }
}

function ensureDefaultPickupLocations() {
  const timestamp = nowIso();
  const locationEntries = createDefaultPickupLocationEntries(40);
  for (const entry of locationEntries) {
    demoSeedRepository.upsertPickupLocation({ ...entry, timestamp });
  }
}

function seedDemoData(options = {}) {
  const force = Boolean(options.force);

  if (!force) {
    const userCount = demoSeedRepository.countUsers();
    if (userCount > 0) {
      normalizeLegacyData();
      ensureCurrentUsers();
      ensureDefaultMachines();
      ensureDefaultBasketCatalog();
      ensureDefaultPickupLocations();
      ensurePasswordHashes(userRepository);
      return false;
    }
  }

  const users = [
    ["sorting", "demo123", "Sorting operator", "sorting_operator", ["sorting", "overview"]],
    ["washing", "demo123", "Washing operator", "washing_operator", ["washing", "overview"]],
    ["qc", "demo123", "Quality control operator", "qc_operator", ["qc", "overview"]],
    ["rework", "demo123", "Rework operator", "rework_operator", ["rework", "overview"]],
    ["drying", "demo123", "Drying operator", "drying_operator", ["drying", "overview"]],
    ["ironing", "demo123", "Ironing operator", "ironing_operator", ["ironing", "overview"]],
    ["pickup", "demo123", "Pickup operator", "pickup_operator", ["pickup", "overview"]],
    ["manager", "demo123", "Branch manager", "manager", ["overview", "sorting", "washing", "drying", "qc", "rework", "ironing", "pickup"]]
  ];

  runImmediateTransaction(db, () => {
    if (force) {
      demoSeedRepository.clearDemoData();

      for (const entry of fs.readdirSync(BASKET_UPLOADS_DIR)) {
        const absolutePath = path.join(BASKET_UPLOADS_DIR, entry);
        try {
          if (fs.statSync(absolutePath).isFile()) {
            fs.unlinkSync(absolutePath);
          }
        } catch {
          // ignore demo reset cleanup failures
        }
      }
    }

    for (const [username, password, displayName, role, allowedStations] of users) {
      demoSeedRepository.insertUser({
        username,
        password: REDACTED_PASSWORD_VALUE,
        passwordHash: hashPassword(password),
        displayName,
        role,
        allowedStationsJson: JSON.stringify(allowedStations)
      });
    }

    ensureDefaultMachines();
    ensureDefaultBasketCatalog();
    ensureDefaultPickupLocations();

    const timestamp = nowIso();
    demoSeedRepository.insertOrder({
      publicId: "GL-2601",
      cleanCloudOrderId: "CC-2601",
      customerName: "Dian Saputra",
      customerId: null,
      orderWeight: 4.4,
      customerPhone: "+62 812 2601",
      customerEmail: null,
      serviceTier: "Premium",
      status: "sorting",
      cleanCloudStatus: "sorting",
      readyForPickup: 0,
      timestamp
    });
    demoSeedRepository.insertOrder({
      publicId: "GL-2602",
      cleanCloudOrderId: "CC-2602",
      customerName: "Lina Mahendra",
      customerId: null,
      orderWeight: 3.0,
      customerPhone: "+62 812 2602",
      customerEmail: null,
      serviceTier: "Express",
      status: "sorting",
      cleanCloudStatus: "sorting",
      readyForPickup: 0,
      timestamp
    });
  });

  ensurePasswordHashes(userRepository);
  return true;
}

function readJson(req) {
  return readBodyBuffer(req, {
    maxBytes: MAX_JSON_BODY_BYTES,
    tooLargeMessage: "Request payload too large"
  }).then((buffer) => {
    if (!buffer.length) return {};
    const data = buffer.toString("utf8");
    try {
      return JSON.parse(data);
    } catch {
      throw new Error("Invalid JSON");
    }
  });
}

function readBodyBuffer(req, options = {}) {
  const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : MAX_JSON_BODY_BYTES;
  const tooLargeMessage = String(options.tooLargeMessage || "Request payload too large");

  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    const cleanup = () => {
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      req.removeListener("aborted", onAborted);
    };

    const rejectOnce = (error, destroyRequest = false) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (destroyRequest) {
        try {
          req.destroy();
        } catch {
          // ignore request destroy errors
        }
      }
      reject(error);
    };

    const onData = (chunk) => {
      if (settled) return;

      const payloadChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += payloadChunk.length;

      if (totalBytes > maxBytes) {
        rejectOnce(new Error(tooLargeMessage), true);
        return;
      }

      chunks.push(payloadChunk);
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();

      if (!chunks.length) {
        resolve(Buffer.alloc(0));
        return;
      }

      resolve(Buffer.concat(chunks, totalBytes));
    };

    const onError = (error) => rejectOnce(error);
  const onAborted = () => rejectOnce(new Error("Request aborted by client."));

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
  });
}

function readMultipartForm(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const files = [];
    let totalBytes = 0;
    let settled = false;

    const finishWithError = (error) => {
      if (settled) return;
      settled = true;
      try {
        req.unpipe(busboy);
      } catch {
        // ignore unpipe errors
      }
      try {
        req.resume();
      } catch {
        // ignore resume errors
      }
      reject(error);
    };

    const busboy = Busboy({
      headers: req.headers,
      limits: {
        fields: MAX_MULTIPART_FIELDS,
        files: MAX_MULTIPART_FILES,
        fileSize: MAX_MULTIPART_FILE_BYTES,
        parts: MAX_MULTIPART_FIELDS + MAX_MULTIPART_FILES + 10
      }
    });

    busboy.on("field", (name, value) => {
      if (settled) return;
      const fieldName = String(name || "").trim();
      if (!fieldName) return;
      const fieldValue = String(value || "");
      if (Buffer.byteLength(fieldValue, "utf8") > MAX_MULTIPART_FIELD_BYTES) {
          finishWithError(new Error(`Field ${fieldName} is too large.`));
        return;
      }
      fields[fieldName] = fieldValue;
    });

    busboy.on("file", (fieldNameRaw, fileStream, info = {}) => {
      const fieldName = String(fieldNameRaw || "").trim();
      if (!fieldName) {
        fileStream.resume();
        return;
      }

      const chunks = [];
      let size = 0;
      let fileLimited = false;

      fileStream.on("limit", () => {
        fileLimited = true;
      });
      fileStream.on("data", (chunk) => {
        if (settled) return;
        const payloadChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += payloadChunk.length;
        totalBytes += payloadChunk.length;
        if (totalBytes > MAX_MULTIPART_BODY_BYTES) {
          finishWithError(new Error("Multipart request is too large"));
          return;
        }
        chunks.push(payloadChunk);
      });
      fileStream.on("end", () => {
        if (settled) return;
        if (fileLimited) {
          finishWithError(new Error(`File in field ${fieldName} exceeds allowed size.`));
          return;
        }
        files.push({
          fieldName,
          fileName: String(info.filename || "").trim(),
          contentType: String(info.mimeType || "application/octet-stream").trim().toLowerCase(),
          buffer: size > 0 ? Buffer.concat(chunks, size) : Buffer.alloc(0)
        });
      });
      fileStream.on("error", (error) => {
      finishWithError(error instanceof Error ? error : new Error(String(error || "Failed reading multipart file")));
      });
    });

    busboy.on("fieldsLimit", () => {
      finishWithError(new Error("Too many multipart fields."));
    });
    busboy.on("filesLimit", () => {
      finishWithError(new Error("Too many multipart files."));
    });
    busboy.on("partsLimit", () => {
      finishWithError(new Error("Too many multipart parts."));
    });
    busboy.on("error", (error) => {
      finishWithError(error instanceof Error ? error : new Error(String(error || "Invalid multipart request")));
    });
    busboy.on("finish", () => {
      if (settled) return;
      settled = true;
      resolve({ fields, files });
    });

    req.on("aborted", () => {
    finishWithError(new Error("Multipart request aborted by client."));
    });

    try {
      req.pipe(busboy);
    } catch (error) {
    finishWithError(error instanceof Error ? error : new Error("Invalid multipart boundary"));
    }
  });
}

function getRequestIdempotencyKey(req) {
  const header = req.headers["x-idempotency-key"];
  if (Array.isArray(header)) {
    return String(header[0] || "").trim();
  }
  return String(header || "").trim();
}

function addHoursIso(date, hours) {
  const copy = new Date(date.getTime());
  copy.setHours(copy.getHours() + hours);
  return copy.toISOString();
}

async function runIdempotentOperation(req, options = {}) {
  const key = getRequestIdempotencyKey(req);
  const routeKey = String(options.routeKey || "").trim();
  const actor = String(options.actor || "").trim();
  const execute = options.execute;

  if (typeof execute !== "function") {
    throw new Error("Idempotent execute handler is required");
  }
  if (!key || !routeKey || !actor) {
    return execute();
  }
  if (key.length > 200) {
      return { error: "X-Idempotency-Key is too long.", status: 400 };
  }

  const now = new Date();
  const nowStamp = now.toISOString();
  const expiresAt = addHoursIso(now, IDEMPOTENCY_TTL_HOURS);

  idempotencyRepository.purgeExpired(nowStamp);

  const cached = idempotencyRepository.findCachedRecord({
    key,
    routeKey,
    actor,
    nowStamp
  });

  if (cached?.response_json) {
    try {
      return JSON.parse(cached.response_json);
    } catch {
      // fall through to execute and refresh cache
    }
  }

  const result = await execute();
  const statusCode = Number.isInteger(Number(result?.status))
    ? Number(result.status)
    : (result?.error ? 400 : 200);
  const responseJson = JSON.stringify(result || {});

  idempotencyRepository.saveRecord({
    key,
    routeKey,
    actor,
    statusCode,
    responseJson,
    nowStamp,
    expiresAt
  });

  return result;
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".map": "application/json; charset=utf-8"
  };

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      res.writeHead(404);
          res.end("Not found");
      return;
    }
    const headers = {
      "Content-Type": types[ext] || "application/octet-stream"
    };
    if (ext === ".html" || ext === ".js" || ext === ".css" || ext === ".map") {
      headers["Cache-Control"] = "no-store";
    }
    res.writeHead(200, headers);
    res.end(contents);
  });
}

function resolvePublicFilePath(pathname) {
  const rawPathname = String(pathname || "/");
  let decodedPathname = rawPathname;
  try {
    decodedPathname = decodeURIComponent(rawPathname);
  } catch {
    return null;
  }

  const requestPath = decodedPathname === "/" ? "index.html" : decodedPathname.replace(/^[/\\]+/, "");
  const filePath = path.resolve(PUBLIC_DIR, requestPath);
  const relativePath = path.relative(PUBLIC_DIR, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  return filePath;
}

function auth(req) {
  return sessionStore.getFromRequest(req);
}

function requireAuth(req, res) {
  const session = auth(req);
  if (!session) {
    json(res, 401, { error: "Authorization required" });
    return null;
  }
  return session;
}

function requireManager(session, res) {
  if (!hasManagerRole(session)) {
    json(res, 403, { error: "Manager role required" });
    return false;
  }
  return true;
}

function requireStationAccess(session, station, res) {
  if (!hasStationAccess(session, station)) {
    json(res, 403, { error: "No access to this station", station, label: stationLabels[station] || station });
    return false;
  }
  return true;
}

function getStationCard(station, session) {
  return {
    key: station,
    label: stationLabels[station],
    allowed: hasStationAccess(session, station)
  };
}

if (SYNC_POLL_INTERVAL_MS > 0) {
  setInterval(() => {
    processSyncQueue().catch((error) => {
      console.error("Sync queue processing failed:", error);
    });
  }, SYNC_POLL_INTERVAL_MS).unref();
}

function getSyncQueueSummary() {
  const rows = systemRepository.listSyncQueueStatusCounts();

  return {
    pending: rows.find((row) => row.status === "pending")?.count || 0,
    processing: rows.find((row) => row.status === "processing")?.count || 0,
    processed: rows.find((row) => row.status === "processed")?.count || 0,
    failed: rows.find((row) => row.status === "failed")?.count || 0
  };
}

const authRoutesContext = {
  userRepository,
  readJson,
  json,
  requireAuth,
  auth,
  verifyHashedPassword,
  sessionStore,
  loginRateLimiter,
  logSecurityEvent,
  trustProxy: TRUST_PROXY
};

const coreRoutesContext = {
  coreRepository,
  readJson,
  json,
  requireAuth,
  requireManager,
  requireStationAccess,
  stationLabels,
  getStationCard,
  seedDemoData,
  getRecentScansByStation,
  getScanExportRows,
  scanRowsToCsv,
  nowIso,
  getOverview
};

const cleanCloudSyncRoutesContext = {
  readJson,
  json,
  requireAuth,
  requireManager,
  getSyncQueueSummary,
  handleCleanCloudWebhook,
  processSyncQueue,
  retryFailedSyncByOrder,
  listSyncQueueItems,
  listWebhookEvents,
  mapLocalStatusToCleanCloudStatusCode,
  isLikelyNumericOrderId,
  callCleanCloudUpdateOrder,
  enrichOrderContactFromCleanCloud,
  cleanCloudWebhookToken: CLEAN_CLOUD_WEBHOOK_TOKEN,
  cleanCloudApiToken: CLEAN_CLOUD_API_TOKEN,
  cleanCloudWebhookTokenRequired: REQUIRE_CLEAN_CLOUD_WEBHOOK_TOKEN,
  trustProxy: TRUST_PROXY
};

const workflowRoutesContext = {
  readJson,
  readMultipartForm,
  runIdempotentOperation,
  json,
  requireAuth,
  requireManager,
  requireStationAccess,
  stationLabels,
  getPickupWorkbenchSnapshot,
  createBaskets,
  updateSortedBaskets,
  returnSortedOrderToSorting,
  listMachineWorkbench,
  validateMachineLoadBasket,
  startMachineLoad,
  unloadBasketFromMachineLoad,
  cancelMachineLoad,
  scanBasket,
  rejectBasketFromQc,
  createReworkRequestFromQc,
  approveReworkRequest,
  declineReworkRequest,
  listPendingQcTransferTasks,
  confirmQcTransferTask,
  inspectQcBasket,
  completePickup,
  placeOrderForPickup,
  releaseOrderFromHold
};

const orderRoutesContext = {
  requireAuth,
  requireStationAccess,
  json,
  stationLabels,
  getOrderDetails,
  canAccessOrderDetails,
  listStationOrders,
  getQcLiveMetrics
};

const securityRoutesContext = {
  requireAuth,
  requireManager,
  json,
  listSecurityEvents
};

const apiRouteHandlers = [
  (req, res, url) => handleAuthRoutes(req, res, url, authRoutesContext),
  (req, res, url) => handleCoreRoutes(req, res, url, coreRoutesContext),
  (req, res, url) => handleSecurityRoutes(req, res, url, securityRoutesContext),
  (req, res, url) => handleCleanCloudSyncRoutes(req, res, url, cleanCloudSyncRoutesContext),
  (req, res, url) => handleWorkflowRoutes(req, res, url, workflowRoutesContext),
  (req, res, url) => handleOrderRoutes(req, res, url, orderRoutesContext)
];

function routeApi(req, res, url) {
  for (const handler of apiRouteHandlers) {
    if (handler(req, res, url)) {
      return true;
    }
  }

  return false;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && (url.pathname === "/healthz" || url.pathname === "/api/healthz")) {
    let dbOk = true;
    let dbError = null;

    try {
      systemRepository.checkConnection();
    } catch (error) {
      dbOk = false;
      dbError = error instanceof Error ? error.message : String(error);
    }

    const payload = {
      ok: dbOk,
      service: "green-lab-demo-mvp",
      time: nowIso(),
      uptimeSec: Math.floor(process.uptime()),
      db: {
        client: DB_CLIENT,
        ok: dbOk,
        error: dbError
      },
      syncQueue: getSyncQueueSummary()
    };

    json(res, dbOk ? 200 : 503, payload);
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    if (!routeApi(req, res, url)) {
    json(res, 404, { error: "Not found" });
    }
    return;
  }

  let filePath = resolvePublicFilePath(url.pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end("Access denied");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, "index.html");
  }

  serveFile(res, filePath);
});

server.listen(PORT, () => {
console.log(`Green Lab demo MVP is running at http://127.0.0.1:${PORT}`);
});

