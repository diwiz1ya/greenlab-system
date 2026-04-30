const assert = require("node:assert/strict");
const { createPostgresWorkflowRepository } = require("../backend/db/postgres-workflow-repository");

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
    { rows: [], rowCount: 3 },
    { rows: [{ station: "washing", count: 2 }], rowCount: 1 },
    { rows: [{ id: 2601, status: "pickup" }], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [{ id: 2601, ready_to_place: 1 }], rowCount: 1 },
    { rows: [{ id: 1, basket_code: "B-1" }], rowCount: 1 },
    { rows: [{ slot_index: 1, bin_qr_code: "QR:BIN-001" }], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [{ id: 1, qr_code: "QR:BIN-001" }], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [{ id: 11, machine_code: "W01" }], rowCount: 1 },
    { rows: [{ id: 11, active_load_id: 21 }], rowCount: 1 },
    { rows: [{ id: 1, public_id: "GL-2601" }], rowCount: 1 },
    { rows: [{ id: 1, order_id: 2601 }], rowCount: 1 },
    { rows: [{ load_id: 21, machine_code: "W01" }], rowCount: 1 },
    { rows: [{ id: 301 }], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [{ id: 21, station: "washing" }], rowCount: 1 },
    { rows: [{ load_basket_id: 31, basket_id: 1 }], rowCount: 1 },
    { rows: [{ qr_code: "QR:BIN-001" }], rowCount: 1 },
    { rows: [{ basket_code: "GL-2601-B1" }], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [{ pending_count: "0" }], rowCount: 1 },
    { rows: [{ id: 1, order_id: 2601 }], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [{ public_id: "GL-2601" }], rowCount: 1 },
    { rows: [{ status: "pickup", ready_to_place: 1 }], rowCount: 1 },
    { rows: [{ ok: 1 }], rowCount: 1 },
    { rows: [{ ok: 1 }], rowCount: 1 },
    { rows: [{ id: 2601, status: "hold" }], rowCount: 1 },
    { rows: [{ count: "2" }], rowCount: 1 },
    { rows: [], rowCount: 2 },
    { rows: [], rowCount: 1 },
    { rows: [{ id: 2601, public_id: "GL-2601" }], rowCount: 1 },
    { rows: [{ id: 1, label: "BIN-001" }], rowCount: 1 },
    { rows: [{ id: 1, label: "Shelf A" }], rowCount: 1 },
    { rows: [{ order_id: 2601, public_id: "GL-2601" }], rowCount: 1 },
    { rows: [{ order_id: 2601, public_id: "GL-2601" }], rowCount: 1 },
    { rows: [{ id: 1, station: "washing", public_id: "GL-2601" }], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [{ id: 2601, status: "pickup" }], rowCount: 1 },
    { rows: [{ id: 1, qr_code: "QR:BIN-001" }], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 }
  ]);
  const repository = createPostgresWorkflowRepository(db);

  assert.deepEqual(await repository.normalizeMachineLoadStatuses(), { changes: 3 });
  assert.deepEqual(await repository.listOrderProgressStations(2601), [{ station: "washing", count: 2 }]);
  assert.deepEqual(await repository.findPickupAssemblyOrder(2601), { id: 2601, status: "pickup" });
  assert.deepEqual(
    await repository.updateOrderReadyToPlace({
      orderId: 2601,
      readyToPlace: true,
      timestamp: "t1"
    }),
    { changes: 1 }
  );
  assert.deepEqual(await repository.findPickupInvariantOrder(2601), { id: 2601, ready_to_place: 1 });
  assert.deepEqual(await repository.listActiveBasketsByOrder(2601), [{ id: 1, basket_code: "B-1" }]);
  assert.deepEqual(await repository.listActivePickupPlacementsByOrder(2601), [
    { slot_index: 1, bin_qr_code: "QR:BIN-001" }
  ]);
  assert.deepEqual(
    await repository.updateOrderStatusForPickup({
      orderId: 2601,
      status: "pickup",
      cleancloudStatus: "ready",
      timestamp: "t2"
    }),
    { changes: 1 }
  );
  assert.deepEqual(
    await repository.updateOrderStatusAndClearPickupFlags({
      orderId: 2601,
      status: "washing",
      cleancloudStatus: "work",
      timestamp: "t3"
    }),
    { changes: 1 }
  );
  assert.deepEqual(await repository.listPickupAssemblyBaskets(2601), [{ id: 1, qr_code: "QR:BIN-001" }]);
  assert.deepEqual(await repository.updateBasketQr({ basketId: 1, qrCode: "QR:BIN-009", timestamp: "t4" }), {
    changes: 1
  });
  assert.deepEqual(await repository.getMachineWithActiveLoad({ station: "washing", machineCode: "W01" }), {
    id: 11,
    machine_code: "W01"
  });
  assert.deepEqual(await repository.listMachineWorkbenchRows("washing"), [{ id: 11, active_load_id: 21 }]);
  assert.deepEqual(await repository.listLoadBaskets(21), [{ id: 1, public_id: "GL-2601" }]);
  assert.deepEqual(await repository.findMachineFlowBasketByQr("QR:BIN-001"), { id: 1, order_id: 2601 });
  assert.deepEqual(await repository.findActiveMachineLoadByBasketId(1), { load_id: 21, machine_code: "W01" });
  assert.deepEqual(
    await repository.insertMachineLoad({
      machineId: 11,
      station: "washing",
      actor: "washing",
      timestamp: "t5"
    }),
    { changes: 1, lastInsertRowid: 301 }
  );
  assert.deepEqual(
    await repository.insertMachineLoadBasket({
      loadId: 301,
      basketId: 1,
      orderId: 2601,
      timestamp: "t6"
    }),
    { changes: 1 }
  );
  assert.deepEqual(
    await repository.insertScanEvent({
      orderId: 2601,
      basketId: 1,
      station: "washing",
      actor: "washing",
      result: "ok",
      message: "loaded",
      timestamp: "t7"
    }),
    { changes: 1 }
  );
  assert.deepEqual(await repository.getMachineLoadById(21), { id: 21, station: "washing" });
  assert.deepEqual(await repository.listPendingMachineLoadBaskets(21), [{ load_basket_id: 31, basket_id: 1 }]);
  assert.deepEqual(await repository.findActiveBasketCatalogQr("QR:BIN-001"), { qr_code: "QR:BIN-001" });
  assert.deepEqual(await repository.findBasketQrOccupant({ qrCode: "QR:BIN-001", excludeBasketId: 1 }), {
    basket_code: "GL-2601-B1"
  });
  assert.deepEqual(await repository.unloadMachineLoadBasket({ loadBasketId: 31, actor: "washing", timestamp: "t8" }), {
    changes: 1
  });
  assert.deepEqual(await repository.rebindBasketQr({ basketId: 1, qrCode: "QR:BIN-002", timestamp: "t9" }), {
    changes: 1
  });
  assert.deepEqual(await repository.moveBasketToStation({ basketId: 1, station: "drying", timestamp: "t10" }), {
    changes: 1
  });
  assert.deepEqual(await repository.markMachineLoadCompletedIfEmpty({ loadId: 21, timestamp: "t11" }), {
    changes: 1
  });
  assert.equal(await repository.countPendingMachineLoadBaskets(21), 0);
  assert.deepEqual(await repository.listMachineLoadBasketOrderRefs(21), [{ id: 1, order_id: 2601 }]);
  assert.deepEqual(await repository.cancelMachineLoad({ loadId: 21, actor: "washing", timestamp: "t12" }), {
    changes: 1
  });
  assert.deepEqual(await repository.findOrderPublicId(2601), { public_id: "GL-2601" });
  assert.deepEqual(await repository.getPickupScanOrderState(2601), { status: "pickup", ready_to_place: 1 });
  assert.equal(await repository.hasPickupHandoverConfirmation(2601), true);
  assert.equal(await repository.hasBasketPickupOkScan({ orderId: 2601, basketId: 1 }), true);
  assert.deepEqual(await repository.findHoldOrderById(2601), { id: 2601, status: "hold" });
  assert.equal(await repository.countBasketsByOrder(2601), 2);
  assert.deepEqual(
    await repository.moveHoldBasketsToWashing({
      orderId: 2601,
      holdStation: "hold",
      timestamp: "t13"
    }),
    { changes: 2 }
  );
  assert.deepEqual(await repository.releaseHoldOrderToWashing({ orderId: 2601, timestamp: "t14" }), {
    changes: 1
  });
  assert.deepEqual(await repository.findPickupPlacementOrder(2601), { id: 2601, public_id: "GL-2601" });
  assert.deepEqual(await repository.findBinCatalogEntry("QR:BIN-001"), { id: 1, label: "BIN-001" });
  assert.deepEqual(await repository.findPickupLocationCatalogEntry("QR:PICKUP-001"), { id: 1, label: "Shelf A" });
  assert.deepEqual(await repository.findActivePickupPlacementByBin("QR:BIN-001"), {
    order_id: 2601,
    public_id: "GL-2601"
  });
  assert.deepEqual(await repository.findActivePickupPlacementByLocation("QR:PICKUP-001"), {
    order_id: 2601,
    public_id: "GL-2601"
  });
  assert.deepEqual(await repository.findActiveBasketByQrForPickupPlacement("QR:BIN-001"), {
    id: 1,
    station: "washing",
    public_id: "GL-2601"
  });
  assert.deepEqual(
    await repository.releaseActivePickupOrderPlacements({
      orderId: 2601,
      actor: "pickup",
      timestamp: "t15"
    }),
    { changes: 1 }
  );
  assert.deepEqual(
    await repository.insertPickupOrderPlacement({
      orderId: 2601,
      slotIndex: 1,
      binQrCode: "QR:BIN-001",
      locationQrCode: "QR:PICKUP-001",
      actor: "pickup",
      timestamp: "t16"
    }),
    { changes: 1 }
  );
  assert.deepEqual(await repository.markOrderPlacedForPickup({ orderId: 2601, timestamp: "t17" }), { changes: 1 });
  assert.deepEqual(await repository.findPickupCompletionOrder(2601), { id: 2601, status: "pickup" });
  assert.deepEqual(await repository.listOrderBasketsForArchive(2601), [{ id: 1, qr_code: "QR:BIN-001" }]);
  assert.deepEqual(await repository.markOrderPickedUp({ orderId: 2601, timestamp: "t18" }), { changes: 1 });
  assert.deepEqual(
    await repository.archiveBasket({
      basketId: 1,
      archivedQrCode: "ARCHIVED:QR:BIN-001",
      timestamp: "t19"
    }),
    { changes: 1 }
  );

  assert.deepEqual(db.calls[1].params, [2601]);
  assert.deepEqual(db.calls[3].params, [1, "t1", 2601]);
  assert.deepEqual(db.calls[16].params, [11, "washing", "washing", "t5", "t5", "t5"]);
  assert.match(db.calls[16].sql, /RETURNING id/);
  assert.deepEqual(db.calls[18].params, [2601, 1, "washing", "washing", "ok", "loaded", "t7"]);
  assert.deepEqual(db.calls[26].params, ["t11", 21, 21]);
  assert.match(db.calls[26].sql, /NOT EXISTS/);
  assert.match(db.calls[32].sql, /Выдача подтверждена.%/);
  assert.deepEqual(db.calls[36].params, ["t13", 2601, "hold", "hold"]);
  assert.deepEqual(db.calls[45].params, [2601, 1, "QR:BIN-001", "QR:PICKUP-001", "pickup", "t16", "t16", "t16"]);
  assert.deepEqual(db.calls[50].params, ["ARCHIVED:QR:BIN-001", "t19", 1]);

  console.log("PostgreSQL workflow repository tests: OK");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
