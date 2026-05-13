import { api } from "../api.js";
import { isProductionQr, normalizeProductionQrCode } from "../route-sheets.js";
import { app, setNotice, state } from "../state.js";

const MACHINE_CODE_PATTERNS = {
  washing: /^W0[1-6]$/,
  drying: /^D0[1-6]$/
};
function normalizeMachineCode(value) {
  let normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  normalized = normalized.replace(/^QR[:\-]/, "");
  normalized = normalized.replace(/^(MACHINE|MACHINECODE|MACHINEQR)[:\-]/, "");
  normalized = normalized.replace(/[^A-Z0-9]/g, "");
  return normalized;
}

function normalizeBasketQrCode(value) {
  return normalizeProductionQrCode(value);
}

function parsePositiveInt(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeFlowMode(value) {
  return value === "load" || value === "unload" ? value : "";
}

function createMachineIdempotencyKey(prefix) {
  const safePrefix = String(prefix || "machine")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .slice(0, 60) || "machine";
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${safePrefix}-${randomPart}`;
}

function getMachineCodeHint(station) {
  if (station === "washing") return "W01..W06";
  if (station === "drying") return "D01..D06";
  return "W01..W06 or D01..D06";
}

function isMachineCodeAllowedForStation(station, value) {
  const normalized = normalizeMachineCode(value);
  const pattern = MACHINE_CODE_PATTERNS[station];
  return Boolean(pattern && pattern.test(normalized));
}

function isMachineFlowBasketQr(value) {
  return isProductionQr(value);
}

const machineQrScannerState = {
  stream: null,
  intervalId: null,
  active: false,
  detector: null,
  html5Qrcode: null,
  lastErrorMessage: ""
};
const unloadAutoCloseTimers = new Map();
const unloadSuccessVisibleMs = 900;

function getHtml5QrcodeClass() {
  const value = window?.Html5Qrcode;
  return typeof value === "function" ? value : null;
}

function isHtml5QrcodeAvailable() {
  return Boolean(getHtml5QrcodeClass());
}

function isLikelyIPhoneWebkit() {
  const ua = String(navigator?.userAgent || "");
  return /iPhone|iPad|iPod/i.test(ua);
}

function shouldPreferHtml5Scanner() {
  return isLikelyIPhoneWebkit() && isHtml5QrcodeAvailable();
}

function isMachineBarcodeDetectorAvailable() {
  return "BarcodeDetector" in window;
}

function isMachineLiveQrScannerAvailable() {
  return isMachineBarcodeDetectorAvailable() || isHtml5QrcodeAvailable();
}

function isMachineSecureCameraContext() {
  return Boolean(window?.isSecureContext);
}

function getMachineScannerErrorDetails(error) {
  const name = String(error?.name || "Error").trim();
  const message = String(error?.message || "").trim();
  return message ? `${name}: ${message}` : name;
}

function setMachineQrScannerStatus(message, tone = "") {
  const status = app.querySelector("[data-machine-qr-status]");
  if (!status) return;
  status.textContent = String(message || "");
  status.classList.remove("ok", "error");
  if (tone === "ok" || tone === "error") {
    status.classList.add(tone);
  }
}

async function startMachineHtml5Scanner(scanner, onSuccess, onError) {
  const Html5Qrcode = getHtml5QrcodeClass();
  if (!Html5Qrcode) {
    throw new Error("Html5Qrcode API is unavailable");
  }

  const attempts = [
    { label: "facingMode=environment (exact)", cameraConfig: { facingMode: { exact: "environment" } } },
    { label: "facingMode=environment", cameraConfig: { facingMode: "environment" } }
  ];

  if (typeof Html5Qrcode.getCameras === "function") {
    try {
      const cameras = await Html5Qrcode.getCameras();
      if (Array.isArray(cameras) && cameras.length) {
        const preferred =
          cameras.find((camera) => /back|rear|environment|зад/i.test(String(camera?.label || ""))) || cameras[0];
        if (preferred?.id) {
          attempts.push({
            label: `cameraId=${String(preferred.label || preferred.id || "unknown")}`,
            cameraConfig: preferred.id
          });
        }
      }
    } catch {
      // keep facingMode attempts
    }
  }

  const errors = [];
  for (const attempt of attempts) {
    try {
      await scanner.start(
        attempt.cameraConfig,
        {
          fps: 10,
          qrbox: { width: 260, height: 260 }
        },
        onSuccess,
        onError
      );
      return;
    } catch (error) {
      errors.push(`${attempt.label} -> ${getMachineScannerErrorDetails(error)}`);
    }
  }

  throw new Error(errors.join(" | "));
}

function closeMachineQrScanner() {
  if (machineQrScannerState.intervalId) {
    clearInterval(machineQrScannerState.intervalId);
    machineQrScannerState.intervalId = null;
  }

  if (machineQrScannerState.stream) {
    for (const track of machineQrScannerState.stream.getTracks()) {
      track.stop();
    }
    machineQrScannerState.stream = null;
  }

  machineQrScannerState.active = false;
  machineQrScannerState.detector = null;
  if (machineQrScannerState.html5Qrcode) {
    const scanner = machineQrScannerState.html5Qrcode;
    machineQrScannerState.html5Qrcode = null;
    try {
      const stopResult = typeof scanner.stop === "function" ? scanner.stop() : null;
      if (stopResult && typeof stopResult.then === "function") {
        stopResult
          .catch(() => {})
          .finally(() => {
            try {
              if (typeof scanner.clear === "function") scanner.clear();
            } catch {
              // ignore scanner clear errors
            }
          });
      } else if (typeof scanner.clear === "function") {
        scanner.clear();
      }
    } catch {
      try {
        if (typeof scanner.clear === "function") scanner.clear();
      } catch {
        // ignore scanner clear errors
      }
    }
  }

  const scanner = app.querySelector("[data-machine-qr-scanner]");
  if (scanner) {
    scanner.remove();
  }
}

function openMachineQrScanner({ title = "QR scanning", subtitle = "Point camera at a QR code" } = {}) {
  return new Promise(async (resolve) => {
    closeMachineQrScanner();
    machineQrScannerState.lastErrorMessage = "";

    if (!isMachineLiveQrScannerAvailable()) {
      machineQrScannerState.lastErrorMessage = "This browser does not support live QR scanning via camera.";
      resolve(null);
      return;
    }

    if (!isMachineSecureCameraContext()) {
      machineQrScannerState.lastErrorMessage = "Camera works only in a secure context (HTTPS or localhost).";
      resolve(null);
      return;
    }

    const scanner = document.createElement("section");
    scanner.className = "sorting-qr-scanner";
    scanner.dataset.machineQrScanner = "1";
    scanner.innerHTML = `
      <div class="sorting-qr-scanner-backdrop" data-machine-qr-close></div>
      <article class="sorting-qr-scanner-sheet" role="dialog" aria-modal="true">
        <div class="sorting-qr-scanner-head">
          <div>
            <strong>${title}</strong>
            <div class="muted">${subtitle}</div>
          </div>
          <button type="button" class="secondary" data-machine-qr-close>Close</button>
        </div>
        <div class="sorting-qr-scanner-video-wrap">
          <video class="sorting-qr-scanner-video" data-machine-qr-video autoplay playsinline muted></video>
          <div class="sorting-qr-scanner-camera-host" data-machine-qr-camera-host></div>
        </div>
        <div class="sorting-qr-scanner-status" data-machine-qr-status>Starting camera...</div>
        <div class="sorting-qr-scanner-actions">
          <button type="button" class="secondary" data-machine-qr-close>Cancel</button>
        </div>
      </article>
    `;
    app.appendChild(scanner);

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      closeMachineQrScanner();
      resolve(value);
    };

    for (const closer of scanner.querySelectorAll("[data-machine-qr-close]")) {
      closer.addEventListener("click", () => finish(null), { once: true });
    }

    const video = scanner.querySelector("[data-machine-qr-video]");
    const cameraHost = scanner.querySelector("[data-machine-qr-camera-host]");
    const shouldUseHtml5Scanner = shouldPreferHtml5Scanner() || !isMachineBarcodeDetectorAvailable();

    if (!(video instanceof HTMLVideoElement) || !(cameraHost instanceof HTMLElement)) {
      finish(null);
      return;
    }

    if (shouldUseHtml5Scanner && isHtml5QrcodeAvailable()) {
      try {
        const Html5Qrcode = getHtml5QrcodeClass();
        if (!Html5Qrcode) {
          machineQrScannerState.lastErrorMessage = "QR scanning module is unavailable in this browser.";
          setMachineQrScannerStatus(machineQrScannerState.lastErrorMessage, "error");
          finish(null);
          return;
        }
        const hostId = `machine-qr-live-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        cameraHost.id = hostId;
        video.classList.add("hidden");

        const html5Scanner = new Html5Qrcode(hostId, { verbose: false });
        machineQrScannerState.html5Qrcode = html5Scanner;
        machineQrScannerState.active = true;
        setMachineQrScannerStatus("Requesting camera access...");

        await startMachineHtml5Scanner(
          html5Scanner,
          (decodedText) => {
            if (!decodedText || settled) return;
            setMachineQrScannerStatus(`QR detected: ${decodedText}`, "ok");
            finish(decodedText);
          },
          () => {}
        );
        setMachineQrScannerStatus("Camera is ready. Point it at a QR code.");
      } catch (error) {
        machineQrScannerState.active = false;
        if (machineQrScannerState.html5Qrcode) {
          try {
            machineQrScannerState.html5Qrcode.clear();
          } catch {
            // ignore scanner clear errors
          }
          machineQrScannerState.html5Qrcode = null;
        }
        const details = getMachineScannerErrorDetails(error);
        machineQrScannerState.lastErrorMessage = `Live scanner failed to start (${details || "unknown error"}).`;
        setMachineQrScannerStatus(`${machineQrScannerState.lastErrorMessage} Tap "Cancel" and check camera permissions.`, "error");
      }
      return;
    }

    if (!navigator?.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      machineQrScannerState.lastErrorMessage = "This browser does not support camera access via getUserMedia.";
      setMachineQrScannerStatus(machineQrScannerState.lastErrorMessage, "error");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" }
        },
        audio: false
      });
      machineQrScannerState.stream = stream;
      machineQrScannerState.active = true;
      video.srcObject = stream;
      await video.play();
    } catch (error) {
      const details = getMachineScannerErrorDetails(error);
      machineQrScannerState.lastErrorMessage = `Camera access was denied (${details || "unknown error"}).`;
      setMachineQrScannerStatus(machineQrScannerState.lastErrorMessage, "error");
      return;
    }

    try {
      machineQrScannerState.detector = new BarcodeDetector({ formats: ["qr_code"] });
    } catch (error) {
      const details = getMachineScannerErrorDetails(error);
      machineQrScannerState.lastErrorMessage = `Live camera QR detection is unavailable (${details || "unknown error"}).`;
      setMachineQrScannerStatus(machineQrScannerState.lastErrorMessage, "error");
      return;
    }

    setMachineQrScannerStatus("Camera is ready. Point it at a QR code.");

    machineQrScannerState.intervalId = setInterval(async () => {
      if (!machineQrScannerState.active || settled) return;
      try {
        const barcodes = await machineQrScannerState.detector.detect(video);
        if (!Array.isArray(barcodes) || !barcodes.length) return;
        const rawValue = String(barcodes[0]?.rawValue || "").trim();
        if (!rawValue) return;
        setMachineQrScannerStatus(`QR detected: ${rawValue}`, "ok");
        finish(rawValue);
      } catch {
        // ignore intermittent camera decode errors
      }
    }, 260);
  });
}

