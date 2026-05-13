import { escapeHtml, renderCameraIconButton } from "../utils.js";

function getOrderProgress(order) {
  const total = Number(order?.total_order_baskets || order?.total_baskets || 0);
  const scanned = Number(order?.scanned_baskets || 0);
  return {
    total,
    scanned,
    remaining: Math.max(0, total - scanned)
  };
}

function getOrderStageLabel(order) {
  if (order?.ready_for_pickup) return "Ready for handoff";
  if (Array.isArray(order?.placements) && order.placements.length) return "In storage";
  if (order?.ready_to_place) return "Ready to place";
  return "Assembly";
}

function getDefaultPlacementLocation(order) {
  const placement = (Array.isArray(order?.placements) ? order.placements : [])
    .find((row) => String(row?.location_qr_code || "").trim());
  return String(placement?.location_qr_code || "").trim();
}

function getPlaceableBaskets(order) {
  return (Array.isArray(order?.baskets) ? order.baskets : [])
    .filter((basket) => basket?.scanned);
}

function renderPlaceOrderButton(order) {
  const placeableBaskets = getPlaceableBaskets(order);
  if (!placeableBaskets.length || order?.ready_for_pickup || getDefaultPlacementLocation(order)) return "";
  const location = getDefaultPlacementLocation(order);
  return `
    <button
      type="button"
      class="secondary pickup-place-now-button"
      data-pickup-place-order="${Number(order?.id || 0)}"
      data-pickup-place-location="${escapeHtml(location)}"
    >Assign location</button>
  `;
}

function renderConfirmAssemblyButton(order) {
  const progress = getOrderProgress(order);
  if (order?.ready_for_pickup || !getDefaultPlacementLocation(order) || progress.remaining > 0) return "";
  return `
    <button type="button" class="pickup-place-now-button" data-pickup-confirm-assembled="${Number(order?.id || 0)}">
      Confirm assembled
    </button>
  `;
}

function renderPickupScanStatus(lastScan) {
  if (!lastScan) {
    return `
      <section class="scan-status idle" data-scan-status="pickup">
        <strong>Waiting</strong>
        <div class="muted">Scan route sheet.</div>
      </section>
    `;
  }

  if (lastScan.ok) {
    return "";
  }

  return `
    <section class="scan-status error" data-scan-status="pickup">
      <strong>Error</strong>
      <div>${escapeHtml(lastScan.message || "Scan was not accepted.")}</div>
    </section>
  `;
}

function renderModeSwitch(mode, assemblyCount, readyToPlaceCount, placedCount, disablePlacement = false) {
  const isAssembly = mode !== "placement";
  void placedCount;
  return `
    <div class="pickup-mode-switch" role="tablist" aria-label="Dispatch stage mode">
      <button
        type="button"
        class="pickup-mode-button ${isAssembly ? "is-active" : ""}"
        data-pickup-mode="assembly"
        aria-selected="${isAssembly ? "true" : "false"}"
      >
        <span class="pickup-mode-button-title">Assembly</span>
        <span class="pickup-mode-button-meta">${escapeHtml(`In assembly: ${assemblyCount}`)}</span>
      </button>
      <button
        type="button"
        class="pickup-mode-button ${!isAssembly ? "is-active" : ""}"
        data-pickup-mode="placement"
        aria-selected="${!isAssembly ? "true" : "false"}"
        ${disablePlacement ? "disabled" : ""}
      >
        <span class="pickup-mode-button-title">Storage</span>
        <span class="pickup-mode-button-meta">${escapeHtml(`Open tasks: ${readyToPlaceCount}`)}</span>
      </button>
    </div>
  `;
}

function renderAssemblyCompletionPrompt(prompt) {
  if (!prompt?.orderId) return "";

  const publicId = String(prompt.publicId || "Order").trim() || "Order";
  const customerName = String(prompt.customerName || "Customer").trim() || "Customer";
  const scanned = Number(prompt.scannedBaskets || 0);
  const total = Number(prompt.totalBaskets || 0);

  return `
    <section class="notice ok pickup-assembly-banner">
      <div class="pickup-assembly-banner-copy">
        <strong>${escapeHtml(`${publicId} is assembled`)}</strong>
        <div>${escapeHtml(`${customerName} · Accepted ${scanned}/${total}. Open Storage when you are ready to assign a location.`)}</div>
      </div>
      <button type="button" class="pickup-assembly-banner-action" data-pickup-assembly-ack>OK</button>
    </section>
  `;
}

