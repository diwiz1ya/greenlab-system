import { api } from "./api.js";
import { app, clearLastScan, createPickupPlacementDraft, resetQcState, resetSession, setLastScan, setNotice, state, stationLabels } from "./state.js";
import { bindManagerActions } from "./actions/manager.js";
import { bindMachineActions } from "./actions/machines.js";
import { bindPickupActions } from "./actions/pickup.js";
import { bindQcActions, openQcQrScanner, runQcInspectFromInput } from "./actions/qc.js";
import { bindSortingActions } from "./actions/sorting.js";
import { normalizeProductionQrCode } from "./route-sheets.js";
import { escapeHtml } from "./utils.js";

function setButtonLoading(button, isLoading, loadingText) {
  if (!button) return;

  if (isLoading) {
    if (!button.dataset.defaultLabel) {
      button.dataset.defaultLabel = button.textContent || "";
    }
    button.dataset.wasDisabled = button.disabled ? "1" : "0";
    button.dataset.loading = "1";
    button.disabled = true;
    button.textContent = loadingText;
    return;
  }

  const wasDisabled = button.dataset.wasDisabled === "1";
  if (button.dataset.defaultLabel) {
    button.textContent = button.dataset.defaultLabel;
  }
  button.disabled = wasDisabled;
  delete button.dataset.loading;
  delete button.dataset.wasDisabled;
}

function setScanUiBusy(station, inputId, isBusy) {
  const loadingText = station === "qc" ? "Opening..." : "Checking...";
  for (const button of app.querySelectorAll(`[data-run-scan="${station}"]`)) {
    setButtonLoading(button, isBusy, loadingText);
  }

  const input = document.getElementById(inputId);
  if (input) {
    if (isBusy) {
      input.dataset.wasDisabled = input.disabled ? "1" : "0";
      input.disabled = true;
    } else {
      input.disabled = input.dataset.wasDisabled === "1";
      delete input.dataset.wasDisabled;
    }
  }
}

function normalizeSimpleCameraQrCode(value) {
  const productionQr = normalizeProductionQrCode(value);
  if (productionQr) return productionQr;
  let normalized = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!normalized) return "";
  normalized = normalized.replace(/^QR[-]/, "QR:");
  if (/^B-\d{4,}-\d+$/.test(normalized)) return `QR:${normalized}`;
  return normalized;
}

function setCreateBasketsUiBusy(orderId, isBusy) {
  const button = app.querySelector(`[data-create-baskets="${orderId}"]`);
  setButtonLoading(button, isBusy, "Creating...");
}

function setUpdateBasketsUiBusy(orderId, isBusy) {
  const button = app.querySelector(`[data-update-baskets="${orderId}"]`);
  setButtonLoading(button, isBusy, "Saving...");
}

function setReturnToSortingUiBusy(orderId, isBusy) {
  const button = app.querySelector(`[data-return-to-sorting="${orderId}"]`);
  setButtonLoading(button, isBusy, "Returning...");
}

function playScanTone(ok) {
  const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextImpl) return;

  const context = new AudioContextImpl();
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.value = ok ? 880 : 220;
  gain.gain.value = 0.0001;

  oscillator.connect(gain);
  gain.connect(context.destination);

  const now = context.currentTime;
  gain.gain.exponentialRampToValueAtTime(0.09, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (ok ? 0.16 : 0.24));

  oscillator.start(now);
  oscillator.stop(now + (ok ? 0.17 : 0.25));

  oscillator.onended = () => context.close().catch(() => {});
}

function scrollOrderModalSection(anchor, behavior = "smooth") {
  const targetAnchor = String(anchor || "").trim();
  if (!targetAnchor) return;

  const target = app.querySelector(`.order-modal [data-order-modal-anchor="${targetAnchor}"]`);
  if (!target) return;

  target.scrollIntoView({
    behavior,
    block: "start",
    inline: "nearest"
  });
}

const inlineScanStations = new Set(["washing", "rework", "drying"]);

function canUseInlineStationUpdate(station) {
  return inlineScanStations.has(station)
    && state.screen === "station"
    && state.currentStation === station;
}

