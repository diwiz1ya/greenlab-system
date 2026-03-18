const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { DatabaseSync } = require("node:sqlite");
const { createSessionStore } = require("./backend/auth/session-store");
const { hasManagerRole, hasStationAccess, canAccessOrderDetails } = require("./backend/auth/access-checks");
const { REDACTED_PASSWORD_VALUE, hashPassword, verifyHashedPassword, ensurePasswordHashes } = require("./backend/auth/password-hash");
const { createScanExportService } = require("./backend/scans/export");
const { createPickupWorkbenchService } = require("./backend/pickup/workbench");
const { createCleanCloudService } = require("./backend/cleancloud/service");
const { createOrderQueryService } = require("./backend/orders/queries");
const { createWorkflowService } = require("./backend/workflow/service");
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

const PORT = process.env.GREENLAB_PORT || process.env.PORT || 3010;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "greenlab-demo.sqlite");
const CLEAN_CLOUD_API_BASE = process.env.CLEAN_CLOUD_API_BASE || "https://cleancloudapp.com/api";
const CLEAN_CLOUD_API_TOKEN = process.env.CLEAN_CLOUD_API_TOKEN || process.env.CLEANCLOUD_API_TOKEN || "";
const CLEAN_CLOUD_WEBHOOK_TOKEN = process.env.CLEAN_CLOUD_WEBHOOK_TOKEN || "";
const CLEAN_CLOUD_SYNC_RETRY_LIMIT = Number(process.env.CLEAN_CLOUD_SYNC_RETRY_LIMIT || 5);

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    password_hash TEXT,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL,
    allowed_stations TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    cleancloud_order_id TEXT NOT NULL UNIQUE,
    customer_name TEXT NOT NULL,
    customer_id TEXT,
    order_weight REAL,
    customer_phone TEXT,
    customer_email TEXT,
    service_tier TEXT NOT NULL,
    status TEXT NOT NULL,
    cleancloud_status TEXT NOT NULL,
    ready_for_pickup INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS baskets (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL,
    basket_code TEXT NOT NULL UNIQUE,
    basket_type TEXT NOT NULL,
    station TEXT NOT NULL,
    status TEXT NOT NULL,
    qr_code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS scan_events (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL,
    basket_id INTEGER,
    station TEXT NOT NULL,
    actor TEXT NOT NULL,
    result TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(order_id) REFERENCES orders(id),
    FOREIGN KEY(basket_id) REFERENCES baskets(id)
  );

  CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    processed_at TEXT,
    FOREIGN KEY(order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS webhook_events (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    event_key TEXT NOT NULL UNIQUE,
    payload TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT NOT NULL,
    received_at TEXT NOT NULL,
    processed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY,
    category TEXT NOT NULL,
    actor TEXT NOT NULL,
    ip TEXT NOT NULL,
    path TEXT NOT NULL,
    method TEXT NOT NULL,
    status INTEGER NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

ensureSchema();

const sessionStore = createSessionStore();
const { getScanExportRows, getRecentScansByStation, scanRowsToCsv } = createScanExportService(db);

const stationLabels = {
  overview: "Обзор",
  sorting: "Сортировка",
  washing: "Стирка",
  qc: "Контроль качества (QC)",
  drying: "Сушка",
  ironing: "Глажка",
  pickup: "Выдача"
};

const productionFlow = ["washing", "qc", "drying", "ironing", "pickup"];
const flowIndex = Object.fromEntries(productionFlow.map((station, index) => [station, index]));
const PICKUP_SCAN_OK_MESSAGE = "Корзина подтверждена для выдачи.";
const HOLD_STATION = "hold";
const HOLD_STATION_LABEL = "HOLD (решение менеджера)";
const HOLD_CLOUD_STATUS = "HOLD: повреждение, решение менеджера";
const qcIssueLabels = {
  stain: "Пятна",
  damage: "Повреждение"
};
const { getOrderDetails, getOverview, listStationOrders } = createOrderQueryService(db, {
  stationLabels,
  holdStation: HOLD_STATION
});
const { getPickupScanProgress, listPickupWorkbenchOrders } = createPickupWorkbenchService(db, {
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
  scanBasket,
  inspectQcBasket,
  rejectBasketFromQc,
  releaseOrderFromHold,
  completePickup
} = createWorkflowService({
  db,
  nowIso,
  getOrderDetails,
  getStationLabel,
  queueSync,
  getPickupScanProgress,
  productionFlow,
  flowIndex,
  holdStation: HOLD_STATION,
  holdCloudStatus: HOLD_CLOUD_STATUS,
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
} = createSecurityEventService(db, { nowIso });

seedDemoData();

function getStationLabel(station) {
  if (station === HOLD_STATION) return HOLD_STATION_LABEL;
  return stationLabels[station] || station;
}

function nowIso() {
  return new Date().toISOString();
}

function hasColumn(tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

function ensureSchema() {
  if (!hasColumn("orders", "customer_id")) {
    db.exec("ALTER TABLE orders ADD COLUMN customer_id TEXT;");
  }
  if (!hasColumn("orders", "order_weight")) {
    db.exec("ALTER TABLE orders ADD COLUMN order_weight REAL;");
  }
  if (!hasColumn("orders", "customer_phone")) {
    db.exec("ALTER TABLE orders ADD COLUMN customer_phone TEXT;");
  }
  if (!hasColumn("orders", "customer_email")) {
    db.exec("ALTER TABLE orders ADD COLUMN customer_email TEXT;");
  }
  if (!hasColumn("sync_queue", "attempts")) {
    db.exec("ALTER TABLE sync_queue ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;");
  }
  if (!hasColumn("sync_queue", "last_error")) {
    db.exec("ALTER TABLE sync_queue ADD COLUMN last_error TEXT;");
  }
  if (!hasColumn("users", "password_hash")) {
    db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT;");
  }
}

function normalizeLegacyData() {
  db.exec(`
    UPDATE orders SET status = 'qc' WHERE status = 'washing_qc';
    UPDATE baskets SET station = 'qc' WHERE station = 'washing_qc';
    UPDATE baskets SET status = 'qc' WHERE status = 'washing_qc';
    UPDATE users
    SET allowed_stations = REPLACE(allowed_stations, '"washing_qc"', '"qc"')
    WHERE allowed_stations LIKE '%washing_qc%';
  `);
}

function ensureCurrentUsers() {
  const rows = db.prepare("SELECT id, username, allowed_stations FROM users").all();
  const updateAllowed = db.prepare("UPDATE users SET allowed_stations = ? WHERE id = ?");

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

    if (row.username === "manager" && !allowedStations.includes("qc")) {
      const washingIndex = allowedStations.indexOf("washing");
      if (washingIndex >= 0) {
        allowedStations.splice(washingIndex + 1, 0, "qc");
      } else {
        allowedStations.push("qc");
      }
      changed = true;
    }

    if (row.username === "qc") {
      const expected = ["qc", "overview"];
      if (JSON.stringify(allowedStations) !== JSON.stringify(expected)) {
        allowedStations = expected;
        changed = true;
      }
    }

    if (changed) {
      updateAllowed.run(JSON.stringify(allowedStations), row.id);
    }
  }

  const qcUserExists = db.prepare("SELECT id FROM users WHERE username = ?").get("qc");
  if (!qcUserExists) {
    db.prepare(`
      INSERT INTO users (username, password, password_hash, display_name, role, allowed_stations)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("qc", REDACTED_PASSWORD_VALUE, hashPassword("demo123"), "Оператор контроля качества", "qc_operator", JSON.stringify(["qc", "overview"]));
  }
}

function seedDemoData(options = {}) {
  const force = Boolean(options.force);

  if (force) {
    db.exec(`
      DELETE FROM webhook_events;
      DELETE FROM sync_queue;
      DELETE FROM scan_events;
      DELETE FROM baskets;
      DELETE FROM orders;
      DELETE FROM users;
    `);
  } else {
    const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
    if (userCount > 0) {
      normalizeLegacyData();
      ensureCurrentUsers();
      ensurePasswordHashes(db);
      return false;
    }
  }

  const users = [
    ["sorting", "demo123", "Оператор сортировки", "sorting_operator", ["sorting", "overview"]],
    ["washing", "demo123", "Оператор стирки", "washing_operator", ["washing", "overview"]],
    ["qc", "demo123", "Оператор контроля качества", "qc_operator", ["qc", "overview"]],
    ["drying", "demo123", "Оператор сушки", "drying_operator", ["drying", "overview"]],
    ["ironing", "demo123", "Оператор глажки", "ironing_operator", ["ironing", "overview"]],
    ["pickup", "demo123", "Оператор выдачи", "pickup_operator", ["pickup", "overview"]],
    ["manager", "demo123", "Менеджер филиала", "manager", ["overview", "sorting", "washing", "qc", "drying", "ironing", "pickup"]]
  ];

  const insertUser = db.prepare(`
    INSERT INTO users (username, password, password_hash, display_name, role, allowed_stations)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const [username, password, displayName, role, allowedStations] of users) {
    insertUser.run(username, REDACTED_PASSWORD_VALUE, hashPassword(password), displayName, role, JSON.stringify(allowedStations));
  }

  const timestamp = nowIso();
  const insertOrder = db.prepare(`
    INSERT INTO orders (
      public_id, cleancloud_order_id, customer_name, customer_id, order_weight, customer_phone, customer_email, service_tier, status,
      cleancloud_status, ready_for_pickup, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertOrder.run("GL-2401", "CC-10001", "Ayu Prasetyo", null, 3.2, "+62 812 0001", null, "Daya", "sorting", "Новый заказ", 0, timestamp, timestamp);
  insertOrder.run("GL-2402", "CC-10002", "Mateo Silva", null, 5.1, "+62 812 0002", null, "Vanish", "washing", "В работе", 0, timestamp, timestamp);
  insertOrder.run("GL-2403", "CC-10003", "Nina Kurnia", null, 2.8, "+62 812 0003", null, "Eco", "qc", "В работе", 0, timestamp, timestamp);
  insertOrder.run("GL-2404", "CC-10004", "Raka Wijaya", null, 4.0, "+62 812 0004", null, "Стандарт", "pickup", "Готов к выдаче", 1, timestamp, timestamp);

  const orderMap = new Map(
    db.prepare("SELECT id, public_id FROM orders").all().map((row) => [row.public_id, row.id])
  );

  const insertBasket = db.prepare(`
    INSERT INTO baskets (
      order_id, basket_code, basket_type, station, status, qr_code, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertBasket.run(orderMap.get("GL-2402"), "B-2402-1", "Белое", "washing", "washing", "QR:B-2402-1", timestamp, timestamp);
  insertBasket.run(orderMap.get("GL-2402"), "B-2402-2", "Цветное", "washing", "washing", "QR:B-2402-2", timestamp, timestamp);
  insertBasket.run(orderMap.get("GL-2403"), "B-2403-1", "Ручная стирка", "qc", "qc", "QR:B-2403-1", timestamp, timestamp);
  insertBasket.run(orderMap.get("GL-2404"), "B-2404-1", "Белое", "pickup", "pickup", "QR:B-2404-1", timestamp, timestamp);

  const pickupBasketId = db.prepare("SELECT id FROM baskets WHERE basket_code = ?").get("B-2404-1").id;
  db.prepare(`
    INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
    VALUES (?, ?, 'pickup', 'system', 'ok', 'Корзина готова к выдаче.', ?)
  `).run(orderMap.get("GL-2404"), pickupBasketId, timestamp);

  ensurePasswordHashes(db);
  return true;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1000000) {
        reject(new Error("Слишком большой запрос"));
      }
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Некорректный JSON"));
      }
    });
    req.on("error", reject);
  });
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
    ".css": "text/css; charset=utf-8"
  };

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      res.writeHead(404);
      res.end("Не найдено");
      return;
    }
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(contents);
  });
}

