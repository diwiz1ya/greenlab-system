const { parsePositiveInt, parseRequiredString, parseStation } = require("../http/validation");

function isMultipartRequest(req) {
  const contentType = String(req?.headers?.["content-type"] || "").toLowerCase();
  return contentType.includes("multipart/form-data");
}

function normalizeSortingBaskets(rawBaskets, filesByField = new Map()) {
  const source = Array.isArray(rawBaskets) ? rawBaskets : [];
  return source.slice(0, 20).map((basket) => {
    const photos = Array.isArray(basket?.photos)
      ? basket.photos.map((photo) => {
          const role = String(photo?.role || "").trim();
          const note = String(photo?.note || "").trim();
          const dataUrl = String(photo?.dataUrl || photo?.data_url || "").trim();
          const uploadField = String(photo?.uploadField || photo?.upload_field || "").trim();
          const file = uploadField ? filesByField.get(uploadField) : null;
          if (file && Buffer.isBuffer(file.buffer) && file.buffer.length > 0) {
            return {
              role,
              note,
              mimeType: String(file.contentType || "application/octet-stream").trim().toLowerCase(),
              fileBuffer: file.buffer
            };
          }
          return { role, note, dataUrl };
        })
      : [];
    return {
      type: String(basket?.type || "").trim(),
      itemCounts: basket?.itemCounts || basket?.item_counts || null,
      photos,
      qrCode: String(basket?.qrCode || basket?.qr_code || "").trim(),
      labelPrintedAt: String(basket?.labelPrintedAt || basket?.label_printed_at || "").trim(),
      labelPrintCount: Number(basket?.labelPrintCount ?? basket?.label_print_count ?? 0)
    };
  });
}

function normalizeSortingRequestBody(body, filesByField = new Map()) {
  const types = Array.isArray(body?.types)
    ? body.types
        .map((type) => String(type || "").trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];
  const routeSheetSource = Array.isArray(body?.routeSheets)
    ? body.routeSheets
    : (Array.isArray(body?.route_sheets) ? body.route_sheets : body?.baskets);
  const baskets = normalizeSortingBaskets(routeSheetSource, filesByField);
  return {
    orderId: parsePositiveInt(body?.orderId),
    types,
    baskets,
    routeSheets: baskets
  };
}

async function readSortingRequest(req, readJson, readMultipartForm) {
  if (!isMultipartRequest(req)) {
    return normalizeSortingRequestBody(await readJson(req));
  }

  const form = await readMultipartForm(req);
  const rawPayload = String(form?.fields?.payload || "").trim();
  if (!rawPayload) {
    throw new Error("Sorting payload is missing.");
  }

  let payload;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    throw new Error("Invalid JSON in payload field.");
  }

  const filesByField = new Map();
  const files = Array.isArray(form?.files) ? form.files : [];
  for (const file of files) {
    const fieldName = String(file?.fieldName || "").trim();
    if (!fieldName || filesByField.has(fieldName)) continue;
    filesByField.set(fieldName, file);
  }

  return normalizeSortingRequestBody(payload, filesByField);
}

