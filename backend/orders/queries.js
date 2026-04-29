function createOrderQueryService(orderQueryRepository, options = {}) {
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
    const order = orderQueryRepository.findOrderById(orderId);

    if (!order) {
      return null;
    }

    const baskets = orderQueryRepository.listBasketsByOrderId(orderId).map((basket) => {
      const { basket_items_json, ...rest } = basket;
      return {
        ...rest,
        item_counts: parseBasketItemCounts(basket_items_json)
      };
    });
    const basketIds = baskets.map((basket) => basket.id);
    const imagesByBasketId = new Map();
    if (basketIds.length) {
      const imageRows = orderQueryRepository.listBasketImagesByBasketIds(basketIds);

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

    const scans = orderQueryRepository.listRecentScansByOrderId(orderId);
    const pickupPlacements = orderQueryRepository.listPickupPlacementsByOrderId(orderId).map((row) => ({
      slot_index: Number(row.slot_index || 1),
      bin_qr_code: row.bin_qr_code || "",
      location_qr_code: row.location_qr_code || "",
      placed_at: row.placed_at || null
    }));
    const machineUsageRows = orderQueryRepository.listMachineUsageByOrderId(orderId);
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

    const reworkRequests = orderQueryRepository.listReworkRequestsByOrderId(orderId).map((row) => ({
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
        counts.sorting = orderQueryRepository.countSortingOrders();
        continue;
      }

      counts[station] = orderQueryRepository.countOrdersByBasketStation(station);
    }
    counts.hold = orderQueryRepository.countOrdersByBasketStation(holdStation);
    counts.ready = orderQueryRepository.countReadyOrders();

    const orders = orderQueryRepository.listOverviewOrders().map((row) => ({
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
    const pickupPlacements = orderQueryRepository.listActivePickupPlacements();
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
    const managerKpiCore = orderQueryRepository.getManagerKpiCore();
    const managerKpiRework = orderQueryRepository.getManagerKpiRework();
    const managerKpiPickup = orderQueryRepository.getManagerKpiPickup();

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
      return orderQueryRepository.listSortingStationOrders().map((row) => ({ ...row, ready_to_place: Boolean(row.ready_to_place), ready_for_pickup: Boolean(row.ready_for_pickup) }));
    }

    return orderQueryRepository.listActiveStationOrders(station).map((row) => ({
      ...row,
      ready_to_place: Boolean(row.ready_to_place),
      ready_for_pickup: Boolean(row.ready_for_pickup)
    }));
  }

  function getQcLiveMetrics() {
    const basketsInQc = orderQueryRepository.countQcBaskets();
    const ordersInQcQueue = orderQueryRepository.countQcOrdersFromBaskets();
    const ordersInQcStatus = orderQueryRepository.countQcStatusOrders();

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