function renderOrderCard(order, activeOrderId, actions = "") {
  const progress = getOrderProgress(order);
  const isActive = Number(activeOrderId || 0) === Number(order?.id || 0);
  return `
    <article class="card pickup-order-card ${isActive ? "active" : ""}">
      <div class="header-row pickup-order-head">
        <div>
          <strong>${escapeHtml(order.public_id || "—")}</strong>
          <div class="muted pickup-order-customer">${escapeHtml(order.customer_name || "Customer not specified")}</div>
        </div>
        <span class="pill ${order.ready_for_pickup ? "ok" : (order.ready_to_place ? "warn" : "")}">${escapeHtml(getOrderStageLabel(order))}</span>
      </div>
      <div class="pickup-order-meta-row muted">
        <span>${escapeHtml(`Accepted: ${progress.scanned}/${progress.total}`)}</span>
        ${Array.isArray(order.placements) && order.placements.length
          ? `<span>${escapeHtml(`Placed: ${order.placements.length}`)}</span>`
          : ""}
      </div>
      ${actions ? `<div class="action-row pickup-actions">${actions}</div>` : ""}
    </article>
  `;
}

function renderOrderList(orders, emptyText, renderActions, activeOrderId) {
  if (!Array.isArray(orders) || !orders.length) {
    return `<div class="card"><span class="muted">${escapeHtml(emptyText)}</span></div>`;
  }
  return orders
    .map((order) => renderOrderCard(order, activeOrderId, renderActions(order)))
    .join("");
}

function renderAssemblyCompactCard(order) {
  const progress = getOrderProgress(order);
  const ratio = progress.total > 0 ? Math.min(1, progress.scanned / progress.total) : 0;
  const percent = Math.round(ratio * 100);
  return `
    <article class="card pickup-compact-order">
      <div class="pickup-compact-head">
        <div class="pickup-compact-title">
          <strong>${escapeHtml(order.public_id || "—")}</strong>
          <span class="muted pickup-compact-customer">${escapeHtml(order.customer_name || "Customer not specified")}</span>
        </div>
        <span class="pill ${order.ready_to_place ? "ok" : "warn"}">${escapeHtml(getOrderStageLabel(order))}</span>
      </div>
      <div class="pickup-compact-progress">
        <div class="pickup-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
          <span style="width: ${percent}%;"></span>
        </div>
        <span class="muted">${escapeHtml(`${progress.scanned}/${progress.total}`)}</span>
      </div>
      ${getDefaultPlacementLocation(order)
        ? `<div class="pickup-active-order-meta">${escapeHtml(`Location: ${getDefaultPlacementLocation(order)}`)}</div>`
        : ""}
      ${renderPlaceOrderButton(order)}
      ${renderConfirmAssemblyButton(order)}
    </article>
  `;
}

function renderAssemblyCompactList(orders, emptyText) {
  if (!Array.isArray(orders) || !orders.length) {
    return `<div class="card"><span class="muted">${escapeHtml(emptyText)}</span></div>`;
  }
  return orders.map((order) => renderAssemblyCompactCard(order)).join("");
}

function isAssemblyOrderStarted(order) {
  return Number(order?.scanned_baskets || 0) > 0;
}

function renderActiveAssemblyCard(order) {
  void order;
  return "";
}

function renderAssemblyMode(assemblyOrders, activeOrder, lastScan) {
  const scanPlaceholder = "QR:RS-001";
  const startedAssemblyOrders = Array.isArray(assemblyOrders)
    ? assemblyOrders.filter(isAssemblyOrderStarted)
    : [];
  return `
    <div class="pickup-layout">
      <section class="card pickup-scan-card">
        ${renderActiveAssemblyCard(activeOrder)}
        <div class="pickup-flow">
          <label class="pickup-scan-label">
            Route sheet QR
            <span class="qr-camera-input-wrap">
              <input
                id="pickup-scan-input"
                data-scan-input-for="pickup"
                placeholder="${escapeHtml(scanPlaceholder)}"
              />
              ${renderCameraIconButton({
                attributes: {
                  "data-open-simple-camera": "pickup",
                  "data-simple-camera-input-id": "pickup-scan-input"
                }
              })}
            </span>
          </label>
          ${renderPickupScanStatus(lastScan)}
        </div>
      </section>

      <section class="pickup-orders-column">
        ${startedAssemblyOrders.length
          ? `
            <div class="pickup-orders-group">
              <div class="pickup-orders-header">
                <strong>Now in assembly</strong>
                <span class="muted">${escapeHtml(String(startedAssemblyOrders.length))}</span>
              </div>
              <div class="pickup-orders-list">
                ${renderAssemblyCompactList(startedAssemblyOrders, "No orders.")}
              </div>
            </div>
          `
          : ""}
      </section>
    </div>
  `;
}