function focusById(id) {
  if (!id) return;
  setTimeout(() => {
    const element = document.getElementById(id);
    if (!element) return;
    element.focus();
    if (typeof element.select === "function") {
      element.select();
    }
  }, 0);
}

function forEachNode(selector, callback) {
  for (const node of app.querySelectorAll(selector)) {
    callback(node);
  }
}

async function notifyAndRender(renderApp, level, message) {
  setNotice(level, message);
  await renderApp();
}

function clearActiveNotice() {
  state.notice = null;
  const notice = app.querySelector(".notice");
  if (notice) {
    notice.remove();
  }
}

function clearUnloadAutoCloseTimer(station) {
  const key = String(station || "");
  const timerId = unloadAutoCloseTimers.get(key);
  if (timerId) {
    clearTimeout(timerId);
    unloadAutoCloseTimers.delete(key);
  }
}

function clearUnloadSuccessState(draft) {
  if (!draft) return;
  draft.unloadSuccessChip = "";
  draft.unloadSuccessAt = 0;
}

function scheduleUnloadAutoClose(station, renderApp) {
  const key = String(station || "");
  if (!key) return;

  clearUnloadAutoCloseTimer(key);
  const timerId = setTimeout(async () => {
    unloadAutoCloseTimers.delete(key);
    const draft = getMachineDraft(key);
    if (draft.flowMode !== "unload" || !String(draft.unloadSuccessChip || "").trim()) {
      return;
    }
    resetUnloadDraft(draft);
    draft.flowMode = "";
    await renderApp();
  }, unloadSuccessVisibleMs);
  unloadAutoCloseTimers.set(key, timerId);
}