function renderInlineScanStatus(station, scan) {
  if (station === "qc") {
    const stamp = scan?.createdAt
      ? (() => {
          const parsed = new Date(scan.createdAt);
          if (Number.isNaN(parsed.getTime())) return "";
          return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        })()
      : "";
    const toneClass = !scan || scan.station !== station
      ? "idle"
      : (scan.ok ? "ok" : "error");
    const messageText = !scan || scan.station !== station
      ? "Scan QR code."
      : (scan.message || "QR not confirmed.");
    const metaLine = !scan || scan.station !== station
      ? ""
      : (() => {
          const orderPublicId = String(scan.orderPublicId || "").trim();
          const basketCode = String(scan.basketCode || "").trim();
          const chunks = [orderPublicId, basketCode].filter(Boolean);
          if (!chunks.length) return "";
          return escapeHtml(chunks.join(" · "));
        })();

    if (!scan || scan.station !== station) {
      return `
        <section class="scan-status ${toneClass} scan-status-compact" data-scan-status="${station}">
          <div class="scan-status-compact-head">
            <span class="scan-status-compact-label">Last scan</span>
          </div>
          <div class="scan-status-compact-text muted">${messageText}</div>
        </section>
      `;
    }
    return `
      <section class="scan-status ${toneClass} scan-status-compact" data-scan-status="${station}">
        <div class="scan-status-compact-head">
          <span class="scan-status-compact-label">Last scan</span>
        </div>
        <div class="scan-status-compact-body">
          ${metaLine ? `<span class="scan-status-compact-meta muted">${metaLine}</span>` : ""}
          <span class="scan-status-compact-text">${escapeHtml(messageText)}</span>
          ${stamp ? `<span class="scan-status-compact-time muted">${escapeHtml(stamp)}</span>` : ""}
        </div>
      </section>
    `;
  }

  if (!scan || scan.station !== station) {
    return `
      <section class="scan-status idle" data-scan-status="${station}">
        <strong>Waiting</strong>
        <div class="muted">Scan QR code to update status.</div>
      </section>
    `;
  }

  if (scan.ok) {
    return `
      <section class="scan-status ok" data-scan-status="${station}">
        <strong>OK</strong>
        <div>${escapeHtml(scan.message || "QR confirmed.")}</div>
      </section>
    `;
  }

  return `
    <section class="scan-status error" data-scan-status="${station}">
      <strong>Error</strong>
      <div>${escapeHtml(scan.message || "QR not confirmed.")}</div>
    </section>
  `;
}

function applyInlineScanStatus(station, scan) {
  const current = app.querySelector(`[data-scan-status="${station}"]`);
  if (!current) return false;

  const template = document.createElement("template");
  template.innerHTML = renderInlineScanStatus(station, scan).trim();
  const next = template.content.firstElementChild;
  if (!next) return false;

  current.replaceWith(next);
  return true;
}

