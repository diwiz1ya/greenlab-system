export const app = document.getElementById("app");

export function createPickupPlacementDraft() {
  return {
    orderId: null,
    containerCount: 1,
    placements: [
      { locationQr: "" }
    ],
    feedback: null
  };
}

export const state = {
  token: localStorage.getItem("greenlab-demo-token"),
  user: null,
  stations: null,
  screen: "login",
  currentStation: null,
  selectedOrderId: null,
  activeSortingOrderId: null,
  activePickupOrderId: null,
  pickupMode: "assembly",
  pickupAssemblyCompletionPrompt: null,
  pickupPlacementDraft: createPickupPlacementDraft(),
  submittingScanStation: null,
  submittingCreateOrderId: null,
  submittingUpdateOrderId: null,
  submittingReturnOrderId: null,
  submittingEditSortedOrderId: null,
  submittingPickupPlacement: false,
  submittingCompletePickupOrderId: null,
  submittingQcDecision: false,
  submittingMachineAction: null,
  qcRejectReason: "stain_not_removed",
  qcSelectedIssueImageId: "",
  qcSelectedItemCategory: "",
  qcSelectedItemLabel: "",
  qcCurrentPhotoDataUrl: "",
  qcInspection: null,
  qcModalOpen: false,
  qcModalStep: 1,
  qcTransferPanelOpen: false,
  submittingQcTransferRequestId: null,
  qcTransferScanDrafts: {},
  machineDrafts: {},
  sortingDrafts: {},
  managerFilter: "",
  managerQuickView: null,
  managerQuickViewAnchorY: null,
  managerReadyOrderId: null,
  managerSyncModalOpen: false,
  managerHistoryModalOpen: false,
  managerReportsModalOpen: false,
  managerReportsRangePreset: "7d",
  managerReportsDateFrom: "",
  managerReportsDateTo: "",
  managerActionDialog: null,
  submittingManagerAction: false,
  notice: null,
  deniedStation: null,
  lastScan: null
};

export const stationLabels = {
  overview: "Overview",
  sorting: "Sorting",
  washing: "Washing",
  drying: "Drying",
  qc: "Quality Control (QC)",
  rework: "Rework",
  ironing: "Ironing",
  pickup: "Dispatch"
};

export const stationDescriptions = {
  overview: "Branch overview and status monitoring.",
  sorting: "Create baskets, assign QR labels, and start production.",
  washing: "Washing station: scan-only workflow.",
  drying: "Drying station: scan-only before QC.",
  qc: "Quality check after drying and before ironing.",
  rework: "Rework after QC: scan returns basket back to QC.",
  ironing: "Ironing station: scan once to start, scan again to finish.",
  pickup: "Dispatch station: assembly and storage placement before manager handoff."
};

export function isScanStation(station) {
  return station === "washing"
    || station === "qc"
    || station === "rework"
    || station === "drying"
    || station === "ironing"
    || station === "pickup";
}

export function isManagerRole() {
  return state.user?.role === "manager";
}

export function getAllowedStations() {
  return Array.isArray(state.user?.allowedStations) ? state.user.allowedStations : [];
}

export function getPrimaryStationForUser(user = state.user) {
  const allowedStations = Array.isArray(user?.allowedStations) ? user.allowedStations : [];
  if (!allowedStations.length) {
    return "overview";
  }
  return allowedStations.find((station) => station !== "overview") || allowedStations[0];
}

export function applyRoleDefaults() {
  if (!state.user || isManagerRole()) {
    return;
  }

  const primaryStation = getPrimaryStationForUser();
  state.currentStation = primaryStation;
  state.screen = "station";
  state.deniedStation = null;
}

export function resetQcState() {
  state.submittingQcDecision = false;
  state.qcRejectReason = "stain_not_removed";
  state.qcSelectedIssueImageId = "";
  state.qcSelectedItemCategory = "";
  state.qcSelectedItemLabel = "";
  state.qcCurrentPhotoDataUrl = "";
  state.qcInspection = null;
  state.qcModalOpen = false;
  state.qcModalStep = 1;
  state.qcTransferPanelOpen = false;
  state.submittingQcTransferRequestId = null;
  state.qcTransferScanDrafts = {};
}

export function resetSession() {
  state.token = null;
  state.user = null;
  state.stations = null;
  state.screen = "login";
  state.currentStation = null;
  state.selectedOrderId = null;
  state.activeSortingOrderId = null;
  state.activePickupOrderId = null;
  state.pickupMode = "assembly";
  state.pickupAssemblyCompletionPrompt = null;
  state.pickupPlacementDraft = createPickupPlacementDraft();
  state.submittingScanStation = null;
  state.submittingCreateOrderId = null;
  state.submittingUpdateOrderId = null;
  state.submittingReturnOrderId = null;
  state.submittingEditSortedOrderId = null;
  state.submittingPickupPlacement = false;
  state.submittingCompletePickupOrderId = null;
  state.submittingMachineAction = null;
  resetQcState();
  state.machineDrafts = {};
  state.sortingDrafts = {};
  state.managerFilter = "";
  state.managerQuickView = null;
  state.managerQuickViewAnchorY = null;
  state.managerReadyOrderId = null;
  state.managerSyncModalOpen = false;
  state.managerHistoryModalOpen = false;
  state.managerReportsModalOpen = false;
  state.managerReportsRangePreset = "7d";
  state.managerReportsDateFrom = "";
  state.managerReportsDateTo = "";
  state.managerActionDialog = null;
  state.submittingManagerAction = false;
  state.deniedStation = null;
  state.lastScan = null;
  localStorage.removeItem("greenlab-demo-token");
}

export function setLastScan(status) {
  state.lastScan = {
    ...status,
    createdAt: new Date().toISOString()
  };
}

export function clearLastScan() {
  state.lastScan = null;
}

export function getLastScanForStation(station) {
  if (!state.lastScan || state.lastScan.station !== station) {
    return null;
  }
  return state.lastScan;
}

export function setNotice(type, text) {
  state.notice = { type, text };
}

export function consumeNotice() {
  const next = state.notice;
  state.notice = null;
  return next;
}
