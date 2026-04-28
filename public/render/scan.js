import { stationLabels } from "../state.js";
import { escapeHtml } from "../utils.js";
import { renderOrderMeta } from "./manager.js";
import { renderQcWorkbench } from "./qc.js";

function renderScanStatus(lastScan, station) {
  if (!lastScan || lastScan.station !== station) {
    return `
      <section class="scan-status idle" data-scan-status="${station}">
        <strong>Waiting</strong>
        <div class="muted">Scan a QR code to update status.</div>
      </section>
    `;
  }

  if (lastScan.ok) {
    return `
      <section class="scan-status ok" data-scan-status="${station}">
        <strong>OK</strong>
        <div>${escapeHtml(lastScan.message || "QR confirmed.")}</div>
      </section>
    `;
  }

  return `
    <section class="scan-status error" data-scan-status="${station}">
      <strong>Error</strong>
      <div>${escapeHtml(lastScan.message || "QR not confirmed.")}</div>
    </section>
  `;
}

function buildMachineLoadEntries(machines) {
  return (Array.isArray(machines) ? machines : [])
    .filter((machine) => machine?.active_load && machine.active_load.id)
    .map((machine) => {
      const load = machine.active_load;
      const loadId = Number(load.id || 0);
      const loadStatus = String(load.status || "active");
      const basketsCount = Number(load.baskets_count || 0);
      const unloadedCount = Number(load.unloaded_baskets_count || 0);
      return {
        machine,
        load,
        loadId,
        loadStatus,
        isRunning: loadStatus === "active",
        basketsCount,
        unloadedCount,
        pendingUnloadCount: Math.max(0, basketsCount - unloadedCount)
      };
    })
    .filter((entry) => entry.loadId > 0);
}

function renderMachineHubActiveSection(loadEntries, station, submittingMachineAction) {
  void loadEntries;
  void station;
  void submittingMachineAction;
  return "";
}

function renderMachineFlowIcon(kind) {
  if (kind === "machine") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="4" y="3" width="16" height="18" rx="3"></rect>
        <circle cx="12" cy="11.5" r="4.2"></circle>
        <circle cx="8" cy="6.7" r="0.8"></circle>
        <circle cx="11" cy="6.7" r="0.8"></circle>
        <path d="M9.2 15.4h5.6"></path>
      </svg>
    `;
  }
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3.5 8.6a2.5 2.5 0 0 1 2.5-2.5h12a2.5 2.5 0 0 1 2.5 2.5V18a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18V8.6Z"></path>
      <path d="M6.4 6.1l1.8-2.3h7.6l1.8 2.3"></path>
      <path d="M8 12h8"></path>
      <path d="M8 15h8"></path>
    </svg>
  `;
}

function renderMachineScanButton({ station, inputId, kind, submitMode = "", submitLoadId = 0 }) {
  const label = kind === "machine" ? "Scan machine QR" : "Scan basket QR";
  const submitAttr = submitMode ? ` data-machine-camera-submit="${submitMode}"` : "";
  const submitLoadAttr = submitLoadId ? ` data-machine-camera-submit-load="${submitLoadId}"` : "";
  return `
    <button
      class="machine-scan-icon-button"
      type="button"
      aria-label="${escapeHtml(label)}"
      title="${escapeHtml(label)}"
      data-machine-open-camera="${station}"
      data-machine-camera-input-id="${inputId}"
      data-machine-camera-kind="${kind}"${submitAttr}${submitLoadAttr}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="3.5" y="5.5" width="17" height="13" rx="2.5"></rect>
        <path d="M8 4.5h8"></path>
        <path d="M12 9v6"></path>
        <path d="M9 12h6"></path>
      </svg>
    </button>
  `;
}

