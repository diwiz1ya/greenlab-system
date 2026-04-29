function createPostgresDemoSeedRepository(queryable) {
  async function normalizeLegacyData() {
    await queryable.query(`
      UPDATE orders SET status = 'qc' WHERE status = 'washing_qc';
      UPDATE baskets SET station = 'qc' WHERE station = 'washing_qc';
      UPDATE baskets SET status = 'qc' WHERE status = 'washing_qc';
      UPDATE users
      SET allowed_stations = REPLACE(allowed_stations, '"washing_qc"', '"qc"')
      WHERE allowed_stations LIKE '%washing_qc%';
    `);
  }

  async function listUsersAllowedStations() {
    const result = await queryable.query("SELECT id, username, allowed_stations FROM users");
    return result.rows;
  }

  async function updateAllowedStations(userId, allowedStationsJson) {
    const result = await queryable.query(
      "UPDATE users SET allowed_stations = $1 WHERE id = $2",
      [allowedStationsJson, userId]
    );
    return { changes: result.rowCount };
  }

  async function userExists(username) {
    const result = await queryable.query("SELECT id FROM users WHERE username = $1", [username]);
    return Boolean(result.rows[0]);
  }

  async function insertUser({ username, password, passwordHash, displayName, role, allowedStationsJson }) {
    const result = await queryable.query(
      `
        INSERT INTO users (username, password, password_hash, display_name, role, allowed_stations)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [username, password, passwordHash, displayName, role, allowedStationsJson]
    );
    return { changes: result.rowCount };
  }

  async function countUsers() {
    const result = await queryable.query("SELECT COUNT(*)::int AS count FROM users");
    return result.rows[0]?.count || 0;
  }

  async function upsertMachine({ code, station, type, displayName, timestamp }) {
    const result = await queryable.query(
      `
        INSERT INTO laundry_machines (
          machine_code, station, machine_type, display_name, is_active, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 1, $5, $6)
        ON CONFLICT(machine_code) DO UPDATE SET
          station = excluded.station,
          machine_type = excluded.machine_type,
          display_name = excluded.display_name,
          is_active = 1,
          updated_at = excluded.updated_at
      `,
      [code, station, type, displayName, timestamp, timestamp]
    );
    return { changes: result.rowCount };
  }

  async function upsertBasketCatalogEntry({ label, qrCode, timestamp }) {
    const result = await queryable.query(
      `
        INSERT INTO basket_catalog (
          label, qr_code, is_active, created_at, updated_at
        ) VALUES ($1, $2, 1, $3, $4)
        ON CONFLICT(label) DO UPDATE SET
          qr_code = excluded.qr_code,
          is_active = 1,
          updated_at = excluded.updated_at
      `,
      [label, qrCode, timestamp, timestamp]
    );
    return { changes: result.rowCount };
  }

  async function upsertPickupLocation({ label, qrCode, timestamp }) {
    const result = await queryable.query(
      `
        INSERT INTO pickup_locations (
          label, qr_code, is_active, created_at, updated_at
        ) VALUES ($1, $2, 1, $3, $4)
        ON CONFLICT(label) DO UPDATE SET
          qr_code = excluded.qr_code,
          is_active = 1,
          updated_at = excluded.updated_at
      `,
      [label, qrCode, timestamp, timestamp]
    );
    return { changes: result.rowCount };
  }

  async function clearDemoData() {
    await queryable.query(`
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

  async function insertOrder(order) {
    const result = await queryable.query(
      `
        INSERT INTO orders (
          public_id, cleancloud_order_id, customer_name, customer_id, order_weight, customer_phone, customer_email, service_tier, status,
          cleancloud_status, ready_for_pickup, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
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
      ]
    );
    return { changes: result.rowCount };
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
  createPostgresDemoSeedRepository
};
