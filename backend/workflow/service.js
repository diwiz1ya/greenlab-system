const path = require("path");
const { buildSingleItemCounts, getRemainingItemCounts, itemCountsToJson, normalizeItemCounts, parseBasketItemCounts } = require("./basket-core");
const { normalizeBasketQrCode } = require("./basket-pool");
const { normalizePickupLocationQrCode } = require("../pickup/locations");
const { runImmediateTransaction } = require("../db/transaction");
const { createReworkWorkflow } = require("./rework-service");
const { createSortingWorkflow } = require("./sorting-service");

function createWorkflowService(options) {
  const {
    db,
    workflowRepository,
    nowIso,
    basketUploadsDir,
    getOrderDetails,
    getStationLabel,
    queueSync,
    getPickupScanProgress,
    productionFlow,
    flowIndex,
    holdStation,
    holdCloudStatus,
    awaitingApprovalStation,
    awaitingApprovalCloudStatus,
    pickupScanOkMessage,
    qcIssueLabels
  } = options;

  const reworkStation = "rework";
  const inactiveReworkSourceState = "rework_transferred";
  const pendingCustomerApprovalStatus = "pending_customer_approval";
  const approvedWaitingTransferStatus = "approved_waiting_transfer";
  const declinedWaitingReturnStatus = "declined_waiting_return";
  const approvedRequestStatus = "approved";
  const declinedRequestStatus = "declined";
  const basketItemKeys = ["top", "bottom", "underwear", "socksPairs"];
  const publicUploadsDir = basketUploadsDir || path.join(__dirname, "../../public/uploads/baskets");
  const reworkServiceCatalog = {
    stain_not_removed: { serviceLabel: "Stain removal", extraDays: 1 },
    spot_treatment: { serviceLabel: "Spot treatment", extraDays: 1 },
    hand_wash: { serviceLabel: "Hand wash", extraDays: 1 },
    extra_treatment: { serviceLabel: "Extra treatment", extraDays: 1 }
  };
  const customerApprovalStation = awaitingApprovalStation || "customer_approval";
  const customerApprovalCloudStatus = awaitingApprovalCloudStatus || "Ожидает согласования клиента";
  const orderProgressFlow = ["washing", "drying", "qc", customerApprovalStation, reworkStation, "ironing", "pickup"];
  const orderProgressIndex = Object.fromEntries(orderProgressFlow.map((station, index) => [station, index]));
  const machineStations = new Set(["washing", "drying"]);
  const machineCodePatterns = {
    washing: /^W0[1-6]$/,
    drying: /^D0[1-6]$/
  };
  const machineFlowBasketQrPattern = /^QR:BIN-\d{3}$/;
  const pickupBinQrPattern = /^QR:BIN-\d{3}$/;
  const pickupLocationQrPattern = /^QR:LOC-[A-Z]\d{2}$/;

  // Normalize any unknown legacy statuses to active so unload keeps working.
  workflowRepository.normalizeMachineLoadStatuses();

  const { createBaskets, updateSortedBaskets, returnSortedOrderToSorting } = createSortingWorkflow({
    db,
    nowIso,
    publicUploadsDir,
    getOrderDetails,
    queueSync,
    normalizeItemCounts,
    itemCountsToJson
  });
  const {
    getBasketPayload,
    getBasketWithOrderByQr,
    listReworkRequestsByOrder,
    listPendingReworkRequestsByBasketId,
    listPendingQcTransferTasks,
    inspectQcBasket,
    createReworkRequestFromQc,
    approveReworkRequest,
    declineReworkRequest,
    confirmQcTransferTask,
    rejectBasketFromQc
  } = createReworkWorkflow({
    db,
    nowIso,
    publicUploadsDir,
    getOrderDetails,
    getStationLabel,
    refreshOrderStatusFromBaskets,
    reworkStation,
    awaitingApprovalStation: customerApprovalStation,
    inactiveReworkSourceState,
    pendingCustomerApprovalStatus,
    approvedWaitingTransferStatus,
    declinedWaitingReturnStatus,
    approvedRequestStatus,
    declinedRequestStatus,
    basketItemKeys,
    qcIssueLabels,
    holdStation,
    holdCloudStatus,
    reworkServiceCatalog,
    parseBasketItemCounts,
    buildSingleItemCounts,
    getRemainingItemCounts,
    itemCountsToJson
  });

  function getOrderProgressFromBaskets(orderId) {
    const rows = workflowRepository.listOrderProgressStations(orderId);

    if (!rows.length) {
      return {
        status: "sorting",
        cleancloudStatus: "Новый заказ",
        readyForPickup: false
      };
    }

    if (rows.some((row) => row.station === holdStation)) {
      return {
        status: holdStation,
        cleancloudStatus: holdCloudStatus,
        readyForPickup: false
      };
    }

    if (rows.some((row) => row.station === customerApprovalStation)) {
      return {
        status: customerApprovalStation,
        cleancloudStatus: customerApprovalCloudStatus,
        readyForPickup: false
      };
    }

    let minIndex = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      const index = orderProgressIndex[row.station];
      if (index === undefined) continue;
      if (index < minIndex) {
        minIndex = index;
      }
    }

    if (!Number.isFinite(minIndex)) {
      minIndex = orderProgressIndex.washing;
    }

    const status = orderProgressFlow[minIndex];
    const readyForPickup = false;

    return {
      status,
      cleancloudStatus: status === "pickup" ? "Сборка на выдаче" : "В работе",
      readyForPickup
    };
  }

  function syncPickupAssemblyFlags(orderId, timestamp) {
    const order = workflowRepository.findPickupAssemblyOrder(orderId);
    if (!order) {
      return { readyToPlace: false, progress: { totalBaskets: 0, scannedBaskets: 0, complete: false, baskets: [] } };
    }

    if (order.status !== "pickup" || Boolean(order.ready_for_pickup)) {
      workflowRepository.updateOrderReadyToPlace({ orderId, readyToPlace: false, timestamp });
      return {
        readyToPlace: false,
        progress: getPickupScanProgress(orderId)
      };
    }

    const progress = getPickupScanProgress(orderId);
    const readyToPlace = progress.totalBaskets > 0 && progress.scannedBaskets >= progress.totalBaskets;
    if (readyToPlace) {
      releasePickupAssemblyBins(orderId, timestamp);
    }
    workflowRepository.updateOrderReadyToPlace({ orderId, readyToPlace, timestamp });

    return {
      readyToPlace,
      progress
    };
  }

  function getPickupInvariantState(orderId) {
    const order = workflowRepository.findPickupInvariantOrder(orderId);
    if (!order) {
      return null;
    }

    const baskets = workflowRepository.listActiveBasketsByOrder(orderId);
    const activePlacements = workflowRepository.listActivePickupPlacementsByOrder(orderId);
    const progress = getPickupScanProgress(orderId);

    return {
      order,
      baskets,
      activePlacements,
      progress
    };
  }

  function validatePickupInvariantState(orderId, options = {}) {
    const {
      requirePickupStatus = false,
      requireReadyToPlace = false,
      requireReadyForPickup = false
    } = options;

    const state = getPickupInvariantState(orderId);
    if (!state) {
      return { ok: false, error: "Заказ не найден.", status: 404 };
    }

    const { order, baskets, activePlacements, progress } = state;
    const hasPickupState = requirePickupStatus
      || Boolean(order.ready_to_place)
      || Boolean(order.ready_for_pickup)
      || activePlacements.length > 0;
    const inconsistentBaskets = baskets.filter((basket) => basket.station !== basket.status);
    const basketsOutsidePickup = baskets.filter((basket) => basket.station !== "pickup" || basket.status !== "pickup");
    const slotKeys = new Set();
    const binKeys = new Set();
    const locationKeys = new Set();

    if (!baskets.length) {
      return {
        ok: false,
        error: "Заказ не содержит активных корзин для этапа выдачи.",
        status: 409
      };
    }

    if (inconsistentBaskets.length) {
      return {
        ok: false,
        error: "Заказ содержит корзины с неконсистентным состоянием (status != station).",
        status: 409
      };
    }

    if (hasPickupState && order.status !== "pickup") {
      return {
        ok: false,
        error: "Заказ содержит pickup-признаки, но его статус не равен pickup.",
        status: 409
      };
    }

    if ((Boolean(order.ready_to_place) || Boolean(order.ready_for_pickup) || requireReadyToPlace || requireReadyForPickup) && basketsOutsidePickup.length) {
      return {
        ok: false,
        error: "Заказ на выдаче содержит корзины вне станции pickup.",
        status: 409
      };
    }

    if (requireReadyToPlace && !Boolean(order.ready_to_place)) {
      return {
        ok: false,
        error: "Заказ еще не собран полностью. Сначала завершите сборку BIN.",
        status: 409
      };
    }

    if (requireReadyForPickup && !Boolean(order.ready_for_pickup)) {
      return {
        ok: false,
        error: "Заказ не готов к подтверждению выдачи.",
        status: 409
      };
    }

    if (activePlacements.length > 2) {
      return {
        ok: false,
        error: "Заказ содержит слишком много активных размещений на выдаче.",
        status: 409
      };
    }

    for (const placement of activePlacements) {
      const slotKey = Number(placement.slot_index || 0);
      const binKey = String(placement.bin_qr_code || "").trim().toUpperCase();
      const locationKey = String(placement.location_qr_code || "").trim().toUpperCase();
      if (slotKeys.has(slotKey) || binKeys.has(binKey) || locationKeys.has(locationKey)) {
        return {
          ok: false,
          error: "Заказ содержит дублирующее размещение BIN/LOC на выдаче.",
          status: 409
        };
      }
      slotKeys.add(slotKey);
      if (binKey) binKeys.add(binKey);
      if (locationKey) locationKeys.add(locationKey);
    }

    if (Boolean(order.ready_to_place) && activePlacements.length) {
      return {
        ok: false,
        error: "Заказ помечен как готовый к размещению, но активное размещение уже существует.",
        status: 409
      };
    }

    if (Boolean(order.ready_for_pickup) && !activePlacements.length) {
      return {
        ok: false,
        error: "Заказ помечен как ожидающий выдачи, но размещение BIN/LOC не найдено.",
        status: 409
      };
    }

    if (Boolean(order.ready_for_pickup) && !progress.complete) {
      return {
        ok: false,
        error: "Заказ помечен как ожидающий выдачи, но сборка BIN не завершена.",
        status: 409
      };
    }

    return {
      ok: true,
      state
    };
  }

  function refreshOrderStatusFromBaskets(orderId, cleancloudOrderId, timestamp) {
    void cleancloudOrderId;
    const next = getOrderProgressFromBaskets(orderId);

    if (next.status === "pickup") {
      workflowRepository.updateOrderStatusForPickup({
        orderId,
        status: next.status,
        cleancloudStatus: next.cleancloudStatus,
        timestamp
      });
      const pickupFlags = syncPickupAssemblyFlags(orderId, timestamp);
      return {
        ...next,
        readyToPlace: pickupFlags.readyToPlace
      };
    }

    workflowRepository.updateOrderStatusAndClearPickupFlags({
      orderId,
      status: next.status,
      cleancloudStatus: next.cleancloudStatus,
      timestamp
    });

    return next;
  }

  function normalizeMachineCode(value) {
    let normalized = String(value || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    normalized = normalized.replace(/^QR[:\-]/, "");
    normalized = normalized.replace(/^(MACHINE|MACHINECODE|MACHINEQR)[:\-]/, "");
    normalized = normalized.replace(/[^A-Z0-9]/g, "");
    return normalized;
  }

  function getMachineCodeHint(station) {
    if (station === "washing") return "W01..W06";
    if (station === "drying") return "D01..D06";
    return "W01..W06 или D01..D06";
  }

  function isMachineCodeAllowedForStation(station, machineCode) {
    const pattern = machineCodePatterns[station];
    return Boolean(pattern && pattern.test(machineCode));
  }

  function normalizeMachineFlowBasketQr(value) {
    let normalized = String(value || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    if (!normalized) return "";
    normalized = normalized.replace(/^QR[-]/, "QR:");
    if (/^BIN-\d{3}$/.test(normalized)) {
      return `QR:${normalized}`;
    }
    return normalized;
  }

  function normalizeMachineFlowBasketQrList(values, limit = 20) {
    const source = Array.isArray(values) ? values : [];
    const unique = [];
    const seen = new Set();
    for (const value of source) {
      const qrCode = normalizeMachineFlowBasketQr(value);
      if (!qrCode || seen.has(qrCode)) continue;
      seen.add(qrCode);
      unique.push(qrCode);
      if (unique.length >= limit) break;
    }
    return unique;
  }

  function normalizePickupBinQr(value) {
    let normalized = normalizeBasketQrCode(value);
    if (!normalized) return "";
    normalized = normalized.replace(/^QR[-]/, "QR:");
    if (/^BIN-\d{3}$/.test(normalized)) {
      normalized = `QR:${normalized}`;
    }
    return normalized;
  }

  function releasePickupAssemblyBins(orderId, timestamp) {
    const rows = workflowRepository.listPickupAssemblyBaskets(orderId);
    if (!rows.length) return;

    for (const row of rows) {
      const basketCode = String(row.basket_code || "").trim().toUpperCase();
      if (!basketCode) continue;

      const currentQr = String(row.qr_code || "").trim().toUpperCase();
      const nextQr = `QR:${basketCode}`;
      if (currentQr === nextQr) continue;
      if (!pickupBinQrPattern.test(currentQr)) continue;

      workflowRepository.updateBasketQr({ basketId: row.id, qrCode: nextQr, timestamp });
    }
  }

  function normalizePickupLocationQr(value) {
    let normalized = normalizePickupLocationQrCode(value);
    if (!normalized) return "";
    normalized = normalized.replace(/^QR[-]/, "QR:");
    if (/^LOC-[A-Z]\d{2}$/.test(normalized)) {
      normalized = `QR:${normalized}`;
    }
    return normalized;
  }

  function getMachineWithActiveLoad(station, machineCode) {
    return workflowRepository.getMachineWithActiveLoad({ station, machineCode });
  }

  function listMachineWorkbench(station) {
    if (!machineStations.has(station)) {
      return { error: "Станция машинного цикла доступна только для стирки и сушки.", status: 400 };
    }

    const machineRows = workflowRepository.listMachineWorkbenchRows(station);

    const machines = machineRows.map((row) => {
      const hasActiveLoad = Number(row.active_load_id || 0) > 0;
      const loadStatus = String(row.active_load_status || "");
      const activeLoad = hasActiveLoad
        ? {
            id: Number(row.active_load_id),
            status: loadStatus || "active",
            started_at: row.active_load_started_at,
            started_by: row.active_load_started_by,
            completed_at: row.active_load_completed_at || null,
            completed_by: row.active_load_completed_by || null,
            baskets_count: Number(row.active_load_baskets_count || 0),
            unloaded_baskets_count: Number(row.active_load_unloaded_count || 0),
            baskets: workflowRepository.listLoadBaskets(row.active_load_id).map((basket) => ({
              id: basket.id,
              basket_code: basket.basket_code,
              qr_code: basket.qr_code,
              station: basket.station,
              status: basket.status,
              order_public_id: basket.public_id,
              unloaded_at: basket.unloaded_at || null,
              unloaded_by: basket.unloaded_by || null
            }))
          }
        : null;

      return {
        id: row.id,
        machine_code: row.machine_code,
        station: row.station,
        machine_type: row.machine_type,
        display_name: row.display_name,
        status: hasActiveLoad ? "busy" : "idle",
        active_load: activeLoad
      };
    });

    return {
      ok: true,
      station,
      machines
    };
  }

  function validateMachineLoadBasket(station, basketQrRaw) {
    if (!machineStations.has(station)) {
      return { error: "Machine cycle is available only for washing and drying stations.", status: 400 };
    }

    const basketQr = normalizeMachineFlowBasketQr(basketQrRaw);
    if (!basketQr) {
      return { error: "Scan basket QR first.", status: 400 };
    }
    if (!machineFlowBasketQrPattern.test(basketQr)) {
      return {
        error: `Scan ${basketQr} is not a basket QR. Expected format: QR:BIN-001.`,
        status: 400
      };
    }

    const basket = workflowRepository.findMachineFlowBasketByQr(basketQr);
    if (!basket) {
      return { error: `QR code ${basketQr} was not found.`, status: 404 };
    }
    if (basket.status !== basket.station) {
      return { error: `Basket ${basket.basket_code} is in an inconsistent state (status != station).`, status: 409 };
    }
    if (basket.station !== station) {
      return {
        error: `Basket ${basket.basket_code} is at ${getStationLabel(basket.station)}, not ${getStationLabel(station)}.`,
        status: 409
      };
    }

    const itemCounts = parseBasketItemCounts(basket.basket_items_json);
    const totalItems = Number(itemCounts?.total || 0);
    if (totalItems <= 0) {
      return {
        error: `Basket ${basket.basket_code} is empty. Machine cycle can start only for baskets with items.`,
        status: 409
      };
    }

    const activeLoad = workflowRepository.findActiveMachineLoadByBasketId(basket.id);
    if (activeLoad) {
      return {
        error: `Basket ${basket.basket_code} is already part of active cycle ${activeLoad.machine_code}.`,
        status: 409
      };
    }

    return {
      ok: true,
      basket: {
        id: basket.id,
        order_id: basket.order_id,
        public_id: basket.public_id,
        basket_code: basket.basket_code,
        qr_code: basket.qr_code,
        station: basket.station,
        status: basket.status
      }
    };
  }

  function startMachineLoad(station, machineCodeRaw, basketQrsRaw, actor) {
    if (!machineStations.has(station)) {
      return { error: "Машинный цикл можно запускать только на стирке или сушке.", status: 400 };
    }

    const machineCode = normalizeMachineCode(machineCodeRaw);
    if (!machineCode) {
      return { error: "Сканируйте QR машины перед запуском цикла.", status: 400 };
    }
    if (!isMachineCodeAllowedForStation(station, machineCode)) {
      return {
        error: `Для станции ${getStationLabel(station)} разрешены только QR машин ${getMachineCodeHint(station)}.`,
        status: 400
      };
    }

    const basketQrs = normalizeMachineFlowBasketQrList(basketQrsRaw, 30);
    if (!basketQrs.length) {
      return { error: "Добавьте корзину в цикл машины.", status: 400 };
    }
    if (basketQrs.length > 1) {
      return { error: "В одном цикле машины может быть только одна корзина.", status: 400 };
    }

    const machine = getMachineWithActiveLoad(station, machineCode);
    if (!machine) {
      return { error: `Машина ${machineCode} не найдена для станции ${getStationLabel(station)}.`, status: 404 };
    }
    if (machine.active_load_id) {
      return { error: `Машина ${machine.display_name} уже занята активным циклом.`, status: 409 };
    }

    const baskets = [];
    for (const qrCode of basketQrs) {
      if (!machineFlowBasketQrPattern.test(qrCode)) {
        return {
          error: `Scan ${qrCode} is not a basket QR. Expected format: QR:BIN-001.`,
          status: 400
        };
      }
      const basket = workflowRepository.findMachineFlowBasketByQr(qrCode);
      if (!basket) {
        return { error: `QR code ${qrCode} was not found.`, status: 404 };
      }
      if (basket.status !== basket.station) {
        return { error: `Basket ${basket.basket_code} is in an inconsistent state (status != station).`, status: 409 };
      }
      if (basket.station !== station) {
        return {
          error: `Basket ${basket.basket_code} is at ${getStationLabel(basket.station)}, not ${getStationLabel(station)}.`,
          status: 409
        };
      }
      const itemCounts = parseBasketItemCounts(basket.basket_items_json);
      const totalItems = Number(itemCounts?.total || 0);
      if (totalItems <= 0) {
        return {
          error: `Basket ${basket.basket_code} is empty. Machine cycle can start only for baskets with items.`,
          status: 409
        };
      }
      const activeLoad = workflowRepository.findActiveMachineLoadByBasketId(basket.id);
      if (activeLoad) {
        return {
          error: `Basket ${basket.basket_code} is already part of active cycle ${activeLoad.machine_code}.`,
          status: 409
        };
      }
      baskets.push(basket);
    }

    const timestamp = nowIso();

    let loadId = 0;
    try {
      runImmediateTransaction(db, () => {
        const loadInsert = workflowRepository.insertMachineLoad({
          machineId: machine.id,
          station,
          actor,
          timestamp
        });
        loadId = Number(loadInsert.lastInsertRowid);
        const touchedOrderIds = new Set();
        for (const basket of baskets) {
          workflowRepository.insertMachineLoadBasket({
            loadId,
            basketId: basket.id,
            orderId: basket.order_id,
            timestamp
          });
          workflowRepository.insertScanEvent({
            orderId: basket.order_id,
            basketId: basket.id,
            station,
            actor,
            message: `Корзина помещена в ${machine.display_name} (${machine.machine_code}).`,
            timestamp
          });
          touchedOrderIds.add(Number(basket.order_id));
        }
        for (const orderId of touchedOrderIds) {
          const firstBasketForOrder = baskets.find((basket) => Number(basket.order_id) === orderId);
          refreshOrderStatusFromBaskets(
            orderId,
            firstBasketForOrder?.cleancloud_order_id || null,
            timestamp
          );
        }
      });
    } catch (error) {
      return { error: error?.message || "Failed to start the machine cycle.", status: 500 };
    }

    return {
      ok: true,
      message: `Cycle started: ${machine.display_name} (${machine.machine_code}), basket ${baskets[0].basket_code}.`,
      load: {
        id: loadId,
        machine_code: machine.machine_code,
        machine_display_name: machine.display_name,
        station,
        status: "active",
        started_at: timestamp,
        started_by: actor,
        baskets: baskets.map((basket) => ({
          id: basket.id,
          basket_code: basket.basket_code,
          qr_code: basket.qr_code,
          order_public_id: basket.public_id
        }))
      }
    };
  }

  function unloadBasketFromMachineLoad(loadId, basketQrRaw, actor, options = {}) {
    const load = workflowRepository.getMachineLoadById(loadId);

    if (!load) {
      return { error: "Machine cycle not found.", status: 404 };
    }
    if (load.status !== "active") {
      return { error: "This machine cycle is already closed.", status: 409 };
    }
    if (options.expectedStation && load.station !== options.expectedStation) {
      return { error: `Цикл относится к станции ${getStationLabel(load.station)}, а не ${getStationLabel(options.expectedStation)}.`, status: 409 };
    }

    const basketQr = normalizeMachineFlowBasketQr(basketQrRaw);
    if (!basketQr) {
      return { error: "Scan basket QR for unload.", status: 400 };
    }
    if (!machineFlowBasketQrPattern.test(basketQr)) {
      return { error: `Scan ${basketQr} is not a basket QR. Expected format: QR:BIN-001.`, status: 400 };
    }

    const currentIndex = flowIndex[load.station];
    if (currentIndex === undefined || currentIndex >= productionFlow.length - 1) {
      return { error: "This station cannot unload basket to the next step.", status: 400 };
    }
    const nextStation = productionFlow[currentIndex + 1];

    const pendingRows = workflowRepository.listPendingMachineLoadBaskets(loadId);

    if (!pendingRows.length) {
      return { error: "No baskets left to unload in this machine cycle.", status: 409 };
    }

    let row = pendingRows.find((entry) => entry.qr_code === basketQr) || null;
    if (!row && pendingRows.length === 1) {
      row = pendingRows[0];
    }

    if (!row) {
      return { error: `Basket ${basketQr} does not belong to this machine cycle.`, status: 404 };
    }
    if (row.unloaded_at) {
      return { error: `Basket ${row.basket_code} is already unloaded from this cycle.`, status: 409 };
    }
    if (row.status !== row.station) {
      return { error: `Basket ${row.basket_code} is in inconsistent state (status != station).`, status: 409 };
    }
    if (row.station !== load.station) {
      return {
        error: `Basket ${row.basket_code} is no longer at station ${getStationLabel(load.station)}.`,
        status: 409
      };
    }

    const originalQr = String(row.qr_code || "");
    const rebindToAnotherBin = basketQr !== originalQr;
    if (rebindToAnotherBin) {
      const knownBin = workflowRepository.findActiveBasketCatalogQr(basketQr);
      if (!knownBin) {
        return {
          error: `QR ${basketQr} is not present in BIN catalog BIN-001..BIN-050.`,
          status: 400
        };
      }

      const occupied = workflowRepository.findBasketQrOccupant({ qrCode: basketQr, excludeBasketId: row.basket_id });
      if (occupied?.basket_code) {
        return {
          error: `QR ${basketQr} is already occupied by basket ${occupied.basket_code}.`,
          status: 409
        };
      }
    }

    const timestamp = nowIso();

    let pendingCount = 0;
    try {
      runImmediateTransaction(db, () => {
        if (rebindToAnotherBin) {
          workflowRepository.rebindBasketQr({ basketId: row.basket_id, qrCode: basketQr, timestamp });
        }
        workflowRepository.unloadMachineLoadBasket({ loadBasketId: row.load_basket_id, actor, timestamp });
        workflowRepository.moveBasketToStation({ basketId: row.basket_id, station: nextStation, timestamp });

        const unloadMessage = rebindToAnotherBin
          ? `Basket unloaded from ${load.display_name} (${load.machine_code}), QR changed ${originalQr} -> ${basketQr}, station: ${getStationLabel(nextStation)}.`
          : `Basket unloaded from ${load.display_name} (${load.machine_code}) and moved to station ${getStationLabel(nextStation)}.`;
        workflowRepository.insertScanEvent({
          orderId: row.order_id,
          basketId: row.basket_id,
          station: load.station,
          actor,
          message: unloadMessage,
          timestamp
        });

        refreshOrderStatusFromBaskets(row.order_id, row.cleancloud_order_id, timestamp);
        workflowRepository.markMachineLoadCompletedIfEmpty({ loadId: load.id, timestamp });
        pendingCount = workflowRepository.countPendingMachineLoadBaskets(load.id);
      });
    } catch (error) {
      if (String(error?.message || "").includes("UNIQUE constraint failed: baskets.qr_code")) {
        return { error: `QR ${basketQr} is already used by another order.`, status: 409 };
      }
      return { error: error?.message || "Failed to unload basket from machine cycle.", status: 500 };
    }

    const nextQrCode = rebindToAnotherBin ? basketQr : originalQr;
    return {
      ok: true,
      message: `Basket ${row.basket_code} unloaded. Remaining to unload: ${pendingCount}.`,
      load: {
        id: load.id,
        machine_code: load.machine_code,
        machine_display_name: load.display_name,
        station: load.station,
        status: pendingCount > 0 ? "active" : "completed",
        pending_unload_count: pendingCount
      },
      basket: {
        id: row.basket_id,
        basket_code: row.basket_code,
        qr_code: nextQrCode,
        order_public_id: row.public_id,
        station: nextStation,
        status: nextStation
      }
    };
  }

  function cancelMachineLoad(loadId, actor, options = {}) {
    const load = workflowRepository.getMachineLoadById(loadId);

    if (!load) {
      return { error: "Машинный цикл не найден.", status: 404 };
    }
    if (load.status !== "active") {
      return { error: "Этот машинный цикл уже закрыт.", status: 409 };
    }
    if (options.expectedStation && load.station !== options.expectedStation) {
      return { error: `Цикл относится к станции ${getStationLabel(load.station)}, а не ${getStationLabel(options.expectedStation)}.`, status: 409 };
    }

    const baskets = workflowRepository.listMachineLoadBasketOrderRefs(loadId);
    const timestamp = nowIso();

    try {
      runImmediateTransaction(db, () => {
        workflowRepository.cancelMachineLoad({ loadId: load.id, actor, timestamp });
        for (const basket of baskets) {
          workflowRepository.insertScanEvent({
            orderId: basket.order_id,
            basketId: basket.id,
            station: load.station,
            actor,
            message: `Цикл ${load.display_name} (${load.machine_code}) отменен оператором.`,
            timestamp
          });
        }
      });
    } catch (error) {
      return { error: error?.message || "Не удалось отменить машинный цикл.", status: 500 };
    }

    return {
      ok: true,
      message: `Цикл отменен: ${load.display_name} (${load.machine_code}).`,
      load: {
        id: load.id,
        status: "cancelled",
        cancelled_at: timestamp,
        cancelled_by: actor
      }
    };
  }

  function insertScanEvent(orderId, basketId, station, actor, result, message, timestamp) {
    workflowRepository.insertScanEvent({
      orderId,
      basketId,
      station,
      actor,
      result,
      message,
      timestamp
    });
  }

  function scanBasket(station, qrCode, actor, options = {}) {
    const basket = getBasketWithOrderByQr(qrCode);

    if (!basket) {
      return { status: 404, payload: { ok: false, message: "QR-код не найден." } };
    }

    const timestamp = nowIso();
    const orderId = basket.order_db_id;
    const expectedOrderId = Number(options.expectedOrderId || 0);
    const strictExpectedOrder = Boolean(options.strictExpectedOrder);

    if (
      station === "pickup"
      && strictExpectedOrder
      && Number.isFinite(expectedOrderId)
      && expectedOrderId > 0
      && expectedOrderId !== orderId
    ) {
      const expectedOrder = workflowRepository.findOrderPublicId(expectedOrderId);
      const expectedOrderPublicId = String(expectedOrder?.public_id || "").trim();
      const actualOrderPublicId = String(basket.public_id || "").trim();
      const mismatchMessage = expectedOrderPublicId
        ? `Скан относится к ${actualOrderPublicId || "другому заказу"}, а выбран ${expectedOrderPublicId}. Завершите выбранный заказ или переключите его в выдаче.`
        : "Скан относится к другому заказу. Сначала переключите выбранный заказ в выдаче.";

      insertScanEvent(orderId, basket.id, station, actor, "error", mismatchMessage, timestamp);

      return {
        status: 409,
        payload: {
          ok: false,
          message: mismatchMessage
        }
      };
    }

    if (basket.status !== basket.station) {
      insertScanEvent(
        orderId,
        basket.id,
        station,
        actor,
        "error",
        "Скан отклонён: неконсистентное состояние корзины (status != station).",
        timestamp
      );

      return {
        status: 409,
        payload: {
          ok: false,
          message: "Скан отклонён: состояние корзины неконсистентно (status != station)."
        }
      };
    }

    if (station === "qc" && basket.basket_kind !== "rework") {
      const pendingRequests = listPendingReworkRequestsByBasketId(basket.id);
      if (pendingRequests.length) {
        insertScanEvent(
          orderId,
          basket.id,
          station,
          actor,
          "error",
          "QC не завершен: есть незавершенный кейс доработки по этой корзине.",
          timestamp
        );

        return {
          status: 409,
          payload: {
            ok: false,
            message: "QC нельзя завершить: по этой корзине есть незавершённый кейс доработки."
          }
        };
      }
    }

    if (basket.station !== station) {
      insertScanEvent(orderId, basket.id, station, actor, "error", `Корзина относится к станции ${getStationLabel(basket.station)}.`, timestamp);

      return {
        status: 409,
        payload: { ok: false, message: `Корзина на станции ${getStationLabel(basket.station)}, а не ${getStationLabel(station)}.` }
      };
    }

    if (station === "pickup") {
      // Pickup assembly is allowed to start as baskets arrive one by one, even when
      // the overall order status still reflects an earlier station. Hard pickup
      // status is enforced later for placement and handover confirmation.
      const pickupInvariant = validatePickupInvariantState(orderId);
      if (!pickupInvariant.ok) {
        insertScanEvent(orderId, basket.id, station, actor, "error", pickupInvariant.error, timestamp);

        return {
          status: pickupInvariant.status,
          payload: {
            ok: false,
            message: pickupInvariant.error
          }
        };
      }

      const pickupOrder = workflowRepository.getPickupScanOrderState(orderId);
      const handoverConfirmed = workflowRepository.hasPickupHandoverConfirmation(orderId);
      if (!pickupOrder || handoverConfirmed) {
        const blockedMessage = "Выдача по заказу уже подтверждена. Обновите экран.";
        insertScanEvent(orderId, basket.id, station, actor, "error", blockedMessage, timestamp);

        return {
          status: 409,
          payload: {
            ok: false,
            message: blockedMessage
          }
        };
      }
      if (Boolean(pickupOrder.ready_for_pickup)) {
        const blockedMessage = "Заказ уже размещен и ожидает выдачи.";
        insertScanEvent(orderId, basket.id, station, actor, "error", blockedMessage, timestamp);
        return {
          status: 409,
          payload: {
            ok: false,
            message: blockedMessage
          }
        };
      }

      const alreadyScanned = workflowRepository.hasBasketPickupOkScan({ orderId, basketId: basket.id });
      if (alreadyScanned) {
        const pickupSync = syncPickupAssemblyFlags(orderId, timestamp);
        const pickupProgress = pickupSync.progress;
        const message = pickupSync.readyToPlace
          ? "Эта корзина уже принята. Заказ готов к размещению."
          : `Эта корзина уже принята. Сборка: ${pickupProgress.scannedBaskets}/${pickupProgress.totalBaskets}.`;

        return {
          status: 200,
          payload: {
            ok: true,
            message,
            order: getOrderDetails(orderId),
            basket: {
              id: basket.id,
              basket_code: basket.basket_code,
              qr_code: basket.qr_code
            },
            pickupProgress,
            readyToPlace: pickupSync.readyToPlace
          }
        };
      }

      insertScanEvent(orderId, basket.id, station, actor, "ok", "BIN принят в сборку заказа на выдачу.", timestamp);

      const pickupSync = syncPickupAssemblyFlags(orderId, timestamp);
      const pickupProgress = pickupSync.progress;
      const message = pickupSync.readyToPlace
        ? "Комплект собран. Перейдите в режим «Размещение»."
        : `Принято в сборку: ${pickupProgress.scannedBaskets}/${pickupProgress.totalBaskets}.`;

      return {
        status: 200,
        payload: {
          ok: true,
          message,
          order: getOrderDetails(orderId),
          basket: {
            id: basket.id,
            basket_code: basket.basket_code,
            qr_code: basket.qr_code
          },
          pickupProgress,
          readyToPlace: pickupSync.readyToPlace
        }
      };
    }

    if (station === reworkStation) {
      workflowRepository.moveBasketToStation({ basketId: basket.id, station: "qc", timestamp });

      refreshOrderStatusFromBaskets(orderId, basket.cleancloud_order_id, timestamp);

      insertScanEvent(
        orderId,
        basket.id,
        station,
        actor,
        "ok",
        `Корзина доработана и возвращена на станцию ${getStationLabel("qc")}.`,
        timestamp
      );

      return {
        status: 200,
        payload: {
          ok: true,
          message: `Корзина доработана и возвращена на станцию ${getStationLabel("qc")}.`,
          order: getOrderDetails(orderId),
          basket: getBasketPayload({
            ...basket,
            station: "qc",
            status: "qc"
          })
        }
      };
    }

    if (station === "sorting") {
      insertScanEvent(
        orderId,
        basket.id,
        station,
        actor,
        "error",
        "На сортировке QR-скан не используется. Откройте заказ и запустите сортировку из модалки.",
        timestamp
      );

      return {
        status: 400,
        payload: {
          ok: false,
          message: "На сортировке QR не сканируется. Откройте заказ и нажмите «Запустить сортировку»."
        }
      };
    }

    const currentIndex = flowIndex[station];
    if (currentIndex === undefined || currentIndex >= productionFlow.length - 1) {
      return { status: 400, payload: { ok: false, message: "На этой станции сканирование недоступно." } };
    }

    const nextStation = productionFlow[currentIndex + 1];
    workflowRepository.moveBasketToStation({ basketId: basket.id, station: nextStation, timestamp });

    refreshOrderStatusFromBaskets(orderId, basket.cleancloud_order_id, timestamp);

    insertScanEvent(orderId, basket.id, station, actor, "ok", `Basket moved to ${getStationLabel(nextStation)} station.`, timestamp);

    return {
      status: 200,
      payload: {
        ok: true,
        message: `Basket moved to ${getStationLabel(nextStation)} station.`,
        order: getOrderDetails(orderId),
        basket: getBasketPayload({
          ...basket,
          station: nextStation,
          status: nextStation
        })
      }
    };
  }

  function releaseOrderFromHold(orderId, actor) {
    const order = workflowRepository.findHoldOrderById(orderId);
    if (!order) {
      return { error: "Заказ не найден", status: 404 };
    }
    if (order.status !== holdStation) {
      return { error: "Заказ не находится в HOLD", status: 400 };
    }

    const basketCount = workflowRepository.countBasketsByOrder(orderId);
    if (!basketCount) {
      return { error: "У заказа нет корзин для возврата в работу", status: 400 };
    }

    const timestamp = nowIso();
    workflowRepository.moveHoldBasketsToWashing({ orderId, holdStation, timestamp });
    workflowRepository.releaseHoldOrderToWashing({ orderId, timestamp });
    insertScanEvent(orderId, null, "overview", actor, "ok", "HOLD снят менеджером. Заказ возвращён на стирку.", timestamp);

    queueSync(orderId, "cleancloud.status", {
      orderId: order.cleancloud_order_id,
      status: "В работе"
    });

    return { ok: true, order: getOrderDetails(orderId) };
  }

  function placeOrderForPickup(orderId, containerCountRaw, placementsRaw, actor) {
    const order = workflowRepository.findPickupPlacementOrder(orderId);
    if (!order) {
      return { error: "Заказ не найден", status: 404 };
    }
    if (order.status !== "pickup") {
      return { error: "Заказ еще не дошел до этапа выдачи.", status: 409 };
    }
    if (Boolean(order.ready_for_pickup)) {
      return { error: "Заказ уже размещен и ожидает выдачи.", status: 409 };
    }
    if (!Boolean(order.ready_to_place)) {
      return { error: "Заказ еще не собран полностью. Сначала завершите сборку BIN.", status: 409 };
    }

    const pickupInvariant = validatePickupInvariantState(orderId, {
      requirePickupStatus: true,
      requireReadyToPlace: true
    });
    if (!pickupInvariant.ok) {
      return { error: pickupInvariant.error, status: pickupInvariant.status };
    }

    releasePickupAssemblyBins(orderId, nowIso());

    const containerCount = Number(containerCountRaw);
    if (!Number.isInteger(containerCount) || (containerCount !== 1 && containerCount !== 2)) {
      return { error: "Количество корзин должно быть 1 или 2.", status: 400 };
    }

    const sourcePlacements = Array.isArray(placementsRaw) ? placementsRaw : [];
    const placements = sourcePlacements.slice(0, 2).map((entry, index) => {
      const binQrCode = normalizePickupBinQr(entry?.binQr || entry?.bin_qr || "");
      const locationQrCode = normalizePickupLocationQr(entry?.locationQr || entry?.location_qr || "");
      return {
        slotIndex: index + 1,
        binQrCode,
        locationQrCode
      };
    });

    if (placements.length !== containerCount) {
      return { error: "Количество строк размещения не совпадает с количеством корзин.", status: 400 };
    }

    const usedBins = new Set();
    const usedLocations = new Set();
    for (const placement of placements) {
      if (!placement.binQrCode) {
        return { error: `Отсканируйте BIN для корзины ${placement.slotIndex}.`, status: 400 };
      }
      if (!pickupBinQrPattern.test(placement.binQrCode)) {
        return {
          error: `Некорректный BIN в строке ${placement.slotIndex}. Ожидается QR:BIN-001.`,
          status: 400
        };
      }
      if (!placement.locationQrCode) {
        return { error: `Отсканируйте LOC для корзины ${placement.slotIndex}.`, status: 400 };
      }
      if (!pickupLocationQrPattern.test(placement.locationQrCode)) {
        return {
          error: `Некорректный LOC в строке ${placement.slotIndex}. Ожидается QR:LOC-A01.`,
          status: 400
        };
      }
      if (usedBins.has(placement.binQrCode)) {
        return { error: `Корзина ${placement.binQrCode} уже добавлена в этом размещении.`, status: 409 };
      }
      if (usedLocations.has(placement.locationQrCode)) {
        return { error: `Ячейка ${placement.locationQrCode} уже добавлена в этом размещении.`, status: 409 };
      }
      usedBins.add(placement.binQrCode);
      usedLocations.add(placement.locationQrCode);
    }

    for (const placement of placements) {
      const catalogBin = workflowRepository.findBinCatalogEntry(placement.binQrCode);
      if (!catalogBin) {
        return { error: `BIN ${placement.binQrCode} отсутствует в пуле пустых корзин.`, status: 400 };
      }
      const basketInUse = workflowRepository.findActiveBasketByQrForPickupPlacement(placement.binQrCode);
      if (basketInUse) {
        return {
          error: `BIN ${placement.binQrCode} занят заказом ${basketInUse.public_id} (${getStationLabel(basketInUse.station)}).`,
          status: 409
        };
      }
      const activeBinPlacement = workflowRepository.findActivePickupPlacementByBin(placement.binQrCode);
      if (activeBinPlacement) {
        return {
          error: `BIN ${placement.binQrCode} уже закреплен за заказом ${activeBinPlacement.public_id}.`,
          status: 409
        };
      }

      const catalogLocation = workflowRepository.findPickupLocationCatalogEntry(placement.locationQrCode);
      if (!catalogLocation) {
        return { error: `LOC ${placement.locationQrCode} не найдена в каталоге.`, status: 400 };
      }
      const activeLocationPlacement = workflowRepository.findActivePickupPlacementByLocation(placement.locationQrCode);
      if (activeLocationPlacement) {
        return {
          error: `LOC ${placement.locationQrCode} уже занята заказом ${activeLocationPlacement.public_id}.`,
          status: 409
        };
      }
    }

    const timestamp = nowIso();
    try {
      runImmediateTransaction(db, () => {
        workflowRepository.releaseActivePickupOrderPlacements({ orderId, actor, timestamp });
        for (const placement of placements) {
          workflowRepository.insertPickupOrderPlacement({
            orderId,
            slotIndex: placement.slotIndex,
            binQrCode: placement.binQrCode,
            locationQrCode: placement.locationQrCode,
            actor,
            timestamp
          });
        }
        workflowRepository.markOrderPlacedForPickup({ orderId, timestamp });
        const placementSummary = placements
          .map((placement) => `${placement.binQrCode} -> ${placement.locationQrCode}`)
          .join("; ");
        insertScanEvent(orderId, null, "pickup", actor, "ok", `Заказ размещен на выдаче: ${placementSummary}.`, timestamp);
      });
    } catch (error) {
      return { error: error?.message || "Не удалось закрепить заказ за ячейкой выдачи.", status: 500 };
    }

    return {
      ok: true,
      message: "Размещение сохранено: BIN и LOC закреплены за заказом.",
      order: getOrderDetails(orderId),
      placements: placements.map((placement) => ({
        slot_index: placement.slotIndex,
        bin_qr_code: placement.binQrCode,
        location_qr_code: placement.locationQrCode
      }))
    };
  }

  function completePickup(orderId, actor) {
    const order = workflowRepository.findPickupCompletionOrder(orderId);
    if (!order) {
      return { error: "Заказ не найден", status: 404 };
    }
    if (order.status !== "pickup" || !order.ready_for_pickup) {
      return { error: "Заказ не готов к подтверждению выдачи", status: 400 };
    }
    const pickupInvariant = validatePickupInvariantState(orderId, {
      requirePickupStatus: true,
      requireReadyForPickup: true
    });
    if (!pickupInvariant.ok) {
      return { error: pickupInvariant.error, status: pickupInvariant.status };
    }
    const progress = getPickupScanProgress(orderId);
    if (!progress.complete) {
      return {
        error: `Сначала отсканируйте все корзины (${progress.scannedBaskets}/${progress.totalBaskets})`,
        status: 400
      };
    }

    const timestamp = nowIso();
    const orderBaskets = workflowRepository.listOrderBasketsForArchive(orderId);

    try {
      runImmediateTransaction(db, () => {
        workflowRepository.markOrderPickedUp({ orderId, timestamp });
        workflowRepository.releaseActivePickupOrderPlacements({ orderId, actor, timestamp });
        insertScanEvent(orderId, null, "pickup", actor, "ok", "Выдача подтверждена менеджером.", timestamp);

        for (const basket of orderBaskets) {
          const archivedQrCode = `ARCHIVED:${basket.id}:${timestamp}`;
          workflowRepository.archiveBasket({ basketId: basket.id, archivedQrCode, timestamp });
        }

        if (orderBaskets.length > 0) {
          insertScanEvent(orderId, null, "pickup", actor, "ok", `QR корзин освобождены для повторного использования: ${orderBaskets.length}.`, timestamp);
        }
        queueSync(orderId, "cleancloud.status", {
          orderId: order.cleancloud_order_id,
          status: "Завершён",
          allowCompleted: true
        });
      });
    } catch (error) {
      return { error: error?.message || "Не удалось подтвердить выдачу.", status: 500 };
    }

    return { ok: true, order: getOrderDetails(orderId) };
  }

  return {
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
    confirmQcTransferTask,
    listPendingQcTransferTasks,
    listReworkRequestsByOrder,
    releaseOrderFromHold,
    placeOrderForPickup,
    completePickup
  };
}

module.exports = {
  createWorkflowService
};
