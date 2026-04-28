const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { DatabaseSync } = require("node:sqlite");
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

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA busy_timeout = 3000;
  PRAGMA foreign_keys = ON;
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
    ready_to_place INTEGER NOT NULL DEFAULT 0,
    ready_for_pickup INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS baskets (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL,
    basket_code TEXT NOT NULL UNIQUE,
    basket_type TEXT NOT NULL,
    basket_items_json TEXT,
    basket_kind TEXT NOT NULL DEFAULT 'main',
    parent_basket_id INTEGER,
    rework_reason TEXT,
    rework_attempt INTEGER NOT NULL DEFAULT 0,
    station TEXT NOT NULL,
    status TEXT NOT NULL,
    qr_code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(order_id) REFERENCES orders(id),
    FOREIGN KEY(parent_basket_id) REFERENCES baskets(id)
  );

  CREATE TABLE IF NOT EXISTS basket_catalog (
    id INTEGER PRIMARY KEY,
    label TEXT NOT NULL UNIQUE,
    qr_code TEXT NOT NULL UNIQUE,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pickup_locations (
    id INTEGER PRIMARY KEY,
    label TEXT NOT NULL UNIQUE,
    qr_code TEXT NOT NULL UNIQUE,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pickup_order_placements (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL,
    slot_index INTEGER NOT NULL,
    bin_qr_code TEXT NOT NULL,
    location_qr_code TEXT NOT NULL,
    placed_by TEXT NOT NULL,
    placed_at TEXT NOT NULL,
    released_by TEXT,
    released_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS laundry_machines (
    id INTEGER PRIMARY KEY,
    machine_code TEXT NOT NULL UNIQUE,
    station TEXT NOT NULL,
    machine_type TEXT NOT NULL,
    display_name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS machine_loads (
    id INTEGER PRIMARY KEY,
    machine_id INTEGER NOT NULL,
    station TEXT NOT NULL,
    status TEXT NOT NULL,
    started_by TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_by TEXT,
    completed_at TEXT,
    cancelled_by TEXT,
    cancelled_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(machine_id) REFERENCES laundry_machines(id)
  );

  CREATE TABLE IF NOT EXISTS machine_load_baskets (
    id INTEGER PRIMARY KEY,
    load_id INTEGER NOT NULL,
    basket_id INTEGER NOT NULL,
    order_id INTEGER NOT NULL,
    added_at TEXT NOT NULL,
    unloaded_at TEXT,
    unloaded_by TEXT,
    UNIQUE(load_id, basket_id),
    FOREIGN KEY(load_id) REFERENCES machine_loads(id),
    FOREIGN KEY(basket_id) REFERENCES baskets(id),
    FOREIGN KEY(order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS rework_requests (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL,
    source_basket_id INTEGER NOT NULL,
    rework_basket_id INTEGER,
    item_category TEXT NOT NULL,
    item_label TEXT,
    quantity INTEGER NOT NULL DEFAULT 1,
    source_image_id INTEGER,
    source_image_url TEXT,
    source_image_note TEXT,
    qc_photo_path TEXT,
    qc_photo_url TEXT,
    reason_code TEXT NOT NULL,
    service_label TEXT NOT NULL,
    extra_days INTEGER NOT NULL DEFAULT 1,
    request_status TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    decision_actor TEXT,
    decision_at TEXT,
    decision_note TEXT,
    handoff_confirmed_by TEXT,
    handoff_confirmed_at TEXT,
    handoff_note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(order_id) REFERENCES orders(id),
    FOREIGN KEY(source_basket_id) REFERENCES baskets(id),
    FOREIGN KEY(rework_basket_id) REFERENCES baskets(id)
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

  CREATE TABLE IF NOT EXISTS basket_images (
    id INTEGER PRIMARY KEY,
    basket_id INTEGER NOT NULL,
    image_role TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    file_path TEXT NOT NULL,
    public_url TEXT NOT NULL,
    created_at TEXT NOT NULL,
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

  CREATE TABLE IF NOT EXISTS idempotency_records (
    id INTEGER PRIMARY KEY,
    idem_key TEXT NOT NULL,
    route_key TEXT NOT NULL,
    actor TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    UNIQUE(idem_key, route_key, actor)
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
const { getOrderDetails, getOverview, listStationOrders, getQcLiveMetrics } = createOrderQueryService(db, {
  stationLabels,
  holdStation: HOLD_STATION
});
const { getPickupScanProgress, getPickupWorkbenchSnapshot } = createPickupWorkbenchService(db, {
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
} = createSecurityEventService(db, { nowIso });

seedDemoData({ force: DEMO_RESET_ON_BOOT });

function getStationLabel(station) {
  if (station === HOLD_STATION) return HOLD_STATION_LABEL;
  if (station === CUSTOMER_APPROVAL_STATION) return CUSTOMER_APPROVAL_STATION_LABEL;
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
  if (!hasColumn("orders", "ready_to_place")) {
    db.exec("ALTER TABLE orders ADD COLUMN ready_to_place INTEGER NOT NULL DEFAULT 0;");
  }
  if (!hasColumn("baskets", "basket_items_json")) {
    db.exec("ALTER TABLE baskets ADD COLUMN basket_items_json TEXT;");
  }
  if (!hasColumn("baskets", "basket_kind")) {
    db.exec("ALTER TABLE baskets ADD COLUMN basket_kind TEXT NOT NULL DEFAULT 'main';");
  }
  if (!hasColumn("baskets", "parent_basket_id")) {
    db.exec("ALTER TABLE baskets ADD COLUMN parent_basket_id INTEGER;");
  }
  if (!hasColumn("baskets", "rework_reason")) {
    db.exec("ALTER TABLE baskets ADD COLUMN rework_reason TEXT;");
  }
  if (!hasColumn("baskets", "rework_attempt")) {
    db.exec("ALTER TABLE baskets ADD COLUMN rework_attempt INTEGER NOT NULL DEFAULT 0;");
  }
  if (!hasColumn("baskets", "label_printed_at")) {
    db.exec("ALTER TABLE baskets ADD COLUMN label_printed_at TEXT;");
  }
  if (!hasColumn("baskets", "label_print_count")) {
    db.exec("ALTER TABLE baskets ADD COLUMN label_print_count INTEGER NOT NULL DEFAULT 0;");
  }
  if (!hasColumn("rework_requests", "rework_basket_id")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN rework_basket_id INTEGER;");
  }
  if (!hasColumn("rework_requests", "item_category")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN item_category TEXT NOT NULL DEFAULT 'top';");
  }
  if (!hasColumn("rework_requests", "item_label")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN item_label TEXT;");
  }
  if (!hasColumn("rework_requests", "quantity")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1;");
  }
  if (!hasColumn("rework_requests", "source_image_id")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN source_image_id INTEGER;");
  }
  if (!hasColumn("rework_requests", "source_image_url")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN source_image_url TEXT;");
  }
  if (!hasColumn("rework_requests", "source_image_note")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN source_image_note TEXT;");
  }
  if (!hasColumn("rework_requests", "qc_photo_path")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN qc_photo_path TEXT;");
  }
  if (!hasColumn("rework_requests", "qc_photo_url")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN qc_photo_url TEXT;");
  }
  if (!hasColumn("rework_requests", "reason_code")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN reason_code TEXT NOT NULL DEFAULT 'stain_not_removed';");
  }
  if (!hasColumn("rework_requests", "service_label")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN service_label TEXT NOT NULL DEFAULT 'Stain removal';");
  }
  if (!hasColumn("rework_requests", "extra_days")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN extra_days INTEGER NOT NULL DEFAULT 1;");
  }
  if (!hasColumn("rework_requests", "request_status")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN request_status TEXT NOT NULL DEFAULT 'pending_customer_approval';");
  }
  if (!hasColumn("rework_requests", "requested_by")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN requested_by TEXT NOT NULL DEFAULT 'system';");
  }
  if (!hasColumn("rework_requests", "requested_at")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;");
  }
  if (!hasColumn("rework_requests", "decision_actor")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN decision_actor TEXT;");
  }
  if (!hasColumn("rework_requests", "decision_at")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN decision_at TEXT;");
  }
  if (!hasColumn("rework_requests", "decision_note")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN decision_note TEXT;");
  }
  if (!hasColumn("rework_requests", "handoff_confirmed_by")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN handoff_confirmed_by TEXT;");
  }
  if (!hasColumn("rework_requests", "handoff_confirmed_at")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN handoff_confirmed_at TEXT;");
  }
  if (!hasColumn("rework_requests", "handoff_note")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN handoff_note TEXT;");
  }
  if (!hasColumn("rework_requests", "created_at")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;");
  }
  if (!hasColumn("rework_requests", "updated_at")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;");
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
  if (!hasColumn("machine_load_baskets", "unloaded_at")) {
    db.exec("ALTER TABLE machine_load_baskets ADD COLUMN unloaded_at TEXT;");
  }
  if (!hasColumn("machine_load_baskets", "unloaded_by")) {
    db.exec("ALTER TABLE machine_load_baskets ADD COLUMN unloaded_by TEXT;");
  }

  db.exec(`
    UPDATE orders
    SET ready_to_place = 0
    WHERE ready_to_place IS NULL;

    UPDATE baskets
    SET basket_kind = 'main'
    WHERE basket_kind IS NULL OR TRIM(basket_kind) = '';

    UPDATE baskets
    SET rework_attempt = 0
    WHERE rework_attempt IS NULL;
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_status_ready
      ON orders (status, ready_for_pickup);

    CREATE INDEX IF NOT EXISTS idx_orders_status_ready_to_place
      ON orders (status, ready_to_place, ready_for_pickup);

    CREATE INDEX IF NOT EXISTS idx_baskets_order_station_status
      ON baskets (order_id, station, status);

    CREATE INDEX IF NOT EXISTS idx_baskets_station_status
      ON baskets (station, status);

    CREATE INDEX IF NOT EXISTS idx_machine_loads_machine_status_created
      ON machine_loads (machine_id, status, created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_machine_loads_status_station
      ON machine_loads (status, station);

    CREATE INDEX IF NOT EXISTS idx_machine_load_baskets_load_unloaded
      ON machine_load_baskets (load_id, unloaded_at);

    CREATE INDEX IF NOT EXISTS idx_machine_load_baskets_basket_unloaded
      ON machine_load_baskets (basket_id, unloaded_at);

    CREATE INDEX IF NOT EXISTS idx_scan_events_order_station_created
      ON scan_events (order_id, station, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_scan_events_station_created
      ON scan_events (station, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_rework_requests_order_status
      ON rework_requests (order_id, request_status);

    CREATE INDEX IF NOT EXISTS idx_rework_requests_source_status
      ON rework_requests (source_basket_id, request_status);

    CREATE INDEX IF NOT EXISTS idx_sync_queue_status_created
      ON sync_queue (status, created_at);

    CREATE INDEX IF NOT EXISTS idx_idempotency_records_expires
      ON idempotency_records (expires_at);

    CREATE INDEX IF NOT EXISTS idx_pickup_locations_active
      ON pickup_locations (is_active, label);

    CREATE INDEX IF NOT EXISTS idx_pickup_order_placements_order_active
      ON pickup_order_placements (order_id, slot_index)
      WHERE released_at IS NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_pickup_order_placements_active_bin
      ON pickup_order_placements (bin_qr_code)
      WHERE released_at IS NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_pickup_order_placements_active_location
      ON pickup_order_placements (location_qr_code)
      WHERE released_at IS NULL;
  `);
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
      updateAllowed.run(JSON.stringify(allowedStations), row.id);
    }
  }

  const qcUserExists = db.prepare("SELECT id FROM users WHERE username = ?").get("qc");
  if (!qcUserExists) {
    db.prepare(`
      INSERT INTO users (username, password, password_hash, display_name, role, allowed_stations)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("qc", REDACTED_PASSWORD_VALUE, hashPassword("demo123"), "Quality control operator", "qc_operator", JSON.stringify(["qc", "overview"]));
  }

  const reworkUserExists = db.prepare("SELECT id FROM users WHERE username = ?").get("rework");
  if (!reworkUserExists) {
    db.prepare(`
      INSERT INTO users (username, password, password_hash, display_name, role, allowed_stations)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("rework", REDACTED_PASSWORD_VALUE, hashPassword("demo123"), "Rework operator", "rework_operator", JSON.stringify(["rework", "overview"]));
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

  const upsertMachine = db.prepare(`
    INSERT INTO laundry_machines (
      machine_code, station, machine_type, display_name, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(machine_code) DO UPDATE SET
      station = excluded.station,
      machine_type = excluded.machine_type,
      display_name = excluded.display_name,
      is_active = 1,
      updated_at = excluded.updated_at
  `);

  for (const machine of defaultMachines) {
    upsertMachine.run(
      machine.code,
      machine.station,
      machine.type,
      machine.displayName,
      timestamp,
      timestamp
    );
  }
}

function ensureDefaultBasketCatalog() {
  const timestamp = nowIso();
  const upsertBasket = db.prepare(`
    INSERT INTO basket_catalog (
      label, qr_code, is_active, created_at, updated_at
    ) VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(label) DO UPDATE SET
      qr_code = excluded.qr_code,
      is_active = 1,
      updated_at = excluded.updated_at
  `);
  const catalogEntries = createDefaultBasketCatalogEntries(50);
  for (const entry of catalogEntries) {
    upsertBasket.run(entry.label, entry.qrCode, timestamp, timestamp);
  }
}

function ensureDefaultPickupLocations() {
  const timestamp = nowIso();
  const upsertLocation = db.prepare(`
    INSERT INTO pickup_locations (
      label, qr_code, is_active, created_at, updated_at
    ) VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(label) DO UPDATE SET
      qr_code = excluded.qr_code,
      is_active = 1,
      updated_at = excluded.updated_at
  `);

  const locationEntries = createDefaultPickupLocationEntries(40);
  for (const entry of locationEntries) {
    upsertLocation.run(entry.label, entry.qrCode, timestamp, timestamp);
  }
}

function seedDemoData(options = {}) {
  const force = Boolean(options.force);

  if (!force) {
    const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
    if (userCount > 0) {
      normalizeLegacyData();
      ensureCurrentUsers();
      ensureDefaultMachines();
      ensureDefaultBasketCatalog();
      ensureDefaultPickupLocations();
      ensurePasswordHashes(db);
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

  const insertUser = db.prepare(`
    INSERT INTO users (username, password, password_hash, display_name, role, allowed_stations)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  try {
    db.exec("BEGIN IMMEDIATE;");

    if (force) {
      db.exec(`
        DELETE FROM webhook_events;
        DELETE FROM sync_queue;
        DELETE FROM scan_events;
        DELETE FROM pickup_order_placements;
        DELETE FROM pickup_locations;
        DELETE FROM basket_images;
        DELETE FROM machine_load_baskets;
        DELETE FROM machine_loads;
        DELETE FROM laundry_machines;
        DELETE FROM rework_requests;
        DELETE FROM baskets;
        DELETE FROM orders;
        DELETE FROM users;
      `);

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
      insertUser.run(username, REDACTED_PASSWORD_VALUE, hashPassword(password), displayName, role, JSON.stringify(allowedStations));
    }

    ensureDefaultMachines();
    ensureDefaultBasketCatalog();
    ensureDefaultPickupLocations();

    const timestamp = nowIso();
    const insertOrder = db.prepare(`
      INSERT INTO orders (
        public_id, cleancloud_order_id, customer_name, customer_id, order_weight, customer_phone, customer_email, service_tier, status,
        cleancloud_status, ready_for_pickup, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertOrder.run("GL-2601", "CC-2601", "Dian Saputra", null, 4.4, "+62 812 2601", null, "Premium", "sorting", "sorting", 0, timestamp, timestamp);
    insertOrder.run("GL-2602", "CC-2602", "Lina Mahendra", null, 3.0, "+62 812 2602", null, "Express", "sorting", "sorting", 0, timestamp, timestamp);

    db.exec("COMMIT;");
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // ignore rollback failure
    }
    throw error;
  }

  ensurePasswordHashes(db);
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

  db.prepare(`
    DELETE FROM idempotency_records
    WHERE expires_at <= ?
  `).run(nowStamp);

  const cached = db.prepare(`
    SELECT status_code, response_json
    FROM idempotency_records
    WHERE idem_key = ?
      AND route_key = ?
      AND actor = ?
      AND expires_at > ?
    LIMIT 1
  `).get(key, routeKey, actor, nowStamp);

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

  db.prepare(`
    INSERT INTO idempotency_records (
      idem_key, route_key, actor, status_code, response_json, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(idem_key, route_key, actor) DO UPDATE SET
      status_code = excluded.status_code,
      response_json = excluded.response_json,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at
  `).run(key, routeKey, actor, statusCode, responseJson, nowStamp, expiresAt);

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
  logSecurityEvent,
  trustProxy: TRUST_PROXY
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