async function refreshInlineKioskCount(station) {
  const badge = app.querySelector(`[data-kiosk-active-count="${station}"]`);
  const qcBasketsBadge = app.querySelector("[data-kiosk-qc-baskets]");
  const qcOrdersBadge = app.querySelector("[data-kiosk-qc-orders]");
  if (!badge && !qcBasketsBadge && !qcOrdersBadge) return;

  try {
    const payload = await api(`/api/orders?station=${station}`);
    const orders = Array.isArray(payload.orders) ? payload.orders : [];

    if (station === "qc") {
      const hasBasketField = orders.some((row) => row && Object.prototype.hasOwnProperty.call(row, "baskets_in_station"));
      const fallbackBasketsCount = hasBasketField
        ? orders.reduce((total, row) => {
            const parsed = Number(row?.baskets_in_station);
            if (!Number.isFinite(parsed)) return total;
            return total + Math.max(0, Math.trunc(parsed));
          }, 0)
        : orders.length;
      const fallbackOrdersCount = hasBasketField
        ? orders.reduce((total, row) => {
            const parsed = Number(row?.baskets_in_station);
            if (!Number.isFinite(parsed)) return total;
            return total + (Math.max(0, Math.trunc(parsed)) > 0 ? 1 : 0);
          }, 0)
        : orders.length;

      const basketsCount = Number.isFinite(Number(payload.metrics?.basketsInQc))
        ? Math.max(0, Math.trunc(Number(payload.metrics.basketsInQc)))
        : fallbackBasketsCount;
      const ordersCount = Number.isFinite(Number(payload.metrics?.ordersInQcQueue))
        ? Math.max(0, Math.trunc(Number(payload.metrics.ordersInQcQueue)))
        : fallbackOrdersCount;

      if (qcBasketsBadge) {
        qcBasketsBadge.textContent = `Baskets in QC: ${basketsCount}`;
        qcBasketsBadge.classList.toggle("ok", basketsCount > 0);
        qcBasketsBadge.classList.toggle("warn", basketsCount === 0);
      }
      if (qcOrdersBadge) {
        qcOrdersBadge.textContent = `Orders in QC: ${ordersCount}`;
        qcOrdersBadge.classList.toggle("ok", ordersCount > 0);
        qcOrdersBadge.classList.toggle("warn", ordersCount === 0);
      }
      return;
    }

    const count = orders.length;
    if (!badge) return;
    badge.textContent = `In progress: ${count}`;
    badge.classList.toggle("ok", count > 0);
    badge.classList.toggle("warn", count === 0);
  } catch {
    // ignore count refresh failure in inline mode
  }
}

function refocusScanInput(inputId) {
  const refreshedInput = document.getElementById(inputId);
  if (refreshedInput) {
    refreshedInput.focus();
    refreshedInput.select();
  }
}

export async function runScanFromInput(station, inputId, renderApp) {
  const inlineUpdate = canUseInlineStationUpdate(station);
  const suppressStationNotice = station === "pickup" || station === "ironing";
  const input = document.getElementById(inputId);
  if (!input) {
    setLastScan({ station, ok: false, code: "", message: "Scan input field not found." });
    if (!inlineUpdate && !suppressStationNotice) {
      setNotice("error", "Scan input field not found.");
    } else {
      state.notice = null;
      applyInlineScanStatus(station, state.lastScan);
    }
    await renderApp();
    return;
  }
  const code = normalizeSimpleCameraQrCode(input.value.trim()) || input.value.trim();
  if (code) input.value = code;
  if (!code) {
    setLastScan({ station, ok: false, code: "", message: "Empty QR code." });
    if (inlineUpdate) {
      state.notice = null;
      applyInlineScanStatus(station, state.lastScan);
      const refreshedInput = document.getElementById(inputId);
      if (refreshedInput) refreshedInput.focus();
      return;
    }
    if (suppressStationNotice) {
      state.notice = null;
    } else {
      setNotice("warn", "Scan skipped: empty QR code.");
    }
    await renderApp();
    const refreshedInput = document.getElementById(inputId);
    if (refreshedInput) refreshedInput.focus();
    return;
  }

  if (state.submittingScanStation === station) {
    return;
  }

    state.submittingScanStation = station;
    setScanUiBusy(station, inputId, true);

    try {
      try {
        const payload = {
          station,
          qrCode: code
        };
        const result = await api("/api/scan", {
          method: "POST",
          body: JSON.stringify(payload)
        });
      const statusMessage = station === "pickup" && result.pickupProgress
        ? `${result.message} (${Number(result.pickupProgress.scannedBaskets || 0)}/${Number(result.pickupProgress.totalBaskets || 0)})`
        : result.message;
      state.selectedOrderId = result.order.id;
      if (station === "pickup") {
        const pickupOrderId = Number(result.order?.id || 0) || null;
        state.activePickupOrderId = pickupOrderId;
        if (pickupOrderId && result.pickupProgress?.complete) {
          state.pickupAssemblyCompletionPrompt = {
            orderId: pickupOrderId,
            publicId: String(result.order?.public_id || "").trim() || "Order",
            customerName: String(result.order?.customer_name || "").trim() || "Customer",
            scannedBaskets: Number(result.pickupProgress.scannedBaskets || 0),
            totalBaskets: Number(result.pickupProgress.totalBaskets || 0),
            message: String(result.message || "").trim()
          };
          state.pickupMode = "assembly";
        }
      }
      setLastScan({ station, ok: true, code, message: statusMessage });
      if (!inlineUpdate && !suppressStationNotice) {
        setNotice("ok", statusMessage);
      } else {
        state.notice = null;
      }
      playScanTone(true);
      input.value = "";
    } catch (error) {
      setLastScan({ station, ok: false, code, message: error.message });
      if (!inlineUpdate && !suppressStationNotice) {
        setNotice("error", error.message);
      } else {
        state.notice = null;
      }
      playScanTone(false);
    }
  } finally {
    state.submittingScanStation = null;
    setScanUiBusy(station, inputId, false);
  }

  if (inlineUpdate) {
    applyInlineScanStatus(station, state.lastScan);
    await refreshInlineKioskCount(station);
    refocusScanInput(inputId);
    return;
  }

  await renderApp();
  refocusScanInput(inputId);
}

