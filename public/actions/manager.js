import { api, downloadScanExport } from "../api.js";
import { clearLastScan, createPickupPlacementDraft, resetQcState, resetSession, setNotice, state } from "../state.js";

let managerFilterTimeoutId = null;
let managerQuickModalViewportBound = false;
const managerReportSlaMinutes = {
  approval: 20,
  transfer: 15,
  stalled: 90
};

function parseTimestampMs(value) {
  const stamp = String(value || "").trim();
  if (!stamp) return null;
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime();
}

function getAgeMinutes(value, nowMs = Date.now()) {
  const stampMs = parseTimestampMs(value);
  if (!Number.isFinite(stampMs)) return null;
  const deltaMs = Math.max(0, nowMs - stampMs);
  return Math.floor(deltaMs / 60000);
}

function formatStamp(value) {
  const stamp = String(value || "").trim();
  if (!stamp) return "—";
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatDurationCompact(totalMinutes) {
  const minutes = Number(totalMinutes);
  if (!Number.isFinite(minutes) || minutes < 0) return "—";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

function normalizeText(value, fallback = "—") {
  const text = String(value || "").trim();
  return text || fallback;
}

function isIssuedOrder(order) {
  const cleanCloudStatus = String(order?.cleancloud_status || "").toLowerCase();
  return order?.status === "overview"
    || (
      order?.status === "pickup"
      && !order?.ready_for_pickup
      && (
        cleanCloudStatus.includes("issued")
        || cleanCloudStatus.includes("completed")
        || cleanCloudStatus.includes("awaiting close")
        || cleanCloudStatus.includes("выдан")
        || cleanCloudStatus.includes("заверш")
        || cleanCloudStatus.includes("ожидает закрытия")
      )
    );
}

function isHoldOrder(order) {
  return order?.status === "hold";
}

function isApprovalOrder(order) {
  return order?.status === "customer_approval" || Number(order?.pending_customer_approval_count || 0) > 0;
}

function isNewOrder(order) {
  return order?.status === "sorting" || order?.status === "sorted";
}

function isProductionOrder(order) {
  if (!order || typeof order !== "object") return false;
  if (isIssuedOrder(order)) return false;
  if (isHoldOrder(order)) return false;
  if (isApprovalOrder(order)) return false;
  if (isNewOrder(order)) return false;
  if (order.status === "pickup" && order.ready_for_pickup) return false;
  return true;
}

function toCsvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function buildCsv(headers, rows) {
  const headerLine = headers.map((header) => toCsvCell(header)).join(",");
  const rowLines = rows.map((row) => row.map((cell) => toCsvCell(cell)).join(","));
  return [headerLine, ...rowLines].join("\n");
}

function downloadCsvFile(fileName, csvText) {
  const blob = new Blob([`\uFEFF${csvText}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function makeReportFileName(reportKey) {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  return `manager-report-${reportKey}-${stamp}.csv`;
}

function formatDateInput(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDateInputMs(value) {
  const stamp = String(value || "").trim();
  if (!stamp) return null;
  const parsed = new Date(`${stamp}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getTime();
}

function endOfDateInputMs(value) {
  const startMs = startOfDateInputMs(value);
  if (!Number.isFinite(startMs)) return null;
  return startMs + (24 * 60 * 60 * 1000) - 1;
}

function offsetDateInput(baseDateInput, daysDelta) {
  const startMs = startOfDateInputMs(baseDateInput);
  if (!Number.isFinite(startMs)) return "";
  return formatDateInput(startMs + (daysDelta * 24 * 60 * 60 * 1000));
}

function formatReportRangeLabel(range) {
  if (!range || !range.dateFrom || !range.dateTo) return "—";
  const from = formatStamp(`${range.dateFrom}T00:00:00`);
  const to = formatStamp(`${range.dateTo}T23:59:59`);
  if (range.dateFrom === range.dateTo) return from.split(",")[0] || from;
  const fromDay = from.split(",")[0] || from;
  const toDay = to.split(",")[0] || to;
  return `${fromDay} — ${toDay}`;
}

function resolveManagerReportRange(raw = {}) {
  const nowMs = Date.now();
  const today = formatDateInput(nowMs);
  const normalizedPreset = String(raw?.preset || "7d").trim();
  const rawFrom = String(raw?.dateFrom || "").trim();
  const rawTo = String(raw?.dateTo || "").trim();

  let preset = normalizedPreset;
  let dateFrom = rawFrom;
  let dateTo = rawTo;
  let startMs = null;
  let endMs = null;

  if (preset === "shift") {
    preset = "7d";
  }

  if (preset === "today") {
    dateFrom = today;
    dateTo = today;
    startMs = startOfDateInputMs(today);
    endMs = nowMs;
  } else if (preset === "7d") {
    dateFrom = offsetDateInput(today, -6);
    dateTo = today;
    startMs = startOfDateInputMs(dateFrom);
    endMs = endOfDateInputMs(dateTo);
  } else if (preset === "30d") {
    dateFrom = offsetDateInput(today, -29);
    dateTo = today;
    startMs = startOfDateInputMs(dateFrom);
    endMs = endOfDateInputMs(dateTo);
  } else {
    preset = "custom";
    dateFrom = rawFrom || today;
    dateTo = rawTo || dateFrom;
    startMs = startOfDateInputMs(dateFrom);
    endMs = endOfDateInputMs(dateTo);
  }

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error("Invalid date range.");
  }
  if (endMs < startMs) {
    throw new Error("End date cannot be earlier than start date.");
  }

  return {
    preset,
    dateFrom,
    dateTo,
    startMs,
    endMs,
    label: formatReportRangeLabel({ dateFrom, dateTo })
  };
}

function isTimestampInRange(value, range) {
  const stampMs = parseTimestampMs(value);
  if (!Number.isFinite(stampMs)) return false;
  return stampMs >= range.startMs && stampMs <= range.endMs;
}

function filterOrdersByRange(orders, range, getTimestamp) {
  return (Array.isArray(orders) ? orders : []).filter((order) => {
    const timestamp = typeof getTimestamp === "function" ? getTimestamp(order) : order?.updated_at;
    return isTimestampInRange(timestamp, range);
  });
}

function applyManagerReportPreset(preset) {
  const range = resolveManagerReportRange({ preset });
  state.managerReportsRangePreset = range.preset;
  state.managerReportsDateFrom = range.dateFrom;
  state.managerReportsDateTo = range.dateTo;
}

function ensureManagerReportRangeState() {
  try {
    const range = resolveManagerReportRange({
      preset: state.managerReportsRangePreset,
      dateFrom: state.managerReportsDateFrom,
      dateTo: state.managerReportsDateTo
    });
    const isMobileViewport = typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(max-width: 640px)").matches;
    if (isMobileViewport && range.preset === "30d") {
      applyManagerReportPreset("7d");
      return;
    }
    state.managerReportsRangePreset = range.preset;
    state.managerReportsDateFrom = range.dateFrom;
    state.managerReportsDateTo = range.dateTo;
  } catch {
    applyManagerReportPreset("7d");
  }
}

function saveCustomManagerReportDates(dateFrom, dateTo) {
  const normalizedFrom = String(dateFrom || "").trim();
  const normalizedTo = String(dateTo || "").trim();
  const fallback = formatDateInput(Date.now());
  state.managerReportsRangePreset = "custom";
  state.managerReportsDateFrom = normalizedFrom || fallback;
  state.managerReportsDateTo = normalizedTo || state.managerReportsDateFrom;
}

function syncManagerReportsRangeUi() {
  const modal = document.querySelector(".manager-reports-modal");
  if (!(modal instanceof HTMLElement)) return;

  const activePreset = String(state.managerReportsRangePreset || "").trim();
  for (const button of modal.querySelectorAll("[data-manager-report-range-preset]")) {
    const preset = String(button.dataset.managerReportRangePreset || "").trim();
    button.classList.toggle("is-active", preset === activePreset);
  }

  const datesWrap = modal.querySelector(".manager-reports-range-dates");
  if (datesWrap instanceof HTMLElement) {
    datesWrap.classList.toggle("is-hidden", activePreset !== "custom");
  }

  const fromInput = modal.querySelector("[data-manager-reports-date-from]");
  if (fromInput instanceof HTMLInputElement) {
    fromInput.value = String(state.managerReportsDateFrom || "");
  }
  const toInput = modal.querySelector("[data-manager-reports-date-to]");
  if (toInput instanceof HTMLInputElement) {
    toInput.value = String(state.managerReportsDateTo || "");
  }
}

function getOrderFromDetailsPayload(payload) {
  if (payload && typeof payload === "object" && payload.order && typeof payload.order === "object") {
    return payload.order;
  }
  if (payload && typeof payload === "object") {
    return payload;
  }
  return null;
}

async function fetchOrderDetailsMap(orderIds) {
  const uniqueIds = Array.from(new Set(
    (Array.isArray(orderIds) ? orderIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)
  ));

  const entries = await Promise.all(uniqueIds.map(async (orderId) => {
    try {
      const payload = await api(`/api/orders/${orderId}`);
      return [orderId, getOrderFromDetailsPayload(payload)];
    } catch {
      return [orderId, null];
    }
  }));

  return new Map(entries);
}

function findIssuedAt(scans) {
  const rows = Array.isArray(scans) ? scans : [];
  const managerConfirmation = rows.find((scan) =>
    String(scan?.station || "").trim() === "pickup"
    && /выдача\s+подтверждена/ui.test(String(scan?.message || ""))
  );
  if (managerConfirmation?.created_at) return managerConfirmation.created_at;

  const managerPickup = rows.find((scan) =>
    String(scan?.station || "").trim() === "pickup"
    && String(scan?.actor || "").toLowerCase().includes("manager")
  );
  if (managerPickup?.created_at) return managerPickup.created_at;

  const pickupOk = rows.find((scan) =>
    String(scan?.station || "").trim() === "pickup"
    && String(scan?.result || "").toLowerCase() === "ok"
  );
  if (pickupOk?.created_at) return pickupOk.created_at;

  return "";
}

function collectMachineCodes(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((entry) => normalizeText(entry?.display_name || entry?.machine_code || "", ""))
    .filter(Boolean)
    .join(", ");
}

function buildShiftSummaryReport(orders, range) {
  const list = filterOrdersByRange(orders, range, (order) => order?.created_at);
  const nowMs = Date.now();

  const issuedCount = list.filter(isIssuedOrder).length;
  const newCount = list.filter(isNewOrder).length;
  const holdCount = list.filter(isHoldOrder).length;
  const approvalCount = list.filter(isApprovalOrder).length;
  const readyCount = list.filter((order) => order.status === "pickup" && order.ready_for_pickup).length;
  const productionCount = list.filter(isProductionOrder).length;

  const approvalOverdueCount = list.reduce((total, order) => {
    const age = getAgeMinutes(order.pending_approval_since, nowMs);
    return total + (Number.isFinite(age) && age > managerReportSlaMinutes.approval ? 1 : 0);
  }, 0);
  const transferOverdueCount = list.reduce((total, order) => {
    const age = getAgeMinutes(order.pending_qc_task_since, nowMs);
    return total + (Number.isFinite(age) && age > managerReportSlaMinutes.transfer ? 1 : 0);
  }, 0);
  const stalledCount = list.reduce((total, order) => {
    const age = getAgeMinutes(order.updated_at, nowMs);
    return total + (isProductionOrder(order) && Number.isFinite(age) && age > managerReportSlaMinutes.stalled ? 1 : 0);
  }, 0);

  return {
    title: "Shift summary",
    headers: ["Metric", "Value"],
    rows: [
      ["Generated", formatStamp(new Date().toISOString())],
      ["Period", range.label],
      ["Total orders", list.length],
      ["New (sorting/sorted)", newCount],
      ["In production", productionCount],
      ["Pending approval", approvalCount],
      ["HOLD", holdCount],
      ["Ready for handoff", readyCount],
      ["Issued (archive)", issuedCount],
      ["SLA risk (approval + handoff)", approvalOverdueCount + transferOverdueCount],
      ["Stalled >2h", stalledCount]
    ]
  };
}

async function buildIssuedArchiveReport(orders, range) {
  const issuedOrders = (Array.isArray(orders) ? orders : [])
    .filter(isIssuedOrder)
    .slice()
    .sort((left, right) => (parseTimestampMs(right.updated_at) || 0) - (parseTimestampMs(left.updated_at) || 0));
  const detailsMap = await fetchOrderDetailsMap(issuedOrders.map((order) => order.id));
  const prepared = [];

  for (const order of issuedOrders) {
    const details = detailsMap.get(Number(order.id));
    const issuedAt = findIssuedAt(details?.scans) || order.updated_at || "";
    if (!isTimestampInRange(issuedAt, range)) continue;
    prepared.push({
      order,
      issuedAt,
      row: [
      normalizeText(order.public_id),
      normalizeText(order.customer_name),
      normalizeText(order.customer_phone),
      formatStamp(order.created_at),
      formatStamp(issuedAt),
      normalizeText(order.cleancloud_status || order.status)
      ]
    });
  }

  prepared.sort((left, right) => (parseTimestampMs(right.issuedAt) || 0) - (parseTimestampMs(left.issuedAt) || 0));
  const rows = prepared.map((entry) => entry.row);

  return {
    title: "Issued in period",
    headers: ["ID", "Customer", "Phone", "Created date", "Issued date", "Status"],
    rows
  };
}

function buildSlaExceptionsReport(orders, range) {
  const list = filterOrdersByRange(orders, range, (order) => order?.updated_at);
  const nowMs = Date.now();
  const rows = [];

  for (const order of list) {
    const approvalAge = getAgeMinutes(order.pending_approval_since, nowMs);
    if (Number.isFinite(approvalAge) && approvalAge > managerReportSlaMinutes.approval) {
      rows.push([
        normalizeText(order.public_id),
        normalizeText(order.customer_name),
        normalizeText(order.status),
        "Approval",
        approvalAge,
        managerReportSlaMinutes.approval,
        Math.max(0, approvalAge - managerReportSlaMinutes.approval),
        formatStamp(order.pending_approval_since)
      ]);
    }

    const transferAge = getAgeMinutes(order.pending_qc_task_since, nowMs);
    if (Number.isFinite(transferAge) && transferAge > managerReportSlaMinutes.transfer) {
      rows.push([
        normalizeText(order.public_id),
        normalizeText(order.customer_name),
        normalizeText(order.status),
        "QC handoff",
        transferAge,
        managerReportSlaMinutes.transfer,
        Math.max(0, transferAge - managerReportSlaMinutes.transfer),
        formatStamp(order.pending_qc_task_since)
      ]);
    }

    const idleAge = getAgeMinutes(order.updated_at, nowMs);
    if (isProductionOrder(order) && Number.isFinite(idleAge) && idleAge > managerReportSlaMinutes.stalled) {
      rows.push([
        normalizeText(order.public_id),
        normalizeText(order.customer_name),
        normalizeText(order.status),
        "Flow stalled",
        idleAge,
        managerReportSlaMinutes.stalled,
        Math.max(0, idleAge - managerReportSlaMinutes.stalled),
        formatStamp(order.updated_at)
      ]);
    }
  }

  rows.sort((left, right) => Number(right[6] || 0) - Number(left[6] || 0));

  return {
    title: "Exceptions and SLA",
    headers: ["ID", "Customer", "Stage", "Risk type", "Age, min", "SLA, min", "Overdue, min", "Since"],
    rows
  };
}

function buildReworkReport(orders, range) {
  const rows = filterOrdersByRange(orders, range, (order) => order?.updated_at)
    .filter((order) => Number(order?.rework_request_count || 0) > 0 || Number(order?.rework_basket_count || 0) > 0)
    .sort((left, right) => (parseTimestampMs(right.updated_at) || 0) - (parseTimestampMs(left.updated_at) || 0))
    .map((order) => [
      normalizeText(order.public_id),
      normalizeText(order.customer_name),
      normalizeText(order.customer_phone),
      Number(order.rework_basket_count || 0),
      Number(order.rework_request_count || 0),
      Number(order.pending_customer_approval_count || 0),
      Number(order.rework_declined_count || 0),
      Number(order.max_rework_attempt || 0),
      normalizeText(order.status),
      formatStamp(order.updated_at)
    ]);

  return {
    title: "Rework report",
    headers: ["ID", "Customer", "Phone", "RW baskets", "RW requests", "Waiting customer", "Declines", "Max RW attempt", "Status", "Updated"],
    rows
  };
}

async function buildMachineLoadReport(orders, range) {
  const list = filterOrdersByRange(orders, range, (order) => order?.updated_at);
  const detailsMap = await fetchOrderDetailsMap(list.map((order) => order.id));
  const rows = [];

  for (const order of list) {
    const details = detailsMap.get(Number(order.id));
    const usage = details?.machine_usage && typeof details.machine_usage === "object" ? details.machine_usage : {};
    const washing = collectMachineCodes(usage.washing);
    const drying = collectMachineCodes(usage.drying);
    const other = collectMachineCodes(usage.other);
    if (!washing && !drying && !other) continue;
    rows.push([
      normalizeText(order.public_id),
      normalizeText(order.customer_name),
      normalizeText(order.customer_phone),
      normalizeText(order.status),
      washing || "—",
      drying || "—",
      other || "—",
      formatStamp(order.updated_at)
    ]);
  }

  rows.sort((left, right) => String(left[0]).localeCompare(String(right[0]), "ru"));

  return {
    title: "Machine loads",
    headers: ["ID", "Customer", "Phone", "Status", "Washing", "Drying", "Other", "Updated"],
    rows
  };
}

async function buildManagerReport(reportKey, range) {
  const overview = await api("/api/overview");
  const orders = Array.isArray(overview?.orders) ? overview.orders : [];

  if (reportKey === "shift-summary") {
    return buildShiftSummaryReport(orders, range);
  }
  if (reportKey === "issued-archive") {
    return buildIssuedArchiveReport(orders, range);
  }
  if (reportKey === "sla-exceptions") {
    return buildSlaExceptionsReport(orders, range);
  }
  if (reportKey === "rework") {
    return buildReworkReport(orders, range);
  }
  if (reportKey === "machine-load") {
    return buildMachineLoadReport(orders, range);
  }

  throw new Error("Unknown report type.");
}

async function exportManagerReport(reportKey, range) {
  const report = await buildManagerReport(reportKey, range);
  const headers = Array.isArray(report?.headers) ? report.headers : [];
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  const normalizedRows = rows.length ? rows : [[`No data for report "${normalizeText(report?.title, reportKey)}"`, ...new Array(Math.max(0, headers.length - 1)).fill("")]];
  const csv = buildCsv(headers, normalizedRows);
  downloadCsvFile(makeReportFileName(reportKey), csv);
  return {
    title: normalizeText(report?.title, reportKey),
    rowsCount: rows.length
  };
}

function getManagerQuickViewAnchorY(button, event) {
  const rect = button?.getBoundingClientRect?.();
  const fallback = rect ? (rect.top + (rect.height / 2)) : 0;
  const raw = Number(event?.clientY);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.round(raw);
  }
  return Number.isFinite(fallback) && fallback > 0 ? Math.round(fallback) : null;
}

function positionManagerQuickModalInViewport() {
  const modal = document.querySelector(".manager-quick-modal");
  if (!(modal instanceof HTMLElement)) return;
  const sheet = modal.querySelector(".manager-quick-modal-sheet");
  if (!(sheet instanceof HTMLElement)) return;

  const anchorY = Number(modal.dataset.managerQuickAnchorY || 0);
  if (!Number.isFinite(anchorY) || anchorY <= 0) {
    modal.style.alignItems = "";
    sheet.style.marginTop = "";
    return;
  }

  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const sheetHeight = sheet.offsetHeight || 0;
  if (!viewportHeight || !sheetHeight) {
    modal.style.alignItems = "";
    sheet.style.marginTop = "";
    return;
  }

  const safeTop = 8;
  const safeBottom = 8;
  const maxTop = Math.max(safeTop, viewportHeight - sheetHeight - safeBottom);
  const preferredTop = anchorY - (sheetHeight / 2);
  const top = Math.min(maxTop, Math.max(safeTop, preferredTop));

  modal.style.alignItems = "start";
  sheet.style.marginTop = `${Math.round(top)}px`;
}

function ensureManagerQuickModalViewportSync() {
  if (managerQuickModalViewportBound) return;
  window.addEventListener("resize", () => {
    positionManagerQuickModalInViewport();
  });
  managerQuickModalViewportBound = true;
}

function openManagerActionDialog(dialog) {
  state.managerReadyOrderId = null;
  state.managerQuickView = null;
  state.managerHistoryModalOpen = false;
  state.managerReportsModalOpen = false;
  state.managerActionDialog = dialog;
  state.submittingManagerAction = false;
}

function closeManagerActionDialog() {
  state.managerActionDialog = null;
  state.submittingManagerAction = false;
}

function buildReleaseHoldDialog(button) {
  const orderId = Number(button.dataset.releaseHold);
  if (!Number.isFinite(orderId)) return null;
  const orderPublicId = String(button.dataset.orderPublicId || "").trim();
  return {
    kind: "release-hold",
    orderId,
    orderPublicId,
    title: "Return order to flow",
    body: orderPublicId
      ? `Order ${orderPublicId} will leave hold and return to washing.`
      : "Order will leave hold and return to washing.",
    detail: "Use this only when the manager decision is complete and the order can continue.",
    confirmLabel: "Release hold",
    tone: "critical"
  };
}

function buildCompletePickupDialog(button) {
  const orderId = Number(button.dataset.completePickupOrder);
  if (!Number.isFinite(orderId)) return null;
  const orderPublicId = String(button.dataset.orderPublicId || "").trim();
  return {
    kind: "complete-pickup",
    orderId,
    orderPublicId,
    eyebrow: "Handoff",
    title: "Confirm handoff",
    body: orderPublicId
      ? `Order ${orderPublicId} will be marked as issued.`
      : "Order will be marked as issued.",
    detail: "After confirmation, route sheets and storage locations are released. Order status syncs to CleanCloud as completed.",
    footer: "This action runs immediately and is recorded in the order log.",
    confirmLabel: "Issued",
    tone: "neutral"
  };
}

function buildReworkDialog(button, kind) {
  const requestId = Number(
    kind === "approve-rework"
      ? button.dataset.approveReworkRequest
      : button.dataset.declineReworkRequest
  );
  if (!Number.isFinite(requestId)) return null;

  const orderPublicId = String(button.dataset.orderPublicId || "").trim();
  const requestSummary = String(button.dataset.requestSummary || "").trim();
  const isApprove = kind === "approve-rework";

  return {
    kind,
    requestId,
    orderPublicId,
    title: isApprove ? "Approve extra treatment" : "Decline extra treatment",
    body: requestSummary
      ? `${requestSummary}${orderPublicId ? ` · order ${orderPublicId}` : ""}`
      : (orderPublicId ? `Order ${orderPublicId}` : "Rework request"),
    detail: isApprove
      ? "After approval, the request goes to QC transfer tasks. The rework basket is created when transfer is confirmed."
      : "After decline, the request goes to QC tasks to confirm return to the primary flow. The basket cannot continue without that step.",
    confirmLabel: isApprove ? "Confirm customer approval" : "Record decline",
    tone: isApprove ? "warn" : "neutral"
  };
}

async function executeManagerAction(dialog) {
  if (!dialog) return null;

  if (dialog.kind === "release-hold") {
    const result = await api(`/api/orders/${dialog.orderId}/release-hold`, {
      method: "POST",
      body: JSON.stringify({})
    });
    return { result, notice: "HOLD released: order returned to washing." };
  }

  if (dialog.kind === "complete-pickup") {
    const result = await api("/api/pickup/complete", {
      method: "POST",
      body: JSON.stringify({ orderId: dialog.orderId })
    });
    return { result, notice: "Handoff confirmed: route sheets and locations released." };
  }

  if (dialog.kind === "approve-rework") {
    const result = await api(`/api/rework-requests/${dialog.requestId}/approve`, {
      method: "POST",
      body: JSON.stringify({})
    });
    return { result, notice: result.message };
  }

  if (dialog.kind === "decline-rework") {
    const result = await api(`/api/rework-requests/${dialog.requestId}/decline`, {
      method: "POST",
      body: JSON.stringify({})
    });
    return { result, notice: result.message };
  }

  return null;
}

export function bindManagerActions(renderApp, renderLogin) {
  ensureManagerQuickModalViewportSync();
  positionManagerQuickModalInViewport();

  const managerFilterInput = document.querySelector("[data-manager-filter]");
  if (managerFilterInput) {
    managerFilterInput.addEventListener("input", async () => {
      const nextValue = String(managerFilterInput.value || "");
      state.managerFilter = nextValue;
      if (managerFilterTimeoutId) {
        clearTimeout(managerFilterTimeoutId);
      }
      managerFilterTimeoutId = setTimeout(async () => {
        managerFilterTimeoutId = null;
        await renderApp();
        const refreshedInput = document.querySelector("[data-manager-filter]");
        if (refreshedInput) {
          refreshedInput.focus();
          refreshedInput.setSelectionRange(nextValue.length, nextValue.length);
        }
      }, 120);
    });
  }

  for (const button of document.querySelectorAll("[data-open-sync-modal]")) {
    button.addEventListener("click", async () => {
      state.selectedOrderId = null;
      state.managerReadyOrderId = null;
      state.managerQuickView = null;
      state.managerQuickViewAnchorY = null;
      state.managerHistoryModalOpen = false;
      state.managerReportsModalOpen = false;
      state.managerSyncModalOpen = true;
      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-open-manager-quick-view]")) {
    button.addEventListener("click", async (event) => {
      const nextView = String(button.dataset.openManagerQuickView || "").trim();
      if (!nextView) return;
      state.selectedOrderId = null;
      state.managerReadyOrderId = null;
      state.managerSyncModalOpen = false;
      state.managerHistoryModalOpen = false;
      state.managerReportsModalOpen = false;
      state.managerQuickView = nextView;
      state.managerQuickViewAnchorY = getManagerQuickViewAnchorY(button, event);
      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-open-manager-history-modal]")) {
    button.addEventListener("click", async () => {
      state.selectedOrderId = null;
      state.managerReadyOrderId = null;
      state.managerQuickView = null;
      state.managerQuickViewAnchorY = null;
      state.managerSyncModalOpen = false;
      state.managerReportsModalOpen = false;
      closeManagerActionDialog();
      state.managerHistoryModalOpen = true;
      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-open-manager-reports-modal]")) {
    button.addEventListener("click", async () => {
      ensureManagerReportRangeState();
      state.selectedOrderId = null;
      state.managerReadyOrderId = null;
      state.managerQuickView = null;
      state.managerQuickViewAnchorY = null;
      state.managerSyncModalOpen = false;
      state.managerHistoryModalOpen = false;
      closeManagerActionDialog();
      state.managerReportsModalOpen = true;
      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-manager-report-range-preset]")) {
    button.addEventListener("click", () => {
      const preset = String(button.dataset.managerReportRangePreset || "").trim();
      if (!preset) return;
      applyManagerReportPreset(preset);
      syncManagerReportsRangeUi();
    });
  }

  for (const input of document.querySelectorAll("[data-manager-reports-date-from]")) {
    input.addEventListener("change", () => {
      const dateFrom = String(input.value || "").trim();
      const dateTo = String(state.managerReportsDateTo || "").trim();
      saveCustomManagerReportDates(dateFrom, dateTo);
      syncManagerReportsRangeUi();
    });
  }

  for (const input of document.querySelectorAll("[data-manager-reports-date-to]")) {
    input.addEventListener("change", () => {
      const dateFrom = String(state.managerReportsDateFrom || "").trim();
      const dateTo = String(input.value || "").trim();
      saveCustomManagerReportDates(dateFrom, dateTo);
      syncManagerReportsRangeUi();
    });
  }

  for (const button of document.querySelectorAll("[data-open-manager-ready-order]")) {
    button.addEventListener("click", async () => {
      const orderId = Number(button.dataset.openManagerReadyOrder || 0);
      if (!Number.isFinite(orderId) || orderId <= 0) return;
      state.selectedOrderId = null;
      state.managerSyncModalOpen = false;
      state.managerQuickView = null;
      state.managerQuickViewAnchorY = null;
      state.managerHistoryModalOpen = false;
      state.managerReportsModalOpen = false;
      state.managerReadyOrderId = orderId;
      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-close-manager-ready-modal]")) {
    button.addEventListener("click", async () => {
      state.managerReadyOrderId = null;
      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-close-manager-quick-view]")) {
    button.addEventListener("click", async () => {
      state.managerQuickView = null;
      state.managerQuickViewAnchorY = null;
      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-close-sync-modal]")) {
    button.addEventListener("click", async () => {
      state.managerSyncModalOpen = false;
      state.managerQuickViewAnchorY = null;
      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-close-manager-history-modal]")) {
    button.addEventListener("click", async () => {
      state.managerHistoryModalOpen = false;
      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-close-manager-reports-modal]")) {
    button.addEventListener("click", async () => {
      state.managerReportsModalOpen = false;
      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-close-manager-action]")) {
    button.addEventListener("click", async () => {
      closeManagerActionDialog();
      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-release-hold]")) {
    button.addEventListener("click", async () => {
      const dialog = buildReleaseHoldDialog(button);
      if (!dialog) return;
      openManagerActionDialog(dialog);
      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-complete-pickup-order]")) {
    button.addEventListener("click", async () => {
      const dialog = buildCompletePickupDialog(button);
      if (!dialog) return;
      openManagerActionDialog(dialog);
      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-approve-rework-request]")) {
    button.addEventListener("click", async () => {
      const dialog = buildReworkDialog(button, "approve-rework");
      if (!dialog) return;
      openManagerActionDialog(dialog);
      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-decline-rework-request]")) {
    button.addEventListener("click", async () => {
      const dialog = buildReworkDialog(button, "decline-rework");
      if (!dialog) return;
      openManagerActionDialog(dialog);
      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-confirm-manager-action]")) {
    button.addEventListener("click", async () => {
      if (!state.managerActionDialog || state.submittingManagerAction) {
        return;
      }

      state.submittingManagerAction = true;
      await renderApp();

      try {
        const payload = await executeManagerAction(state.managerActionDialog);
        closeManagerActionDialog();
        if (payload?.result?.order?.id) {
          const completedOrderId = Number(payload.result.order.id || 0);
          const readyModalOrderId = Number(state.managerReadyOrderId || 0);
          state.managerQuickView = null;
          state.managerQuickViewAnchorY = null;
          if (readyModalOrderId > 0 && completedOrderId === readyModalOrderId) {
            state.managerReadyOrderId = null;
            state.selectedOrderId = null;
          } else {
            state.selectedOrderId = completedOrderId;
          }
        }
        if (payload?.notice) {
          setNotice("ok", payload.notice);
        }
      } catch (error) {
        state.submittingManagerAction = false;
        setNotice("error", error.message);
        await renderApp();
        return;
      }

      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-demo-reset]")) {
    button.addEventListener("click", async () => {
      const confirmed = window.confirm("Reset demo data to the initial scenario? Current test progress will be removed.");
      if (!confirmed) {
        return;
      }
      try {
        await api("/api/demo/reset", { method: "POST" });
        state.screen = "station-picker";
        state.currentStation = null;
        state.selectedOrderId = null;
        state.activeSortingOrderId = null;
        state.activePickupOrderId = null;
        state.pickupMode = "assembly";
        state.pickupPlacementDraft = createPickupPlacementDraft();
        state.submittingPickupPlacement = false;
        resetQcState();
        state.sortingDrafts = {};
        state.managerQuickView = null;
        state.managerQuickViewAnchorY = null;
        state.managerReadyOrderId = null;
        state.managerSyncModalOpen = false;
        state.managerHistoryModalOpen = false;
        state.managerReportsModalOpen = false;
        state.managerReportsRangePreset = "7d";
        state.managerReportsDateFrom = "";
        state.managerReportsDateTo = "";
        closeManagerActionDialog();
        state.deniedStation = null;
        clearLastScan();
        setNotice("ok", "Demo data reset completed. The initial scenario is restored.");
      } catch (error) {
        setNotice("error", error.message);
      }
      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-run-sync-now]")) {
    button.addEventListener("click", async () => {
      try {
        const result = await api("/api/sync/run", { method: "POST", body: JSON.stringify({}) });
        setNotice("ok", result.message || "Sync queue started manually.");
      } catch (error) {
        setNotice("error", error.message);
      }
      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-retry-sync-order]")) {
    button.addEventListener("click", async () => {
      const orderId = Number(button.dataset.retrySyncOrder);
      if (!Number.isFinite(orderId) || orderId <= 0) {
        setNotice("error", "Invalid orderId for retry.");
        await renderApp();
        return;
      }

      try {
        const result = await api("/api/sync/retry-order", {
          method: "POST",
          body: JSON.stringify({ orderId })
        });
        setNotice("ok", result.message || `Retry for order #${orderId} completed.`);
      } catch (error) {
        setNotice("error", error.message);
      }
      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-export-scans]")) {
    button.addEventListener("click", async () => {
      const format = button.dataset.exportScans;
      try {
        await downloadScanExport(format);
        setNotice("ok", `Scan log exported to ${format.toUpperCase()}.`);
      } catch (error) {
        setNotice("error", error.message);
      }
      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-export-order]")) {
    button.addEventListener("click", async () => {
      const format = button.dataset.exportOrder;
      if (!state.selectedOrderId) {
        setNotice("warn", "Select an order first to export its scans.");
        await renderApp();
        return;
      }
      try {
        await downloadScanExport(format, state.selectedOrderId);
        setNotice("ok", `Order scans ${state.selectedOrderId} exported to ${format.toUpperCase()}.`);
      } catch (error) {
        setNotice("error", error.message);
      }
      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-export-manager-report]")) {
    button.addEventListener("click", async () => {
      const reportKey = String(button.dataset.exportManagerReport || "").trim();
      if (!reportKey) return;

      const defaultLabel = String(button.textContent || "Download");
      button.disabled = true;
      button.textContent = "Preparing...";

      try {
        const range = resolveManagerReportRange({
          preset: state.managerReportsRangePreset,
          dateFrom: state.managerReportsDateFrom,
          dateTo: state.managerReportsDateTo
        });
        const exported = await exportManagerReport(reportKey, range);
        const countLabel = exported.rowsCount > 0 ? `, rows: ${exported.rowsCount}` : "";
        setNotice("ok", `Report «${exported.title}» exported${countLabel}. Period: ${range.label}.`);
      } catch (error) {
        setNotice("error", error.message || "Could not export report.");
      } finally {
        button.disabled = false;
        button.textContent = defaultLabel;
      }

      await renderApp();
    });
  }

  const logoutFromDenied = document.getElementById("logout-from-denied");
  if (logoutFromDenied) {
    logoutFromDenied.addEventListener("click", async () => {
      try {
        await api("/api/logout", { method: "POST" });
      } catch {
        // ignore
      }
      resetSession();
      renderLogin();
    });
  }
}