function getMachineDraft(station) {
  const key = String(station || "");
  if (!state.machineDrafts[key]) {
    state.machineDrafts[key] = {
      flowMode: "",
      machineCode: "",
      basketInput: "",
      stagedBasketQrs: [],
      unloadLoadId: 0,
      unloadMachineCode: "",
      unloadBasketInput: "",
      unloadSuccessChip: "",
      unloadSuccessAt: 0
    };
  }

  const draft = state.machineDrafts[key];
  draft.flowMode = normalizeFlowMode(draft.flowMode);
  draft.machineCode = String(draft.machineCode || "");
  draft.basketInput = String(draft.basketInput || "");
  draft.stagedBasketQrs = Array.isArray(draft.stagedBasketQrs) ? draft.stagedBasketQrs : [];
  draft.unloadLoadId = parsePositiveInt(draft.unloadLoadId);
  draft.unloadMachineCode = String(draft.unloadMachineCode || "");
  draft.unloadBasketInput = String(draft.unloadBasketInput || "");
  draft.unloadSuccessChip = String(draft.unloadSuccessChip || "");
  draft.unloadSuccessAt = Number.isFinite(Number(draft.unloadSuccessAt)) ? Number(draft.unloadSuccessAt) : 0;
  return draft;
}

function resetLoadDraft(draft) {
  draft.machineCode = "";
  draft.basketInput = "";
  draft.stagedBasketQrs = [];
}

