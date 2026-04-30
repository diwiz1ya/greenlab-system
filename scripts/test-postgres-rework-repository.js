const assert = require("node:assert/strict");
const { createPostgresReworkRepository } = require("../backend/db/postgres-rework-repository");

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
  const db = createFakeQueryable([
    { rows: [{ id: 1, image_role: "front" }], rowCount: 1 },
    { rows: [{ id: 2, source_basket_code: "B-1" }], rowCount: 1 },
    { rows: [{ id: 3, request_status: "pending_customer_approval" }], rowCount: 1 },
    { rows: [{ id: 4, source_order_id: 2601 }], rowCount: 1 },
    { rows: [{ id: 5, source_basket_code: "B-1" }], rowCount: 1 },
    { rows: [{ id: 6, request_status: "approved_waiting_transfer" }], rowCount: 1 },
    { rows: [{ id: 7, public_id: "GL-2601" }], rowCount: 1 },
    { rows: [{ max_attempt: "2" }], rowCount: 1 },
    { rows: [{ id: 8, public_id: "GL-2601" }], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [{ id: 101 }], rowCount: 1 },
    { rows: [{ id: 9, source_basket_code: "B-1" }], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [{ id: 201 }], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 2 },
    { rows: [], rowCount: 1 }
  ]);
  const repository = createPostgresReworkRepository(db);

  assert.deepEqual(await repository.listBasketImages(1), [{ id: 1, image_role: "front" }]);
  assert.deepEqual(await repository.listReworkRequestsByOrder(2601), [{ id: 2, source_basket_code: "B-1" }]);
  assert.deepEqual(
    await repository.listPendingReworkRequestsByBasketId({
      basketId: 1,
      statuses: ["pending_customer_approval", "approved_waiting_transfer"]
    }),
    [{ id: 3, request_status: "pending_customer_approval" }]
  );
  assert.deepEqual(await repository.listPendingReworkRequestsByBasketId({ basketId: 1, statuses: [] }), []);
  assert.deepEqual(await repository.getReworkRequestWithContext(4), [{ id: 4, source_order_id: 2601 }][0]);
  assert.deepEqual(await repository.getQcTransferTaskWithContext(5), [{ id: 5, source_basket_code: "B-1" }][0]);
  assert.deepEqual(
    await repository.listPendingQcTransferTasks({ statuses: ["approved_waiting_transfer", "declined_waiting_return"] }),
    [{ id: 6, request_status: "approved_waiting_transfer" }]
  );
  assert.deepEqual(await repository.listPendingQcTransferTasks({ statuses: [] }), []);
  assert.deepEqual(await repository.findBasketWithOrderByQr("QR:BIN-001"), [{ id: 7, public_id: "GL-2601" }][0]);
  assert.equal(await repository.getNextReworkAttempt({ orderId: 2601, rootBasketId: 1 }), 3);
  assert.deepEqual(await repository.findQcBasketForInspection("QR:BIN-001"), [{ id: 8, public_id: "GL-2601" }][0]);
  assert.deepEqual(
    await repository.insertQcScanErrorEvent({
      orderId: 2601,
      basketId: 1,
      actor: "qc",
      message: "bad qr",
      timestamp: "2026-04-30T08:00:00.000Z"
    }),
    { changes: 1 }
  );
  assert.equal(
    await repository.createPendingReworkRequest({
      orderId: 2601,
      sourceBasketId: 1,
      itemCategory: "shirt",
      itemLabel: "Shirt",
      quantity: 1,
      selectedImage: { id: 10, public_url: "/uploads/a.jpg", note: "front" },
      qcPhoto: { filePath: "qc.jpg", publicUrl: "/uploads/qc.jpg" },
      reasonCode: "stain",
      serviceLabel: "Rewash",
      extraDays: 1,
      requestStatus: "pending_customer_approval",
      actor: "qc",
      timestamp: "2026-04-30T08:00:00.000Z"
    }),
    101
  );
  assert.deepEqual(await repository.getReworkRequestById(101), [{ id: 9, source_basket_code: "B-1" }][0]);
  assert.deepEqual(
    await repository.updateBasketStationStatus({
      basketId: 1,
      station: "qc",
      status: "qc",
      timestamp: "t1"
    }),
    { changes: 1 }
  );
  assert.deepEqual(
    await repository.updateBasketStationStatusIfCurrent({
      basketId: 1,
      station: "qc",
      status: "qc",
      timestamp: "t2",
      expectedStation: "pickup",
      expectedStatus: "pickup"
    }),
    { changes: 1 }
  );
  assert.deepEqual(
    await repository.insertScanOkEvent({
      orderId: 2601,
      basketId: 1,
      station: "qc",
      actor: "qc",
      message: "ok",
      timestamp: "t3"
    }),
    { changes: 1 }
  );
  assert.deepEqual(
    await repository.updateReworkRequestDecision({
      requestId: 101,
      requestStatus: "approved_waiting_transfer",
      actor: "manager",
      timestamp: "t4",
      decisionNote: "ok",
      expectedStatus: "pending_customer_approval"
    }),
    { changes: 1 }
  );
  assert.deepEqual(
    await repository.confirmReturnTask({
      requestId: 101,
      requestStatus: "declined",
      decisionActor: "manager",
      decisionAt: "t5",
      decisionNote: "no",
      handoffActor: "qc",
      handoffAt: "t6",
      handoffNote: "returned",
      expectedStatus: "declined_waiting_return"
    }),
    { changes: 1 }
  );
  assert.equal(
    await repository.createReworkBasket({
      orderId: 2601,
      basketCode: "GL-2601-R1",
      basketType: "mixed",
      basketItemsJson: "[]",
      rootBasketId: 1,
      reasonCode: "stain",
      attempt: 1,
      station: "washing",
      qrCode: "QR:BIN-002",
      timestamp: "t7"
    }),
    201
  );
  assert.deepEqual(
    await repository.updateSourceBasketAfterTransfer({
      sourceBasketId: 1,
      basketItemsJson: "[]",
      station: "rework_transferred",
      status: "rework_transferred",
      timestamp: "t8",
      expectedStation: "qc",
      expectedStatus: "qc"
    }),
    { changes: 1 }
  );
  assert.deepEqual(
    await repository.confirmTransferTask({
      requestId: 101,
      reworkBasketId: 201,
      requestStatus: "approved",
      decisionActor: "manager",
      decisionAt: "t9",
      decisionNote: "ok",
      handoffActor: "qc",
      handoffAt: "t10",
      handoffNote: "moved",
      expectedStatus: "approved_waiting_transfer"
    }),
    { changes: 1 }
  );
  assert.deepEqual(
    await repository.updateOrderBasketsToHold({
      orderId: 2601,
      holdStation: "hold",
      timestamp: "t11"
    }),
    { changes: 2 }
  );
  assert.deepEqual(
    await repository.updateOrderToHold({
      orderId: 2601,
      holdStation: "hold",
      holdCloudStatus: "HOLD",
      timestamp: "t12"
    }),
    { changes: 1 }
  );

  assert.deepEqual(db.calls[0].params, [1]);
  assert.deepEqual(db.calls[2].params, [1, "pending_customer_approval", "approved_waiting_transfer"]);
  assert.match(db.calls[2].sql, /request_status IN \(\$2, \$3\)/);
  assert.deepEqual(db.calls[5].params, ["approved_waiting_transfer", "declined_waiting_return"]);
  assert.match(db.calls[5].sql, /ORDER BY rr\.decision_at DESC/);
  assert.deepEqual(db.calls[10].params.slice(0, 5), [2601, 1, "shirt", "Shirt", 1]);
  assert.match(db.calls[10].sql, /RETURNING id/);
  assert.deepEqual(db.calls[13].params, ["qc", "qc", "t2", 1, "pickup", "pickup"]);
  assert.match(db.calls[17].sql, /basket_kind, parent_basket_id/);
  assert.match(db.calls[17].sql, /RETURNING id/);
  assert.deepEqual(db.calls[19].params, [
    201,
    "approved",
    "manager",
    "t9",
    "ok",
    "qc",
    "t10",
    "moved",
    "t10",
    101,
    "approved_waiting_transfer"
  ]);

  console.log("PostgreSQL rework repository tests: OK");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
