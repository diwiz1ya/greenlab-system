const { getLastInsertRowId } = require("./statement-result");

function createSqliteReworkRepository(db) {
  const listBasketImagesStmt = db.prepare(`
    SELECT id, image_role, sort_order, note, public_url, created_at
    FROM basket_images
    WHERE basket_id = ?
    ORDER BY sort_order, id
  `);
  const listReworkRequestsByOrderStmt = db.prepare(`
    SELECT
      rr.*,
      source.basket_code AS source_basket_code,
      rework.basket_code AS rework_basket_code,
      rework.qr_code AS rework_basket_qr_code
    FROM rework_requests rr
    JOIN baskets source ON source.id = rr.source_basket_id
    LEFT JOIN baskets rework ON rework.id = rr.rework_basket_id
    WHERE rr.order_id = ?
    ORDER BY rr.id DESC
  `);
  const listPendingReworkRequestsByBasketIdStmt = db.prepare(`
    SELECT
      rr.*,
      source.basket_code AS source_basket_code,
      rework.basket_code AS rework_basket_code,
      rework.qr_code AS rework_basket_qr_code
    FROM rework_requests rr
    JOIN baskets source ON source.id = rr.source_basket_id
    LEFT JOIN baskets rework ON rework.id = rr.rework_basket_id
    WHERE rr.source_basket_id = ?
      AND rr.request_status IN (?, ?, ?)
    ORDER BY rr.id DESC
  `);
  const getReworkRequestWithContextStmt = db.prepare(`
    SELECT
      rr.*,
      source.order_id AS source_order_id,
      source.basket_code AS source_basket_code,
      source.basket_type AS source_basket_type,
      source.basket_items_json AS source_basket_items_json,
      source.basket_kind AS source_basket_kind,
      source.parent_basket_id AS source_parent_basket_id,
      source.station AS source_station,
      source.status AS source_status,
      source.qr_code AS source_qr_code,
      o.public_id AS order_public_id,
      o.cleancloud_order_id
    FROM rework_requests rr
    JOIN baskets source ON source.id = rr.source_basket_id
    JOIN orders o ON o.id = rr.order_id
    WHERE rr.id = ?
  `);
  const getQcTransferTaskWithContextStmt = db.prepare(`
    SELECT
      rr.*,
      source.basket_code AS source_basket_code,
      source.qr_code AS source_basket_qr_code,
      source.basket_type AS source_basket_type,
      source.basket_items_json AS source_basket_items_json,
      source.basket_kind AS source_basket_kind,
      source.parent_basket_id AS source_parent_basket_id,
      source.station AS source_station,
      source.status AS source_status,
      rework.basket_code AS rework_basket_code,
      rework.qr_code AS rework_basket_qr_code,
      rework.station AS rework_station,
      rework.status AS rework_status,
      o.public_id AS order_public_id,
      o.customer_name AS order_customer_name,
      o.cleancloud_order_id
    FROM rework_requests rr
    JOIN baskets source ON source.id = rr.source_basket_id
    LEFT JOIN baskets rework ON rework.id = rr.rework_basket_id
    JOIN orders o ON o.id = rr.order_id
    WHERE rr.id = ?
  `);
  const listPendingQcTransferTasksStmt = db.prepare(`
    SELECT
      rr.*,
      source.basket_code AS source_basket_code,
      source.qr_code AS source_basket_qr_code,
      source.basket_type AS source_basket_type,
      source.basket_kind AS source_basket_kind,
      source.parent_basket_id AS source_parent_basket_id,
      source.station AS source_station,
      source.status AS source_status,
      rework.basket_code AS rework_basket_code,
      rework.qr_code AS rework_basket_qr_code,
      rework.station AS rework_station,
      rework.status AS rework_status,
      o.public_id AS order_public_id,
      o.customer_name AS order_customer_name
    FROM rework_requests rr
    JOIN baskets source ON source.id = rr.source_basket_id
    LEFT JOIN baskets rework ON rework.id = rr.rework_basket_id
    JOIN orders o ON o.id = rr.order_id
    WHERE rr.request_status IN (?, ?)
      AND rr.rework_basket_id IS NULL
      AND rr.handoff_confirmed_at IS NULL
    ORDER BY datetime(rr.decision_at) DESC, rr.id DESC
  `);
  const findBasketWithOrderByQrStmt = db.prepare(`
    SELECT b.*, o.cleancloud_order_id, o.id AS order_db_id, o.public_id
    FROM baskets b
    JOIN orders o ON o.id = b.order_id
    WHERE b.qr_code = ?
  `);
  const getNextReworkAttemptStmt = db.prepare(`
    SELECT COALESCE(MAX(rework_attempt), 0) AS max_attempt
    FROM baskets
    WHERE order_id = ? AND parent_basket_id = ?
  `);
  const findQcBasketForInspectionStmt = db.prepare(`
    SELECT
      b.*,
      o.id AS order_db_id,
      o.public_id,
      o.customer_name,
      o.order_weight,
      o.customer_phone,
      o.customer_email,
      o.cleancloud_status
    FROM baskets b
    JOIN orders o ON o.id = b.order_id
    WHERE b.qr_code = ?
  `);
  const insertQcScanErrorEventStmt = db.prepare(`
    INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
    VALUES (?, ?, 'qc', ?, 'error', ?, ?)
  `);
  const insertPendingReworkRequestStmt = db.prepare(`
    INSERT INTO rework_requests (
      order_id, source_basket_id, item_category, item_label, quantity,
      source_image_id, source_image_url, source_image_note, qc_photo_path, qc_photo_url,
      reason_code, service_label, extra_days, request_status,
      requested_by, requested_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getReworkRequestByIdStmt = db.prepare(`
    SELECT
      rr.*,
      source.basket_code AS source_basket_code,
      rework.basket_code AS rework_basket_code,
      rework.qr_code AS rework_basket_qr_code
    FROM rework_requests rr
    JOIN baskets source ON source.id = rr.source_basket_id
    LEFT JOIN baskets rework ON rework.id = rr.rework_basket_id
    WHERE rr.id = ?
  `);
  const updateBasketStationStatusStmt = db.prepare(`
    UPDATE baskets
    SET station = ?, status = ?, updated_at = ?
    WHERE id = ?
  `);
  const updateBasketStationStatusIfCurrentStmt = db.prepare(`
    UPDATE baskets
    SET station = ?, status = ?, updated_at = ?
    WHERE id = ?
      AND station = ?
      AND status = ?
  `);
  const insertScanOkEventStmt = db.prepare(`
    INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
    VALUES (?, ?, ?, ?, 'ok', ?, ?)
  `);
  const updateReworkRequestDecisionStmt = db.prepare(`
    UPDATE rework_requests
    SET request_status = ?, decision_actor = ?, decision_at = ?, decision_note = ?, updated_at = ?
    WHERE id = ?
      AND request_status = ?
  `);

  return {
    listBasketImages: (basketId) => listBasketImagesStmt.all(basketId),
    listReworkRequestsByOrder: (orderId) => listReworkRequestsByOrderStmt.all(orderId),
    listPendingReworkRequestsByBasketId: ({ basketId, statuses }) => listPendingReworkRequestsByBasketIdStmt.all(basketId, ...statuses),
    getReworkRequestWithContext: (requestId) => getReworkRequestWithContextStmt.get(requestId),
    getQcTransferTaskWithContext: (requestId) => getQcTransferTaskWithContextStmt.get(requestId),
    listPendingQcTransferTasks: ({ statuses }) => listPendingQcTransferTasksStmt.all(...statuses),
    findBasketWithOrderByQr: (qrCode) => findBasketWithOrderByQrStmt.get(qrCode),
    getNextReworkAttempt: ({ orderId, rootBasketId }) => {
      const row = getNextReworkAttemptStmt.get(orderId, rootBasketId);
      return Number(row?.max_attempt || 0) + 1;
    },
    findQcBasketForInspection: (qrCode) => findQcBasketForInspectionStmt.get(qrCode),
    insertQcScanErrorEvent: ({ orderId, basketId, actor, message, timestamp }) => insertQcScanErrorEventStmt.run(
      orderId,
      basketId,
      actor,
      message,
      timestamp
    ),
    createPendingReworkRequest: ({
      orderId,
      sourceBasketId,
      itemCategory,
      itemLabel,
      quantity,
      selectedImage,
      qcPhoto,
      reasonCode,
      serviceLabel,
      extraDays,
      requestStatus,
      actor,
      timestamp
    }) => {
      const result = insertPendingReworkRequestStmt.run(
        orderId,
        sourceBasketId,
        itemCategory,
        itemLabel,
        quantity,
        selectedImage?.id || null,
        selectedImage?.public_url || null,
        selectedImage?.note || null,
        qcPhoto?.filePath || null,
        qcPhoto?.publicUrl || null,
        reasonCode,
        serviceLabel,
        extraDays,
        requestStatus,
        actor,
        timestamp,
        timestamp,
        timestamp
      );
      return getLastInsertRowId(result, "rework request");
    },
    getReworkRequestById: (requestId) => getReworkRequestByIdStmt.get(requestId),
    updateBasketStationStatus: ({ basketId, station, status, timestamp }) => updateBasketStationStatusStmt.run(
      station,
      status,
      timestamp,
      basketId
    ),
    updateBasketStationStatusIfCurrent: ({
      basketId,
      station,
      status,
      timestamp,
      expectedStation,
      expectedStatus
    }) => updateBasketStationStatusIfCurrentStmt.run(
      station,
      status,
      timestamp,
      basketId,
      expectedStation,
      expectedStatus
    ),
    insertScanOkEvent: ({ orderId, basketId, station, actor, message, timestamp }) => insertScanOkEventStmt.run(
      orderId,
      basketId,
      station,
      actor,
      message,
      timestamp
    ),
    updateReworkRequestDecision: ({
      requestId,
      requestStatus,
      actor,
      timestamp,
      decisionNote,
      expectedStatus
    }) => updateReworkRequestDecisionStmt.run(
      requestStatus,
      actor,
      timestamp,
      decisionNote,
      timestamp,
      requestId,
      expectedStatus
    )
  };
}

module.exports = {
  createSqliteReworkRepository
};
