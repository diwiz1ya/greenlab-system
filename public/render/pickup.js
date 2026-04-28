import { escapeHtml } from "../utils.js";

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
  if (order?.ready_for_pickup) return "Ready for pickup";
  if (order?.ready_to_place) return "Ready to place";
  return "Assembly";
}

function renderPickupScanStatus(lastScan) {
  if (!lastScan) {
    return `
      <section class="scan-status idle" data-scan-status="pickup">
        <strong>Waiting</strong>
        <div class="muted">Scan BIN basket.</div>
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
    <div class="pickup-mode-switch" role="tablist" aria-label="Pickup stage mode">
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
        <span class="pickup-mode-button-title">Placement</span>
        <span class="pickup-mode-button-meta">${escapeHtml(`Ready to place: ${readyToPlaceCount}`)}</span>
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
        <div>${escapeHtml(`${customerName} · Accepted ${scanned}/${total}. Open Placement when you are ready to assign storage.`)}</div>
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
        <span class="pill ${order.ready_to_place ? "ok" : "warn"}">${escapeHtml(order.ready_to_place ? "Ready to place" : "Assembly")}</span>
      </div>
      <div class="pickup-compact-progress">
        <div class="pickup-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
          <span style="width: ${percent}%;"></span>
        </div>
        <span class="muted">${escapeHtml(`${progress.scanned}/${progress.total}`)}</span>
      </div>
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
  if (!order) {
    return `
      <section class="pickup-active-order empty">
        <strong>No order selected</strong>
        <div class="muted">Scan any BIN basket. The card will show the order from the latest scan.</div>
      </section>
    `;
  }

  const progress = getOrderProgress(order);
  return `
    <section class="pickup-active-order">
      <div class="pickup-active-order-head">
        <div>
          <span class="qc-section-label">Current order</span>
          <strong>${escapeHtml(order.public_id)}</strong>
          <div class="muted">${escapeHtml(order.customer_name || "Customer")}</div>
        </div>
        <span class="pill ${order.ready_to_place ? "ok" : "warn"}">${escapeHtml(order.ready_to_place ? "Ready to place" : "Assembly")}</span>
      </div>
      <div class="pickup-active-progress">
        <span class="pill ${progress.remaining === 0 ? "ok" : "warn"}">${escapeHtml(`Accepted ${progress.scanned}/${progress.total}`)}</span>
      </div>
      ${order.ready_to_place
        ? `<div class="pickup-active-order-meta">Order kit is assembled.</div>`
        : ""}
    </section>
  `;
}

function renderAssemblyMode(assemblyOrders, activeOrder, lastScan) {
  const scanPlaceholder = "QR:BIN-001";
  const startedAssemblyOrders = Array.isArray(assemblyOrders)
    ? assemblyOrders.filter(isAssemblyOrderStarted)
    : [];
  return `
    <div class="pickup-layout">
      <section class="card pickup-scan-card">
        ${renderActiveAssemblyCard(activeOrder)}
        <div class="pickup-flow">
          <label class="pickup-scan-label">
            BIN basket QR
            <input
              id="pickup-scan-input"
              data-scan-input-for="pickup"
              placeholder="${escapeHtml(scanPlaceholder)}"
            />
          </label>
          <div class="action-row pickup-scan-actions">
            <button data-open-simple-camera="pickup" data-simple-camera-input-id="pickup-scan-input">Open camera</button>
          </div>
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

function getPlacementStepState(containerCount, placements) {
  const totalSteps = containerCount * 2;
  for (let index = 0; index < containerCount; index += 1) {
    const row = placements[index] || {};
    const binQr = String(row.binQr || "").trim();
    const locationQr = String(row.locationQr || "").trim();
    if (!binQr) {
      return {
        key: "scan-bin",
        slotIndex: index,
        step: (index * 2) + 1,
        totalSteps
      };
    }
    if (!locationQr) {
      return {
        key: "scan-loc",
        slotIndex: index,
        step: (index * 2) + 2,
        totalSteps
      };
    }
  }
  return {
    key: "done",
    slotIndex: containerCount - 1,
    step: totalSteps,
    totalSteps
  };
}

function buildPlacementStepItems(containerCount, placements) {
  const steps = [];
  for (let index = 0; index < containerCount; index += 1) {
    const row = placements[index] || {};
    steps.push({
      key: "binQr",
      slotIndex: index,
      label: `${index + 1} BIN`,
      value: String(row.binQr || "").trim()
    });
    steps.push({
      key: "locationQr",
      slotIndex: index,
      label: `${index + 1} LOC`,
      value: String(row.locationQr || "").trim()
    });
  }

  const currentIndex = steps.findIndex((step) => !step.value);
  const activeIndex = currentIndex >= 0 ? currentIndex : steps.length - 1;
  return steps.map((step, index) => ({
    ...step,
    done: Boolean(step.value),
    active: index === activeIndex
  }));
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
    return `
      <button type="button" class="card pickup-place-order-select ${isSelected ? "active" : ""}" data-pickup-place-order="${order.id}">
        <div class="pickup-place-order-head">
          <div class="pickup-compact-title">
            <strong>${escapeHtml(order.public_id || "—")}</strong>
            <span class="muted pickup-compact-customer">${escapeHtml(order.customer_name || "Customer not specified")}</span>
          </div>
          <span class="pill warn">Ready to place</span>
        </div>
        <div class="pickup-compact-progress">
          <div class="pickup-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
            <span style="width: ${percent}%;"></span>
          </div>
          <span class="muted">${escapeHtml(`${progress.scanned}/${progress.total}`)}</span>
        </div>
        <div class="pickup-place-order-action-row">
          <span class="pickup-place-order-action-label">${isSelected ? "Selected" : "Open placement"}</span>
          <span class="pickup-place-order-action-cta">${isSelected ? "Continue" : "Open"}</span>
        </div>
      </button>
    `;
  }).join("");
}

