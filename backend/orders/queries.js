function createOrderQueryService(db, options = {}) {
  const stationLabels = options.stationLabels || {};
  const holdStation = options.holdStation || "hold";

  function normalizeItemCount(value) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) return 0;
    return parsed;
  }

  function toNullableNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseBasketItemCounts(raw) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      const top = normalizeItemCount(parsed?.top);
      const bottom = normalizeItemCount(parsed?.bottom);
      const underwear = normalizeItemCount(parsed?.underwear);
      const socksPairs = normalizeItemCount(
        parsed?.socksPairs !== undefined ? parsed.socksPairs : parsed?.socks_pairs
      );
      const total = top + bottom + underwear + socksPairs;
      if (total <= 0) return null;
      return { top, bottom, underwear, socksPairs, total };
    } catch {
      return null;
    }
  }

  function getOrderDetails(orderId) {
    const order = db.prepare(`
      SELECT id, public_id, cleancloud_order_id, customer_name, customer_id, order_weight, customer_phone, customer_email, service_tier, status,
             cleancloud_status, ready_to_place, ready_for_pickup, created_at, updated_at
      FROM orders
      WHERE id = ?
    `).get(orderId);

    if (!order) {
      return null;
    }

    const baskets = db.prepare(`
      SELECT
        id,
        basket_code,
        basket_type,
        basket_items_json,
        basket_kind,
        parent_basket_id,
        rework_reason,
        rework_attempt,
        label_printed_at,
        label_print_count,
        station,
        status,
        qr_code,
        created_at,
        updated_at
      FROM baskets
      WHERE order_id = ?
      ORDER BY id
    `).all(orderId).map((basket) => {
      const { basket_items_json, ...rest } = basket;
      return {
        ...rest,
        item_counts: parseBasketItemCounts(basket_items_json)
      };
    });
    const basketIds = baskets.map((basket) => basket.id);
    const imagesByBasketId = new Map();
    if (basketIds.length) {
      const placeholders = basketIds.map(() => "?").join(", ");
      const imageRows = db.prepare(`
        SELECT id, basket_id, image_role, sort_order, note, public_url, created_at
        FROM basket_images
        WHERE basket_id IN (${placeholders})
        ORDER BY basket_id, sort_order, id
      `).all(...basketIds);

      for (const row of imageRows) {
        if (!imagesByBasketId.has(row.basket_id)) {
          imagesByBasketId.set(row.basket_id, []);
        }
        imagesByBasketId.get(row.basket_id).push({
          id: row.id,
          role: row.image_role,
          sort_order: Number(row.sort_order || 0),
          note: row.note || null,
          public_url: row.public_url,
          created_at: row.created_at
        });
      }
    }
    for (const basket of baskets) {
      basket.images = imagesByBasketId.get(basket.id) || [];
    }

    const scans = db.prepare(`
      SELECT id, station, actor, result, message, created_at, basket_id
      FROM scan_events
      WHERE order_id = ?
      ORDER BY datetime(created_at) DESC
      LIMIT 10
    `).all(orderId);
    const pickupPlacements = db.prepare(`
      SELECT
        slot_index,
        bin_qr_code,
        location_qr_code,
        placed_at
      FROM pickup_order_placements
      WHERE order_id = ?
        AND released_at IS NULL
      ORDER BY slot_index, id
    `).all(orderId).map((row) => ({
      slot_index: Number(row.slot_index || 1),
      bin_qr_code: row.bin_qr_code || "",
      location_qr_code: row.location_qr_code || "",
      placed_at: row.placed_at || null
    }));
    const machineUsageRows = db.prepare(`
      SELECT
        ml.station,
        m.machine_code,
        m.display_name,
        MAX(COALESCE(ml.completed_at, ml.updated_at, ml.started_at)) AS last_used_at
      FROM machine_load_baskets mlb
      JOIN machine_loads ml ON ml.id = mlb.load_id
      JOIN laundry_machines m ON m.id = ml.machine_id
      WHERE mlb.order_id = ?
        AND ml.status IN ('active', 'completed')
      GROUP BY ml.station, m.machine_code, m.display_name
      ORDER BY
        CASE ml.station
          WHEN 'washing' THEN 0
          WHEN 'drying' THEN 1
          ELSE 2
        END,
        datetime(last_used_at) DESC,
        m.machine_code ASC
    `).all(orderId);
    const machineUsage = { washing: [], drying: [], other: [] };
    for (const row of machineUsageRows) {
      const entry = {
        machine_code: row.machine_code || "",
        display_name: row.display_name || "",
        last_used_at: row.last_used_at || null
      };
      if (row.station === "washing") {
        machineUsage.washing.push(entry);
      } else if (row.station === "drying") {
        machineUsage.drying.push(entry);
      } else {
        machineUsage.other.push({ ...entry, station: row.station || "" });
      }
    }

    const reworkRequests = db.prepare(`
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
    `).all(orderId).map((row) => ({
      id: row.id,
      order_id: row.order_id,
      source_basket_id: row.source_basket_id,
      source_basket_code: row.source_basket_code,
      rework_basket_id: row.rework_basket_id || null,
      rework_basket_code: row.rework_basket_code || null,
      rework_basket_qr_code: row.rework_basket_qr_code || null,
      item_category: row.item_category,
      item_label: row.item_label || null,
      source_image_id: row.source_image_id || null,
      source_image_url: row.source_image_url || null,
      source_image_note: row.source_image_note || null,
      qc_photo_url: row.qc_photo_url || null,
      quantity: Number(row.quantity || 0),
      reason_code: row.reason_code,
      service_label: row.service_label,
      extra_days: Number(row.extra_days || 0),
      request_status: row.request_status,
      requested_by: row.requested_by,
      requested_at: row.requested_at,
      decision_actor: row.decision_actor || null,
      decision_at: row.decision_at || null,
      decision_note: row.decision_note || null,
      handoff_confirmed_by: row.handoff_confirmed_by || null,
      handoff_confirmed_at: row.handoff_confirmed_at || null,
      handoff_note: row.handoff_note || null,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
    const pendingCustomerApprovalCount = reworkRequests.filter((row) => row.request_status === "pending_customer_approval").length;

    return {
      ...order,
      ready_to_place: Boolean(order.ready_to_place),
      ready_for_pickup: Boolean(order.ready_for_pickup),
      baskets,
      scans,
      pickup_placements: pickupPlacements,
      pickup_placement_count: pickupPlacements.length,
      machine_usage: machineUsage,
      rework_requests: reworkRequests,
      pending_customer_approval_count: pendingCustomerApprovalCount,
      has_pending_customer_approval: pendingCustomerApprovalCount > 0
    };
  }

  function getOverview() {
    const counts = {};
    for (const station of Object.keys(stationLabels)) {
      if (station === "overview") {
        counts[station] = 0;
        continue;
      }

      if (station === "sorting") {
        counts.sorting = db.prepare(`
          SELECT COUNT(*) AS count
          FROM orders
          WHERE status IN ('sorting', 'sorted')
        `).get().count;
        continue;
      }

      counts[station] = db.prepare(`
        SELECT COUNT(DISTINCT o.id) AS count
        FROM orders o
        JOIN baskets b ON b.order_id = o.id
        WHERE b.station = ? AND b.status = ?
      `).get(station, station).count;
    }
    counts.hold = db.prepare(`
      SELECT COUNT(DISTINCT o.id) AS count
      FROM orders o
      JOIN baskets b ON b.order_id = o.id
      WHERE b.station = ? AND b.status = ?
    `).get(holdStation, holdStation).count;
    counts.ready = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE ready_for_pickup = 1").get().count;

    const orders = db.prepare(`
      SELECT
        o.id,
        o.public_id,
        o.cleancloud_order_id,
        o.customer_name,
        o.customer_id,
        o.order_weight,
        o.customer_phone,
        o.customer_email,
        o.service_tier,
        o.status,
        o.cleancloud_status,
        o.ready_to_place,
        o.ready_for_pickup,
        o.created_at,
        o.updated_at,
        (
          SELECT COUNT(*)
          FROM baskets b
          WHERE b.order_id = o.id
        ) AS basket_count,
        (
          SELECT COUNT(*)
          FROM baskets b
          WHERE b.order_id = o.id AND COALESCE(b.basket_kind, 'main') = 'rework'
        ) AS rework_basket_count,
        (
          SELECT COUNT(*)
          FROM rework_requests rr
          WHERE rr.order_id = o.id AND rr.request_status = 'pending_customer_approval'
        ) AS pending_customer_approval_count,
        (
          SELECT MIN(rr.requested_at)
          FROM rework_requests rr
          WHERE rr.order_id = o.id AND rr.request_status = 'pending_customer_approval'
        ) AS pending_approval_since,
        (
          SELECT MIN(COALESCE(rr.decision_at, rr.updated_at))
          FROM rework_requests rr
          WHERE rr.order_id = o.id
            AND rr.request_status IN ('approved_waiting_transfer', 'declined_waiting_return')
            AND rr.handoff_confirmed_at IS NULL
        ) AS pending_qc_task_since,
        (
          SELECT rr.request_status
          FROM rework_requests rr
          WHERE rr.order_id = o.id
            AND rr.request_status IN ('approved_waiting_transfer', 'declined_waiting_return')
            AND rr.handoff_confirmed_at IS NULL
          ORDER BY datetime(COALESCE(rr.decision_at, rr.updated_at)) ASC, rr.id ASC
          LIMIT 1
        ) AS pending_qc_task_kind,
        (
          SELECT COUNT(*)
          FROM rework_requests rr
          WHERE rr.order_id = o.id
        ) AS rework_request_count,
        (
          SELECT COUNT(*)
          FROM rework_requests rr
          WHERE rr.order_id = o.id
            AND rr.request_status IN ('declined', 'declined_waiting_return')
        ) AS rework_declined_count,
        (
          SELECT COALESCE(MAX(b.rework_attempt), 0)
          FROM baskets b
          WHERE b.order_id = o.id
            AND COALESCE(b.basket_kind, 'main') = 'rework'
        ) AS max_rework_attempt
      FROM orders o
      ORDER BY o.id
    `).all().map((row) => ({
      ...row,
      ready_to_place: Boolean(row.ready_to_place),
      ready_for_pickup: Boolean(row.ready_for_pickup),
      basket_count: Number(row.basket_count || 0),
      rework_basket_count: Number(row.rework_basket_count || 0),
      pending_customer_approval_count: Number(row.pending_customer_approval_count || 0),
      pending_approval_since: row.pending_approval_since || null,
      pending_qc_task_since: row.pending_qc_task_since || null,
      pending_qc_task_kind: row.pending_qc_task_kind || null,
      rework_request_count: Number(row.rework_request_count || 0),
      rework_declined_count: Number(row.rework_declined_count || 0),
      max_rework_attempt: Number(row.max_rework_attempt || 0)
    }));
    const pickupPlacements = db.prepare(`
      SELECT
        p.order_id,
        p.slot_index,
        p.bin_qr_code,
        p.location_qr_code
      FROM pickup_order_placements p
      WHERE p.released_at IS NULL
      ORDER BY p.order_id, p.slot_index, p.id
    `).all();
    const placementsByOrderId = new Map();
    for (const row of pickupPlacements) {
      const orderId = Number(row.order_id);
      if (!Number.isFinite(orderId)) continue;
      if (!placementsByOrderId.has(orderId)) {
        placementsByOrderId.set(orderId, []);
      }
      placementsByOrderId.get(orderId).push({
        slot_index: Number(row.slot_index || 1),
        bin_qr_code: row.bin_qr_code || "",
        location_qr_code: row.location_qr_code || ""
      });
    }
    for (const order of orders) {
      const orderId = Number(order.id);
      const placements = Number.isFinite(orderId) ? (placementsByOrderId.get(orderId) || []) : [];
      order.pickup_placements = placements;
      order.pickup_placement_count = placements.length;
    }
    const managerKpiCore = db.prepare(`
      SELECT
        COUNT(*) AS decisions_total,
        SUM(CASE WHEN rr.request_status IN ('declined', 'declined_waiting_return') THEN 1 ELSE 0 END) AS declined_total,
        SUM(CASE WHEN rr.request_status IN ('approved', 'approved_waiting_transfer') THEN 1 ELSE 0 END) AS approved_total,
        AVG((julianday(rr.decision_at) - julianday(rr.requested_at)) * 24 * 60) AS approval_minutes_avg
      FROM rework_requests rr
      WHERE rr.decision_at IS NOT NULL
    `).get() || {};

    const managerKpiRework = db.prepare(`
      SELECT
        COUNT(*) AS total_rework_baskets,
        SUM(CASE WHEN COALESCE(b.rework_attempt, 0) > 1 THEN 1 ELSE 0 END) AS repeated_rework_baskets
      FROM baskets b
      WHERE COALESCE(b.basket_kind, 'main') = 'rework'
    `).get() || {};

    const managerKpiPickup = db.prepare(`
      SELECT
        COUNT(*) AS handoff_count,
        AVG((julianday(p.completed_at) - julianday(o.created_at)) * 24 * 60) AS pickup_cycle_minutes_avg
      FROM (
        SELECT se.order_id, MAX(se.created_at) AS completed_at
        FROM scan_events se
        WHERE se.station = 'pickup'
          AND se.result = 'ok'
          AND se.message LIKE 'Выдача подтверждена%'
        GROUP BY se.order_id
      ) p
      JOIN orders o ON o.id = p.order_id
    `).get() || {};

    const decisionsTotal = Number(managerKpiCore.decisions_total || 0);
    const declinedTotal = Number(managerKpiCore.declined_total || 0);
    const approvedTotal = Number(managerKpiCore.approved_total || 0);
    const totalReworkBaskets = Number(managerKpiRework.total_rework_baskets || 0);
    const repeatedReworkBaskets = Number(managerKpiRework.repeated_rework_baskets || 0);
    const handoffCount = Number(managerKpiPickup.handoff_count || 0);
    const approvalMinutesAvg = toNullableNumber(managerKpiCore.approval_minutes_avg);
    const pickupCycleMinutesAvg = toNullableNumber(managerKpiPickup.pickup_cycle_minutes_avg);

    const manager_kpi = {
      decisions_total: decisionsTotal,
      declined_total: declinedTotal,
      approved_total: approvedTotal,
      decline_rate_percent: decisionsTotal > 0 ? (declinedTotal / decisionsTotal) * 100 : 0,
      approval_minutes_avg: approvalMinutesAvg,
      total_rework_baskets: totalReworkBaskets,
      repeated_rework_baskets: repeatedReworkBaskets,
      repeated_rework_rate_percent: totalReworkBaskets > 0 ? (repeatedReworkBaskets / totalReworkBaskets) * 100 : 0,
      handoff_count: handoffCount,
      pickup_cycle_minutes_avg: pickupCycleMinutesAvg
    };

    return { counts, orders, manager_kpi };
  }

  function listStationOrders(station) {
    if (station === "sorting") {
      return db.prepare(`
        SELECT id, public_id, cleancloud_order_id, customer_name, customer_id, order_weight, customer_phone, customer_email, service_tier, status, cleancloud_status, ready_to_place, ready_for_pickup, updated_at
        FROM orders
        WHERE status IN ('sorting', 'sorted')
        ORDER BY CASE WHEN status = 'sorting' THEN 0 ELSE 1 END, id
      `).all().map((row) => ({ ...row, ready_to_place: Boolean(row.ready_to_place), ready_for_pickup: Boolean(row.ready_for_pickup) }));
    }

    return db.prepare(`
      SELECT
        o.id, o.public_id, o.cleancloud_order_id, o.customer_name, o.customer_id, o.order_weight,
        o.customer_phone, o.customer_email, o.service_tier, o.status, o.cleancloud_status,
        o.ready_to_place, o.ready_for_pickup, o.updated_at,
        (
          SELECT COUNT(*)
          FROM baskets b
          WHERE b.order_id = o.id AND b.station = ? AND b.status = ?
        ) AS baskets_in_station
      FROM orders o
      WHERE EXISTS (
        SELECT 1
        FROM baskets b
        WHERE b.order_id = o.id AND b.station = ? AND b.status = ?
      )
      ORDER BY id
    `).all(station, station, station, station).map((row) => ({
      ...row,
      ready_to_place: Boolean(row.ready_to_place),
      ready_for_pickup: Boolean(row.ready_for_pickup)
    }));
  }

  function getQcLiveMetrics() {
    const basketsInQc = db.prepare(`
      SELECT COUNT(*) AS count
      FROM baskets
      WHERE station = 'qc' AND status = 'qc'
    `).get().count;

    const ordersInQcQueue = db.prepare(`
      SELECT COUNT(DISTINCT order_id) AS count
      FROM baskets
      WHERE station = 'qc' AND status = 'qc'
    `).get().count;

    const ordersInQcStatus = db.prepare(`
      SELECT COUNT(*) AS count
      FROM orders
      WHERE status = 'qc'
    `).get().count;

    return {
      basketsInQc,
      ordersInQcQueue,
      ordersInQcStatus
    };
  }

  return {
    getOrderDetails,
    getOverview,
    listStationOrders,
    getQcLiveMetrics
  };
}

module.exports = {
  createOrderQueryService
};
