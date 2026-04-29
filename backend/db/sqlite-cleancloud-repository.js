function createSqliteCleanCloudRepository(db) {
  const findPendingSyncDuplicateStmt = db.prepare(`
    SELECT id
    FROM sync_queue
    WHERE order_id = ? AND action = ? AND payload = ? AND status IN ('pending', 'processing')
    LIMIT 1
  `);
  const insertSyncQueueItemStmt = db.prepare(`
    INSERT INTO sync_queue (order_id, action, payload, status, created_at, processed_at, attempts, last_error)
    VALUES (?, ?, ?, 'pending', ?, NULL, 0, NULL)
  `);
  const findOrderContactByIdStmt = db.prepare(`
    SELECT id, public_id, cleancloud_order_id, customer_name, customer_id, order_weight, customer_phone, customer_email
    FROM orders
    WHERE id = ?
  `);
  const insertOverviewScanEventStmt = db.prepare(`
    INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
    VALUES (?, NULL, 'overview', ?, 'ok', ?, ?)
  `);
  const markSyncQueueProcessedStmt = db.prepare(`
    UPDATE sync_queue
    SET status = 'processed', processed_at = ?, last_error = ?
    WHERE id = ?
  `);
  const markSyncQueueRetryStmt = db.prepare(`
    UPDATE sync_queue
    SET status = ?, attempts = ?, last_error = ?, processed_at = ?
    WHERE id = ?
  `);
  const keepSyncQueuePendingStmt = db.prepare(`
    UPDATE sync_queue
    SET status = 'pending', last_error = ?, processed_at = NULL
    WHERE id = ?
  `);
  const listPendingSyncItemsByOrderStmt = db.prepare(`
    SELECT id, action, payload, attempts
    FROM sync_queue
    WHERE status = 'pending' AND order_id = ?
    ORDER BY id
    LIMIT ?
  `);
  const listPendingSyncItemsStmt = db.prepare(`
    SELECT id, action, payload, attempts
    FROM sync_queue
    WHERE status = 'pending'
    ORDER BY id
    LIMIT ?
  `);
  const countSyncQueueItemsByOrderStmt = db.prepare(`
    SELECT COUNT(*) AS count
    FROM sync_queue
    WHERE order_id = ?
  `);
  const retryFailedSyncItemsByOrderStmt = db.prepare(`
    UPDATE sync_queue
    SET status = 'pending', attempts = 0, last_error = NULL, processed_at = NULL
    WHERE order_id = ? AND status = 'failed'
  `);
  const markSyncQueueProcessingStmt = db.prepare("UPDATE sync_queue SET status = 'processing' WHERE id = ? AND status = 'pending'");
  const listSyncQueueItemsStmt = db.prepare(`
    SELECT id, order_id, action, payload, status, attempts, last_error, created_at, processed_at
    FROM sync_queue
    ORDER BY id DESC
    LIMIT ?
  `);
  const listWebhookEventsStmt = db.prepare(`
    SELECT id, source, event_key, status, message, received_at, processed_at
    FROM webhook_events
    ORDER BY id DESC
    LIMIT ?
  `);
  const findOrderByCleanCloudOrderIdStmt = db.prepare(`
    SELECT id, public_id, status, ready_for_pickup
    FROM orders
    WHERE cleancloud_order_id = ?
  `);
  const getOrderBasketPickupSnapshotStmt = db.prepare(`
    SELECT
      COUNT(*) AS total_baskets,
      SUM(CASE WHEN station = 'pickup' AND status = 'pickup' THEN 1 ELSE 0 END) AS pickup_baskets
    FROM baskets
    WHERE order_id = ?
  `);
  const updateOrderFromWebhookStmt = db.prepare(`
    UPDATE orders
    SET status = ?, cleancloud_status = ?, ready_to_place = 0, ready_for_pickup = ?, updated_at = ?
    WHERE id = ?
  `);
  const insertWebhookEventStmt = db.prepare(`
    INSERT INTO webhook_events (source, event_key, payload, status, message, received_at, processed_at)
    VALUES (?, ?, ?, 'received', 'Received webhook', ?, NULL)
  `);
  const updateWebhookEventStmt = db.prepare(`
    UPDATE webhook_events
    SET status = ?, message = ?, processed_at = ?
    WHERE event_key = ?
  `);

  function updateOrderContact(orderId, fields, timestamp) {
    const updates = [];
    const params = [];

    for (const [column, value] of Object.entries(fields || {})) {
      updates.push(`${column} = ?`);
      params.push(value);
    }

    if (!updates.length) {
      return { changes: 0 };
    }

    updates.push("updated_at = ?");
    params.push(timestamp, orderId);
    return db.prepare(`
      UPDATE orders
      SET ${updates.join(", ")}
      WHERE id = ?
    `).run(...params);
  }

  return {
    findPendingSyncDuplicate: (orderId, action, payloadJson) => findPendingSyncDuplicateStmt.get(orderId, action, payloadJson),
    insertSyncQueueItem: ({ orderId, action, payloadJson, createdAt }) => insertSyncQueueItemStmt.run(orderId, action, payloadJson, createdAt),
    findOrderContactById: (orderId) => findOrderContactByIdStmt.get(orderId),
    updateOrderContact,
    insertOverviewScanEvent: ({ orderId, actor, message, timestamp }) => insertOverviewScanEventStmt.run(orderId, actor, message, timestamp),
    markSyncQueueProcessed: ({ id, processedAt, note }) => markSyncQueueProcessedStmt.run(processedAt, note, id),
    markSyncQueueRetry: ({ id, status, attempts, errorMessage, processedAt }) => markSyncQueueRetryStmt.run(status, attempts, errorMessage, processedAt, id),
    keepSyncQueuePending: ({ id, errorMessage }) => keepSyncQueuePendingStmt.run(errorMessage, id),
    listPendingSyncItems: ({ limit, orderId = null }) => (
      Number.isFinite(orderId) && orderId > 0
        ? listPendingSyncItemsByOrderStmt.all(orderId, limit)
        : listPendingSyncItemsStmt.all(limit)
    ),
    countSyncQueueItemsByOrder: (orderId) => countSyncQueueItemsByOrderStmt.get(orderId).count,
    retryFailedSyncItemsByOrder: (orderId) => retryFailedSyncItemsByOrderStmt.run(orderId).changes,
    markSyncQueueProcessing: (id) => markSyncQueueProcessingStmt.run(id),
    listSyncQueueItems: (limit) => listSyncQueueItemsStmt.all(limit),
    listWebhookEvents: (limit) => listWebhookEventsStmt.all(limit),
    findOrderByCleanCloudOrderId: (cleanCloudOrderId) => findOrderByCleanCloudOrderIdStmt.get(cleanCloudOrderId),
    getOrderBasketPickupSnapshot: (orderId) => getOrderBasketPickupSnapshotStmt.get(orderId),
    updateOrderFromWebhook: ({ orderId, status, cleancloudStatus, readyForPickup, timestamp }) => (
      updateOrderFromWebhookStmt.run(status, cleancloudStatus, readyForPickup ? 1 : 0, timestamp, orderId)
    ),
    insertWebhookEvent: ({ source, eventKey, payloadJson, receivedAt }) => insertWebhookEventStmt.run(source, eventKey, payloadJson, receivedAt),
    updateWebhookEvent: ({ eventKey, status, message, processedAt }) => updateWebhookEventStmt.run(status, message, processedAt, eventKey)
  };
}

module.exports = {
  createSqliteCleanCloudRepository
};
