import { api } from "./api.js";
import { bindGlobalActions } from "./actions.js";
import { renderLogin } from "./render/login.js";
import { renderManagerHistoryModal, renderManagerOverviewCompact, renderManagerReadyOrderModal, renderManagerReportsModal, renderOverview, renderSyncQueue } from "./render/manager.js";
import { renderManagerActionModal, renderOrderDetailsModal } from "./render/orders.js";
import { renderPickup } from "./render/pickup.js";
import { renderSorting } from "./render/sorting.js";
import { renderSimpleScanModeWithStatus } from "./render/scan.js";
import { renderNoAccess, renderSimpleWorkerHome, renderStationPicker } from "./render/stations.js";
import { localizeDom } from "./i18n.js";
import { app, applyRoleDefaults, consumeNotice, getAllowedStations, getLastScanForStation, isManagerRole, isScanStation, resetSession, state, stationLabels } from "./state.js";
import { escapeHtml } from "./utils.js";

let pickupReadyToastTimeoutId = null;

function schedulePickupReadyToastAutoHide(shouldShow) {
  if (!shouldShow) return;

  const toast = app.querySelector(".notice.ok");
  if (!toast) return;

  toast.classList.add("pickup-ready-toast");
  if (pickupReadyToastTimeoutId) {
    clearTimeout(pickupReadyToastTimeoutId);
  }

  pickupReadyToastTimeoutId = setTimeout(() => {
    if (!toast.isConnected) return;
    toast.classList.add("is-leaving");
    setTimeout(() => {
      if (toast.isConnected) {
        toast.remove();
      }
    }, 220);
  }, 4200);
}

function showLogin(error) {
  document.body.classList.remove("modal-open");
  renderLogin(renderApp, error);
  localizeDom(app);
}

boot();

async function boot() {
  // Keep one-shot localization per render; MutationObserver auto-localization
  // can lock the UI on machine-station flow transitions.
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
  const shouldLoadQcTransferTasks = !managerView
    && state.screen === "station"
    && state.currentStation === "qc"
    && allowedStations.includes("qc");
  const shouldLoadPickupWorkbench = !managerView
    && pickupAllowed
    && state.screen === "station"
    && state.currentStation === "pickup";
  const shouldLoadMachineWorkbench = !managerView
    && state.screen === "station"
    && (state.currentStation === "washing" || state.currentStation === "drying")
    && allowedStations.includes(state.currentStation);
  const managerReadyOrderId = Number(state.managerReadyOrderId || 0);
  const selectedOrderId = Number(state.selectedOrderId || 0);
  const detailsOrderId = managerView && managerReadyOrderId > 0 ? managerReadyOrderId : selectedOrderId;
  const shouldLoadOrderDetails = Number.isFinite(detailsOrderId)
    && detailsOrderId > 0
    && (
      managerView
      || (
        !managerView
        && state.screen === "station"
        && state.currentStation === "sorting"
        && allowedStations.includes("sorting")
      )
    );

  const [overview, syncQueue, currentStationOrders, pickupWorkbench, qcTransferTasksPayload, machineWorkbenchPayload] = await Promise.all([
    shouldLoadOverview ? api("/api/overview") : Promise.resolve({ counts: {}, orders: [] }),
    shouldLoadSyncQueue ? api("/api/sync-queue") : Promise.resolve({ items: [], summary: null }),
    shouldLoadCurrentStationOrders ? api(`/api/orders?station=${state.currentStation}`) : Promise.resolve(null),
    shouldLoadPickupWorkbench ? api("/api/pickup/workbench") : Promise.resolve({ assemblyOrders: [], readyToPlaceOrders: [], placedOrders: [] }),
    shouldLoadQcTransferTasks ? api("/api/qc/transfer-tasks") : Promise.resolve({ tasks: [] }),
    shouldLoadMachineWorkbench ? api(`/api/machines/workbench?station=${state.currentStation}`) : Promise.resolve({ station: null, machines: [] })
  ]);
  const qcTransferTasks = Array.isArray(qcTransferTasksPayload?.tasks) ? qcTransferTasksPayload.tasks : [];
  const machineWorkbench = {};
  if (shouldLoadMachineWorkbench) {
    machineWorkbench[state.currentStation] = {
      station: machineWorkbenchPayload?.station || state.currentStation,
      machines: Array.isArray(machineWorkbenchPayload?.machines) ? machineWorkbenchPayload.machines : []
    };
  }
  if (shouldLoadQcTransferTasks) {
    const activeTaskIds = new Set(qcTransferTasks.map((task) => String(Number(task?.id || 0))).filter((value) => value !== "0"));
    for (const key of Object.keys(state.qcTransferScanDrafts || {})) {
      if (!activeTaskIds.has(String(key))) {
        delete state.qcTransferScanDrafts[key];
      }
    }
  }

  const notice = consumeNotice();
  const pickupReadyNotice = Boolean(
    state.currentStation === "pickup"
    && notice?.type === "ok"
    && /kit assembled|ready to place/ui.test(String(notice?.text || ""))
  );
  const stationData = {};
  if (shouldLoadCurrentStationOrders && currentStationOrders) {
    stationData[state.currentStation] = currentStationOrders;
  }

  let orderDetails = null;
  if (shouldLoadOrderDetails) {
    try {
      orderDetails = await api(`/api/orders/${detailsOrderId}`);
    } catch {
      if (managerView && managerReadyOrderId > 0) {
        state.managerReadyOrderId = null;
      } else {
        state.selectedOrderId = null;
      }
    }
  }

  const content = renderScreenContent({
    stations,
    overview,
    stationData,
    pickupWorkbench,
    qcTransferTasks,
    machineWorkbench,
    orderDetails,
    syncQueue,
    notice
  });
  const managerDisplayName = String(state.user?.displayName || "").trim();
  const managerDisplayNameLower = managerDisplayName.toLowerCase();
  const showManagerMeta = Boolean(managerDisplayName) && !managerDisplayNameLower.includes("manager");

  app.innerHTML = `
    <section class="shell shell-station-${escapeHtml(state.currentStation || "none")}">
      <div class="topbar panel ${isManagerRole() ? "manager-topbar" : ""} ${!isManagerRole() ? `topbar-station-${escapeHtml(state.currentStation || "none")}` : ""}">
        <div>
          ${
            isManagerRole()
              ? `
                <div class="manager-topbar-copy">
                  <strong class="manager-topbar-title">Manager Desk</strong>
                  ${showManagerMeta ? `<div class="muted manager-topbar-meta">${escapeHtml(managerDisplayName)}</div>` : ""}
                </div>
              `
              : `<strong class="station-title">${escapeHtml(stationLabels[state.currentStation] || "Station")}</strong>`
          }
        </div>
        <nav>
          <button class="ghost" id="logout-button">Log out</button>
        </nav>
      </div>
      ${content}
    </section>
  `;
  localizeDom(app);

  schedulePickupReadyToastAutoHide(pickupReadyNotice);
  syncModalBodyClass();
  bindGlobalActions(renderApp, () => showLogin());
}

