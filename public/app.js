import { api } from "./api.js";
import { bindGlobalActions } from "./actions.js";
import { renderLogin } from "./render/login.js";
import { renderManagerOverviewCompact, renderOrderDetails, renderOverview, renderPickup, renderSorting, renderSyncQueue } from "./render/orders.js";
import { renderScanScreen, renderSimpleScanModeWithStatus } from "./render/scan.js";
import { renderManagerCabinet, renderNoAccess, renderSimpleWorkerHome, renderStationPicker } from "./render/stations.js";
import { app, applyRoleDefaults, consumeNotice, getAllowedStations, getLastScanForStation, isManagerRole, isScanStation, resetSession, state, stationLabels } from "./state.js";
import { escapeHtml } from "./utils.js";

function showLogin(error) {
  document.body.classList.remove("modal-open");
  renderLogin(renderApp, error);
}

boot();

async function boot() {
  if (!state.token) {
    showLogin();
    return;
  }

  try {
    const session = await api("/api/session");
    state.user = session.user;
    state.screen = "station-picker";
    applyRoleDefaults();
    await renderApp();
  } catch {
    resetSession();
    showLogin();
  }
}

async function ensureStations() {
  if (Array.isArray(state.stations) && state.stations.length) {
    return state.stations;
  }
  const stationsResponse = await api("/api/stations");
  state.stations = Array.isArray(stationsResponse.stations) ? stationsResponse.stations : [];
  return state.stations;
}

async function renderApp() {
  const allowedStations = getAllowedStations();
  const managerView = isManagerRole();
  const pickupAllowed = allowedStations.includes("pickup");
  const stations = await ensureStations();
  const shouldLoadOverview = allowedStations.includes("overview")
    && (managerView || (state.screen === "station" && state.currentStation === "overview"));
  const shouldLoadSyncQueue = managerView;
  const shouldLoadCurrentStationOrders = !managerView
    && state.screen === "station"
    && Boolean(state.currentStation)
    && state.currentStation !== "overview"
    && state.currentStation !== "pickup"
    && allowedStations.includes(state.currentStation);
  const shouldLoadPickupWorkbench = !managerView
    && pickupAllowed
    && state.screen === "station"
    && state.currentStation === "pickup";
  const shouldLoadOrderDetails = managerView && Boolean(state.selectedOrderId);

  const [overview, syncQueue, currentStationOrders, pickupWorkbench] = await Promise.all([
    shouldLoadOverview ? api("/api/overview") : Promise.resolve({ counts: {}, orders: [] }),
    shouldLoadSyncQueue ? api("/api/sync-queue") : Promise.resolve({ items: [], summary: null }),
    shouldLoadCurrentStationOrders ? api(`/api/orders?station=${state.currentStation}`) : Promise.resolve(null),
    shouldLoadPickupWorkbench ? api("/api/pickup/workbench") : Promise.resolve({ orders: [] })
  ]);

  const notice = consumeNotice();
  const stationData = {};
  if (shouldLoadCurrentStationOrders && currentStationOrders) {
    stationData[state.currentStation] = currentStationOrders;
  }

  let orderDetails = null;
  if (shouldLoadOrderDetails) {
    try {
      orderDetails = await api(`/api/orders/${state.selectedOrderId}`);
    } catch {
      state.selectedOrderId = null;
    }
  }

  const content = renderScreenContent({
    stations,
    overview,
    stationData,
    pickupWorkbench,
    orderDetails,
    syncQueue,
    notice
  });

  app.innerHTML = `
    <section class="shell">
      <div class="topbar panel">
        <div>
          ${
            isManagerRole()
              ? `
                <strong class="manager-topbar-title">Кабинет менеджера</strong>
                <div class="muted manager-topbar-meta">${escapeHtml(state.user.displayName)}</div>
              `
              : `<strong class="station-title">${escapeHtml(stationLabels[state.currentStation] || "Станция")}</strong>`
          }
        </div>
        <nav>
          <button class="ghost" id="logout-button">Выйти</button>
        </nav>
      </div>
      ${content}
    </section>
  `;

  syncModalBodyClass();
  bindGlobalActions(renderApp, () => showLogin());
}

function syncModalBodyClass() {
  const hasModal = Boolean(app.querySelector(".sorting-modal, .qc-modal"));
  document.body.classList.toggle("modal-open", hasModal);
}