function renderMachineLoadFlow(station, draft, submittingMachineAction) {
  const staged = Array.isArray(draft.stagedBasketQrs) ? draft.stagedBasketQrs : [];
  const selectedBasket = staged[0] || "";
  const machineCode = String(draft.machineCode || "").trim();
  const basketInputValue = String(draft.basketInput || "");
  const machineInputId = `machine-load-input-${station}`;
  const basketInputId = `machine-basket-input-${station}`;
  const machineReady = Boolean(machineCode);
  const hasBasketInput = Boolean(basketInputValue.trim());
  const hasBasketDraft = hasBasketInput || Boolean(selectedBasket);
  const canStart = machineReady && Boolean(selectedBasket) && !submittingMachineAction;
  const stationTitle = station === "washing" ? "washing" : "drying";
  let startButtonLabel = `Start ${stationTitle}`;
  let startBlockedReason = "";
  if (submittingMachineAction) {
    startButtonLabel = "Starting...";
    startBlockedReason = "Please wait: start is in progress.";
  } else if (!machineReady) {
    startButtonLabel = "Scan machine";
    startBlockedReason = "Button is unavailable until machine QR is scanned.";
  } else if (!selectedBasket) {
    startButtonLabel = "Scan basket";
    startBlockedReason = "Button is unavailable until basket QR is scanned and added.";
  } else if (canStart) {
    startButtonLabel = "Ready to start";
  }

  return `
    <section class="machine-flow-body">
      <div class="machine-unload-stepbar">
        <div class="machine-unload-step ${machineReady ? "done" : "active"}">
          <strong>Step 1</strong>
          <span>${machineReady ? `Machine selected: ${escapeHtml(machineCode)}` : "Scan machine"}</span>
        </div>
        <div class="machine-unload-step ${machineReady ? (selectedBasket ? "done" : "active") : "idle"}">
          <strong>Step 2</strong>
          <span>${machineReady ? (selectedBasket ? `Basket added: ${escapeHtml(selectedBasket)}` : "Scan basket") : "Waiting for step 1"}</span>
        </div>
      </div>

      ${
        machineReady
          ? `
            <article class="machine-unload-active-card">
              <span class="machine-unload-active-label">Selected machine</span>
              <strong>${escapeHtml(machineCode)}</strong>
              <div class="machine-unload-active-meta">
                <code>${escapeHtml(machineCode)}</code>
                <span class="muted">Ready for ${stationTitle} cycle</span>
              </div>
              <div class="machine-flow-inline-actions">
                <button class="ghost" type="button" data-machine-edit-machine="${station}">Change machine</button>
              </div>
            </article>
          `
          : ""
      }

      ${
        !machineReady
          ? `
            <article class="machine-flow-step-card is-active is-minimal">
              <div class="machine-flow-step-head">
                <div class="machine-flow-step-copy">
                  <strong>Scan machine</strong>
                </div>
              </div>
              <div class="machine-flow-scan-row">
                <input
                  id="${machineInputId}"
                  data-machine-machine-input="${station}"
                  class="scan-large machine-code-input"
                  placeholder="${station === "washing" ? "W01" : "D01"}"
                  value="${escapeHtml(machineCode)}"
                  autocomplete="off"
                  spellcheck="false"
                />
                ${renderMachineScanButton({ station, inputId: machineInputId, kind: "machine" })}
              </div>
            </article>
          `
          : `
            <article class="machine-flow-step-card is-active is-minimal">
              <div class="machine-flow-step-head">
                <div class="machine-flow-step-copy">
                  <strong>Scan basket</strong>
                </div>
              </div>
              <div class="machine-flow-scan-row">
                <input
                  id="${basketInputId}"
                  data-machine-basket-input="${station}"
                  class="machine-basket-input"
                  placeholder="QR:BIN-001"
                  value="${escapeHtml(basketInputValue)}"
                  autocomplete="off"
                  spellcheck="false"
                />
                ${renderMachineScanButton({
                  station,
                  inputId: basketInputId,
                  kind: "basket",
                  submitMode: "add-basket"
                })}
              </div>
              <button
                class="machine-flow-hidden-action"
                type="button"
                data-machine-add-basket="${station}"
                data-machine-basket-input-id="${basketInputId}"
                tabindex="-1"
                aria-hidden="true"
              >Add</button>
              ${
                hasBasketInput && !selectedBasket
                  ? `
                    <div class="machine-flow-footer-hint muted">
                      Press Enter to add basket into the cycle.
                    </div>
                  `
                  : ""
              }
              ${
                selectedBasket
                  ? `
                    <div class="machine-flow-ready-note">
                      You can load items for ${stationTitle}.
                    </div>
                  `
                  : ""
              }
            </article>
          `
      }
    </section>

    <footer class="machine-flow-footer">
      <button
        class="${canStart ? "is-ready" : ""}"
        data-machine-start-load="${station}"
        data-machine-machine-input-id="${machineInputId}"
        ${canStart ? "" : "disabled"}
      >${startButtonLabel}</button>
      ${startBlockedReason ? `<div class="machine-flow-footer-hint muted">${escapeHtml(startBlockedReason)}</div>` : ""}
    </footer>
  `;
}