function getPlacementStepState(placements) {
  const row = placements[0] || {};
  const locationQr = String(row.locationQr || "").trim();
  if (!locationQr) {
    return {
      key: "scan-loc",
      slotIndex: 0,
      step: 1,
      totalSteps: 1
    };
  }
  return {
    key: "done",
    slotIndex: 0,
    step: 1,
    totalSteps: 1
  };
}

function renderPlacementFeedback(feedback) {
  const tone = feedback?.type === "error" ? "error" : (feedback?.type === "ok" ? "ok" : "warn");
  const text = String(feedback?.text || "").trim();
  if (!text) return "";
  return `<div class="pickup-placement-feedback ${tone}">${escapeHtml(text)}</div>`;
}

function renderPlacementReadyList(orders, selectedOrderId) {
  if (!Array.isArray(orders) || !orders.length) {
    return '<div class="card"><span class="muted">No orders.</span></div>';
  }

  return orders.map((order) => {
    const progress = getOrderProgress(order);
    const ratio = progress.total > 0 ? Math.min(1, progress.scanned / progress.total) : 0;
    const percent = Math.round(ratio * 100);
    const isSelected = Number(selectedOrderId || 0) === Number(order.id);
    const location = getDefaultPlacementLocation(order);
    return `
      <button
        type="button"
        class="card pickup-place-order-select ${isSelected ? "active" : ""}"
        data-pickup-place-order="${order.id}"
        data-pickup-place-location="${escapeHtml(location)}"
      >
        <div class="pickup-place-order-head">
          <div class="pickup-compact-title">
            <strong>${escapeHtml(order.public_id || "—")}</strong>
            <span class="muted pickup-compact-customer">${escapeHtml(order.customer_name || "Customer not specified")}</span>
          </div>
          <span class="pill warn">${escapeHtml(location ? "In location" : "Needs location")}</span>
        </div>
        <div class="pickup-compact-progress">
          <div class="pickup-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
            <span style="width: ${percent}%;"></span>
          </div>
          <span class="muted">${escapeHtml(`${progress.scanned}/${progress.total}`)}</span>
        </div>
        <div class="pickup-place-order-action-row">
          <span class="pickup-place-order-action-label">${isSelected ? "Selected" : (location ? "Open location" : "Assign location")}</span>
          <span class="pickup-place-order-action-cta">${isSelected ? "Continue" : (location && progress.remaining <= 0 ? "Confirm" : "Open")}</span>
        </div>
      </button>
    `;
  }).join("");
}

