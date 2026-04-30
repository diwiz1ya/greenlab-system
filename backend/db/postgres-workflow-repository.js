function changes(result) {
  return { changes: result.rowCount };
}

function countValue(row, column = "count") {
  return Number(row?.[column] || 0);
}

function insertedResult(result, label) {
  const rowId = Number(result.rows[0]?.id || 0);
  if (!Number.isInteger(rowId) || rowId <= 0) {
    throw new Error(`Failed to read inserted ${label} id.`);
  }
  return { changes: result.rowCount, lastInsertRowid: rowId };
}

function createPostgresWorkflowRepository(queryable) {
  async function normalizeMachineLoadStatuses() {
    const result = await queryable.query(`
      UPDATE machine_loads
      SET status = 'active'
      WHERE status NOT IN ('active', 'completed', 'cancelled')
    `);
    return changes(result);
  }

  async function listOrderProgressStations(orderId) {
    const result = await queryable.query(
      `
        SELECT station, COUNT(*)::int AS count
        FROM baskets
        WHERE order_id = $1
          AND station = status
          AND station != 'archived'
        GROUP BY station
      `,
      [orderId]
    );
    return result.rows;
  }

  async function findPickupAssemblyOrder(orderId) {
    const result = await queryable.query(
      `
        SELECT id, status, ready_for_pickup
        FROM orders
        WHERE id = $1
      `,
      [orderId]
    );
    return result.rows[0] || null;
  }

  async function updateOrderReadyToPlace({ orderId, readyToPlace, timestamp }) {
    const result = await queryable.query(
      `
        UPDATE orders
        SET ready_to_place = $1, updated_at = $2
        WHERE id = $3
      `,
      [readyToPlace ? 1 : 0, timestamp, orderId]
    );
    return changes(result);
  }

  async function findPickupInvariantOrder(orderId) {
    const result = await queryable.query(
      `
        SELECT id, public_id, status, ready_to_place, ready_for_pickup
        FROM orders
        WHERE id = $1
        LIMIT 1
      `,
      [orderId]
    );
    return result.rows[0] || null;
  }

  async function listActiveBasketsByOrder(orderId) {
    const result = await queryable.query(
      `
        SELECT id, basket_code, qr_code, station, status
        FROM baskets
        WHERE order_id = $1
          AND status != 'archived'
        ORDER BY id ASC
      `,
      [orderId]
    );
    return result.rows;
  }

  async function listActivePickupPlacementsByOrder(orderId) {
    const result = await queryable.query(
      `
        SELECT slot_index, bin_qr_code, location_qr_code
        FROM pickup_order_placements
        WHERE order_id = $1
          AND released_at IS NULL
        ORDER BY slot_index ASC, id ASC
      `,
      [orderId]
    );
    return result.rows;
  }

  async function updateOrderStatusForPickup({ orderId, status, cleancloudStatus, timestamp }) {
    const result = await queryable.query(
      `
        UPDATE orders
        SET status = $1, cleancloud_status = $2, updated_at = $3
        WHERE id = $4
      `,
      [status, cleancloudStatus, timestamp, orderId]
    );
    return changes(result);
  }

  async function updateOrderStatusAndClearPickupFlags({ orderId, status, cleancloudStatus, timestamp }) {
    const result = await queryable.query(
      `
        UPDATE orders
        SET status = $1, cleancloud_status = $2, ready_to_place = 0, ready_for_pickup = 0, updated_at = $3
        WHERE id = $4
      `,
      [status, cleancloudStatus, timestamp, orderId]
    );
    return changes(result);
  }

  async function listPickupAssemblyBaskets(orderId) {
    const result = await queryable.query(
      `
        SELECT id, basket_code, qr_code
        FROM baskets
        WHERE order_id = $1
          AND station = 'pickup'
          AND status = 'pickup'
      `,
      [orderId]
    );
    return result.rows;
  }

  async function updateBasketQr({ basketId, qrCode, timestamp }) {
    const result = await queryable.query(
      `
        UPDATE baskets
        SET qr_code = $1, updated_at = $2
        WHERE id = $3
      `,
      [qrCode, timestamp, basketId]
    );
    return changes(result);
  }

  async function getMachineWithActiveLoad({ station, machineCode }) {
    const result = await queryable.query(
      `
        SELECT
          m.id,
          m.machine_code,
          m.station,
          m.machine_type,
          m.display_name,
          m.is_active,
          ml.id AS active_load_id,
          ml.started_at AS active_load_started_at,
          ml.started_by AS active_load_started_by
        FROM laundry_machines m
        LEFT JOIN machine_loads ml
          ON ml.machine_id = m.id
         AND ml.status = 'active'
        WHERE m.station = $1
          AND m.machine_code = $2
          AND m.is_active = 1
        LIMIT 1
      `,
      [station, machineCode]
    );
    return result.rows[0] || null;
  }

  async function listMachineWorkbenchRows(station) {
    const result = await queryable.query(
      `
        SELECT
          m.id,
          m.machine_code,
          m.station,
          m.machine_type,
          m.display_name,
          ml.id AS active_load_id,
          ml.status AS active_load_status,
          ml.started_at AS active_load_started_at,
          ml.started_by AS active_load_started_by,
          ml.completed_at AS active_load_completed_at,
          ml.completed_by AS active_load_completed_by,
          (
            SELECT COUNT(*)::int
            FROM machine_load_baskets mlb
            WHERE mlb.load_id = ml.id
          ) AS active_load_baskets_count,
          (
            SELECT COUNT(*)::int
            FROM machine_load_baskets mlb
            WHERE mlb.load_id = ml.id
              AND mlb.unloaded_at IS NOT NULL
          ) AS active_load_unloaded_count
        FROM laundry_machines m
        LEFT JOIN machine_loads ml
          ON ml.id = (
            SELECT ml2.id
            FROM machine_loads ml2
            WHERE ml2.machine_id = m.id
              AND ml2.status = 'active'
            ORDER BY ml2.created_at DESC, ml2.id DESC
            LIMIT 1
          )
        WHERE m.station = $1
          AND m.is_active = 1
        ORDER BY m.machine_code ASC
      `,
      [station]
    );
    return result.rows;
  }

  async function listLoadBaskets(loadId) {
    const result = await queryable.query(
      `
        SELECT
          b.id,
          b.basket_code,
          b.qr_code,
          b.station,
          b.status,
          o.public_id,
          mlb.unloaded_at,
          mlb.unloaded_by
        FROM machine_load_baskets mlb
        JOIN baskets b ON b.id = mlb.basket_id
        JOIN orders o ON o.id = b.order_id
        WHERE mlb.load_id = $1
        ORDER BY mlb.id ASC
      `,
      [loadId]
    );
    return result.rows;
  }

  async function findMachineFlowBasketByQr(qrCode) {
    const result = await queryable.query(
      `
        SELECT
          b.id,
          b.order_id,
          b.basket_code,
          b.qr_code,
          b.basket_items_json,
          b.station,
          b.status,
          o.public_id,
          o.cleancloud_order_id
        FROM baskets b
        JOIN orders o ON o.id = b.order_id
        WHERE b.qr_code = $1
        LIMIT 1
      `,
      [qrCode]
    );
    return result.rows[0] || null;
  }

  async function findActiveMachineLoadByBasketId(basketId) {
    const result = await queryable.query(
      `
        SELECT
          ml.id AS load_id,
          m.machine_code
        FROM machine_load_baskets mlb
        JOIN machine_loads ml
          ON ml.id = mlb.load_id
         AND ml.status = 'active'
        JOIN laundry_machines m ON m.id = ml.machine_id
        WHERE mlb.basket_id = $1
          AND mlb.unloaded_at IS NULL
        LIMIT 1
      `,
      [basketId]
    );
    return result.rows[0] || null;
  }

  async function insertMachineLoad({ machineId, station, actor, timestamp }) {
    const result = await queryable.query(
      `
        INSERT INTO machine_loads (
          machine_id, station, status, started_by, started_at, created_at, updated_at
        ) VALUES ($1, $2, 'active', $3, $4, $5, $6)
        RETURNING id
      `,
      [machineId, station, actor, timestamp, timestamp, timestamp]
    );
    return insertedResult(result, "machine load");
  }

  async function insertMachineLoadBasket({ loadId, basketId, orderId, timestamp }) {
    const result = await queryable.query(
      `
        INSERT INTO machine_load_baskets (load_id, basket_id, order_id, added_at)
        VALUES ($1, $2, $3, $4)
      `,
      [loadId, basketId, orderId, timestamp]
    );
    return changes(result);
  }

  async function insertScanEvent({ orderId, basketId, station, actor, result = "ok", message, timestamp }) {
    const insertResult = await queryable.query(
      `
        INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [orderId, basketId, station, actor, result, message, timestamp]
    );
    return changes(insertResult);
  }

  async function getMachineLoadById(loadId) {
    const result = await queryable.query(
      `
        SELECT
          ml.id,
          ml.station,
          ml.status,
          m.machine_code,
          m.display_name
        FROM machine_loads ml
        JOIN laundry_machines m ON m.id = ml.machine_id
        WHERE ml.id = $1
        LIMIT 1
      `,
      [loadId]
    );
    return result.rows[0] || null;
  }

  async function listPendingMachineLoadBaskets(loadId) {
    const result = await queryable.query(
      `
        SELECT
          mlb.id AS load_basket_id,
          mlb.unloaded_at,
          b.id AS basket_id,
          b.order_id,
          b.basket_code,
          b.qr_code,
          b.station,
          b.status,
          o.cleancloud_order_id,
          o.public_id
        FROM machine_load_baskets mlb
        JOIN baskets b ON b.id = mlb.basket_id
        JOIN orders o ON o.id = b.order_id
        WHERE mlb.load_id = $1
          AND mlb.unloaded_at IS NULL
        ORDER BY mlb.id ASC
      `,
      [loadId]
    );
    return result.rows;
  }

  async function findActiveBasketCatalogQr(qrCode) {
    const result = await queryable.query(
      `
        SELECT qr_code
        FROM basket_catalog
        WHERE qr_code = $1
          AND is_active = 1
        LIMIT 1
      `,
      [qrCode]
    );
    return result.rows[0] || null;
  }

  async function findBasketQrOccupant({ qrCode, excludeBasketId }) {
    const result = await queryable.query(
      `
        SELECT basket_code
        FROM baskets
        WHERE qr_code = $1
          AND id != $2
        LIMIT 1
      `,
      [qrCode, excludeBasketId]
    );
    return result.rows[0] || null;
  }

  async function unloadMachineLoadBasket({ loadBasketId, actor, timestamp }) {
    const result = await queryable.query(
      `
        UPDATE machine_load_baskets
        SET unloaded_at = $1, unloaded_by = $2
        WHERE id = $3
      `,
      [timestamp, actor, loadBasketId]
    );
    return changes(result);
  }

  async function rebindBasketQr({ basketId, qrCode, timestamp }) {
    const result = await queryable.query(
      `
        UPDATE baskets
        SET qr_code = $1, updated_at = $2
        WHERE id = $3
      `,
      [qrCode, timestamp, basketId]
    );
    return changes(result);
  }

  async function moveBasketToStation({ basketId, station, timestamp }) {
    const result = await queryable.query(
      `
        UPDATE baskets
        SET station = $1, status = $2, updated_at = $3
        WHERE id = $4
      `,
      [station, station, timestamp, basketId]
    );
    return changes(result);
  }

  async function markMachineLoadCompletedIfEmpty({ loadId, timestamp }) {
    const result = await queryable.query(
      `
        UPDATE machine_loads
        SET status = 'completed', updated_at = $1
        WHERE id = $2
          AND status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM machine_load_baskets
            WHERE load_id = $3
              AND unloaded_at IS NULL
          )
      `,
      [timestamp, loadId, loadId]
    );
    return changes(result);
  }

  async function countPendingMachineLoadBaskets(loadId) {
    const result = await queryable.query(
      `
        SELECT COUNT(*)::int AS pending_count
        FROM machine_load_baskets
        WHERE load_id = $1
          AND unloaded_at IS NULL
      `,
      [loadId]
    );
    return countValue(result.rows[0], "pending_count");
  }

  async function listMachineLoadBasketOrderRefs(loadId) {
    const result = await queryable.query(
      `
        SELECT b.id, b.order_id
        FROM machine_load_baskets mlb
        JOIN baskets b ON b.id = mlb.basket_id
        WHERE mlb.load_id = $1
      `,
      [loadId]
    );
    return result.rows;
  }

  async function cancelMachineLoad({ loadId, actor, timestamp }) {
    const result = await queryable.query(
      `
        UPDATE machine_loads
        SET status = 'cancelled', cancelled_by = $1, cancelled_at = $2, updated_at = $3
        WHERE id = $4
      `,
      [actor, timestamp, timestamp, loadId]
    );
    return changes(result);
  }

  async function findOrderPublicId(orderId) {
    const result = await queryable.query("SELECT public_id FROM orders WHERE id = $1", [orderId]);
    return result.rows[0] || null;
  }

  async function getPickupScanOrderState(orderId) {
    const result = await queryable.query(
      `
        SELECT status, ready_to_place, ready_for_pickup
        FROM orders
        WHERE id = $1
      `,
      [orderId]
    );
    return result.rows[0] || null;
  }

  async function hasPickupHandoverConfirmation(orderId) {
    const result = await queryable.query(
      `
        SELECT 1 AS ok
        FROM scan_events
        WHERE order_id = $1
          AND station = 'pickup'
          AND result = 'ok'
          AND message LIKE 'Выдача подтверждена.%'
        LIMIT 1
      `,
      [orderId]
    );
    return Boolean(result.rows[0]);
  }

  async function hasBasketPickupOkScan({ orderId, basketId }) {
    const result = await queryable.query(
      `
        SELECT 1 AS ok
        FROM scan_events
        WHERE order_id = $1
          AND basket_id = $2
          AND station = 'pickup'
          AND result = 'ok'
        LIMIT 1
      `,
      [orderId, basketId]
    );
    return Boolean(result.rows[0]);
  }

  async function findHoldOrderById(orderId) {
    const result = await queryable.query(
      `
        SELECT id, status, cleancloud_order_id
        FROM orders
        WHERE id = $1
      `,
      [orderId]
    );
    return result.rows[0] || null;
  }

  async function countBasketsByOrder(orderId) {
    const result = await queryable.query("SELECT COUNT(*)::int AS count FROM baskets WHERE order_id = $1", [orderId]);
    return countValue(result.rows[0]);
  }

  async function moveHoldBasketsToWashing({ orderId, holdStation, timestamp }) {
    const result = await queryable.query(
      `
        UPDATE baskets
        SET station = 'washing', status = 'washing', updated_at = $1
        WHERE order_id = $2
          AND station = $3
          AND status = $4
      `,
      [timestamp, orderId, holdStation, holdStation]
    );
    return changes(result);
  }

  async function releaseHoldOrderToWashing({ orderId, timestamp }) {
    const result = await queryable.query(
      `
        UPDATE orders
        SET status = 'washing', cleancloud_status = 'В работе', ready_to_place = 0, ready_for_pickup = 0, updated_at = $1
        WHERE id = $2
      `,
      [timestamp, orderId]
    );
    return changes(result);
  }

  async function findPickupPlacementOrder(orderId) {
    const result = await queryable.query(
      `
        SELECT id, public_id, cleancloud_order_id, status, ready_to_place, ready_for_pickup
        FROM orders
        WHERE id = $1
        LIMIT 1
      `,
      [orderId]
    );
    return result.rows[0] || null;
  }

  async function findBinCatalogEntry(qrCode) {
    const result = await queryable.query(
      `
        SELECT id, label
        FROM basket_catalog
        WHERE qr_code = $1
          AND is_active = 1
        LIMIT 1
      `,
      [qrCode]
    );
    return result.rows[0] || null;
  }

  async function findPickupLocationCatalogEntry(qrCode) {
    const result = await queryable.query(
      `
        SELECT id, label
        FROM pickup_locations
        WHERE qr_code = $1
          AND is_active = 1
        LIMIT 1
      `,
      [qrCode]
    );
    return result.rows[0] || null;
  }

  async function findActivePickupPlacementByBin(qrCode) {
    const result = await queryable.query(
      `
        SELECT p.order_id, o.public_id
        FROM pickup_order_placements p
        JOIN orders o ON o.id = p.order_id
        WHERE p.bin_qr_code = $1
          AND p.released_at IS NULL
        LIMIT 1
      `,
      [qrCode]
    );
    return result.rows[0] || null;
  }

  async function findActivePickupPlacementByLocation(qrCode) {
    const result = await queryable.query(
      `
        SELECT p.order_id, o.public_id
        FROM pickup_order_placements p
        JOIN orders o ON o.id = p.order_id
        WHERE p.location_qr_code = $1
          AND p.released_at IS NULL
        LIMIT 1
      `,
      [qrCode]
    );
    return result.rows[0] || null;
  }

  async function findActiveBasketByQrForPickupPlacement(qrCode) {
    const result = await queryable.query(
      `
        SELECT b.id, b.station, o.public_id
        FROM baskets b
        JOIN orders o ON o.id = b.order_id
        WHERE b.qr_code = $1
          AND b.status != 'archived'
          AND NOT (
            o.status = 'pickup'
            AND (
              COALESCE(o.ready_to_place, 0) = 1
              OR COALESCE(o.ready_for_pickup, 0) = 1
            )
          )
        LIMIT 1
      `,
      [qrCode]
    );
    return result.rows[0] || null;
  }

  async function releaseActivePickupOrderPlacements({ orderId, actor, timestamp }) {
    const result = await queryable.query(
      `
        UPDATE pickup_order_placements
        SET released_at = $1, released_by = $2, updated_at = $3
        WHERE order_id = $4
          AND released_at IS NULL
      `,
      [timestamp, actor, timestamp, orderId]
    );
    return changes(result);
  }

  async function insertPickupOrderPlacement({ orderId, slotIndex, binQrCode, locationQrCode, actor, timestamp }) {
    const result = await queryable.query(
      `
        INSERT INTO pickup_order_placements (
          order_id, slot_index, bin_qr_code, location_qr_code, placed_by, placed_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [orderId, slotIndex, binQrCode, locationQrCode, actor, timestamp, timestamp, timestamp]
    );
    return changes(result);
  }

  async function markOrderPlacedForPickup({ orderId, timestamp }) {
    const result = await queryable.query(
      `
        UPDATE orders
        SET ready_to_place = 0, ready_for_pickup = 1, cleancloud_status = 'Готов к выдаче', updated_at = $1
        WHERE id = $2
      `,
      [timestamp, orderId]
    );
    return changes(result);
  }

  async function findPickupCompletionOrder(orderId) {
    const result = await queryable.query("SELECT * FROM orders WHERE id = $1", [orderId]);
    return result.rows[0] || null;
  }

  async function listOrderBasketsForArchive(orderId) {
    const result = await queryable.query(
      `
        SELECT id, qr_code
        FROM baskets
        WHERE order_id = $1
        ORDER BY id ASC
      `,
      [orderId]
    );
    return result.rows;
  }

  async function markOrderPickedUp({ orderId, timestamp }) {
    const result = await queryable.query(
      `
        UPDATE orders
        SET status = 'pickup', cleancloud_status = 'Выдано', ready_to_place = 0, ready_for_pickup = 0, updated_at = $1
        WHERE id = $2
      `,
      [timestamp, orderId]
    );
    return changes(result);
  }

  async function archiveBasket({ basketId, archivedQrCode, timestamp }) {
    const result = await queryable.query(
      `
        UPDATE baskets
        SET qr_code = $1, station = 'archived', status = 'archived', updated_at = $2
        WHERE id = $3
      `,
      [archivedQrCode, timestamp, basketId]
    );
    return changes(result);
  }

  return {
    normalizeMachineLoadStatuses,
    listOrderProgressStations,
    findPickupAssemblyOrder,
    updateOrderReadyToPlace,
    findPickupInvariantOrder,
    listActiveBasketsByOrder,
    listActivePickupPlacementsByOrder,
    updateOrderStatusForPickup,
    updateOrderStatusAndClearPickupFlags,
    listPickupAssemblyBaskets,
    updateBasketQr,
    getMachineWithActiveLoad,
    listMachineWorkbenchRows,
    listLoadBaskets,
    findMachineFlowBasketByQr,
    findActiveMachineLoadByBasketId,
    insertMachineLoad,
    insertMachineLoadBasket,
    insertScanEvent,
    getMachineLoadById,
    listPendingMachineLoadBaskets,
    findActiveBasketCatalogQr,
    findBasketQrOccupant,
    unloadMachineLoadBasket,
    rebindBasketQr,
    moveBasketToStation,
    markMachineLoadCompletedIfEmpty,
    countPendingMachineLoadBaskets,
    listMachineLoadBasketOrderRefs,
    cancelMachineLoad,
    findOrderPublicId,
    getPickupScanOrderState,
    hasPickupHandoverConfirmation,
    hasBasketPickupOkScan,
    findHoldOrderById,
    countBasketsByOrder,
    moveHoldBasketsToWashing,
    releaseHoldOrderToWashing,
    findPickupPlacementOrder,
    findBinCatalogEntry,
    findPickupLocationCatalogEntry,
    findActivePickupPlacementByBin,
    findActivePickupPlacementByLocation,
    findActiveBasketByQrForPickupPlacement,
    releaseActivePickupOrderPlacements,
    insertPickupOrderPlacement,
    markOrderPlacedForPickup,
    findPickupCompletionOrder,
    listOrderBasketsForArchive,
    markOrderPickedUp,
    archiveBasket
  };
}

module.exports = {
  createPostgresWorkflowRepository
};