function renderMachineUnloadFlow(station, loadEntries, draft, submittingMachineAction) {
  const unloadMachineInputId = `machine-unload-machine-input-${station}`;
  const selectedLoadId = Number(draft.unloadLoadId || 0);
  const selectedEntry = loadEntries.find((entry) => entry.loadId === selectedLoadId) || null;
  const unloadBasketInputId = selectedEntry ? `machine-unload-basket-input-${station}-${selectedEntry.loadId}` : "";
  const visibleMachineCode = String(draft.unloadMachineCode || "");
  const basketInputValue = String(draft.unloadBasketInput || "");
  const successChip = String(draft.unloadSuccessChip || "").trim();
  const hasBasketInput = Boolean(basketInputValue.trim());
  const canUnload = Boolean(selectedEntry && hasBasketInput && !submittingMachineAction);
  const stationTitle = station === "washing" ? "washing" : "drying";
  const selectedMachineCode = String(selectedEntry?.machine?.machine_code || "").trim();
  const selectedMachineName = String(selectedEntry?.machine?.display_name || selectedMachineCode || "").trim();
  const selectedPending = Number(selectedEntry?.pendingUnloadCount || 0);
  const selectedUnloaded = Number(selectedEntry?.unloadedCount || 0);
  const selectedTotal = Number(selectedEntry?.basketsCount || 0);
  let unloadButtonLabel = "Unload basket";
  let unloadBlockedReason = "";
  if (submittingMachineAction) {
    unloadButtonLabel = "Unloading...";
    unloadBlockedReason = "Please wait: unload is in progress.";
  } else if (!selectedEntry) {
    unloadButtonLabel = "Scan machine";
    unloadBlockedReason = "Button is unavailable until machine QR is scanned.";
  } else if (!hasBasketInput) {
    unloadButtonLabel = "Scan basket";
    unloadBlockedReason = "Button is unavailable until basket QR is scanned.";
  } else if (canUnload) {
    unloadButtonLabel = "Ready to unload";
  }

  return `
    <section class="machine-flow-body">
      <div class="machine-unload-stepbar">
        <div class="machine-unload-step ${selectedEntry ? "done" : "active"}">
          <strong>Step 1</strong>
          <span>${selectedEntry ? `Machine selected: ${escapeHtml(selectedMachineCode || visibleMachineCode || "—")}` : "Scan machine"}</span>
        </div>
        <div class="machine-unload-step ${selectedEntry ? (hasBasketInput ? "done" : "active") : "idle"}">
          <strong>Step 2</strong>
          <span>${selectedEntry ? "Scan basket" : "Waiting for step 1"}</span>
        </div>
      </div>
      ${successChip ? `<div class="machine-unload-success-chip" role="status" aria-live="polite">${escapeHtml(successChip)}</div>` : ""}
      ${
        loadEntries.length
          ? `
            <div class="machine-unload-map" hidden aria-hidden="true">
              ${
                loadEntries.map((entry) => `
                  <div
                    data-machine-unload-item-station="${station}"
                    data-machine-unload-item-machine-code="${escapeHtml(entry.machine.machine_code || "")}"
                    data-machine-unload-item-load="${entry.loadId}"
                  ></div>
                `).join("")
              }
            </div>
          `
          : ""
      }

      ${
        selectedEntry
          ? `
            <article class="machine-unload-active-card">
              <span class="machine-unload-active-label">Active machine</span>
              <strong>${escapeHtml(selectedMachineName || selectedMachineCode)}</strong>
              <div class="machine-unload-active-meta">
                <code>${escapeHtml(selectedMachineCode || "—")}</code>
                <span class="muted">In cycle: ${selectedTotal} · unloaded: ${selectedUnloaded} · remaining: ${selectedPending}</span>
              </div>
            </article>
          `
          : ""
      }

      ${
        !selectedEntry
          ? `
            <article class="machine-flow-step-card is-active is-minimal">
              <div class="machine-flow-step-head">
                <div class="machine-flow-step-copy">
                  <strong>Scan machine</strong>
                </div>
              </div>
              <div class="machine-flow-scan-row">
                <input
                  id="${unloadMachineInputId}"
                  data-machine-unload-machine-input="${station}"
                  class="scan-large machine-code-input"
                  placeholder="${station === "washing" ? "W01" : "D01"}"
                  value="${escapeHtml(visibleMachineCode)}"
                  autocomplete="off"
                  spellcheck="false"
                />
                ${renderMachineScanButton({ station, inputId: unloadMachineInputId, kind: "machine" })}
              </div>
            </article>
          `
          : `
            <article class="machine-flow-step-card is-active is-minimal">
              <div class="machine-flow-step-head">
                <div class="machine-flow-step-copy">
                  <strong>Scan basket</strong>
                </div>
              </div>
              <div class="machine-flow-scan-row">
                <input
                  id="${unloadBasketInputId}"
                  data-machine-unload-input="${station}"
                  data-machine-unload-load="${selectedEntry.loadId}"
                  data-machine-unload-draft="${station}"
                  class="machine-basket-input"
                  placeholder="QR:BIN-001"
                  value="${escapeHtml(basketInputValue)}"
                  autocomplete="off"
                  spellcheck="false"
                />
                ${renderMachineScanButton({
                  station,
                  inputId: unloadBasketInputId,
                  kind: "basket",
                  submitMode: "unload-basket",
                  submitLoadId: selectedEntry.loadId
                })}
              </div>
              ${
                hasBasketInput
                  ? `
                    <div class="machine-flow-ready-note">
                      You can unload a basket for ${stationTitle}.
                    </div>
                  `
                  : ""
              }
            </article>
          `
      }
    </section>

    <footer class="machine-flow-footer">
      <button
        class="${canUnload ? "is-ready" : ""}"
        data-machine-unload-basket-load="${selectedEntry ? selectedEntry.loadId : ""}"
        data-machine-unload-basket-station="${station}"
        data-machine-unload-basket-input-id="${unloadBasketInputId}"
        ${canUnload ? "" : "disabled"}
      >${unloadButtonLabel}</button>
      ${unloadBlockedReason ? `<div class="machine-flow-footer-hint muted">${escapeHtml(unloadBlockedReason)}</div>` : ""}
    </footer>
  `;
}

