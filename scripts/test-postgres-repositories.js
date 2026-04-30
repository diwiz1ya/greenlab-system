const assert = require("node:assert/strict");
const { createPostgresCleanCloudRepository } = require("../backend/db/postgres-cleancloud-repository");
const { createPostgresCoreRepository } = require("../backend/db/postgres-core-repository");
const { createPostgresDemoSeedRepository } = require("../backend/db/postgres-demo-seed-repository");
const { createPostgresIdempotencyRepository } = require("../backend/db/postgres-idempotency-repository");
const { createPostgresOrderQueryRepository } = require("../backend/db/postgres-order-query-repository");
const { createPostgresPickupWorkbenchRepository } = require("../backend/db/postgres-pickup-workbench-repository");
const { createPostgresScanRepository } = require("../backend/db/postgres-scan-repository");
const { createPostgresSecurityEventRepository } = require("../backend/db/postgres-security-event-repository");
const { createPostgresSortingRepository } = require("../backend/db/postgres-sorting-repository");
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

  const cleanCloudDb = createFakeQueryable([
    { rows: [{ id: 41 }], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [{ id: 2601, public_id: "GL-2601" }], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [{ id: 51, action: "cleancloud.status" }], rowCount: 1 },
    { rows: [{ id: 52, action: "cleancloud.status" }], rowCount: 1 },
    { rows: [{ count: "9" }], rowCount: 1 },
    { rows: [], rowCount: 2 },
    { rows: [], rowCount: 1 },
    { rows: [{ id: 61, status: "pending" }], rowCount: 1 },
    { rows: [{ id: 71, status: "processed" }], rowCount: 1 },
    { rows: [{ id: 2601, public_id: "GL-2601" }], rowCount: 1 },
    { rows: [{ total_baskets: 2, pickup_baskets: 1 }], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 }
  ]);
  const cleanCloudRepository = createPostgresCleanCloudRepository(cleanCloudDb);
  assert.deepEqual(
    await cleanCloudRepository.findPendingSyncDuplicate(2601, "cleancloud.status", "{\"status\":\"ready\"}"),
    { id: 41 }
  );
  assert.deepEqual(
    await cleanCloudRepository.insertSyncQueueItem({
      orderId: 2601,
      action: "cleancloud.status",
      payloadJson: "{\"status\":\"ready\"}",
      createdAt: "2026-04-29T08:00:00.000Z"
    }),
    { changes: 1 }
  );
  assert.deepEqual(await cleanCloudRepository.findOrderContactById(2601), {
    id: 2601,
    public_id: "GL-2601"
  });
  assert.deepEqual(
    await cleanCloudRepository.updateOrderContact(
      2601,
      { customer_phone: "+62 812", order_weight: 4.5 },
      "2026-04-29T08:00:00.000Z"
    ),
    { changes: 1 }
  );
  assert.deepEqual(await cleanCloudRepository.updateOrderContact(2601, {}, "2026-04-29T08:00:00.000Z"), {
    changes: 0
  });
  await assert.rejects(
    () => cleanCloudRepository.updateOrderContact(2601, { status: "pickup" }, "2026-04-29T08:00:00.000Z"),
    /Unsupported order contact column/
  );
  assert.deepEqual(
    await cleanCloudRepository.insertOverviewScanEvent({
      orderId: 2601,
      actor: "manager",
      message: "Updated",
      timestamp: "2026-04-29T08:00:00.000Z"
    }),
    { changes: 1 }
  );
  assert.deepEqual(
    await cleanCloudRepository.markSyncQueueProcessed({
      id: 51,
      processedAt: "2026-04-29T08:01:00.000Z",
      note: "ok"
    }),
    { changes: 1 }
  );
  assert.deepEqual(
    await cleanCloudRepository.markSyncQueueRetry({
      id: 52,
      status: "failed",
      attempts: 3,
      errorMessage: "timeout",
      processedAt: "2026-04-29T08:02:00.000Z"
    }),
    { changes: 1 }
  );
  assert.deepEqual(await cleanCloudRepository.keepSyncQueuePending({ id: 53, errorMessage: "retry" }), {
    changes: 1
  });
  assert.deepEqual(await cleanCloudRepository.listPendingSyncItems({ limit: 10, orderId: 2601 }), [
    { id: 51, action: "cleancloud.status" }
  ]);
  assert.deepEqual(await cleanCloudRepository.listPendingSyncItems({ limit: 5 }), [
    { id: 52, action: "cleancloud.status" }
  ]);
  assert.equal(await cleanCloudRepository.countSyncQueueItemsByOrder(2601), 9);
  assert.equal(await cleanCloudRepository.retryFailedSyncItemsByOrder(2601), 2);
  assert.deepEqual(await cleanCloudRepository.markSyncQueueProcessing(51), { changes: 1 });
  assert.deepEqual(await cleanCloudRepository.listSyncQueueItems(20), [{ id: 61, status: "pending" }]);
  assert.deepEqual(await cleanCloudRepository.listWebhookEvents(20), [{ id: 71, status: "processed" }]);
  assert.deepEqual(await cleanCloudRepository.findOrderByCleanCloudOrderId("CC-2601"), {
    id: 2601,
    public_id: "GL-2601"
  });
  assert.deepEqual(await cleanCloudRepository.getOrderBasketPickupSnapshot(2601), {
    total_baskets: 2,
    pickup_baskets: 1
  });
  assert.deepEqual(
    await cleanCloudRepository.updateOrderFromWebhook({
      orderId: 2601,
      status: "pickup",
      cleancloudStatus: "ready",
      readyForPickup: true,
      timestamp: "2026-04-29T08:03:00.000Z"
    }),
    { changes: 1 }
  );
  assert.deepEqual(
    await cleanCloudRepository.insertWebhookEvent({
      source: "cleancloud",
      eventKey: "evt-1",
      payloadJson: "{}",
      receivedAt: "2026-04-29T08:04:00.000Z"
    }),
    { changes: 1 }
  );
  assert.deepEqual(
    await cleanCloudRepository.updateWebhookEvent({
      eventKey: "evt-1",
      status: "processed",
      message: "done",
      processedAt: "2026-04-29T08:05:00.000Z"
    }),
    { changes: 1 }
  );
  assert.deepEqual(cleanCloudDb.calls[0].params, [2601, "cleancloud.status", "{\"status\":\"ready\"}"]);
  assert.deepEqual(cleanCloudDb.calls[3].params, [
    "+62 812",
    4.5,
    "2026-04-29T08:00:00.000Z",
    2601
  ]);
  assert.deepEqual(cleanCloudDb.calls[8].params, [2601, 10]);
  assert.deepEqual(cleanCloudDb.calls[9].params, [5]);
  assert.deepEqual(cleanCloudDb.calls[17].params, ["pickup", "ready", 1, "2026-04-29T08:03:00.000Z", 2601]);
  assert.match(cleanCloudDb.calls[3].sql, /customer_phone = \$1, order_weight = \$2, updated_at = \$3/);
  assert.match(cleanCloudDb.calls[12].sql, /status = 'processing' WHERE id = \$1/);
  assert.match(cleanCloudDb.calls[16].sql, /SUM\(CASE WHEN station = 'pickup'/);

  const sortingDb = createFakeQueryable([
    { rows: [{ qr_code: "QR:BIN-001" }], rowCount: 1 },
    { rows: [{ qr_code: "QR:BIN-002" }], rowCount: 1 },
    { rows: [{ qr_code: "QR:BIN-003" }], rowCount: 1 },
    { rows: [{ qr_code: "QR:BIN-004" }], rowCount: 1 },
    { rows: [{ qr_code: "QR:BIN-005" }], rowCount: 1 },
    { rows: [{ id: 2601, public_id: "GL-2601" }], rowCount: 1 },
    { rows: [{ count: "2" }], rowCount: 1 },
    { rows: [{ id: 1 }, { id: 2 }], rowCount: 2 },
    { rows: [{ id: 10, file_path: "a.jpg" }], rowCount: 1 },
    { rows: [], rowCount: 2 },
    { rows: [{ id: 101 }], rowCount: 1 },
    { rows: [{ id: 201 }], rowCount: 1 },
    { rows: [], rowCount: 2 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 }
  ]);
  const sortingRepository = createPostgresSortingRepository(sortingDb);
  assert.deepEqual(await sortingRepository.listKnownCatalogQrs(), [{ qr_code: "QR:BIN-001" }]);
  assert.deepEqual(await sortingRepository.listFreeCatalogQrs({ limit: 5 }), [{ qr_code: "QR:BIN-002" }]);
  assert.deepEqual(await sortingRepository.listFreeCatalogQrs({ limit: 5, excludeOrderId: 2601 }), [
    { qr_code: "QR:BIN-003" }
  ]);
  assert.deepEqual(await sortingRepository.findConflictingQrCode({ qrCode: "QR:BIN-004" }), {
    qr_code: "QR:BIN-004"
  });
  assert.deepEqual(
    await sortingRepository.findConflictingQrCode({ qrCode: "QR:BIN-005", excludeOrderId: 2601 }),
    { qr_code: "QR:BIN-005" }
  );
  assert.deepEqual(await sortingRepository.findOrderById(2601), { id: 2601, public_id: "GL-2601" });
  assert.equal(await sortingRepository.countBasketsByOrder(2601), 2);
  assert.deepEqual(await sortingRepository.listBasketIdsByOrder(2601), [1, 2]);
  assert.deepEqual(await sortingRepository.listBasketImagesByBasketIds([]), []);
  assert.deepEqual(await sortingRepository.listBasketImagesByBasketIds([1, 2]), [
    { id: 10, file_path: "a.jpg" }
  ]);
  assert.deepEqual(await sortingRepository.deleteBasketImagesByBasketIds([]), { changes: 0 });
  assert.deepEqual(await sortingRepository.deleteBasketImagesByBasketIds([1, 2]), { changes: 2 });
  assert.equal(
    await sortingRepository.insertBasketImage({
      basketId: 1,
      role: "front",
      sortOrder: 0,
      note: "ok",
      filePath: "a.jpg",
      publicUrl: "/uploads/a.jpg",
      timestamp: "2026-04-29T08:00:00.000Z"
    }),
    101
  );
  assert.equal(
    await sortingRepository.insertBasket({
      orderId: 2601,
      basketCode: "GL-2601-B1",
      basketType: "mixed",
      basketItemsJson: "[]",
      qrCode: "QR:BIN-001",
      labelPrintedAt: "2026-04-29T08:00:00.000Z",
      labelPrintCount: 1,
      timestamp: "2026-04-29T08:00:00.000Z"
    }),
    201
  );
  assert.deepEqual(await sortingRepository.deleteBasketsByOrder(2601), { changes: 2 });
  assert.deepEqual(await sortingRepository.markOrderSorted({ orderId: 2601, timestamp: "t1" }), { changes: 1 });
  assert.deepEqual(await sortingRepository.markOrderReturnedToSorting({ orderId: 2601, timestamp: "t2" }), {
    changes: 1
  });
  assert.deepEqual(
    await sortingRepository.insertSortingScanEvent({
      orderId: 2601,
      actor: "sorting",
      message: "sorted",
      timestamp: "t3"
    }),
    { changes: 1 }
  );
  assert.deepEqual(sortingDb.calls[1].params, [5]);
  assert.deepEqual(sortingDb.calls[2].params, [2601, 5]);
  assert.deepEqual(sortingDb.calls[4].params, ["QR:BIN-005", 2601]);
  assert.deepEqual(sortingDb.calls[8].params, [1, 2]);
  assert.deepEqual(sortingDb.calls[9].params, [1, 2]);
  assert.match(sortingDb.calls[10].sql, /RETURNING id/);
  assert.match(sortingDb.calls[11].sql, /RETURNING id/);
  assert.match(sortingDb.calls[13].sql, /status = 'sorted'/);

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

  const orderQueryDb = createFakeQueryable([
    { rows: [{ id: 2601, public_id: "GL-2601" }], rowCount: 1 },
    { rows: [{ id: 1, basket_code: "B-1" }], rowCount: 1 },
    { rows: [{ id: 11, basket_id: 1 }], rowCount: 1 },
    { rows: [{ id: 21, station: "sorting" }], rowCount: 1 },
    { rows: [{ slot_index: 1 }], rowCount: 1 },
    { rows: [{ station: "washing", machine_code: "W01" }], rowCount: 1 },
    { rows: [{ id: 31, source_basket_code: "B-1" }], rowCount: 1 },
    { rows: [{ count: "2" }], rowCount: 1 },
    { rows: [{ count: "3" }], rowCount: 1 },
    { rows: [{ count: "4" }], rowCount: 1 },
    { rows: [{ id: 2601, basket_count: 1 }], rowCount: 1 },
    { rows: [{ order_id: 2601, slot_index: 1 }], rowCount: 1 },
    { rows: [{ decisions_total: 2, approval_minutes_avg: 3.5 }], rowCount: 1 },
    { rows: [{ total_rework_baskets: 1 }], rowCount: 1 },
    { rows: [{ handoff_count: 1 }], rowCount: 1 },
    { rows: [{ id: 2602, public_id: "GL-2602" }], rowCount: 1 },
    { rows: [{ id: 2603, baskets_in_station: 2 }], rowCount: 1 },
    { rows: [{ count: "5" }], rowCount: 1 },
    { rows: [{ count: "6" }], rowCount: 1 },
    { rows: [{ count: "7" }], rowCount: 1 }
  ]);
  const orderQueryRepository = createPostgresOrderQueryRepository(orderQueryDb);
  assert.deepEqual(await orderQueryRepository.findOrderById(2601), { id: 2601, public_id: "GL-2601" });
  assert.deepEqual(await orderQueryRepository.listBasketsByOrderId(2601), [{ id: 1, basket_code: "B-1" }]);
  assert.deepEqual(await orderQueryRepository.listBasketImagesByBasketIds([]), []);
  assert.deepEqual(await orderQueryRepository.listBasketImagesByBasketIds([1, 2]), [{ id: 11, basket_id: 1 }]);
  assert.deepEqual(await orderQueryRepository.listRecentScansByOrderId(2601), [{ id: 21, station: "sorting" }]);
  assert.deepEqual(await orderQueryRepository.listPickupPlacementsByOrderId(2601), [{ slot_index: 1 }]);
  assert.deepEqual(await orderQueryRepository.listMachineUsageByOrderId(2601), [
    { station: "washing", machine_code: "W01" }
  ]);
  assert.deepEqual(await orderQueryRepository.listReworkRequestsByOrderId(2601), [
    { id: 31, source_basket_code: "B-1" }
  ]);
  assert.equal(await orderQueryRepository.countSortingOrders(), 2);
  assert.equal(await orderQueryRepository.countOrdersByBasketStation("qc"), 3);
  assert.equal(await orderQueryRepository.countReadyOrders(), 4);
  assert.deepEqual(await orderQueryRepository.listOverviewOrders(), [{ id: 2601, basket_count: 1 }]);
  assert.deepEqual(await orderQueryRepository.listActivePickupPlacements(), [{ order_id: 2601, slot_index: 1 }]);
  assert.deepEqual(await orderQueryRepository.getManagerKpiCore(), {
    decisions_total: 2,
    approval_minutes_avg: 3.5
  });
  assert.deepEqual(await orderQueryRepository.getManagerKpiRework(), [{ total_rework_baskets: 1 }][0]);
  assert.deepEqual(await orderQueryRepository.getManagerKpiPickup(), { handoff_count: 1 });
  assert.deepEqual(await orderQueryRepository.listSortingStationOrders(), [{ id: 2602, public_id: "GL-2602" }]);
  assert.deepEqual(await orderQueryRepository.listActiveStationOrders("drying"), [
    { id: 2603, baskets_in_station: 2 }
  ]);
  assert.equal(await orderQueryRepository.countQcBaskets(), 5);
  assert.equal(await orderQueryRepository.countQcOrdersFromBaskets(), 6);
  assert.equal(await orderQueryRepository.countQcStatusOrders(), 7);
  assert.deepEqual(orderQueryDb.calls[0].params, [2601]);
  assert.deepEqual(orderQueryDb.calls[2].params, [1, 2]);
  assert.deepEqual(orderQueryDb.calls[8].params, ["qc", "qc"]);
  assert.deepEqual(orderQueryDb.calls[16].params, ["drying", "drying", "drying", "drying"]);
  assert.match(orderQueryDb.calls[2].sql, /WHERE basket_id IN \(\$1, \$2\)/);
  assert.match(orderQueryDb.calls[3].sql, /ORDER BY created_at DESC/);
  assert.match(orderQueryDb.calls[5].sql, /last_used_at DESC/);
  assert.match(orderQueryDb.calls[10].sql, /pending_customer_approval_count/);
  assert.match(orderQueryDb.calls[12].sql, /EXTRACT\(EPOCH FROM/);
  assert.match(orderQueryDb.calls[14].sql, /Выдача подтверждена%/);

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

  const pickupDb = createFakeQueryable([
    { rows: [{ total_baskets: 2, baskets_at_pickup: 1 }], rowCount: 1 },
    { rows: [{ id: 1, basket_code: "B-1", scanned: true }], rowCount: 1 },
    { rows: [{ slot_index: 1, bin_qr_code: "QR:BIN-001" }], rowCount: 1 },
    { rows: [{ id: 1, public_id: "GL-2601" }], rowCount: 1 },
    { rows: [{ id: 2, public_id: "GL-2602" }], rowCount: 1 },
    { rows: [{ id: 3, public_id: "GL-2603" }], rowCount: 1 }
  ]);
  const pickupRepository = createPostgresPickupWorkbenchRepository(pickupDb);
  assert.deepEqual(await pickupRepository.getOrderAssemblyProgressRow(2601), {
    total_baskets: 2,
    baskets_at_pickup: 1
  });
  assert.deepEqual(await pickupRepository.listPickupScanProgressRows(2601), [
    { id: 1, basket_code: "B-1", scanned: true }
  ]);
  assert.deepEqual(await pickupRepository.listPickupPlacementRows(2601), [
    { slot_index: 1, bin_qr_code: "QR:BIN-001" }
  ]);
  assert.deepEqual(await pickupRepository.listAssemblyOrders(), [{ id: 1, public_id: "GL-2601" }]);
  assert.deepEqual(await pickupRepository.listReadyToPlaceOrders(), [{ id: 2, public_id: "GL-2602" }]);
  assert.deepEqual(await pickupRepository.listPlacedOrders(), [{ id: 3, public_id: "GL-2603" }]);
  assert.deepEqual(pickupDb.calls[0].params, [2601, "rework_transferred", "archived"]);
  assert.deepEqual(pickupDb.calls[1].params, [2601, "rework_transferred", "archived"]);
  assert.deepEqual(pickupDb.calls[2].params, [2601]);
  assert.match(pickupDb.calls[0].sql, /COUNT\(\*\)::int AS total_baskets/);
  assert.match(pickupDb.calls[1].sql, /EXISTS \( SELECT 1 FROM scan_events se/);
  assert.match(pickupDb.calls[3].sql, /COALESCE\(ready_to_place, 0\) = 0/);
  assert.match(pickupDb.calls[4].sql, /COALESCE\(ready_to_place, 0\) = 1/);
  assert.match(pickupDb.calls[5].sql, /ready_for_pickup, 0\) = 1/);

  console.log("PostgreSQL repository tests: OK");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