function resetUnloadDraft(draft) {
  draft.unloadLoadId = 0;
  draft.unloadMachineCode = "";
  draft.unloadBasketInput = "";
  clearUnloadSuccessState(draft);
}

function selectUnloadLoad(draft, loadId, machineCode = "") {
  draft.flowMode = "unload";
  draft.unloadLoadId = parsePositiveInt(loadId);
  draft.unloadBasketInput = "";
  clearUnloadSuccessState(draft);
  if (machineCode) {
    draft.unloadMachineCode = normalizeMachineCode(machineCode);
  }
}

function findUnloadItemByMachineCode(station, machineCode) {
  const normalized = normalizeMachineCode(machineCode);
  if (!normalized) return null;

  const items = app.querySelectorAll(`[data-machine-unload-item-station="${station}"]`);
  for (const item of items) {
    const itemCode = normalizeMachineCode(item.dataset.machineUnloadItemMachineCode || "");
    if (itemCode !== normalized) continue;

    return {
      loadId: parsePositiveInt(item.dataset.machineUnloadItemLoad)
    };
  }
  return null;
}

async function runMachineMutation({
  actionKey,
  request,
  renderApp,
  successNotice,
  errorNotice,
  onSuccess
}) {
  if (state.submittingMachineAction === actionKey) {
    return { ok: false, skipped: true };
  }

  state.submittingMachineAction = actionKey;
  try {
    const result = await request();
    if (typeof onSuccess === "function") {
      onSuccess(result);
    }
    if (successNotice !== false) {
      setNotice("ok", successNotice || result?.message);
    } else {
      state.notice = null;
    }
    return { ok: true, result };
  } catch (error) {
    setNotice("error", error?.message || errorNotice);
    return { ok: false, error };
  } finally {
    state.submittingMachineAction = null;
    await renderApp();
  }
}