function renderPlacementFlow(selectedOrder, draft, submittingPlacement) {
  const existingLocation = getDefaultPlacementLocation(selectedOrder);
  const selectedProgress = getOrderProgress(selectedOrder);
  if (existingLocation) {
    const canConfirm = !selectedOrder?.ready_for_pickup && selectedProgress.remaining <= 0;
    return `
      <div class="pickup-placement-modal-head">
        <div class="pickup-placement-order-head">
          <strong>${escapeHtml(selectedOrder.public_id || "—")}</strong>
          <div class="muted">${escapeHtml(selectedOrder.customer_name || "Customer")}</div>
        </div>
        <button type="button" class="ghost" data-pickup-place-close ${submittingPlacement ? "disabled" : ""}>Close</button>
      </div>
      <div class="pickup-placement-modal-body">
        <section class="pickup-placement-step-card">
          <div class="pickup-placement-step-head">
            <strong>${escapeHtml(canConfirm ? "Confirm assembled" : "Location assigned")}</strong>
            <span class="pickup-placement-step-badge">${escapeHtml(`${selectedProgress.scanned}/${selectedProgress.total}`)}</span>
          </div>
          <div class="muted">
            ${escapeHtml(canConfirm
              ? "Move the last items to this location, then confirm the order is assembled."
              : "Use this same storage location for the remaining route sheets.")}
          </div>
          <div class="pickup-placement-preview">
            <div class="pickup-placement-preview-row">
              <code>${escapeHtml(existingLocation)}</code>
            </div>
          </div>
        </section>
        <div class="pickup-placement-footer">
          ${canConfirm
            ? `<button type="button" class="pickup-placement-submit" data-pickup-confirm-assembled="${Number(selectedOrder?.id || 0)}" ${submittingPlacement ? "disabled" : ""}>Confirm assembled</button>`
            : ""}
        </div>
      </div>
    `;
  }

  const placements = Array.isArray(draft?.placements) ? draft.placements : [];
  const stepState = getPlacementStepState(placements);
  const feedback = draft?.feedback || null;
  const currentRow = placements[stepState.slotIndex] || { locationQr: "" };
  const hasAnyPlacementData = placements.some((row) => String(row?.locationQr || "").trim());

  let stepBody = "";
  let primaryAction = "";
  let helperNote = "";

  if (stepState.key === "scan-loc") {
    helperNote = "Scan the storage location where this order will stay.";
    stepBody = `
      <section class="pickup-placement-step-card">
        <div class="pickup-placement-step-head">
          <strong>Scan storage location</strong>
          <span class="pickup-placement-step-badge">${escapeHtml(`${stepState.step}/${stepState.totalSteps}`)}</span>
        </div>
        <div class="muted">Scan the storage location QR where this order will stay.</div>
        <label>
          Storage location QR
          <span class="qr-camera-input-wrap">
            <input
              type="text"
              value="${escapeHtml(String(currentRow.locationQr || ""))}"
              placeholder="QR:LOC-A01"
              data-pickup-placement-input="locationQr"
              data-slot-index="${stepState.slotIndex}"
              data-pickup-placement-active="true"
              ${submittingPlacement ? "disabled" : ""}
              autocomplete="off"
              spellcheck="false"
            />
            ${renderCameraIconButton({
              disabled: submittingPlacement,
              attributes: {
                "data-pickup-placement-open-camera": "",
                "data-slot-index": stepState.slotIndex,
                "data-pickup-placement-field": "locationQr"
              }
            })}
          </span>
        </label>
      </section>
    `;
  } else {
    primaryAction = `
      <button type="button" class="pickup-placement-submit" data-pickup-place-submit ${submittingPlacement ? "disabled" : ""}>
        ${submittingPlacement ? "Saving..." : "Assign location"}
      </button>
    `;
    stepBody = `
      <section class="pickup-placement-step-card">
        <div class="pickup-placement-step-head">
          <strong>Ready to assign</strong>
          <span class="pickup-placement-step-badge">${escapeHtml(`${stepState.totalSteps}/${stepState.totalSteps}`)}</span>
        </div>
        <div class="muted">Storage location is filled. Confirm assignment.</div>
        <div class="pickup-placement-preview">
          <div class="pickup-placement-preview-row">
            <code>${escapeHtml(String(placements[0]?.locationQr || "QR:LOC-???"))}</code>
          </div>
        </div>
      </section>
    `;
  }

  return `
    <div class="pickup-placement-modal-head">
      <div class="pickup-placement-order-head">
        <strong>${escapeHtml(selectedOrder.public_id || "—")}</strong>
        <div class="muted">${escapeHtml(selectedOrder.customer_name || "Customer")}</div>
      </div>
      <button type="button" class="ghost" data-pickup-place-close ${submittingPlacement ? "disabled" : ""}>Close</button>
    </div>
    <div class="pickup-placement-modal-body">
      ${stepBody}
      ${renderPlacementFeedback(feedback)}
      <div class="pickup-placement-footer">
        <div class="pickup-placement-footer-meta">
          ${helperNote ? `<div class="pickup-placement-primary-note muted">${escapeHtml(helperNote)}</div>` : ""}
          ${hasAnyPlacementData ? `<button type="button" class="secondary pickup-placement-clear-link" data-pickup-place-clear ${submittingPlacement ? "disabled" : ""}>Reset</button>` : ""}
        </div>
        ${primaryAction}
      </div>
    </div>
  `;
}