function renderMachineFlowModal(station, stationTitle, draft, loadEntries, submittingMachineAction) {
  const mode = draft.flowMode === "unload" ? "unload" : (draft.flowMode === "load" ? "load" : "");
  if (!mode) return "";

  return `
    <div class="machine-flow-modal">
      <section class="machine-flow-sheet panel" role="dialog" aria-modal="true" aria-label="${mode === "load" ? "Load" : "Unload"} ${escapeHtml(stationTitle)}">
        <header class="machine-flow-head">
          <div class="machine-flow-head-copy">
            <h3>${mode === "load" ? "Load" : "Unload"}</h3>
          </div>
          <button class="ghost" data-machine-close-flow="${station}">Close</button>
        </header>
        ${
          mode === "load"
            ? renderMachineLoadFlow(station, draft, submittingMachineAction)
            : renderMachineUnloadFlow(station, loadEntries, draft, submittingMachineAction)
        }
      </section>
    </div>
  `;
}

function renderMachineWorkbench(station, machineWorkbench, machineDraft, submittingMachineAction) {
  if (station !== "washing" && station !== "drying") {
    return "";
  }

  const machines = Array.isArray(machineWorkbench?.machines) ? machineWorkbench.machines : [];
  const draft = machineDraft || {};
  const loadEntries = buildMachineLoadEntries(machines);
  const runningCount = loadEntries.filter((entry) => entry.isRunning).length;
  const freeCount = Math.max(0, machines.length - loadEntries.length);
  const stationTitle = station === "washing" ? "Washing" : "Drying";
  const mode = draft.flowMode === "unload" ? "unload" : (draft.flowMode === "load" ? "load" : "");
  const workbenchClass = `machine-workbench machine-workbench-min panel${mode ? " is-flow-open" : ""}`;

  return `
    <section class="${workbenchClass}">
      <header class="machine-workbench-head machine-mobile-head">
        <div class="machine-mobile-head-copy">
          <div class="eyebrow">Machine station</div>
          <h3>${escapeHtml(stationTitle)}</h3>
        </div>
      </header>

      <div class="machine-summary-pills machine-summary-pills-head">
        <span class="pill ${runningCount ? "warn" : "ok"}">Running: ${runningCount}</span>
        <span class="pill ${freeCount ? "ok" : "warn"}">Free: ${freeCount}</span>
      </div>

      <div class="machine-hub-actions">
        <button class="machine-mode-button ${mode === "load" ? "is-active" : ""}" data-machine-open-flow="${station}" data-machine-flow-mode="load">
          <span class="machine-mode-illustration">
            <img src="/images/machines/unload.png" alt="" loading="lazy" decoding="async" />
          </span>
          <span class="machine-mode-copy">
            <span class="machine-mode-label">Load</span>
            <span class="machine-mode-hint">Into machine</span>
          </span>
        </button>
        <button class="machine-mode-button ${mode === "unload" ? "is-active" : ""}" data-machine-open-flow="${station}" data-machine-flow-mode="unload">
          <span class="machine-mode-illustration">
            <img src="/images/machines/load.png" alt="" loading="lazy" decoding="async" />
          </span>
          <span class="machine-mode-copy">
            <span class="machine-mode-label">Unload</span>
            <span class="machine-mode-hint">From machine</span>
          </span>
        </button>
      </div>

      ${renderMachineHubActiveSection(loadEntries, station, submittingMachineAction)}
      ${renderMachineFlowModal(station, stationTitle, draft, loadEntries, submittingMachineAction)}
    </section>
  `;
}