export function bindMachineActions(renderApp) {
  forEachNode("[data-machine-open-flow]", (button) => {
    button.addEventListener("click", async () => {
      const station = button.dataset.machineOpenFlow;
      const mode = normalizeFlowMode(button.dataset.machineFlowMode);
      if (!station || !mode) return;

      clearUnloadAutoCloseTimer(station);
      closeMachineQrScanner();
      clearActiveNotice();
      const draft = getMachineDraft(station);
      draft.flowMode = mode;
      if (mode === "unload") {
        draft.unloadLoadId = 0;
        draft.unloadMachineCode = "";
        draft.unloadBasketInput = "";
        clearUnloadSuccessState(draft);
      }
      await renderApp();
      if (mode === "load") {
        focusById(`machine-load-input-${station}`);
      } else {
        focusById(`machine-unload-machine-input-${station}`);
      }
    });
  });

  forEachNode("[data-machine-close-flow]", (button) => {
    button.addEventListener("click", async () => {
      const station = button.dataset.machineCloseFlow;
      if (!station) return;
      clearUnloadAutoCloseTimer(station);
      closeMachineQrScanner();
      clearActiveNotice();
      const draft = getMachineDraft(station);
      clearUnloadSuccessState(draft);
      if (draft.flowMode === "load") {
        resetLoadDraft(draft);
      } else if (draft.flowMode === "unload") {
        resetUnloadDraft(draft);
      }
      draft.flowMode = "";
      await renderApp();
    });
  });

  forEachNode("[data-machine-open-camera]", (button) => {
    button.addEventListener("click", async () => {
      const station = button.dataset.machineOpenCamera;
      const inputId = button.dataset.machineCameraInputId || "";
      const kind = String(button.dataset.machineCameraKind || "basket").toLowerCase();
      if (!station || !inputId) return;

      const scanned = await openMachineQrScanner({
        title: kind === "machine" ? "Scan machine" : "Scan route sheet",
        subtitle: kind === "machine"
          ? "Point camera at machine QR"
          : "Point camera at route sheet QR"
      });

      if (!scanned) {
        const reason = String(machineQrScannerState.lastErrorMessage || "").trim();
        if (reason) {
          await notifyAndRender(renderApp, "warn", reason);
        }
        return;
      }

      const normalized = kind === "machine"
        ? normalizeMachineCode(scanned)
        : normalizeBasketQrCode(scanned);
      if (!normalized) {
        await notifyAndRender(renderApp, "warn", "QR code was not recognized.");
        return;
      }

      const input = document.getElementById(inputId);
      if (!(input instanceof HTMLInputElement)) {
        return;
      }

      input.value = normalized;
      input.dispatchEvent(new Event("input", { bubbles: true }));

      const submitMode = String(button.dataset.machineCameraSubmit || "").trim().toLowerCase();
      if (submitMode === "add-basket") {
        const addButton = app.querySelector(`[data-machine-add-basket="${station}"]`);
        if (addButton instanceof HTMLButtonElement) {
          addButton.click();
          return;
        }
      }

      if (submitMode === "unload-basket") {
        const loadId = parsePositiveInt(button.dataset.machineCameraSubmitLoad);
        if (loadId > 0) {
          const unloadButton = app.querySelector(
            `[data-machine-unload-basket-load="${loadId}"][data-machine-unload-basket-station="${station}"]`
          );
          if (unloadButton instanceof HTMLButtonElement) {
            unloadButton.click();
            return;
          }
        }
      }

      if (kind === "machine") {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      } else {
        focusById(inputId);
      }
    });
  });

  forEachNode("[data-machine-machine-input]", (input) => {
    input.addEventListener("input", () => {
      const station = input.dataset.machineMachineInput;
      if (!station) return;
      clearActiveNotice();
      const draft = getMachineDraft(station);
      draft.machineCode = normalizeMachineCode(input.value);
    });

    input.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();

      const station = input.dataset.machineMachineInput;
      if (!station) return;

      const draft = getMachineDraft(station);
      draft.machineCode = normalizeMachineCode(input.value);
      if (!draft.machineCode) {
        await notifyAndRender(renderApp, "warn", "Scan machine QR.");
        return;
      }
      if (!isMachineCodeAllowedForStation(station, draft.machineCode)) {
        await notifyAndRender(
          renderApp,
          "warn",
          `Only machine QR ${getMachineCodeHint(station)} is allowed for this station.`
        );
        return;
      }

      await renderApp();
      focusById(`machine-basket-input-${station}`);
    });
  });

  forEachNode("[data-machine-confirm-machine]", (button) => {
    button.addEventListener("click", async () => {
      const station = button.dataset.machineConfirmMachine;
      if (!station) return;

      const inputId = button.dataset.machineMachineInputId || "";
      const draft = getMachineDraft(station);
      const input = inputId ? document.getElementById(inputId) : null;
      draft.machineCode = normalizeMachineCode(input?.value || draft.machineCode);
      if (!draft.machineCode) {
        await notifyAndRender(renderApp, "warn", "Scan machine QR.");
        return;
      }
      if (!isMachineCodeAllowedForStation(station, draft.machineCode)) {
        await notifyAndRender(
          renderApp,
          "warn",
          `Only machine QR ${getMachineCodeHint(station)} is allowed for this station.`
        );
        return;
      }

      await renderApp();
      focusById(`machine-basket-input-${station}`);
    });
  });

  forEachNode("[data-machine-edit-machine]", (button) => {
    button.addEventListener("click", async () => {
      const station = button.dataset.machineEditMachine;
      if (!station) return;
      clearActiveNotice();
      const draft = getMachineDraft(station);
      draft.machineCode = "";
      draft.basketInput = "";
      draft.stagedBasketQrs = [];
      await renderApp();
      focusById(`machine-load-input-${station}`);
    });
  });

  forEachNode("[data-machine-basket-input]", (input) => {
    input.addEventListener("input", () => {
      const station = input.dataset.machineBasketInput;
      if (!station) return;
      clearActiveNotice();
      const draft = getMachineDraft(station);
      draft.basketInput = normalizeBasketQrCode(input.value);
    });

    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const station = input.dataset.machineBasketInput;
      if (!station) return;
      const addButton = app.querySelector(`[data-machine-add-basket="${station}"]`);
      if (addButton) {
        addButton.click();
      }
    });
  });

  forEachNode("[data-machine-add-basket]", (button) => {
    button.addEventListener("click", async () => {
      const station = button.dataset.machineAddBasket;
      if (!station) return;
      clearActiveNotice();

      const inputId = button.dataset.machineBasketInputId || "";
      const draft = getMachineDraft(station);
      const input = inputId ? document.getElementById(inputId) : null;
      const qrCode = normalizeBasketQrCode(input?.value || draft.basketInput);

      if (!qrCode) {
        await notifyAndRender(renderApp, "warn", "Scan route sheet QR first.");
        return;
      }
      if (!isMachineFlowBasketQr(qrCode)) {
        await notifyAndRender(renderApp, "warn", "Route sheet QR is required.");
        return;
      }
      if (draft.stagedBasketQrs.includes(qrCode)) {
        await notifyAndRender(renderApp, "warn", `Route sheet ${qrCode} is already added.`);
        return;
      }
      if (draft.stagedBasketQrs.length >= 1) {
        await notifyAndRender(renderApp, "warn", "Only one route sheet is allowed per machine cycle.");
        return;
      }

      try {
        await api("/api/machines/loads/validate-basket", {
          method: "POST",
          body: JSON.stringify({
            station,
            basketQr: qrCode
          })
        });
      } catch (error) {
        const level = Number(error?.status || 0) >= 500 ? "error" : "warn";
        await notifyAndRender(renderApp, level, error?.message || "Route sheet validation failed.");
        focusById(inputId);
        return;
      }

      draft.stagedBasketQrs = [qrCode];
      draft.basketInput = "";
      if (input) input.value = "";
      state.notice = null;
      await renderApp();
      focusById(inputId);
    });
  });

  forEachNode("[data-machine-remove-basket]", (button) => {
    button.addEventListener("click", async () => {
      const station = button.dataset.machineRemoveBasketStation;
      const qrCode = normalizeBasketQrCode(button.dataset.machineRemoveBasket || "");
      if (!station || !qrCode) return;

      const draft = getMachineDraft(station);
      draft.stagedBasketQrs = draft.stagedBasketQrs.filter((item) => item !== qrCode);
      await renderApp();
    });
  });

  forEachNode("[data-machine-clear-baskets]", (button) => {
    button.addEventListener("click", async () => {
      const station = button.dataset.machineClearBaskets;
      if (!station) return;

      const draft = getMachineDraft(station);
      draft.basketInput = "";
      draft.stagedBasketQrs = [];
      await notifyAndRender(renderApp, "ok", "Route sheet cleared.");
      focusById(`machine-basket-input-${station}`);
    });
  });

  forEachNode("[data-machine-start-load]", (button) => {
    button.addEventListener("click", async () => {
      const station = button.dataset.machineStartLoad;
      if (!station) return;
      clearActiveNotice();

      const machineInputId = button.dataset.machineMachineInputId || "";
      const draft = getMachineDraft(station);
      const machineInput = machineInputId ? document.getElementById(machineInputId) : null;
      draft.machineCode = normalizeMachineCode(machineInput?.value || draft.machineCode);
      const basketQrs = Array.isArray(draft.stagedBasketQrs) ? draft.stagedBasketQrs : [];

      if (!draft.machineCode) {
        await notifyAndRender(renderApp, "warn", "Scan machine QR before starting.");
        return;
      }
      if (!isMachineCodeAllowedForStation(station, draft.machineCode)) {
        await notifyAndRender(
          renderApp,
          "warn",
          `Only machine QR ${getMachineCodeHint(station)} is allowed for this station.`
        );
        return;
      }
      if (!basketQrs.length) {
        await notifyAndRender(renderApp, "warn", "Add a route sheet to the cycle.");
        return;
      }
      if (!basketQrs.every((qrCode) => isMachineFlowBasketQr(qrCode))) {
        await notifyAndRender(renderApp, "warn", "Only route sheet QR is allowed in cycle.");
        return;
      }
      if (basketQrs.length > 1) {
        await notifyAndRender(renderApp, "error", "Only one route sheet is allowed per machine cycle.");
        return;
      }

      await runMachineMutation({
        actionKey: `start:${station}`,
        renderApp,
        successNotice: false,
        errorNotice: "Failed to start machine cycle.",
        request: () => api("/api/machines/loads/start", {
          method: "POST",
          headers: {
            "X-Idempotency-Key": createMachineIdempotencyKey(`machine-start-${station}-${draft.machineCode}`)
          },
          body: JSON.stringify({
            station,
            machineCode: draft.machineCode,
            basketQrs
          })
        }),
        onSuccess: () => {
          resetLoadDraft(draft);
          draft.flowMode = "";
        }
      });

      focusById(machineInputId || `machine-load-input-${station}`);
    });
  });

  forEachNode("[data-machine-open-unload-load]", (button) => {
    button.addEventListener("click", async () => {
      const station = button.dataset.machineOpenUnloadLoadStation;
      const loadId = parsePositiveInt(button.dataset.machineOpenUnloadLoad);
      if (!station || !loadId) return;

      const draft = getMachineDraft(station);
      selectUnloadLoad(draft, loadId, button.dataset.machineOpenUnloadMachineCode || "");
      await renderApp();
      focusById(`machine-unload-basket-input-${station}-${loadId}`);
    });
  });

  const pickUnloadLoadByMachineCode = async (station, rawMachineCode, options = {}) => {
    const { showWarn = false } = options;
    if (!station) return false;

    const draft = getMachineDraft(station);
    clearUnloadAutoCloseTimer(station);
    clearUnloadSuccessState(draft);
    const machineCode = normalizeMachineCode(rawMachineCode || draft.unloadMachineCode);
    draft.unloadMachineCode = machineCode;

    if (!machineCode) {
      if (showWarn) {
        await notifyAndRender(renderApp, "warn", "Scan machine QR.");
      }
      return false;
    }
    if (!isMachineCodeAllowedForStation(station, machineCode)) {
      if (showWarn) {
        await notifyAndRender(
          renderApp,
          "warn",
          `Only machine QR ${getMachineCodeHint(station)} is allowed for this station.`
        );
      }
      return false;
    }

    const match = findUnloadItemByMachineCode(station, machineCode);
    if (!match?.loadId) {
      if (showWarn) {
        await notifyAndRender(renderApp, "warn", `No active cycle for machine ${machineCode}.`);
      }
      return false;
    }

    if (draft.unloadLoadId === match.loadId) {
      return true;
    }

    selectUnloadLoad(draft, match.loadId, machineCode);
    await renderApp();
    focusById(`machine-unload-basket-input-${station}-${match.loadId}`);
    return true;
  };

  forEachNode("[data-machine-unload-machine-input]", (input) => {
    input.addEventListener("input", () => {
      const station = input.dataset.machineUnloadMachineInput;
      if (!station) return;
      const draft = getMachineDraft(station);
      draft.unloadMachineCode = normalizeMachineCode(input.value);
    });

    input.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const station = input.dataset.machineUnloadMachineInput;
      if (!station) return;
      await pickUnloadLoadByMachineCode(station, input.value, { showWarn: true });
    });
  });

  forEachNode("[data-machine-pick-unload-load]", (button) => {
    button.addEventListener("click", async () => {
      const station = button.dataset.machinePickUnloadLoadStation;
      const loadId = parsePositiveInt(button.dataset.machinePickUnloadLoad);
      if (!station || !loadId) return;

      const draft = getMachineDraft(station);
      selectUnloadLoad(draft, loadId, button.dataset.machinePickUnloadMachineCode || "");
      await renderApp();
      focusById(`machine-unload-basket-input-${station}-${loadId}`);
    });
  });

  forEachNode("[data-machine-cancel-load]", (button) => {
    button.addEventListener("click", async () => {
      const station = button.dataset.machineCancelLoadStation;
      const loadId = parsePositiveInt(button.dataset.machineCancelLoad);
      if (!station || !loadId) return;

      await runMachineMutation({
        actionKey: `cancel:${loadId}`,
        renderApp,
        successNotice: false,
        errorNotice: "Failed to cancel cycle.",
        request: () => api(`/api/machines/loads/${loadId}/cancel`, {
          method: "POST",
          body: JSON.stringify({ station })
        }),
        onSuccess: () => {
          const draft = getMachineDraft(station);
          if (draft.unloadLoadId === loadId) {
            resetUnloadDraft(draft);
          }
          draft.flowMode = "unload";
        }
      });
    });
  });

  forEachNode("[data-machine-unload-input]", (input) => {
    input.addEventListener("input", () => {
      const station = input.dataset.machineUnloadDraft;
      const loadId = parsePositiveInt(input.dataset.machineUnloadLoad);
      if (!station) return;
      const draft = getMachineDraft(station);
      draft.unloadBasketInput = normalizeBasketQrCode(input.value);
      clearUnloadSuccessState(draft);

      const unloadButton = app.querySelector(
        `[data-machine-unload-basket-load="${loadId}"][data-machine-unload-basket-station="${station}"]`
      );
      if (unloadButton instanceof HTMLButtonElement) {
        const hasBasketInput = Boolean(draft.unloadBasketInput.trim());
        const canUnload = Boolean(loadId && draft.unloadLoadId === loadId && hasBasketInput && !state.submittingMachineAction);
        unloadButton.disabled = !canUnload;
      }
    });

    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const station = input.dataset.machineUnloadInput;
      const loadId = parsePositiveInt(input.dataset.machineUnloadLoad);
      if (!station || !loadId) return;
      const unloadButton = app.querySelector(
        `[data-machine-unload-basket-load="${loadId}"][data-machine-unload-basket-station="${station}"]`
      );
      if (unloadButton) {
        unloadButton.click();
      }
    });
  });

  forEachNode("[data-machine-unload-basket-load]", (button) => {
    button.addEventListener("click", async () => {
      const station = button.dataset.machineUnloadBasketStation;
      const loadId = parsePositiveInt(button.dataset.machineUnloadBasketLoad);
      const inputId = button.dataset.machineUnloadBasketInputId || "";
      if (!station || !loadId) {
        await notifyAndRender(renderApp, "warn", "Select a cycle for unload.");
        return;
      }

      const draft = getMachineDraft(station);
      const input = inputId ? document.getElementById(inputId) : null;
      const basketQr = normalizeBasketQrCode(input?.value || draft.unloadBasketInput);
      if (!basketQr) {
        await notifyAndRender(renderApp, "warn", "Scan route sheet QR to unload first.");
        return;
      }
      if (!isMachineFlowBasketQr(basketQr)) {
        await notifyAndRender(renderApp, "warn", "Route sheet QR is required for unload.");
        return;
      }

      await runMachineMutation({
        actionKey: `unload:${loadId}`,
        renderApp,
        successNotice: false,
        errorNotice: "Failed to unload route sheet.",
        request: () => api(`/api/machines/loads/${loadId}/unload-basket`, {
          method: "POST",
          headers: {
            "X-Idempotency-Key": createMachineIdempotencyKey(`machine-unload-${loadId}-${basketQr}`)
          },
          body: JSON.stringify({
            station,
            basketQr
          })
        }),
        onSuccess: () => {
          clearUnloadAutoCloseTimer(station);
          clearUnloadSuccessState(draft);
          draft.unloadBasketInput = "";
          draft.unloadSuccessChip = "Route sheet unloaded";
          draft.unloadSuccessAt = Date.now();
          draft.flowMode = "unload";
          scheduleUnloadAutoClose(station, renderApp);
        }
      });

      focusById(inputId || `machine-unload-machine-input-${station}`);
    });
  });
}
