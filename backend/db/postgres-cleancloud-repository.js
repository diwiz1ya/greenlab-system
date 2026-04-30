const ORDER_CONTACT_COLUMNS = new Set([
  "customer_id",
  "order_weight",
  "customer_phone",
  "customer_email",
  "customer_name"
]);

function countRows(result) {
  return Number(result?.rows?.[0]?.count || 0);
}

function changes(result) {
  return { changes: result.rowCount };
}

function createPostgresCleanCloudRepository(queryable) {
  async function findPendingSyncDuplicate(orderId, action, payloadJson) {
    const result = await queryable.query(
      `
        SELECT id
        FROM sync_queue
        WHERE order_id = $1 AND action = $2 AND payload = $3 AND status IN ('pending', 'processing')
        LIMIT 1
      `,
      [orderId, action, payloadJson]
    );
    return result.rows[0] || null;
  }

  async function insertSyncQueueItem({ orderId, action, payloadJson, createdAt }) {
    const result = await queryable.query(
      `
        INSERT INTO sync_queue (order_id, action, payload, status, created_at, processed_at, attempts, last_error)
        VALUES ($1, $2, $3, 'pending', $4, NULL, 0, NULL)
      `,
      [orderId, action, payloadJson, createdAt]
    );
    return changes(result);
  }

  async function findOrderContactById(orderId) {
    const result = await queryable.query(
      `
        SELECT id, public_id, cleancloud_order_id, customer_name, customer_id, order_weight, customer_phone, customer_email
        FROM orders
        WHERE id = $1
      `,
      [orderId]
    );
    return result.rows[0] || null;
  }

  async function updateOrderContact(orderId, fields, timestamp) {
    const updates = [];
    const params = [];

    for (const [column, value] of Object.entries(fields || {})) {
      if (!ORDER_CONTACT_COLUMNS.has(column)) {
        throw new Error(`Unsupported order contact column: ${column}`);
      }
      params.push(value);
      updates.push(`${column} = $${params.length}`);
    }

    if (!updates.length) {
      return { changes: 0 };
    }

    params.push(timestamp);
    updates.push(`updated_at = $${params.length}`);
    params.push(orderId);

    const result = await queryable.query(
      `
        UPDATE orders
        SET ${updates.join(", ")}
        WHERE id = $${params.length}
      `,
      params
    );
    return changes(result);
  }

  async function insertOverviewScanEvent({ orderId, actor, message, timestamp }) {
    const result = await queryable.query(
      `
        INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
        VALUES ($1, NULL, 'overview', $2, 'ok', $3, $4)
      `,
      [orderId, actor, message, timestamp]
    );
    return changes(result);
  }

  async function markSyncQueueProcessed({ id, processedAt, note }) {
    const result = await queryable.query(
      `
        UPDATE sync_queue
        SET status = 'processed', processed_at = $1, last_error = $2
        WHERE id = $3
      `,
      [processedAt, note, id]
    );
    return changes(result);
  }

  async function markSyncQueueRetry({ id, status, attempts, errorMessage, processedAt }) {
    const result = await queryable.query(
      `
        UPDATE sync_queue
        SET status = $1, attempts = $2, last_error = $3, processed_at = $4
        WHERE id = $5
      `,
      [status, attempts, errorMessage, processedAt, id]
    );
    return changes(result);
  }

  async function keepSyncQueuePending({ id, errorMessage }) {
    const result = await queryable.query(
      `
        UPDATE sync_queue
        SET status = 'pending', last_error = $1, processed_at = NULL
        WHERE id = $2
      `,
      [errorMessage, id]
    );
    return changes(result);
  }

  async function listPendingSyncItems({ limit, orderId = null }) {
    if (Number.isFinite(orderId) && orderId > 0) {
      const result = await queryable.query(
        `
          SELECT id, action, payload, attempts
          FROM sync_queue
          WHERE status = 'pending' AND order_id = $1
          ORDER BY id
          LIMIT $2
        `,
        [orderId, limit]
      );
      return result.rows;
    }

    const result = await queryable.query(
      `
        SELECT id, action, payload, attempts
        FROM sync_queue
        WHERE status = 'pending'
        ORDER BY id
        LIMIT $1
      `,
      [limit]
    );
    return result.rows;
  }

  async function countSyncQueueItemsByOrder(orderId) {
    const result = await queryable.query(
      `
        SELECT COUNT(*)::int AS count
        FROM sync_queue
        WHERE order_id = $1
      `,
      [orderId]
    );
    return countRows(result);
  }

  async function retryFailedSyncItemsByOrder(orderId) {
    const result = await queryable.query(
      `
        UPDATE sync_queue
        SET status = 'pending', attempts = 0, last_error = NULL, processed_at = NULL
        WHERE order_id = $1 AND status = 'failed'
      `,
      [orderId]
    );
    return result.rowCount;
  }

  async function markSyncQueueProcessing(id) {
    const result = await queryable.query(
      "UPDATE sync_queue SET status = 'processing' WHERE id = $1 AND status = 'pending'",
      [id]
    );
    return changes(result);
  }

  async function listSyncQueueItems(limit) {
    const result = await queryable.query(
      `
        SELECT id, order_id, action, payload, status, attempts, last_error, created_at, processed_at
        FROM sync_queue
        ORDER BY id DESC
        LIMIT $1
      `,
      [limit]
    );
    return result.rows;
  }

  async function listWebhookEvents(limit) {
    const result = await queryable.query(
      `
        SELECT id, source, event_key, status, message, received_at, processed_at
        FROM webhook_events
        ORDER BY id DESC
        LIMIT $1
      `,
      [limit]
    );
    return result.rows;
  }

  async function findOrderByCleanCloudOrderId(cleanCloudOrderId) {
    const result = await queryable.query(
      `
        SELECT id, public_id, status, ready_for_pickup
        FROM orders
        WHERE cleancloud_order_id = $1
      `,
      [cleanCloudOrderId]
    );
    return result.rows[0] || null;
  }

  async function getOrderBasketPickupSnapshot(orderId) {
    const result = await queryable.query(
      `
        SELECT
          COUNT(*)::int AS total_baskets,
          SUM(CASE WHEN station = 'pickup' AND status = 'pickup' THEN 1 ELSE 0 END)::int AS pickup_baskets
        FROM baskets
        WHERE order_id = $1
      `,
      [orderId]
    );
    return result.rows[0] || null;
  }

  async function updateOrderFromWebhook({ orderId, status, cleancloudStatus, readyForPickup, timestamp }) {
    const result = await queryable.query(
      `
        UPDATE orders
        SET status = $1, cleancloud_status = $2, ready_to_place = 0, ready_for_pickup = $3, updated_at = $4
        WHERE id = $5
      `,
      [status, cleancloudStatus, readyForPickup ? 1 : 0, timestamp, orderId]
    );
    return changes(result);
  }

  async function insertWebhookEvent({ source, eventKey, payloadJson, receivedAt }) {
    const result = await queryable.query(
      `
        INSERT INTO webhook_events (source, event_key, payload, status, message, received_at, processed_at)
        VALUES ($1, $2, $3, 'received', 'Received webhook', $4, NULL)
      `,
      [source, eventKey, payloadJson, receivedAt]
    );
    return changes(result);
  }

  async function updateWebhookEvent({ eventKey, status, message, processedAt }) {
    const result = await queryable.query(
      `
        UPDATE webhook_events
        SET status = $1, message = $2, processed_at = $3
        WHERE event_key = $4
      `,
      [status, message, processedAt, eventKey]
    );
    return changes(result);
  }

  return {
    findPendingSyncDuplicate,
    insertSyncQueueItem,
    findOrderContactById,
    updateOrderContact,
    insertOverviewScanEvent,
    markSyncQueueProcessed,
    markSyncQueueRetry,
    keepSyncQueuePending,
    listPendingSyncItems,
    countSyncQueueItemsByOrder,
    retryFailedSyncItemsByOrder,
    markSyncQueueProcessing,
    listSyncQueueItems,
    listWebhookEvents,
    findOrderByCleanCloudOrderId,
    getOrderBasketPickupSnapshot,
    updateOrderFromWebhook,
    insertWebhookEvent,
    updateWebhookEvent
  };
}

module.exports = {
  createPostgresCleanCloudRepository
};