async function handleWorkflowRoutes(req, res, url, ctx) {
  const {
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
    listIroningWorkbench,
    rejectBasketFromQc,
    createReworkRequestFromQc,
    approveReworkRequest,
    declineReworkRequest,
    listPendingQcTransferTasks,
    confirmQcTransferTask,
    inspectQcBasket,
    placeOrderForPickup,
    confirmPickupAssembly,
    completePickup,
    releaseOrderFromHold
  } = ctx;

  if (req.method === "POST" && /^\/api\/rework-requests\/\d+\/approve$/.test(url.pathname)) {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireManager(session, res)) return true;

    const parts = url.pathname.split("/");
    const requestId = parsePositiveInt(parts[3]);
    if (!requestId) {
      json(res, 400, { error: "Invalid request id" });
      return true;
    }

    readJson(req)
      .then(async (body) => {
        const result = await approveReworkRequest(requestId, session.username, body.note || body.decisionNote || "");
        if (result.error) {
          json(res, result.status, { error: result.error });
          return;
        }
        json(res, 200, result);
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === "POST" && /^\/api\/rework-requests\/\d+\/decline$/.test(url.pathname)) {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireManager(session, res)) return true;

    const parts = url.pathname.split("/");
    const requestId = parsePositiveInt(parts[3]);
    if (!requestId) {
      json(res, 400, { error: "Invalid request id" });
      return true;
    }

    readJson(req)
      .then(async (body) => {
        const result = await declineReworkRequest(requestId, session.username, body.note || body.decisionNote || "");
        if (result.error) {
          json(res, result.status, { error: result.error });
          return;
        }
        json(res, 200, result);
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === "POST" && /^\/api\/orders\/\d+\/release-hold$/.test(url.pathname)) {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireManager(session, res)) return true;

    const parts = url.pathname.split("/");
    const orderId = parsePositiveInt(parts[3]);
    if (!orderId) {
      json(res, 400, { error: "Invalid order id" });
      return true;
    }

    const result = await releaseOrderFromHold(orderId, session.username);
    if (result.error) {
      json(res, result.status, { error: result.error });
      return true;
    }

    json(res, 200, result);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/pickup/workbench") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireStationAccess(session, "pickup", res)) return true;

    const snapshot = await getPickupWorkbenchSnapshot();
    json(res, 200, {
      assemblyOrders: Array.isArray(snapshot?.assemblyOrders) ? snapshot.assemblyOrders : [],
      readyToPlaceOrders: Array.isArray(snapshot?.readyToPlaceOrders) ? snapshot.readyToPlaceOrders : [],
      placedOrders: Array.isArray(snapshot?.placedOrders) ? snapshot.placedOrders : [],
      // Backward-compatible payload for legacy clients.
      orders: Array.isArray(snapshot?.orders) ? snapshot.orders : [],
      stagingOrders: Array.isArray(snapshot?.stagingOrders) ? snapshot.stagingOrders : []
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/pickup/place-order") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireStationAccess(session, "pickup", res)) return true;

    readJson(req)
      .then(async (body) => {
        const orderId = parsePositiveInt(body?.orderId);
        if (!orderId) {
          json(res, 400, { error: "Invalid order id" });
          return;
        }

        const containerCount = Number(body?.containerCount ?? body?.container_count);
        const placements = Array.isArray(body?.placements) ? body.placements : [];

        try {
          const result = await runIdempotentOperation(req, {
            routeKey: `pickup.place-order:${orderId}`,
            actor: session.username,
            execute: () => placeOrderForPickup(orderId, containerCount, placements, session.username)
          });
          if (result.error) {
            json(res, result.status || 400, { error: result.error });
            return;
          }
          json(res, 200, result);
        } catch (error) {
          json(res, 500, { error: error.message || "Failed to place order into pickup location." });
        }
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  if (
    req.method === "POST"
    && (url.pathname === "/api/sorting/create-baskets" || url.pathname === "/api/sorting/create-route-sheets")
  ) {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireStationAccess(session, "sorting", res)) return true;

    readSortingRequest(req, readJson, readMultipartForm)
      .then(async (body) => {
        const orderId = parsePositiveInt(body?.orderId);
        if (!orderId) {
          json(res, 400, { error: "Invalid order id" });
          return;
        }

        const types = Array.isArray(body?.types) ? body.types : [];
        const baskets = Array.isArray(body?.routeSheets) ? body.routeSheets : [];

        try {
          const result = await runIdempotentOperation(req, {
            routeKey: `sorting.create-baskets:${orderId}`,
            actor: session.username,
            execute: () => createBaskets(orderId, { types, baskets }, session.username)
          });
          if (result.error) {
            json(res, result.status, { error: result.error });
            return;
          }
          json(res, 200, result);
        } catch (error) {
          json(res, 500, { error: error.message || "Failed to create baskets" });
        }
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/ironing/workbench") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireStationAccess(session, "ironing", res)) return true;

    const snapshot = await listIroningWorkbench();
    json(res, 200, {
      station: "ironing",
      activeSessions: Array.isArray(snapshot?.activeSessions) ? snapshot.activeSessions : []
    });
    return true;
  }

  if (
    req.method === "POST"
    && (url.pathname === "/api/sorting/update-baskets" || url.pathname === "/api/sorting/update-route-sheets")
  ) {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireStationAccess(session, "sorting", res)) return true;

    readSortingRequest(req, readJson, readMultipartForm)
      .then(async (body) => {
        const orderId = parsePositiveInt(body?.orderId);
        if (!orderId) {
          json(res, 400, { error: "Invalid order id" });
          return;
        }

        const types = Array.isArray(body?.types) ? body.types : [];
        const baskets = Array.isArray(body?.routeSheets) ? body.routeSheets : [];
        try {
          const result = await runIdempotentOperation(req, {
            routeKey: `sorting.update-baskets:${orderId}`,
            actor: session.username,
            execute: () => updateSortedBaskets(orderId, { types, baskets }, session.username)
          });
          if (result.error) {
            json(res, result.status, { error: result.error });
            return;
          }
          json(res, 200, result);
        } catch (error) {
          json(res, 500, { error: error.message || "Failed to update baskets" });
        }
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/sorting/return-to-sorting") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireStationAccess(session, "sorting", res)) return true;

    readJson(req)
      .then(async (body) => {
        const orderId = parsePositiveInt(body.orderId);
        if (!orderId) {
          json(res, 400, { error: "Invalid order id" });
          return;
        }

        const result = await returnSortedOrderToSorting(orderId, session.username);
        if (result.error) {
          json(res, result.status, { error: result.error });
          return;
        }
        json(res, 200, result);
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/machines/workbench") {
    const session = requireAuth(req, res);
    if (!session) return true;

    const station = parseStation(stationLabels, url.searchParams.get("station"));
    if (!station || (station !== "washing" && station !== "drying")) {
      json(res, 400, { error: "Set station to washing or drying." });
      return true;
    }
    if (!requireStationAccess(session, station, res)) return true;

    const result = await listMachineWorkbench(station);
    if (result.error) {
      json(res, result.status || 400, { error: result.error });
      return true;
    }
    json(res, 200, result);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/machines/loads/start") {
    const session = requireAuth(req, res);
    if (!session) return true;

    readJson(req)
      .then(async (body) => {
        const station = parseStation(stationLabels, body.station);
        if (!station || (station !== "washing" && station !== "drying")) {
          json(res, 400, { error: "Set station to washing or drying." });
          return;
        }
        if (!requireStationAccess(session, station, res)) return;

        const machineCode = parseRequiredString(body.machineCode || body.machine_code, { minLength: 2, maxLength: 64 });
        if (!machineCode) {
          json(res, 400, { error: "Machine QR code is required." });
          return;
        }
        const basketQrs = Array.isArray(body.basketQrs || body.basket_qrs)
          ? (body.basketQrs || body.basket_qrs)
          : [];
        if (basketQrs.length > 1) {
          json(res, 400, { error: "Only one basket is allowed per machine cycle." });
          return;
        }

        let result;
        try {
          result = await runIdempotentOperation(req, {
            routeKey: `machines.loads.start:${station}:${machineCode}`,
            actor: session.username,
            execute: () => startMachineLoad(station, machineCode, basketQrs, session.username)
          });
        } catch (error) {
          json(res, 500, { error: error.message || "Failed to start machine cycle." });
          return;
        }
        if (result.error) {
          json(res, result.status || 400, { error: result.error });
          return;
        }
        json(res, 200, result);
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/machines/loads/validate-basket") {
    const session = requireAuth(req, res);
    if (!session) return true;

    readJson(req)
      .then(async (body) => {
        const station = parseStation(stationLabels, body.station);
        if (!station || (station !== "washing" && station !== "drying")) {
          json(res, 400, { error: "Set station to washing or drying." });
          return;
        }
        if (!requireStationAccess(session, station, res)) return;

        const basketQr = parseRequiredString(body.basketQr || body.basket_qr, { minLength: 3, maxLength: 128 });
        if (!basketQr) {
          json(res, 400, { error: "Basket QR code is required." });
          return;
        }

        const result = await validateMachineLoadBasket(station, basketQr);
        if (result.error) {
          json(res, result.status || 400, { error: result.error });
          return;
        }
        json(res, 200, result);
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === "POST" && /^\/api\/machines\/loads\/\d+\/cancel$/.test(url.pathname)) {
    const session = requireAuth(req, res);
    if (!session) return true;

    const parts = url.pathname.split("/");
    const loadId = parsePositiveInt(parts[4]);
    if (!loadId) {
      json(res, 400, { error: "Invalid cycle id" });
      return true;
    }

    readJson(req)
      .then(async (body) => {
        const station = parseStation(stationLabels, body.station);
        if (!station || (station !== "washing" && station !== "drying")) {
          json(res, 400, { error: "Set station to washing or drying." });
          return;
        }
        if (!requireStationAccess(session, station, res)) return;

        const result = await cancelMachineLoad(loadId, session.username, { expectedStation: station });
        if (result.error) {
          json(res, result.status || 400, { error: result.error });
          return;
        }
        json(res, 200, result);
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === "POST" && /^\/api\/machines\/loads\/\d+\/unload-basket$/.test(url.pathname)) {
    const session = requireAuth(req, res);
    if (!session) return true;

    const parts = url.pathname.split("/");
    const loadId = parsePositiveInt(parts[4]);
    if (!loadId) {
      json(res, 400, { error: "Invalid cycle id" });
      return true;
    }

    readJson(req)
      .then(async (body) => {
        const station = parseStation(stationLabels, body.station);
        if (!station || (station !== "washing" && station !== "drying")) {
          json(res, 400, { error: "Set station to washing or drying." });
          return;
        }
        if (!requireStationAccess(session, station, res)) return;

        const basketQr = parseRequiredString(body.basketQr || body.basket_qr, { minLength: 3, maxLength: 128 });
        if (!basketQr) {
          json(res, 400, { error: "Basket QR code is required." });
          return;
        }

        let result;
        try {
          result = await runIdempotentOperation(req, {
            routeKey: `machines.loads.unload:${loadId}`,
            actor: session.username,
            execute: () => unloadBasketFromMachineLoad(loadId, basketQr, session.username, { expectedStation: station })
          });
        } catch (error) {
          json(res, 500, { error: error.message || "Failed to unload basket." });
          return;
        }
        if (result.error) {
          json(res, result.status || 400, { error: result.error });
          return;
        }
        json(res, 200, result);
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/scan") {
    const session = requireAuth(req, res);
    if (!session) return true;

    readJson(req)
      .then(async (body) => {
        const station = parseStation(stationLabels, body.station);
        if (!station) {
          json(res, 400, { error: "Unknown station" });
          return;
        }
        if (!requireStationAccess(session, station, res)) return;

        const qrCode = parseRequiredString(body.qrCode, { minLength: 3, maxLength: 128 });
        if (!qrCode) {
          json(res, 400, { error: "QR code is required." });
          return;
        }
        const expectedOrderId = parsePositiveInt(body.expectedOrderId || body.expected_order_id);

        const result = await scanBasket(station, qrCode, session.username, {
          expectedOrderId: expectedOrderId || null
        });
        json(res, result.status, result.payload);
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/qc/reject") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireStationAccess(session, "qc", res)) return true;

    readJson(req)
      .then(async (body) => {
        const qrCode = parseRequiredString(body.qrCode, { minLength: 3, maxLength: 128 });
        if (!qrCode) {
          json(res, 400, { error: "QR code is required." });
          return;
        }
        const result = await rejectBasketFromQc(qrCode, session.username, body.reason);
        json(res, result.status, result.payload);
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/qc/transfer-tasks") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireStationAccess(session, "qc", res)) return true;

    json(res, 200, { tasks: await listPendingQcTransferTasks() });
    return true;
  }

  if (req.method === "POST" && /^\/api\/qc\/transfer-tasks\/\d+\/confirm$/.test(url.pathname)) {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireStationAccess(session, "qc", res)) return true;

    const parts = url.pathname.split("/");
    const requestId = parsePositiveInt(parts[4]);
    if (!requestId) {
      json(res, 400, { error: "Invalid request id" });
      return true;
    }

    readJson(req)
      .then(async (body) => {
        const sourceQrCodeRaw = parseRequiredString(body.sourceQrCode || body.source_qr_code, { minLength: 3, maxLength: 128 });

        const targetQrCodeRaw = parseRequiredString(body.targetQrCode || body.target_qr_code, { minLength: 3, maxLength: 128 });

        const result = await confirmQcTransferTask(requestId, session.username, {
          sourceQrCode: sourceQrCodeRaw || "",
          targetQrCode: targetQrCodeRaw || "",
          handoffNote: body.note || body.handoffNote || ""
        });
        if (result.error) {
          json(res, result.status, { error: result.error });
          return;
        }
        json(res, 200, result);
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/qc/rework") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireStationAccess(session, "qc", res)) return true;

    readJson(req)
      .then(async (body) => {
        const qrCode = parseRequiredString(body.qrCode, { minLength: 3, maxLength: 128 });
        if (!qrCode) {
          json(res, 400, { error: "QR code is required." });
          return;
        }
        const result = await createReworkRequestFromQc(qrCode, session.username, {
          reason: body.reason,
          itemCategory: body.itemCategory || body.item_category,
          itemLabel: body.itemLabel || body.item_label,
          quantity: body.quantity,
          issueImageId: body.issueImageId || body.issue_image_id,
          qcPhotoDataUrl: body.qcPhotoDataUrl || body.qc_photo_data_url
        });
        json(res, result.status, result.payload);
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/qc/inspect") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireStationAccess(session, "qc", res)) return true;

    readJson(req)
      .then(async (body) => {
        const qrCode = parseRequiredString(body.qrCode, { minLength: 3, maxLength: 128 });
        if (!qrCode) {
          json(res, 400, { error: "QR code is required." });
          return;
        }
        const result = await inspectQcBasket(qrCode);
        json(res, result.status, result.payload);
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/pickup/complete") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireManager(session, res)) return true;

    readJson(req)
      .then(async (body) => {
        const orderId = parsePositiveInt(body.orderId);
        if (!orderId) {
          json(res, 400, { error: "Invalid order id" });
          return;
        }

        const result = await completePickup(orderId, session.username);
        if (result.error) {
          json(res, result.status, { error: result.error });
          return;
        }
        json(res, 200, result);
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/pickup/confirm-assembled") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireStationAccess(session, "pickup", res)) return true;

    readJson(req)
      .then(async (body) => {
        const orderId = parsePositiveInt(body.orderId);
        if (!orderId) {
          json(res, 400, { error: "Invalid order id" });
          return;
        }

        const result = await confirmPickupAssembly(orderId, session.username);
        if (result.error) {
          json(res, result.status, { error: result.error });
          return;
        }
        json(res, 200, result);
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return true;
  }

  return false;
}

module.exports = {
  handleWorkflowRoutes
};
