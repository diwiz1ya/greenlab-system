function createSqliteDemoSeedRepository(db) {
  const listUsersAllowedStationsStmt = db.prepare("SELECT id, username, allowed_stations FROM users");
  const updateAllowedStationsStmt = db.prepare("UPDATE users SET allowed_stations = ? WHERE id = ?");
  const findUserByUsernameStmt = db.prepare("SELECT id FROM users WHERE username = ?");
  const insertUserStmt = db.prepare(`
    INSERT INTO users (username, password, password_hash, display_name, role, allowed_stations)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const countUsersStmt = db.prepare("SELECT COUNT(*) AS count FROM users");
  const upsertMachineStmt = db.prepare(`
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
  const upsertBasketCatalogStmt = db.prepare(`
    INSERT INTO basket_catalog (
      label, qr_code, is_active, created_at, updated_at
    ) VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(label) DO UPDATE SET
      qr_code = excluded.qr_code,
      is_active = 1,
      updated_at = excluded.updated_at
  `);
  const upsertPickupLocationStmt = db.prepare(`
    INSERT INTO pickup_locations (
      label, qr_code, is_active, created_at, updated_at
    ) VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(label) DO UPDATE SET
      qr_code = excluded.qr_code,
      is_active = 1,
      updated_at = excluded.updated_at
  `);
  const insertOrderStmt = db.prepare(`
    INSERT INTO orders (
      public_id, cleancloud_order_id, customer_name, customer_id, order_weight, customer_phone, customer_email, service_tier, status,
      cleancloud_status, ready_for_pickup, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

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

  function listUsersAllowedStations() {
    return listUsersAllowedStationsStmt.all();
  }

  function updateAllowedStations(userId, allowedStationsJson) {
    return updateAllowedStationsStmt.run(allowedStationsJson, userId);
  }

  function userExists(username) {
    return Boolean(findUserByUsernameStmt.get(username));
  }

  function insertUser({ username, password, passwordHash, displayName, role, allowedStationsJson }) {
    return insertUserStmt.run(username, password, passwordHash, displayName, role, allowedStationsJson);
  }

  function countUsers() {
    return countUsersStmt.get().count;
  }

  function upsertMachine({ code, station, type, displayName, timestamp }) {
    return upsertMachineStmt.run(code, station, type, displayName, timestamp, timestamp);
  }

  function upsertBasketCatalogEntry({ label, qrCode, timestamp }) {
    return upsertBasketCatalogStmt.run(label, qrCode, timestamp, timestamp);
  }

  function upsertPickupLocation({ label, qrCode, timestamp }) {
    return upsertPickupLocationStmt.run(label, qrCode, timestamp, timestamp);
  }

  function clearDemoData() {
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
  }

  function insertOrder(order) {
    return insertOrderStmt.run(
      order.publicId,
      order.cleanCloudOrderId,
      order.customerName,
      order.customerId,
      order.orderWeight,
      order.customerPhone,
      order.customerEmail,
      order.serviceTier,
      order.status,
      order.cleanCloudStatus,
      order.readyForPickup,
      order.timestamp,
      order.timestamp
    );
  }

  return {
    normalizeLegacyData,
    listUsersAllowedStations,
    updateAllowedStations,
    userExists,
    insertUser,
    countUsers,
    upsertMachine,
    upsertBasketCatalogEntry,
    upsertPickupLocation,
    clearDemoData,
    insertOrder
  };
}

module.exports = {
  createSqliteDemoSeedRepository
};
