export const app = document.getElementById("app");

export const state = {
  token: localStorage.getItem("greenlab-demo-token"),
  user: null,
  stations: null,
  screen: "login",
  currentStation: null,
  selectedOrderId: null,
  activeSortingOrderId: null,
  activePickupOrderId: null,
  pickupVerifiedOrderId: null,
  pickupScanFlash: null,
  submittingScanStation: null,
  submittingCreateOrderId: null,
  submittingCompletePickupOrderId: null,
  qcRejectReason: "stain",
  qcInspection: null,
  sortingDrafts: {},
  managerFilter: "",
  notice: null,
  deniedStation: null,
  simpleMode: localStorage.getItem("greenlab-simple-mode") === "1",
  lastScan: null
};

export const stationLabels = {
  overview: "Обзор",
  sorting: "Сортировка",
  washing: "Стирка",
  qc: "Контроль качества (QC)",
  drying: "Сушка",
  ironing: "Глажка",
  pickup: "Выдача"
};

export const stationDescriptions = {
  overview: "Обзор филиала и контроль статусов.",
  sorting: "Создание корзин, генерация QR и запуск заказа в работу.",
  washing: "Станция стирки: только сканирование.",
  qc: "Проверка качества после стирки перед сушкой.",
  drying: "Станция сушки: только сканирование.",
  ironing: "Станция глажки: только сканирование перед выдачей.",
  pickup: "Подтверждение выдачи. Финальное закрытие — только в CleanCloud."
};

export function isScanStation(station) {
  return station === "washing" || station === "qc" || station === "drying" || station === "ironing" || station === "pickup";
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

  if (isScanStation(primaryStation)) {
    state.simpleMode = true;
  }
}

export function setSimpleMode(next) {
  state.simpleMode = Boolean(next);
  if (state.simpleMode) {
    localStorage.setItem("greenlab-simple-mode", "1");
  } else {
    localStorage.removeItem("greenlab-simple-mode");
  }
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
  state.pickupVerifiedOrderId = null;
  state.pickupScanFlash = null;
  state.submittingScanStation = null;
  state.submittingCreateOrderId = null;
  state.submittingCompletePickupOrderId = null;
  state.qcRejectReason = "stain";
  state.qcInspection = null;
  state.sortingDrafts = {};
  state.managerFilter = "";
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