function renderPlacementModal(selectedOrder, draft, submittingPlacement) {
  return `
    <section class="pickup-placement-modal" role="dialog" aria-modal="true" aria-label="Storage location assignment">
      <button type="button" class="pickup-placement-modal-backdrop" data-pickup-place-close aria-label="Close"></button>
      <div class="pickup-placement-modal-sheet">
        ${renderPlacementFlow(selectedOrder, draft, submittingPlacement)}
      </div>
    </section>
  `;
}

function renderPlacementMode(readyToPlaceOrders, placedOrders, placementDraft, submittingPlacement) {
  void placedOrders;
  const selectedOrderId = Number(placementDraft?.orderId || 0);
  const selectedOrder = readyToPlaceOrders.find((order) => Number(order.id) === selectedOrderId) || null;

  return `
    <div class="pickup-layout placement-mode placement-list-only">
      <section class="pickup-orders-column">
        <div class="pickup-orders-group">
          <div class="pickup-orders-header">
            <strong>Location tasks</strong>
            <span class="muted">${escapeHtml(String(readyToPlaceOrders.length))}</span>
          </div>
          <div class="pickup-orders-list">
            ${renderPlacementReadyList(readyToPlaceOrders, selectedOrderId)}
          </div>
        </div>
      </section>
    </div>
    ${selectedOrder ? renderPlacementModal(selectedOrder, placementDraft, submittingPlacement) : ""}
  `;
}

export function renderPickup(
  assemblyOrders,
  readyToPlaceOrders,
  placedOrders,
  lastScan = null,
  activeOrderId = null,
  mode = "assembly",
  placementDraft = null,
  submittingPlacement = false,
  assemblyCompletionPrompt = null
) {
  const safeAssemblyOrders = Array.isArray(assemblyOrders) ? assemblyOrders : [];
  const safeReadyToPlaceOrders = Array.isArray(readyToPlaceOrders) ? readyToPlaceOrders : [];
  const safePlacedOrders = Array.isArray(placedOrders) ? placedOrders : [];
  const startedAssemblyOrders = safeAssemblyOrders.filter(isAssemblyOrderStarted);
  const hasPendingAssemblyPrompt = Boolean(assemblyCompletionPrompt?.orderId);
  const safeMode = hasPendingAssemblyPrompt
    ? "assembly"
    : (mode === "placement" ? "placement" : "assembly");
  const safeDraft = placementDraft && typeof placementDraft === "object"
    ? placementDraft
    : {
        orderId: null,
        containerCount: 1,
        placements: [
          { locationQr: "" }
        ],
        feedback: null
      };

  const placeableAssemblyOrders = safeAssemblyOrders.filter((order) => getPlaceableBaskets(order).length > 0 && !getDefaultPlacementLocation(order));
  const placementOrdersById = new Map();
  [...safeReadyToPlaceOrders, ...placeableAssemblyOrders].forEach((order) => placementOrdersById.set(Number(order.id), order));
  const placementOrders = Array.from(placementOrdersById.values());

  const visiblePickupOrders = safeMode === "assembly"
    ? safeAssemblyOrders
    : placementOrders;
  const activeOrder = visiblePickupOrders.find((order) => Number(order.id) === Number(activeOrderId || 0)) || null;

  return `
    <section class="panel stack pickup-workbench">
      <div class="pickup-head">
        ${renderModeSwitch(safeMode, startedAssemblyOrders.length, placementOrders.length, safePlacedOrders.length, hasPendingAssemblyPrompt)}
        <div class="muted pickup-head-subtitle">
          ${safeMode === "assembly"
            ? "Assembly: scan route sheets in any order. Assign a storage location as soon as the order needs storage."
            : "Storage: assign accepted route sheets to a storage location. Handoff unlocks when the whole order is accepted and assigned."}
        </div>
      </div>
      ${renderAssemblyCompletionPrompt(assemblyCompletionPrompt)}
      ${safeMode === "assembly"
        ? renderAssemblyMode(safeAssemblyOrders, activeOrder, lastScan)
        : renderPlacementMode(placementOrders, safePlacedOrders, safeDraft, submittingPlacement)}
    </section>
  `;
}