function renderPlacementFlow(selectedOrder, draft, submittingPlacement) {
  const containerCount = Number(draft?.containerCount || 1) === 2 ? 2 : 1;
  const placements = Array.isArray(draft?.placements) ? draft.placements : [];
  const stepState = getPlacementStepState(containerCount, placements);
  const stepItems = buildPlacementStepItems(containerCount, placements);
  const feedback = draft?.feedback || null;
  const currentRow = placements[stepState.slotIndex] || { binQr: "", locationQr: "" };
  const isReadyToSubmit = Boolean(selectedOrder) && stepState.key === "done";
  const hasAnyPlacementData = placements.some((row) => String(row?.binQr || "").trim() || String(row?.locationQr || "").trim());

  let stepBody = "";
  let primaryAction = "";
  let helperNote = "";

  if (stepState.key === "scan-bin") {
    helperNote = `Scan BIN basket ${stepState.slotIndex + 1} first.`;
    stepBody = `
      <section class="pickup-placement-step-card">
        <div class="pickup-placement-step-head">
          <strong>Scan BIN basket</strong>
          <span class="pickup-placement-step-badge">${escapeHtml(`${stepState.step}/${stepState.totalSteps}`)}</span>
        </div>
        <div class="muted">${escapeHtml(`Empty basket ${stepState.slotIndex + 1} of ${containerCount}.`)}</div>
        <label>
          BIN QR
          <input
            type="text"
            value="${escapeHtml(String(currentRow.binQr || ""))}"
            placeholder="QR:BIN-001"
            data-pickup-placement-input="binQr"
            data-slot-index="${stepState.slotIndex}"
            data-pickup-placement-active="true"
            ${submittingPlacement ? "disabled" : ""}
            autocomplete="off"
            spellcheck="false"
          />
        </label>
        <div class="action-row pickup-placement-step-actions">
          <button
            type="button"
            class="secondary"
            data-pickup-placement-open-camera
            data-slot-index="${stepState.slotIndex}"
            data-pickup-placement-field="binQr"
            ${submittingPlacement ? "disabled" : ""}
          >Open camera</button>
        </div>
      </section>
    `;
  } else if (stepState.key === "scan-loc") {
    helperNote = `Now scan LOC storage for basket ${stepState.slotIndex + 1}.`;
    stepBody = `
      <section class="pickup-placement-step-card">
        <div class="pickup-placement-step-head">
          <strong>Scan storage location</strong>
          <span class="pickup-placement-step-badge">${escapeHtml(`${stepState.step}/${stepState.totalSteps}`)}</span>
        </div>
        <div class="pickup-placement-current-bin">
          <span class="muted">BIN:</span>
          <code>${escapeHtml(String(currentRow.binQr || "—"))}</code>
        </div>
        <label>
          LOC QR
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
        </label>
        <div class="action-row pickup-placement-step-actions">
          <button
            type="button"
            class="secondary"
            data-pickup-placement-open-camera
            data-slot-index="${stepState.slotIndex}"
            data-pickup-placement-field="locationQr"
            ${submittingPlacement ? "disabled" : ""}
          >Open camera</button>
        </div>
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
        <div class="muted">BIN -> LOC pairs are filled. Confirm placement.</div>
        <div class="pickup-placement-preview">
          ${Array.from({ length: containerCount }).map((_, index) => {
            const row = placements[index] || {};
            return `
              <div class="pickup-placement-preview-row">
                <code>${escapeHtml(String(row.binQr || "QR:BIN-???"))}</code>
                <span>→</span>
                <code>${escapeHtml(String(row.locationQr || "QR:LOC-???"))}</code>
              </div>
            `;
          }).join("")}
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
      <div class="pickup-placement-topbar">
        <div class="pickup-placement-count">
          <span class="muted pickup-placement-count-label">Baskets</span>
        </div>
        <div class="pickup-count-chips">
          <button
            type="button"
            class="ghost pickup-count-chip ${containerCount === 1 ? "active" : ""}"
            data-pickup-container-count="1"
            ${submittingPlacement ? "disabled" : ""}
          >1</button>
          <button
            type="button"
            class="ghost pickup-count-chip ${containerCount === 2 ? "active" : ""}"
            data-pickup-container-count="2"
            ${submittingPlacement ? "disabled" : ""}
          >2</button>
        </div>
      </div>
      <div class="pickup-placement-stepper" role="list" aria-label="Placement steps">
        ${stepItems.map((step) => `
          <div class="pickup-placement-step-item ${step.done ? "is-done" : ""} ${step.active ? "is-active" : ""}" role="listitem">
            <span class="pickup-placement-step-marker">${step.done ? "✓" : "•"}</span>
            <span>${escapeHtml(step.label)}</span>
          </div>
        `).join('<span class="pickup-placement-step-arrow" aria-hidden="true">→</span>')}
      </div>
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
    <section class="pickup-placement-modal" role="dialog" aria-modal="true" aria-label="Order placement">
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
            <strong>Ready to place</strong>
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
          { binQr: "", locationQr: "" },
          { binQr: "", locationQr: "" }
        ],
        feedback: null
      };

  const visiblePickupOrders = safeMode === "assembly"
    ? safeAssemblyOrders
    : safeReadyToPlaceOrders;
  const activeOrder = visiblePickupOrders.find((order) => Number(order.id) === Number(activeOrderId || 0)) || null;

  return `
    <section class="panel stack pickup-workbench">
      <div class="pickup-head">
        ${renderModeSwitch(safeMode, startedAssemblyOrders.length, safeReadyToPlaceOrders.length, safePlacedOrders.length, hasPendingAssemblyPrompt)}
        <div class="muted pickup-head-subtitle">
          ${safeMode === "assembly"
            ? "Assembly: scan BIN baskets in any order. Orders are assembled automatically."
            : "Placement: choose an order and bind BIN -> LOC pairs."}
        </div>
      </div>
      ${renderAssemblyCompletionPrompt(assemblyCompletionPrompt)}
      ${safeMode === "assembly"
        ? renderAssemblyMode(safeAssemblyOrders, activeOrder, lastScan)
        : renderPlacementMode(safeReadyToPlaceOrders, safePlacedOrders, safeDraft, submittingPlacement)}
    </section>
  `;
}
