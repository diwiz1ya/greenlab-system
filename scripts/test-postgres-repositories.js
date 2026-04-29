const assert = require("node:assert/strict");
const { createPostgresCoreRepository } = require("../backend/db/postgres-core-repository");
const { createPostgresDemoSeedRepository } = require("../backend/db/postgres-demo-seed-repository");
const { createPostgresIdempotencyRepository } = require("../backend/db/postgres-idempotency-repository");
const { createPostgresScanRepository } = require("../backend/db/postgres-scan-repository");
const { createPostgresSecurityEventRepository } = require("../backend/db/postgres-security-event-repository");
const { createPostgresSystemRepository } = require("../backend/db/postgres-system-repository");
const { createPostgresUserRepository } = require("../backend/db/postgres-user-repository");

function createFakeQueryable(results = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({
        sql: String(sql).replace(/\s+/g, " ").trim(),
        params
      });
      return results.shift() || { rows: [], rowCount: 0 };
    }
  };
}

(async () => {
  const userDb = createFakeQueryable([
    { rows: [{ id: 1, username: "admin" }], rowCount: 1 },
    { rows: [{ id: 1, password: "[redacted]", password_hash: "hash" }], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 }
  ]);
  const userRepository = createPostgresUserRepository(userDb);

  assert.deepEqual(await userRepository.findLoginUserByUsername("admin"), { id: 1, username: "admin" });
  assert.deepEqual(await userRepository.listPasswordRows(), [
    { id: 1, password: "[redacted]", password_hash: "hash" }
  ]);
  assert.deepEqual(await userRepository.updatePasswordHashAndRedact(1, "[redacted]", "new-hash"), { changes: 1 });
  assert.deepEqual(await userRepository.redactPassword(1, "[redacted]"), { changes: 1 });
  assert.deepEqual(userDb.calls.map((call) => call.params), [
    ["admin"],
    [],
    ["[redacted]", "new-hash", 1],
    ["[redacted]", 1]
  ]);
  assert.match(userDb.calls[0].sql, /WHERE username = \$1/);
  assert.match(userDb.calls[2].sql, /password = \$1, password_hash = \$2/);

  const securityDb = createFakeQueryable([
    { rows: [], rowCount: 1 },
    { rows: [{ id: 9, category: "auth" }], rowCount: 1 },
    { rows: [{ id: 8, category: "rate-limit" }], rowCount: 1 }
  ]);
  const securityRepository = createPostgresSecurityEventRepository(securityDb);
  await securityRepository.insertSecurityEvent({
    category: "auth",
    actor: "admin",
    ip: "127.0.0.1",
    path: "/api/login",
    method: "POST",
    status: 200,
    message: "ok",
    createdAt: "2026-04-29T08:00:00.000Z"
  });
  assert.deepEqual(await securityRepository.listSecurityEvents(10, " auth "), [{ id: 9, category: "auth" }]);
  assert.deepEqual(await securityRepository.listSecurityEvents(5), [{ id: 8, category: "rate-limit" }]);
  assert.deepEqual(securityDb.calls[0].params, [
    "auth",
    "admin",
    "127.0.0.1",
    "/api/login",
    "POST",
    200,
    "ok",
    "2026-04-29T08:00:00.000Z"
  ]);
  assert.deepEqual(securityDb.calls[1].params, ["auth", 10]);
  assert.deepEqual(securityDb.calls[2].params, [5]);
  assert.match(securityDb.calls[1].sql, /WHERE category = \$1/);
  assert.match(securityDb.calls[2].sql, /LIMIT \$1/);

  const systemDb = createFakeQueryable([
    { rows: [{ ok: 1 }], rowCount: 1 },
    { rows: [{ status: "pending", count: 2 }], rowCount: 1 }
  ]);
  const systemRepository = createPostgresSystemRepository(systemDb);
  assert.deepEqual(await systemRepository.checkConnection(), { ok: 1 });
  assert.deepEqual(await systemRepository.listSyncQueueStatusCounts(), [{ status: "pending", count: 2 }]);
  assert.match(systemDb.calls[0].sql, /SELECT 1 AS ok/);
  assert.match(systemDb.calls[1].sql, /COUNT\(\*\)::int AS count/);

  const coreDb = createFakeQueryable([
    { rows: [{ count: 5 }], rowCount: 1 },
    { rows: [{ count: 12 }], rowCount: 1 }
  ]);
  const coreRepository = createPostgresCoreRepository(coreDb);
  assert.deepEqual(await coreRepository.getDemoResetCounts(), { orders: 5, scans: 12 });
  assert.match(coreDb.calls[0].sql, /COUNT\(\*\)::int AS count FROM orders/);
  assert.match(coreDb.calls[1].sql, /COUNT\(\*\)::int AS count FROM scan_events/);

  const idempotencyDb = createFakeQueryable([
    { rows: [], rowCount: 2 },
    { rows: [{ status_code: 200, response_json: "{\"ok\":true}" }], rowCount: 1 },
    { rows: [], rowCount: 1 }
  ]);
  const idempotencyRepository = createPostgresIdempotencyRepository(idempotencyDb);
  assert.deepEqual(await idempotencyRepository.purgeExpired("2026-04-29T08:00:00.000Z"), { changes: 2 });
  assert.deepEqual(
    await idempotencyRepository.findCachedRecord({
      key: "k1",
      routeKey: "POST /api/machines/start",
      actor: "operator",
      nowStamp: "2026-04-29T08:00:00.000Z"
    }),
    { status_code: 200, response_json: "{\"ok\":true}" }
  );
  assert.deepEqual(
    await idempotencyRepository.saveRecord({
      key: "k1",
      routeKey: "POST /api/machines/start",
      actor: "operator",
      statusCode: 200,
      responseJson: "{\"ok\":true}",
      nowStamp: "2026-04-29T08:00:00.000Z",
      expiresAt: "2026-04-29T08:10:00.000Z"
    }),
    { changes: 1 }
  );
  assert.deepEqual(idempotencyDb.calls[0].params, ["2026-04-29T08:00:00.000Z"]);
  assert.deepEqual(idempotencyDb.calls[1].params, [
    "k1",
    "POST /api/machines/start",
    "operator",
    "2026-04-29T08:00:00.000Z"
  ]);
  assert.deepEqual(idempotencyDb.calls[2].params, [
    "k1",
    "POST /api/machines/start",
    "operator",
    200,
    "{\"ok\":true}",
    "2026-04-29T08:00:00.000Z",
    "2026-04-29T08:10:00.000Z"
  ]);
  assert.match(idempotencyDb.calls[2].sql, /ON CONFLICT\(idem_key, route_key, actor\)/);

  const scanDb = createFakeQueryable([
    { rows: [{ id: 7, order_public_id: "GL-2601" }], rowCount: 1 },
    { rows: [{ id: 6, order_public_id: "GL-2602" }], rowCount: 1 },
    { rows: [{ id: 5, order_public_id: "GL-2603" }], rowCount: 1 }
  ]);
  const scanRepository = createPostgresScanRepository(scanDb);
  assert.deepEqual(await scanRepository.listExportRows(2601), [{ id: 7, order_public_id: "GL-2601" }]);
  assert.deepEqual(await scanRepository.listExportRows(), [{ id: 6, order_public_id: "GL-2602" }]);
  assert.deepEqual(await scanRepository.listRecentByStation("washing", 20), [
    { id: 5, order_public_id: "GL-2603" }
  ]);
  assert.deepEqual(scanDb.calls[0].params, [2601]);
  assert.deepEqual(scanDb.calls[1].params, []);
  assert.deepEqual(scanDb.calls[2].params, ["washing", 20]);
  assert.match(scanDb.calls[0].sql, /WHERE se\.order_id = \$1/);
  assert.match(scanDb.calls[2].sql, /WHERE se\.station = \$1/);

  const seedDb = createFakeQueryable([
    { rows: [], rowCount: 4 },
    { rows: [{ id: 1, username: "manager", allowed_stations: "[]" }], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [{ id: 1 }], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [{ count: 8 }], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 13 },
    { rows: [], rowCount: 1 }
  ]);
  const seedRepository = createPostgresDemoSeedRepository(seedDb);
  await seedRepository.normalizeLegacyData();
  assert.deepEqual(await seedRepository.listUsersAllowedStations(), [
    { id: 1, username: "manager", allowed_stations: "[]" }
  ]);
  assert.deepEqual(await seedRepository.updateAllowedStations(1, "[\"overview\"]"), { changes: 1 });
  assert.equal(await seedRepository.userExists("manager"), true);
  assert.deepEqual(
    await seedRepository.insertUser({
      username: "manager",
      password: "[redacted]",
      passwordHash: "hash",
      displayName: "Branch manager",
      role: "manager",
      allowedStationsJson: "[\"overview\"]"
    }),
    { changes: 1 }
  );
  assert.equal(await seedRepository.countUsers(), 8);
  assert.deepEqual(
    await seedRepository.upsertMachine({
      code: "W01",
      station: "washing",
      type: "washer",
      displayName: "Washer 01",
      timestamp: "2026-04-29T08:00:00.000Z"
    }),
    { changes: 1 }
  );
  assert.deepEqual(
    await seedRepository.upsertBasketCatalogEntry({
      label: "BIN-001",
      qrCode: "QR:BIN-001",
      timestamp: "2026-04-29T08:00:00.000Z"
    }),
    { changes: 1 }
  );
  assert.deepEqual(
    await seedRepository.upsertPickupLocation({
      label: "PICKUP-001",
      qrCode: "QR:PICKUP-001",
      timestamp: "2026-04-29T08:00:00.000Z"
    }),
    { changes: 1 }
  );
  await seedRepository.clearDemoData();
  assert.deepEqual(
    await seedRepository.insertOrder({
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
      timestamp: "2026-04-29T08:00:00.000Z"
    }),
    { changes: 1 }
  );
  assert.match(seedDb.calls[0].sql, /UPDATE orders SET status = 'qc'/);
  assert.deepEqual(seedDb.calls[2].params, ["[\"overview\"]", 1]);
  assert.deepEqual(seedDb.calls[3].params, ["manager"]);
  assert.deepEqual(seedDb.calls[4].params, [
    "manager",
    "[redacted]",
    "hash",
    "Branch manager",
    "manager",
    "[\"overview\"]"
  ]);
  assert.match(seedDb.calls[6].sql, /ON CONFLICT\(machine_code\)/);
  assert.match(seedDb.calls[7].sql, /ON CONFLICT\(label\)/);
  assert.match(seedDb.calls[9].sql, /DELETE FROM webhook_events/);
  assert.deepEqual(seedDb.calls[10].params, [
    "GL-2601",
    "CC-2601",
    "Dian Saputra",
    null,
    4.4,
    "+62 812 2601",
    null,
    "Premium",
    "sorting",
    "sorting",
    0,
    "2026-04-29T08:00:00.000Z",
    "2026-04-29T08:00:00.000Z"
  ]);
  assert.match(seedDb.calls[10].sql, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11, \$12, \$13\)/);

  console.log("PostgreSQL repository tests: OK");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