export function renderSimpleScanModeWithStatus(
  station,
  orders,
  stationMetrics,
  recentScans,
  lastScan,
  qcRejectReason = "stain_not_removed",
  qcSelectedIssueImageId = "",
  qcSelectedItemCategory = "",
  qcSelectedItemLabel = "",
  qcCurrentPhotoDataUrl = "",
  qcInspection = null,
  qcModalOpen = false,
  qcModalStep = 1,
  submittingQcDecision = false,
  qcTransferTasks = [],
  qcTransferPanelOpen = false,
  submittingQcTransferRequestId = null,
  qcTransferScanDrafts = {},
  machineWorkbench = null,
  machineDraft = null,
  submittingMachineAction = null
) {
  void recentScans;
  const stationLabel = stationLabels[station] || station;
  const isQc = station === "qc";
  const isMachineStation = station === "washing" || station === "drying";

  if (isQc) {
    return renderQcWorkbench({
      orders,
      stationMetrics,
      lastScan,
      qcRejectReason,
      qcSelectedIssueImageId,
      qcSelectedItemCategory,
      qcSelectedItemLabel,
      qcCurrentPhotoDataUrl,
      qcInspection,
      qcModalOpen,
      qcModalStep,
      submittingQcDecision,
      qcTransferTasks,
      qcTransferPanelOpen,
      submittingQcTransferRequestId,
      qcTransferScanDrafts
    });
  }

  if (isMachineStation) {
    return `
      <section class="panel simple-scan-shell">
        <div class="kiosk-layout">
          ${renderMachineWorkbench(station, machineWorkbench, machineDraft, submittingMachineAction)}
        </div>
      </section>
    `;
  }

  return `
    <section class="panel simple-scan-shell">
      <div class="kiosk-layout">
        <div>
          <div class="eyebrow">Scan post · ${escapeHtml(stationLabel)}</div>
          <p class="muted">Scan QR and press Enter.</p>
        </div>
        <div class="scan-kiosk-form">
          <label>
            Basket QR code
            <input
              class="scan-large"
              id="simple-scan-input"
              data-scan-input-for="${station}"
              placeholder="QR:B-2402-1"
              autocomplete="off"
              spellcheck="false"
            />
          </label>
          <div class="action-row simple-scan-actions">
            <button class="secondary" type="button" data-open-simple-camera="${station}" data-simple-camera-input-id="simple-scan-input">Open camera</button>
          </div>
          ${renderScanStatus(lastScan, station)}
          <div class="kiosk-meta">
            <span class="pill ${orders.length > 0 ? "ok" : "warn"}" data-kiosk-active-count="${station}">In progress: ${orders.length}</span>
          </div>
        </div>

        ${station === "pickup" ? `
          <div class="simple-pickup-list stack">
            <div class="eyebrow">Ready for pickup</div>
            ${orders.length
              ? orders.map((order) => `
                  <article class="card">
                    ${renderOrderMeta(order)}
                    <div class="action-row">
                      <button data-open-order="${order.id}">Open details</button>
                      <button data-complete-pickup="${order.id}" ${order.ready_for_pickup ? "" : "disabled"}>Confirm handoff</button>
                    </div>
                  </article>
                `).join("")
              : '<div class="card"><span class="muted">No orders ready for pickup.</span></div>'}
          </div>
        ` : ""}
      </div>
    </section>
  `;
}