function syncModalBodyClass() {
  const hasModal = Boolean(app.querySelector(".sorting-modal, .qc-modal, .order-modal, .manager-sync-modal, .manager-quick-modal, .manager-history-modal, .manager-action-modal, .manager-ready-order-modal, .qc-transfer-drawer, .pickup-placement-modal"));
  document.body.classList.toggle("modal-open", hasModal);
}

function renderScreenContent({ stations, overview, stationData, pickupWorkbench, qcTransferTasks, machineWorkbench, orderDetails, syncQueue, notice }) {
  const managerView = isManagerRole();
  const simpleScanView = !managerView
    && state.screen === "station"
    && isScanStation(state.currentStation)
    && state.currentStation !== "pickup";
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
        rows: [],
        wizardStep: 1,
        activeRowIndex: 0,
        scanInput: ""
      };
    }
  } else {
    state.activeSortingOrderId = null;
  }

  const pickupAssemblyOrders = Array.isArray(pickupWorkbench.assemblyOrders) ? pickupWorkbench.assemblyOrders : [];
  const pickupReadyToPlaceOrders = Array.isArray(pickupWorkbench.readyToPlaceOrders) ? pickupWorkbench.readyToPlaceOrders : [];
  const pickupPlacedOrders = Array.isArray(pickupWorkbench.placedOrders) ? pickupWorkbench.placedOrders : [];
  const pickupSelectableOrders = [...pickupAssemblyOrders, ...pickupReadyToPlaceOrders];
  const pickupOrderIds = new Set(pickupSelectableOrders.map((order) => order.id));
  if (!pickupOrderIds.has(state.activePickupOrderId)) {
    state.activePickupOrderId = null;
  }
  if (state.pickupAssemblyCompletionPrompt?.orderId && !pickupOrderIds.has(state.pickupAssemblyCompletionPrompt.orderId)) {
    state.pickupAssemblyCompletionPrompt = null;
  }
  const placementReadyIds = new Set(pickupReadyToPlaceOrders.map((order) => Number(order.id)));
  const placementDraft = state.pickupPlacementDraft && typeof state.pickupPlacementDraft === "object"
    ? state.pickupPlacementDraft
    : {
        orderId: null,
        containerCount: 1,
        placements: [{ binQr: "", locationQr: "" }, { binQr: "", locationQr: "" }],
        feedback: null
      };
  const placementOrderId = Number(placementDraft.orderId || 0);
  if (!placementReadyIds.has(placementOrderId)) {
    state.pickupPlacementDraft = {
      orderId: null,
      containerCount: 1,
      placements: [
        { binQr: "", locationQr: "" },
        { binQr: "", locationQr: "" }
      ],
      feedback: null
    };
    state.submittingPickupPlacement = false;
  }

  function renderManagerWorkspace() {
    const readyModalOrderId = Number(state.managerReadyOrderId || 0);
    return `
      ${notice ? `<div class="notice ${notice.type}">${escapeHtml(notice.text)}</div>` : ""}
      ${renderManagerOverviewCompact(overview.orders, syncQueue.summary, state.managerFilter, {
        quickView: state.managerQuickView,
        quickViewAnchorY: state.managerQuickViewAnchorY
      })}
      ${renderManagerHistoryModal(overview.orders, {
        open: state.managerHistoryModalOpen,
        filterQuery: state.managerFilter
      })}
      ${renderManagerReportsModal({
        open: state.managerReportsModalOpen,
        rangePreset: state.managerReportsRangePreset,
        dateFrom: state.managerReportsDateFrom,
        dateTo: state.managerReportsDateTo
      })}
      ${renderSyncQueue(syncQueue, { modalOpen: state.managerSyncModalOpen })}
      ${readyModalOrderId > 0 && orderDetails ? renderManagerReadyOrderModal(orderDetails) : ""}
      ${readyModalOrderId <= 0 && orderDetails ? renderOrderDetailsModal(orderDetails, { managerView: true }) : ""}
      ${renderManagerActionModal(state.managerActionDialog, state.submittingManagerAction)}
    `;
  }

  if (state.screen === "station-picker") {
    if (!managerView && state.currentStation) {
      return `
        ${notice ? `<div class="notice ${notice.type}">${escapeHtml(notice.text)}</div>` : ""}
        ${renderSimpleWorkerHome()}
      `;
    }

    if (managerView) {
      return renderManagerWorkspace();
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
        stationData[state.currentStation]?.metrics || null,
        [],
        lastScan,
        state.qcRejectReason,
        state.qcSelectedIssueImageId,
        state.qcSelectedItemCategory,
        state.qcSelectedItemLabel,
        state.qcCurrentPhotoDataUrl,
        state.qcInspection,
        state.qcModalOpen,
        state.qcModalStep,
        state.submittingQcDecision,
        qcTransferTasks,
        state.qcTransferPanelOpen,
        state.submittingQcTransferRequestId,
        state.qcTransferScanDrafts,
        machineWorkbench[state.currentStation] || null,
        state.machineDrafts[state.currentStation] || null,
        state.submittingMachineAction
      )}
    `;
  }

  if (!managerView && state.screen === "station") {
    return `
      ${notice ? `<div class="notice ${notice.type}">${escapeHtml(notice.text)}</div>` : ""}
      ${state.currentStation === "overview" ? renderOverview(overview.orders) : ""}
      ${state.currentStation === "sorting" ? renderSorting(sortingOrders, state.activeSortingOrderId, state.sortingDrafts) : ""}
      ${state.currentStation === "sorting" && orderDetails ? renderOrderDetailsModal(orderDetails) : ""}
      ${state.currentStation === "pickup"
        ? renderPickup(
            pickupAssemblyOrders,
            pickupReadyToPlaceOrders,
            pickupPlacedOrders,
            lastScan,
            state.activePickupOrderId,
            state.pickupMode,
            state.pickupPlacementDraft,
            state.submittingPickupPlacement,
            state.pickupAssemblyCompletionPrompt
          )
        : ""}
    `;
  }

  if (managerView) {
    state.screen = "station-picker";
    state.currentStation = null;
    return renderManagerWorkspace();
  }

  return `
    ${notice ? `<div class="notice ${notice.type}">${escapeHtml(notice.text)}</div>` : ""}
    ${renderStationPicker(stations)}
  `;
}