export function bindGlobalActions(renderApp, renderLogin) {
  bindSortingActions(renderApp, { setButtonLoading });
  bindMachineActions(renderApp);

  if (!app.dataset.orderModalEscapeBound) {
    app.dataset.orderModalEscapeBound = "1";
    document.addEventListener("keydown", async (event) => {
      if (event.key !== "Escape") return;
      if (state.qcTransferPanelOpen && !state.submittingQcTransferRequestId) {
        state.qcTransferPanelOpen = false;
        await renderApp();
        return;
      }
      if (state.managerActionDialog) {
        state.managerActionDialog = null;
        state.submittingManagerAction = false;
        await renderApp();
        return;
      }
      if (state.managerQuickView) {
        state.managerQuickView = null;
        await renderApp();
        return;
      }
      if (state.managerFlowStage) {
        state.managerFlowStage = null;
        await renderApp();
        return;
      }
      if (state.managerReadyOrderId) {
        state.managerReadyOrderId = null;
        await renderApp();
        return;
      }
      if (state.managerSyncModalOpen) {
        state.managerSyncModalOpen = false;
        await renderApp();
        return;
      }
      if (state.managerHistoryModalOpen) {
        state.managerHistoryModalOpen = false;
        await renderApp();
        return;
      }
      if (state.managerReportsModalOpen) {
        state.managerReportsModalOpen = false;
        await renderApp();
        return;
      }

      if (!state.selectedOrderId) return;
      const isOrderModalOpen = Boolean(app.querySelector(".order-modal"));
      if (!isOrderModalOpen) return;

      state.selectedOrderId = null;
      await renderApp();
    });
  }

  const stationPickerButton = document.getElementById("station-picker-button");
  if (stationPickerButton) {
    stationPickerButton.addEventListener("click", async () => {
      state.screen = "station-picker";
      state.deniedStation = null;
      await renderApp();
    });
  }

  const homeStationButton = document.getElementById("home-station-button");
  if (homeStationButton) {
    homeStationButton.addEventListener("click", async () => {
      state.screen = "station";
      resetQcState();
      clearLastScan();
      await renderApp();
    });
  }

  for (const button of app.querySelectorAll("[data-open-station]")) {
    button.addEventListener("click", async () => {
      const station = button.dataset.openStation;
      try {
        await api("/api/open-station", {
          method: "POST",
          body: JSON.stringify({ station })
        });
        state.currentStation = station;
        state.screen = "station";
        state.deniedStation = null;
        state.activePickupOrderId = null;
        state.pickupMode = "assembly";
        state.pickupAssemblyCompletionPrompt = null;
        state.pickupPlacementDraft = createPickupPlacementDraft();
        state.submittingPickupPlacement = false;
        resetQcState();
        clearLastScan();
        if (station !== "overview") {
          setNotice("ok", `${stationLabels[station]} opened.`);
        }
      } catch (error) {
        if (error.status === 403) {
          state.deniedStation = {
            station,
            label: error.payload?.label || stationLabels[station] || station
          };
          state.screen = "forbidden";
          setNotice("error", `Access denied for ${state.deniedStation.label}.`);
        } else {
          setNotice("error", error.message);
        }
      }
      await renderApp();
    });
  }

  for (const button of app.querySelectorAll("[data-open-order]")) {
    button.addEventListener("click", async () => {
      const focusAnchor = String(button.dataset.openOrderFocus || "").trim();
      state.managerSyncModalOpen = false;
      state.managerQuickView = null;
      state.managerFlowStage = null;
      state.managerReadyOrderId = null;
      state.managerHistoryModalOpen = false;
      state.managerReportsModalOpen = false;
      state.managerActionDialog = null;
      state.submittingManagerAction = false;
      state.selectedOrderId = Number(button.dataset.openOrder);
      await renderApp();
      if (focusAnchor) {
        scrollOrderModalSection(focusAnchor, "auto");
      }
    });
  }

  for (const button of app.querySelectorAll("[data-scroll-order-section]")) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      scrollOrderModalSection(button.dataset.scrollOrderSection, "smooth");
    });
  }

  for (const button of app.querySelectorAll("[data-run-scan]")) {
    button.addEventListener("click", async () => {
      const station = button.dataset.runScan;
      const inputId = button.dataset.scanInputId || (station === "pickup" ? "pickup-scan-input" : "scan-input");
      if (station === "qc") {
        await runQcInspectFromInput(inputId, renderApp, {
          applyInlineScanStatus,
          playScanTone,
          refocusScanInput,
          setScanUiBusy
        });
        return;
      }
      await runScanFromInput(station, inputId, renderApp);
    });
  }

  for (const button of app.querySelectorAll("[data-open-simple-camera]")) {
    button.addEventListener("click", async () => {
      const station = String(button.dataset.openSimpleCamera || "").trim();
      if (!station || state.submittingScanStation === station) return;

      const inputId = String(button.dataset.simpleCameraInputId || "simple-scan-input");
      const input = document.getElementById(inputId);
      if (!(input instanceof HTMLInputElement)) {
        setNotice("error", "Scan input field not found.");
        await renderApp();
        return;
      }

      const scannedValue = await openQcQrScanner({
        title: `QR scanning · ${stationLabels[station] || station}`,
        subtitle: "Point camera at route sheet QR"
      });
      if (!scannedValue) {
        return;
      }

      const normalizedValue = normalizeSimpleCameraQrCode(scannedValue);
      if (!normalizedValue) {
        setNotice("warn", "QR code was not recognized.");
        await renderApp();
        return;
      }

      input.value = normalizedValue;
      await runScanFromInput(station, inputId, renderApp);
    });
  }

  bindQcActions(renderApp, {
    applyInlineScanStatus,
    playScanTone,
    refocusScanInput,
    setScanUiBusy
  });
  bindPickupActions(renderApp);
  bindManagerActions(renderApp, renderLogin);


  for (const input of app.querySelectorAll("[data-scan-input-for]")) {
    input.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const station = input.dataset.scanInputFor;
      if (station === "qc") {
        await runQcInspectFromInput(input.id, renderApp, {
          applyInlineScanStatus,
          playScanTone,
          refocusScanInput,
          setScanUiBusy
        });
        return;
      }
      await runScanFromInput(station, input.id, renderApp);
    });
  }

  const backToStations = document.getElementById("back-to-stations");
  if (backToStations) {
    backToStations.addEventListener("click", async () => {
      state.screen = "station-picker";
      state.deniedStation = null;
      await renderApp();
    });
  }

  const logoutButton = document.getElementById("logout-button");
  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      try {
        await api("/api/logout", { method: "POST" });
      } catch {
        // ignore
      }
      resetSession();
      renderLogin();
    });
  }

  const focusTarget = document.getElementById("simple-scan-input")
    || document.getElementById("scan-input")
    || document.getElementById("pickup-scan-input")
    || app.querySelector("[data-machine-machine-input]");
  if (focusTarget) {
    setTimeout(() => focusTarget.focus(), 0);
  }
}