function renderScreenContent({ stations, overview, stationData, pickupWorkbench, orderDetails, syncQueue, notice }) {
  const managerView = isManagerRole();
  const simpleScanView = !managerView
    && state.screen === "station"
    && isScanStation(state.currentStation)
    && state.currentStation !== "pickup"
    && state.simpleMode;
  const lastScan = getLastScanForStation(state.currentStation);
  const sortingOrders = stationData.sorting?.orders || [];
  const actionableSortingOrders = sortingOrders.filter((order) => order.status === "sorting");

  if (actionableSortingOrders.length) {
    if (!actionableSortingOrders.some((order) => order.id === state.activeSortingOrderId)) {
      state.activeSortingOrderId = null;
    }
    const activeIds = new Set(actionableSortingOrders.map((order) => order.id));
    for (const key of Object.keys(state.sortingDrafts || {})) {
      const orderId = Number(key);
      if (!activeIds.has(orderId)) {
        delete state.sortingDrafts[key];
      }
    }
    if (state.activeSortingOrderId && !state.sortingDrafts[state.activeSortingOrderId]) {
      state.sortingDrafts[state.activeSortingOrderId] = {
        rows: [{ color: "mixed" }]
      };
    }
  } else {
    state.activeSortingOrderId = null;
  }

  const readyPickupIds = new Set((pickupWorkbench.orders || []).map((order) => order.id));
  if (!readyPickupIds.has(state.activePickupOrderId)) {
    state.activePickupOrderId = null;
  }
  if (!readyPickupIds.has(state.pickupVerifiedOrderId)) {
    state.pickupVerifiedOrderId = null;
  }

  if (state.screen === "station-picker") {
    if (!managerView && state.currentStation) {
      return `
        ${notice ? `<div class="notice ${notice.type}">${escapeHtml(notice.text)}</div>` : ""}
        ${renderSimpleWorkerHome()}
      `;
    }

    if (managerView) {
      return `
        ${notice ? `<div class="notice ${notice.type}">${escapeHtml(notice.text)}</div>` : ""}
        ${renderManagerCabinet(stations, overview.counts, syncQueue.summary, state.currentStation)}
        ${renderManagerOverviewCompact(overview.orders, 12, state.managerFilter)}
        ${orderDetails ? renderOrderDetails(orderDetails) : ""}
        ${renderSyncQueue(syncQueue)}
      `;
    }

    return `
      ${notice ? `<div class="notice ${notice.type}">${escapeHtml(notice.text)}</div>` : ""}
      ${renderStationPicker(stations)}
    `;
  }

  if (state.screen === "forbidden") {
    return `
      ${notice ? `<div class="notice ${notice.type}">${escapeHtml(notice.text)}</div>` : ""}
      ${renderNoAccess()}
      ${managerView ? renderStationPicker(stations) : ""}
    `;
  }

  if (simpleScanView) {
    return `
      ${notice ? `<div class="notice ${notice.type}">${escapeHtml(notice.text)}</div>` : ""}
      ${renderSimpleScanModeWithStatus(
        state.currentStation,
        stationData[state.currentStation]?.orders || [],
        [],
        lastScan,
        state.qcRejectReason,
        state.qcInspection
      )}
    `;
  }

  if (!managerView && state.screen === "station") {
    return `
      ${notice ? `<div class="notice ${notice.type}">${escapeHtml(notice.text)}</div>` : ""}
      ${state.currentStation === "overview" ? renderOverview(overview.orders) : ""}
      ${state.currentStation === "sorting" ? renderSorting(sortingOrders, state.activeSortingOrderId, state.sortingDrafts) : ""}
      ${state.currentStation === "washing" ? renderScanScreen("washing", stationData.washing?.orders || [], lastScan) : ""}
      ${state.currentStation === "qc" ? renderScanScreen("qc", stationData.qc?.orders || [], lastScan, state.qcRejectReason, state.qcInspection) : ""}
      ${state.currentStation === "drying" ? renderScanScreen("drying", stationData.drying?.orders || [], lastScan) : ""}
      ${state.currentStation === "ironing" ? renderScanScreen("ironing", stationData.ironing?.orders || [], lastScan) : ""}
      ${state.currentStation === "pickup" ? renderPickup(pickupWorkbench.orders || [], lastScan, state.pickupScanFlash, false) : ""}
    `;
  }

  if (managerView) {
    state.screen = "station-picker";
    state.currentStation = null;

    return `
      ${notice ? `<div class="notice ${notice.type}">${escapeHtml(notice.text)}</div>` : ""}
      ${renderManagerCabinet(stations, overview.counts, syncQueue.summary, null)}
      ${renderManagerOverviewCompact(overview.orders, 12, state.managerFilter)}
      ${orderDetails ? renderOrderDetails(orderDetails) : ""}
      ${renderSyncQueue(syncQueue)}
    `;
  }

  return `
    ${notice ? `<div class="notice ${notice.type}">${escapeHtml(notice.text)}</div>` : ""}
    ${renderStationPicker(stations)}
  `;
}
