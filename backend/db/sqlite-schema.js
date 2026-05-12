const SQLITE_BOOTSTRAP_SQL = `  PRAGMA busy_timeout = 3000;
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

  CREATE TABLE IF NOT EXISTS ironing_sessions (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL,
    basket_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    started_by TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_by TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(order_id) REFERENCES orders(id),
    FOREIGN KEY(basket_id) REFERENCES baskets(id)
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
  );`;

function applySqliteBootstrapSchema(db) {
  db.exec(SQLITE_BOOTSTRAP_SQL);
}

function hasColumn(db, tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

function ensureSqliteSchema(db) {
  if (!hasColumn(db, "orders", "customer_id")) {
    db.exec("ALTER TABLE orders ADD COLUMN customer_id TEXT;");
  }
  if (!hasColumn(db, "orders", "order_weight")) {
    db.exec("ALTER TABLE orders ADD COLUMN order_weight REAL;");
  }
  if (!hasColumn(db, "orders", "customer_phone")) {
    db.exec("ALTER TABLE orders ADD COLUMN customer_phone TEXT;");
  }
  if (!hasColumn(db, "orders", "customer_email")) {
    db.exec("ALTER TABLE orders ADD COLUMN customer_email TEXT;");
  }
  if (!hasColumn(db, "orders", "ready_to_place")) {
    db.exec("ALTER TABLE orders ADD COLUMN ready_to_place INTEGER NOT NULL DEFAULT 0;");
  }
  if (!hasColumn(db, "baskets", "basket_items_json")) {
    db.exec("ALTER TABLE baskets ADD COLUMN basket_items_json TEXT;");
  }
  if (!hasColumn(db, "baskets", "basket_kind")) {
    db.exec("ALTER TABLE baskets ADD COLUMN basket_kind TEXT NOT NULL DEFAULT 'main';");
  }
  if (!hasColumn(db, "baskets", "parent_basket_id")) {
    db.exec("ALTER TABLE baskets ADD COLUMN parent_basket_id INTEGER;");
  }
  if (!hasColumn(db, "baskets", "rework_reason")) {
    db.exec("ALTER TABLE baskets ADD COLUMN rework_reason TEXT;");
  }
  if (!hasColumn(db, "baskets", "rework_attempt")) {
    db.exec("ALTER TABLE baskets ADD COLUMN rework_attempt INTEGER NOT NULL DEFAULT 0;");
  }
  if (!hasColumn(db, "baskets", "label_printed_at")) {
    db.exec("ALTER TABLE baskets ADD COLUMN label_printed_at TEXT;");
  }
  if (!hasColumn(db, "baskets", "label_print_count")) {
    db.exec("ALTER TABLE baskets ADD COLUMN label_print_count INTEGER NOT NULL DEFAULT 0;");
  }
  if (!hasColumn(db, "rework_requests", "rework_basket_id")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN rework_basket_id INTEGER;");
  }
  if (!hasColumn(db, "rework_requests", "item_category")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN item_category TEXT NOT NULL DEFAULT 'top';");
  }
  if (!hasColumn(db, "rework_requests", "item_label")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN item_label TEXT;");
  }
  if (!hasColumn(db, "rework_requests", "quantity")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1;");
  }
  if (!hasColumn(db, "rework_requests", "source_image_id")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN source_image_id INTEGER;");
  }
  if (!hasColumn(db, "rework_requests", "source_image_url")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN source_image_url TEXT;");
  }
  if (!hasColumn(db, "rework_requests", "source_image_note")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN source_image_note TEXT;");
  }
  if (!hasColumn(db, "rework_requests", "qc_photo_path")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN qc_photo_path TEXT;");
  }
  if (!hasColumn(db, "rework_requests", "qc_photo_url")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN qc_photo_url TEXT;");
  }
  if (!hasColumn(db, "rework_requests", "reason_code")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN reason_code TEXT NOT NULL DEFAULT 'stain_not_removed';");
  }
  if (!hasColumn(db, "rework_requests", "service_label")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN service_label TEXT NOT NULL DEFAULT 'Stain removal';");
  }
  if (!hasColumn(db, "rework_requests", "extra_days")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN extra_days INTEGER NOT NULL DEFAULT 1;");
  }
  if (!hasColumn(db, "rework_requests", "request_status")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN request_status TEXT NOT NULL DEFAULT 'pending_customer_approval';");
  }
  if (!hasColumn(db, "rework_requests", "requested_by")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN requested_by TEXT NOT NULL DEFAULT 'system';");
  }
  if (!hasColumn(db, "rework_requests", "requested_at")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;");
  }
  if (!hasColumn(db, "rework_requests", "decision_actor")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN decision_actor TEXT;");
  }
  if (!hasColumn(db, "rework_requests", "decision_at")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN decision_at TEXT;");
  }
  if (!hasColumn(db, "rework_requests", "decision_note")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN decision_note TEXT;");
  }
  if (!hasColumn(db, "rework_requests", "handoff_confirmed_by")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN handoff_confirmed_by TEXT;");
  }
  if (!hasColumn(db, "rework_requests", "handoff_confirmed_at")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN handoff_confirmed_at TEXT;");
  }
  if (!hasColumn(db, "rework_requests", "handoff_note")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN handoff_note TEXT;");
  }
  if (!hasColumn(db, "rework_requests", "created_at")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;");
  }
  if (!hasColumn(db, "rework_requests", "updated_at")) {
    db.exec("ALTER TABLE rework_requests ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;");
  }
  if (!hasColumn(db, "sync_queue", "attempts")) {
    db.exec("ALTER TABLE sync_queue ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;");
  }
  if (!hasColumn(db, "sync_queue", "last_error")) {
    db.exec("ALTER TABLE sync_queue ADD COLUMN last_error TEXT;");
  }
  if (!hasColumn(db, "users", "password_hash")) {
    db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT;");
  }
  if (!hasColumn(db, "machine_load_baskets", "unloaded_at")) {
    db.exec("ALTER TABLE machine_load_baskets ADD COLUMN unloaded_at TEXT;");
  }
  if (!hasColumn(db, "machine_load_baskets", "unloaded_by")) {
    db.exec("ALTER TABLE machine_load_baskets ADD COLUMN unloaded_by TEXT;");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS ironing_sessions (
      id INTEGER PRIMARY KEY,
      order_id INTEGER NOT NULL,
      basket_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_by TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_by TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id),
      FOREIGN KEY(basket_id) REFERENCES baskets(id)
    );
  `);

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
    DROP INDEX IF EXISTS idx_pickup_order_placements_active_location;

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

    CREATE INDEX IF NOT EXISTS idx_ironing_sessions_status_started
      ON ironing_sessions (status, started_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_ironing_sessions_basket_status
      ON ironing_sessions (basket_id, status);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_ironing_sessions_active_basket
      ON ironing_sessions (basket_id)
      WHERE status = 'active';

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

    DROP INDEX IF EXISTS idx_pickup_order_placements_active_bin;

    CREATE INDEX IF NOT EXISTS idx_pickup_order_placements_active_location
      ON pickup_order_placements (location_qr_code)
      WHERE released_at IS NULL;
  `);
}


module.exports = {
  SQLITE_BOOTSTRAP_SQL,
  applySqliteBootstrapSchema,
  ensureSqliteSchema
};