function auth(req) {
  return sessionStore.getFromRequest(req);
}

function requireAuth(req, res) {
  const session = auth(req);
  if (!session) {
    json(res, 401, { error: "Требуется авторизация" });
    return null;
  }
  return session;
}

function requireManager(session, res) {
  if (!hasManagerRole(session)) {
    json(res, 403, { error: "Нужна роль менеджера" });
    return false;
  }
  return true;
}

function requireStationAccess(session, station, res) {
  if (!hasStationAccess(session, station)) {
    json(res, 403, { error: "Нет доступа к станции", station, label: stationLabels[station] || station });
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

setInterval(() => {
  processSyncQueue().catch((error) => {
    console.error("Sync queue processing failed:", error);
  });
}, 3000).unref();

function getSyncQueueSummary() {
  const rows = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM sync_queue
    GROUP BY status
  `).all();

  return {
    pending: rows.find((row) => row.status === "pending")?.count || 0,
    processing: rows.find((row) => row.status === "processing")?.count || 0,
    processed: rows.find((row) => row.status === "processed")?.count || 0,
    failed: rows.find((row) => row.status === "failed")?.count || 0
  };
}

const authRoutesContext = {
  db,
  readJson,
  json,
  requireAuth,
  auth,
  verifyHashedPassword,
  sessionStore,
  loginRateLimiter,
  logSecurityEvent
};

const coreRoutesContext = {
  db,
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
  cleanCloudApiToken: CLEAN_CLOUD_API_TOKEN
};

const workflowRoutesContext = {
  readJson,
  json,
  requireAuth,
  requireManager,
  requireStationAccess,
  stationLabels,
  listPickupWorkbenchOrders,
  createBaskets,
  scanBasket,
  rejectBasketFromQc,
  inspectQcBasket,
  completePickup,
  releaseOrderFromHold
};

const orderRoutesContext = {
  requireAuth,
  requireStationAccess,
  json,
  stationLabels,
  getOrderDetails,
  canAccessOrderDetails,
  listStationOrders
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
      db.prepare("SELECT 1 AS ok").get();
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
      json(res, 404, { error: "Не найдено" });
    }
    return;
  }

  let filePath = path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Доступ запрещён");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, "index.html");
  }

  serveFile(res, filePath);
});

server.listen(PORT, () => {
  console.log(`Green Lab demo MVP запущен на http://127.0.0.1:${PORT}`);
});

