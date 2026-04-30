function changes(result) {
  return { changes: result.rowCount };
}

function createPlaceholders(values, startIndex = 1) {
  return values.map((_, index) => `$${startIndex + index}`).join(", ");
}

function readInsertedId(result, label) {
  const rowId = Number(result.rows[0]?.id || 0);
  if (!Number.isInteger(rowId) || rowId <= 0) {
    throw new Error(`Failed to read inserted ${label} id.`);
  }
  return rowId;
}

function createPostgresReworkRepository(queryable) {
  async function listBasketImages(basketId) {
    const result = await queryable.query(
      `
        SELECT id, image_role, sort_order, note, public_url, created_at
        FROM basket_images
        WHERE basket_id = $1
        ORDER BY sort_order, id
      `,
      [basketId]
    );
    return result.rows;
  }

  async function listReworkRequestsByOrder(orderId) {
    const result = await queryable.query(
      `
        SELECT
          rr.*,
          source.basket_code AS source_basket_code,
          rework.basket_code AS rework_basket_code,
          rework.qr_code AS rework_basket_qr_code
        FROM rework_requests rr
        JOIN baskets source ON source.id = rr.source_basket_id
        LEFT JOIN baskets rework ON rework.id = rr.rework_basket_id
        WHERE rr.order_id = $1
        ORDER BY rr.id DESC
      `,
      [orderId]
    );
    return result.rows;
  }

  async function listPendingReworkRequestsByBasketId({ basketId, statuses }) {
    const statusValues = Array.isArray(statuses) ? statuses : [];
    if (!statusValues.length) return [];
    const result = await queryable.query(
      `
        SELECT
          rr.*,
          source.basket_code AS source_basket_code,
          rework.basket_code AS rework_basket_code,
          rework.qr_code AS rework_basket_qr_code
        FROM rework_requests rr
        JOIN baskets source ON source.id = rr.source_basket_id
        LEFT JOIN baskets rework ON rework.id = rr.rework_basket_id
        WHERE rr.source_basket_id = $1
          AND rr.request_status IN (${createPlaceholders(statusValues, 2)})
        ORDER BY rr.id DESC
      `,
      [basketId, ...statusValues]
    );
    return result.rows;
  }

  async function getReworkRequestWithContext(requestId) {
    const result = await queryable.query(
      `
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
        WHERE rr.id = $1
      `,
      [requestId]
    );
    return result.rows[0] || null;
  }

  async function getQcTransferTaskWithContext(requestId) {
    const result = await queryable.query(
      `
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
        WHERE rr.id = $1
      `,
      [requestId]
    );
    return result.rows[0] || null;
  }

  async function listPendingQcTransferTasks({ statuses }) {
    const statusValues = Array.isArray(statuses) ? statuses : [];
    if (!statusValues.length) return [];
    const result = await queryable.query(
      `
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
        WHERE rr.request_status IN (${createPlaceholders(statusValues)})
          AND rr.rework_basket_id IS NULL
          AND rr.handoff_confirmed_at IS NULL
        ORDER BY rr.decision_at DESC, rr.id DESC
      `,
      statusValues
    );
    return result.rows;
  }

  async function findBasketWithOrderByQr(qrCode) {
    const result = await queryable.query(
      `
        SELECT b.*, o.cleancloud_order_id, o.id AS order_db_id, o.public_id
        FROM baskets b
        JOIN orders o ON o.id = b.order_id
        WHERE b.qr_code = $1
      `,
      [qrCode]
    );
    return result.rows[0] || null;
  }

  async function getNextReworkAttempt({ orderId, rootBasketId }) {
    const result = await queryable.query(
      `
        SELECT COALESCE(MAX(rework_attempt), 0) AS max_attempt
        FROM baskets
        WHERE order_id = $1 AND parent_basket_id = $2
      `,
      [orderId, rootBasketId]
    );
    return Number(result.rows[0]?.max_attempt || 0) + 1;
  }

  async function findQcBasketForInspection(qrCode) {
    const result = await queryable.query(
      `
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
        WHERE b.qr_code = $1
      `,
      [qrCode]
    );
    return result.rows[0] || null;
  }

  async function insertQcScanErrorEvent({ orderId, basketId, actor, message, timestamp }) {
    const result = await queryable.query(
      `
        INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
        VALUES ($1, $2, 'qc', $3, 'error', $4, $5)
      `,
      [orderId, basketId, actor, message, timestamp]
    );
    return changes(result);
  }

  async function createPendingReworkRequest({
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
  }) {
    const result = await queryable.query(
      `
        INSERT INTO rework_requests (
          order_id, source_basket_id, item_category, item_label, quantity,
          source_image_id, source_image_url, source_image_note, qc_photo_path, qc_photo_url,
          reason_code, service_label, extra_days, request_status,
          requested_by, requested_at, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING id
      `,
      [
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
      ]
    );
    return readInsertedId(result, "rework request");
  }

  async function getReworkRequestById(requestId) {
    const result = await queryable.query(
      `
        SELECT
          rr.*,
          source.basket_code AS source_basket_code,
          rework.basket_code AS rework_basket_code,
          rework.qr_code AS rework_basket_qr_code
        FROM rework_requests rr
        JOIN baskets source ON source.id = rr.source_basket_id
        LEFT JOIN baskets rework ON rework.id = rr.rework_basket_id
        WHERE rr.id = $1
      `,
      [requestId]
    );
    return result.rows[0] || null;
  }

  async function updateBasketStationStatus({ basketId, station, status, timestamp }) {
    const result = await queryable.query(
      `
        UPDATE baskets
        SET station = $1, status = $2, updated_at = $3
        WHERE id = $4
      `,
      [station, status, timestamp, basketId]
    );
    return changes(result);
  }

  async function updateBasketStationStatusIfCurrent({
    basketId,
    station,
    status,
    timestamp,
    expectedStation,
    expectedStatus
  }) {
    const result = await queryable.query(
      `
        UPDATE baskets
        SET station = $1, status = $2, updated_at = $3
        WHERE id = $4
          AND station = $5
          AND status = $6
      `,
      [station, status, timestamp, basketId, expectedStation, expectedStatus]
    );
    return changes(result);
  }

  async function insertScanOkEvent({ orderId, basketId, station, actor, message, timestamp }) {
    const result = await queryable.query(
      `
        INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
        VALUES ($1, $2, $3, $4, 'ok', $5, $6)
      `,
      [orderId, basketId, station, actor, message, timestamp]
    );
    return changes(result);
  }

  async function updateReworkRequestDecision({
    requestId,
    requestStatus,
    actor,
    timestamp,
    decisionNote,
    expectedStatus
  }) {
    const result = await queryable.query(
      `
        UPDATE rework_requests
        SET request_status = $1, decision_actor = $2, decision_at = $3, decision_note = $4, updated_at = $5
        WHERE id = $6
          AND request_status = $7
      `,
      [requestStatus, actor, timestamp, decisionNote, timestamp, requestId, expectedStatus]
    );
    return changes(result);
  }

  async function confirmReturnTask({
    requestId,
    requestStatus,
    decisionActor,
    decisionAt,
    decisionNote,
    handoffActor,
    handoffAt,
    handoffNote,
    expectedStatus
  }) {
    const result = await queryable.query(
      `
        UPDATE rework_requests
        SET request_status = $1, decision_actor = $2, decision_at = $3,
            decision_note = $4, handoff_confirmed_by = $5, handoff_confirmed_at = $6, handoff_note = $7, updated_at = $8
        WHERE id = $9
          AND request_status = $10
          AND handoff_confirmed_at IS NULL
      `,
      [requestStatus, decisionActor, decisionAt, decisionNote, handoffActor, handoffAt, handoffNote, handoffAt, requestId, expectedStatus]
    );
    return changes(result);
  }

  async function createReworkBasket({
    orderId,
    basketCode,
    basketType,
    basketItemsJson,
    rootBasketId,
    reasonCode,
    attempt,
    station,
    qrCode,
    timestamp
  }) {
    const result = await queryable.query(
      `
        INSERT INTO baskets (
          order_id, basket_code, basket_type, basket_items_json, basket_kind, parent_basket_id,
          rework_reason, rework_attempt, station, status, qr_code, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, 'rework', $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id
      `,
      [orderId, basketCode, basketType, basketItemsJson, rootBasketId, reasonCode, attempt, station, station, qrCode, timestamp, timestamp]
    );
    return readInsertedId(result, "rework basket");
  }

  async function updateSourceBasketAfterTransfer({
    sourceBasketId,
    basketItemsJson,
    station,
    status,
    timestamp,
    expectedStation,
    expectedStatus
  }) {
    const result = await queryable.query(
      `
        UPDATE baskets
        SET basket_items_json = $1, station = $2, status = $3, updated_at = $4
        WHERE id = $5
          AND station = $6
          AND status = $7
      `,
      [basketItemsJson, station, status, timestamp, sourceBasketId, expectedStation, expectedStatus]
    );
    return changes(result);
  }

  async function confirmTransferTask({
    requestId,
    reworkBasketId,
    requestStatus,
    decisionActor,
    decisionAt,
    decisionNote,
    handoffActor,
    handoffAt,
    handoffNote,
    expectedStatus
  }) {
    const result = await queryable.query(
      `
        UPDATE rework_requests
        SET rework_basket_id = $1, request_status = $2, decision_actor = $3, decision_at = $4,
            decision_note = $5, handoff_confirmed_by = $6, handoff_confirmed_at = $7, handoff_note = $8, updated_at = $9
        WHERE id = $10
          AND request_status = $11
          AND rework_basket_id IS NULL
          AND handoff_confirmed_at IS NULL
      `,
      [reworkBasketId, requestStatus, decisionActor, decisionAt, decisionNote, handoffActor, handoffAt, handoffNote, handoffAt, requestId, expectedStatus]
    );
    return changes(result);
  }

  async function updateOrderBasketsToHold({ orderId, holdStation, timestamp }) {
    const result = await queryable.query(
      `
        UPDATE baskets
        SET station = $1, status = $2, updated_at = $3
        WHERE order_id = $4
          AND station = status
      `,
      [holdStation, holdStation, timestamp, orderId]
    );
    return changes(result);
  }

  async function updateOrderToHold({ orderId, holdStation, holdCloudStatus, timestamp }) {
    const result = await queryable.query(
      `
        UPDATE orders
        SET status = $1, cleancloud_status = $2, ready_to_place = 0, ready_for_pickup = 0, updated_at = $3
        WHERE id = $4
      `,
      [holdStation, holdCloudStatus, timestamp, orderId]
    );
    return changes(result);
  }

  return {
    listBasketImages,
    listReworkRequestsByOrder,
    listPendingReworkRequestsByBasketId,
    getReworkRequestWithContext,
    getQcTransferTaskWithContext,
    listPendingQcTransferTasks,
    findBasketWithOrderByQr,
    getNextReworkAttempt,
    findQcBasketForInspection,
    insertQcScanErrorEvent,
    createPendingReworkRequest,
    getReworkRequestById,
    updateBasketStationStatus,
    updateBasketStationStatusIfCurrent,
    insertScanOkEvent,
    updateReworkRequestDecision,
    confirmReturnTask,
    createReworkBasket,
    updateSourceBasketAfterTransfer,
    confirmTransferTask,
    updateOrderBasketsToHold,
    updateOrderToHold
  };
}

module.exports = {
  createPostgresReworkRepository
};
