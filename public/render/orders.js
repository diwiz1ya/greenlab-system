import { escapeHtml } from "../utils.js";
import {
  formatOrderPhone,
  formatOrderWeight,
  formatReworkItemLabel,
  formatReworkReasonLabel,
  formatReworkRequestStatus,
  getColorToneClass,
  getOrderProgressLabel,
  getPreviewBasketImageByType,
  getRowItemsTotal,
  inferColorFromBasketType,
  renderBasketImageStrip,
  renderBasketItemsSummary,
  renderBasketReworkMeta,
  stationStatusLabels
} from "./order-shared.js";

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function renderOrderDetailEmpty(message) {
  return `<article class="order-detail-row"><span class="muted">${escapeHtml(message)}</span></article>`;
}

function renderModalCollapsibleSection({
  title,
  count,
  body,
  open = false,
  countClass = "",
  sectionClass = ""
}) {
  const classes = ["order-modal-section", "order-modal-collapsible", sectionClass].filter(Boolean).join(" ");
  return `
    <details class="${classes}" ${open ? "open" : ""}>
      <summary class="order-modal-section-head order-collapsible-head">
        <strong>${escapeHtml(title)}</strong>
        <span class="pill ${countClass}">${escapeHtml(String(count))}</span>
      </summary>
      ${body}
    </details>
  `;
}

function renderReworkHistory(baskets) {
  const rows = toArray(baskets);
  const reworkBaskets = rows.filter((basket) => String(basket?.basket_kind || "main") === "rework");

  if (!reworkBaskets.length) {
    return `
      <details class="order-details-fold">
        <summary>
          <strong>Rework</strong>
          <span class="pill">0</span>
        </summary>
        <div class="order-detail-list">
          ${renderOrderDetailEmpty("No rework for this order yet.")}
        </div>
      </details>
    `;
  }

  return `
    <details class="order-details-fold">
      <summary>
        <strong>Rework</strong>
        <span class="pill">${reworkBaskets.length}</span>
      </summary>
      <div class="order-detail-list">
        ${reworkBaskets
          .map((basket) => {
            const parentCode = rows.find((item) => item.id === basket.parent_basket_id)?.basket_code || "Source route sheet";
            const reasonLabel = formatReworkReasonLabel(basket.rework_reason);
            const attempt = Number(basket.rework_attempt || 0) || 1;
            return `
              <article class="order-detail-row">
                <div class="order-detail-row-top">
                  <strong>${escapeHtml(`${parentCode} -> ${basket.basket_code}`)}</strong>
                  <span class="pill">${escapeHtml(stationStatusLabels[basket.station] || basket.station)}</span>
                </div>
                <div class="muted">${escapeHtml(`${reasonLabel} · attempt ${attempt}`)}</div>
                <code>${escapeHtml(basket.qr_code)}</code>
              </article>
            `;
          })
          .join("")}
      </div>
    </details>
  `;
}

function renderReworkEvidencePair(request) {
  const cards = [
    {
      label: "Photo from sorting",
      url: String(request?.source_image_url || "").trim(),
      note: String(request?.source_image_note || "").trim() || "Original issue"
    },
    {
      label: "Photo from QC",
      url: String(request?.qc_photo_url || "").trim(),
      note: "Current state after drying"
    }
  ].filter((card) => card.url);

  if (!cards.length) return "";

  return `
    <div class="order-rework-photo-pair">
      ${cards.map((card) => `
        <figure class="order-rework-photo-card">
          <img src="${escapeHtml(card.url)}" alt="${escapeHtml(card.label)}" loading="lazy" />
          <figcaption>
            <strong>${escapeHtml(card.label)}</strong>
            <span class="muted">${escapeHtml(card.note)}</span>
          </figcaption>
        </figure>
      `).join("")}
    </div>
  `;
}

function renderReworkRequests(requests) {
  const rows = toArray(requests);

  return `
    <details class="order-details-fold" ${rows.length ? "open" : ""}>
      <summary>
        <strong>Rework approval</strong>
        <span class="pill">${rows.length}</span>
      </summary>
      <div class="order-detail-list">
        ${
          rows.length
            ? rows.map((request) => {
                const status = String(request.request_status || "");
                const toneClass = status === "approved" ? "ok" : (status === "declined" ? "error" : "warn");
                const itemLabel = request.item_label
                  ? `${formatReworkItemLabel(request.item_category)} · ${request.item_label}`
                  : formatReworkItemLabel(request.item_category);
                return `
                  <article class="order-detail-row">
                    <div class="order-detail-row-top">
                      <strong>${escapeHtml(`${request.source_basket_code || "Basket"} -> ${itemLabel}`)}</strong>
                      <span class="pill ${toneClass}">${escapeHtml(formatReworkRequestStatus(status))}</span>
                    </div>
                    <div class="muted">${escapeHtml(`${formatReworkReasonLabel(request.reason_code)} · ${request.service_label} · +${request.extra_days} day`)}</div>
                    ${
                      request.rework_basket_code
                        ? `<div class="muted">${escapeHtml(`Rework basket: ${request.rework_basket_code}`)}</div>`
                        : ""
                    }
                    ${
                      request.decision_note
                        ? `<div class="muted">${escapeHtml(`Comment: ${request.decision_note}`)}</div>`
                        : ""
                    }
                    ${renderReworkEvidencePair(request)}
                    ${
                      status === "pending_customer_approval"
                        ? `
                          <div class="action-row">
                            <button data-approve-rework-request="${request.id}">Customer approved</button>
                            <button class="secondary" data-decline-rework-request="${request.id}">Customer declined</button>
                          </div>
                        `
                        : ""
                    }
                  </article>
                `;
              }).join("")
            : renderOrderDetailEmpty("No approval requests yet.")
        }
      </div>
    </details>
  `;
}

export function renderOrderDetails(order) {
  if (!order) {
    return `
      <section class="panel order-details-compact">
        <div class="eyebrow">Order details</div>
        <h2>No order selected</h2>
        <p class="muted">Select an order from the list to open details.</p>
      </section>
    `;
  }

  const baskets = toArray(order.baskets);
  const scans = toArray(order.scans);
  const reworkRequests = toArray(order.rework_requests);
  const progressLabel = getOrderProgressLabel(order);
  const basketsById = new Map(baskets.map((basket) => [basket.id, basket]));

  return `
    <section class="panel stack order-details-compact">
      <div class="order-details-head">
        <div>
          <div class="eyebrow">Order details</div>
          <h2>${escapeHtml(order.public_id)} · ${escapeHtml(order.customer_name)}</h2>
        </div>
        <div class="order-details-pills">
          <span class="pill ${order.status === "hold" ? "error" : (order.ready_for_pickup ? "ok" : "warn")}">${escapeHtml(progressLabel)}</span>
          <span class="pill">${escapeHtml(stationStatusLabels[order.status] || order.status)}</span>
        </div>
      </div>
      ${
        order.status === "hold"
          ? `
            <div class="action-row">
              <button data-release-hold="${order.id}">Release HOLD -> washing</button>
            </div>
          `
          : ""
      }
      <div class="order-details-summary">
        <span class="pill">route sheets: ${baskets.length}</span>
        <span class="pill">scans: ${scans.length}</span>
        <span class="pill ${order.has_pending_customer_approval ? "warn" : ""}">approval: ${reworkRequests.length}</span>
        <span class="pill">weight: ${escapeHtml(formatOrderWeight(order.order_weight))}</span>
        <span class="pill">phone: ${escapeHtml(formatOrderPhone(order.customer_phone))}</span>
      </div>
      <details class="order-details-fold">
        <summary>
          <strong>Route sheets</strong>
          <span class="pill">${baskets.length}</span>
        </summary>
        <div class="order-detail-list">
          ${
            baskets.length
              ? baskets
                  .map(
                    (basket) => `
                      <article class="order-detail-row">
                        <div class="order-detail-row-top">
                          <strong>${escapeHtml(basket.basket_code)}</strong>
                          <span class="pill">${escapeHtml(stationStatusLabels[basket.station] || basket.station)}</span>
                        </div>
                        <div class="muted">${escapeHtml(basket.basket_type)}</div>
                        ${renderBasketReworkMeta(basket, basketsById)}
                        ${renderBasketImageStrip(basket.images)}
                        <code>${escapeHtml(basket.qr_code)}</code>
                      </article>
                    `
                  )
                  .join("")
              : renderOrderDetailEmpty("Route sheets will appear after sorting.")
          }
        </div>
      </details>
      ${renderReworkRequests(reworkRequests)}
      ${renderReworkHistory(baskets)}
      <details class="order-details-fold">
        <summary>
          <strong>Scans</strong>
          <span class="pill">${scans.length}</span>
        </summary>
        <div class="order-detail-list">
          ${
            scans.length
              ? scans
                  .map(
                    (scan) => `
                      <article class="order-detail-row">
                        <div class="order-detail-row-top">
                          <strong>${escapeHtml(stationStatusLabels[scan.station] || scan.station)}</strong>
                          <span class="pill ${scan.result === "ok" ? "ok" : "error"}">${escapeHtml(scan.result)}</span>
                        </div>
                        <div class="muted">${escapeHtml(scan.actor)} · ${new Date(scan.created_at).toLocaleString()}</div>
                        <div>${escapeHtml(scan.message)}</div>
                      </article>
                    `
                  )
                  .join("")
              : renderOrderDetailEmpty("No scan events yet.")
          }
        </div>
      </details>
    </section>
  `;
}

function formatOrderUpdatedAt(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString();
}

function shortenText(value, maxLength = 120) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function isAwaitingCleanCloudClose(order) {
  return order.status === "pickup"
    && !order.ready_for_pickup
    && (
      String(order.cleancloud_status || "").toLowerCase().includes("awaiting close")
      || String(order.cleancloud_status || "").toLowerCase().includes("ожидает закрытия")
    );
}

function isIssuedOrder(order) {
  const cleanCloudStatus = String(order.cleancloud_status || "").toLowerCase();
  return order.status === "overview"
    || (
      order.status === "pickup"
      && !order.ready_for_pickup
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

function normalizeManagerActiveStage(order) {
  const status = String(order.status || "").trim();
  if (status === "sorting") return "sorting";
  if (status === "sorted") return "washing";
  if (status === "hold") return "qc";
  if (status === "customer_approval") return "customer_approval";
  if (status === "overview") return "pickup";
  return status || "sorting";
}

function getLatestScansByStation(scans) {
  const latest = new Map();
  for (const scan of scans) {
    if (!latest.has(scan.station)) {
      latest.set(scan.station, scan);
    }
  }
  return latest;
}

function normalizeBasketTypeLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "Mixed";
  return raw.replace(/\s*#\d+\s*$/u, "").trim() || raw;
}

function buildBasketSummary(baskets) {
  const rows = toArray(baskets);
  const mainCount = rows.filter((basket) => String(basket?.basket_kind || "main") !== "rework").length;
  const reworkCount = rows.length - mainCount;
  const qrCount = rows.filter((basket) => String(basket?.qr_code || "").trim()).length;
  const itemCount = rows.reduce((total, basket) => total + getRowItemsTotal(basket), 0);
  const typeMap = new Map();

  for (const basket of rows) {
    if (String(basket?.basket_kind || "main") === "rework") continue;
    const label = normalizeBasketTypeLabel(basket?.basket_type);
      const current = typeMap.get(label) || {
        label,
        count: 0,
        preview: getPreviewBasketImageByType(basket?.basket_type, basket?.basket_kind)
      };
    current.count += 1;
    typeMap.set(label, current);
  }

  return {
    totalCount: rows.length,
    mainCount,
    reworkCount,
    qrCount,
    itemCount,
    typeRows: Array.from(typeMap.values()).sort((left, right) => right.count - left.count)
  };
}

function renderBasketSummaryStrip(baskets) {
  const summary = buildBasketSummary(baskets);
  if (!summary.totalCount) return "";
  const typeHint = summary.typeRows
    .slice(0, 3)
    .map((row) => `${row.label}: ${row.count}`)
    .join(" · ");

  return `
    <div class="order-basket-summary-strip">
      <div class="order-basket-summary-kpis">
        <span class="order-basket-summary-chip kpi emphasis">
          <span class="order-basket-summary-copy">
            <span class="order-basket-summary-eyebrow">Route sheets</span>
            <strong>${escapeHtml(String(summary.totalCount))}</strong>
            <span>in order</span>
          </span>
        </span>
        <span class="order-basket-summary-chip kpi">
          <span class="order-basket-summary-copy">
            <span class="order-basket-summary-eyebrow">QR</span>
            <strong>${escapeHtml(`${summary.qrCount}/${summary.totalCount}`)}</strong>
            <span>linked</span>
          </span>
        </span>
        <span class="order-basket-summary-chip kpi">
          <span class="order-basket-summary-copy">
            <span class="order-basket-summary-eyebrow">Items</span>
            <strong>${escapeHtml(String(summary.itemCount))}</strong>
            <span>${escapeHtml(`main ${summary.mainCount}${summary.reworkCount ? ` · RW ${summary.reworkCount}` : ""}`)}</span>
          </span>
        </span>
      </div>
      ${typeHint ? `<div class="order-basket-summary-meta muted">${escapeHtml(typeHint)}</div>` : ""}
    </div>
  `;
}

function renderOrderPassport(order, baskets, reworkRequests) {
  const basketSummary = buildBasketSummary(baskets);
  const rows = [
    { label: "Status", value: getOrderProgressLabel(order), tone: order.status === "hold" ? "critical" : (order.ready_for_pickup ? "ok" : "") },
    { label: "Station", value: stationStatusLabels[order.status] || order.status },
    { label: "QR", value: baskets.length ? `${basketSummary.qrCount}/${baskets.length}` : "0/0" },
    { label: "Route sheets", value: `${basketSummary.mainCount}${basketSummary.reworkCount ? ` + RW ${basketSummary.reworkCount}` : ""}` },
    { label: "Items", value: String(basketSummary.itemCount || 0) },
    { label: "Approval", value: String(reworkRequests.length), tone: order.has_pending_customer_approval ? "warn" : "" }
  ];

  return `
    <div class="order-passport-grid">
      ${rows.map((row) => `
        <article class="order-passport-card ${row.tone || ""}">
          <span class="order-passport-label">${escapeHtml(row.label)}</span>
          <strong>${escapeHtml(row.value)}</strong>
        </article>
      `).join("")}
    </div>
  `;
}

function renderOrderActionTile({ eyebrow, title, body, tone = "", actions = "" }) {
  return `
    <article class="order-action-card ${tone}">
      <div class="order-action-copy">
        <span class="order-action-eyebrow">${escapeHtml(eyebrow)}</span>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(body)}</p>
      </div>
      ${actions ? `<div class="order-action-actions">${actions}</div>` : ""}
    </article>
  `;
}

function renderOrderActionDeck(order, reworkRequests, options = {}) {
  if (!options.managerView) return "";

  const tiles = [];
  const pendingRequests = reworkRequests.filter((request) => request.request_status === "pending_customer_approval");

  if (order.status === "hold") {
    tiles.push(renderOrderActionTile({
      eyebrow: "Primary action",
      title: "Return order to flow",
      body: "Release the hold when the manager decision is complete and production can continue.",
      tone: "critical",
      actions: `
        <button data-release-hold="${order.id}" data-order-public-id="${escapeHtml(order.public_id)}">Release hold</button>
      `
    }));
  }

  if (pendingRequests.length > 0) {
    tiles.push(renderOrderActionTile({
      eyebrow: "Decision focus",
      title: `Pending approval: ${pendingRequests.length}`,
      body: "The main decision block is on the left: reason, sorting photo, QC photo, and final customer response actions.",
      tone: "warn"
    }));
  }

  if (isAwaitingCleanCloudClose(order)) {
    tiles.push(renderOrderActionTile({
      eyebrow: "External sync",
      title: "Close case in CleanCloud",
      body: "Customer handoff is already confirmed. Check integration health and close the order in the external system.",
      tone: "soft",
      actions: `
        <button class="secondary" data-open-sync-modal>Open integration journal</button>
      `
    }));
  }

  if (!tiles.length) return "";

  return `
    <section class="order-action-deck">
      ${tiles.join("")}
    </section>
  `;
}

function formatExtraDays(value) {
  const days = Number(value);
  if (!Number.isFinite(days) || days <= 0) return "no extra time";
  return `+${days} d`;
}

function buildReworkRequestSummary(request) {
  const itemLabel = request.item_label
    ? `${formatReworkItemLabel(request.item_category)} · ${request.item_label}`
    : formatReworkItemLabel(request.item_category);
  return `${request.source_basket_code || "Route sheet"} -> ${itemLabel}`;
}

function renderBasketReworkFlags(basket, basketsById = new Map()) {
  if (String(basket?.basket_kind || "main") !== "rework") return "";
  const sourceCode = basketsById.get(basket.parent_basket_id)?.basket_code || "Source not specified";
  const reasonLabel = formatReworkReasonLabel(basket.rework_reason);
  const attempt = Number(basket.rework_attempt || 0) || 1;

  return `
    <div class="order-basket-rework-flags">
      <span class="order-basket-flag">${escapeHtml(`Reason: ${reasonLabel}`)}</span>
      <span class="order-basket-flag">${escapeHtml(`Attempt: ${attempt}`)}</span>
      <span class="order-basket-flag">${escapeHtml(`From route sheet: ${sourceCode}`)}</span>
    </div>
  `;
}

function renderBasketCard(basket, basketsById = new Map()) {
  const isRework = String(basket.basket_kind || "main") === "rework";
  const stationLabel = stationStatusLabels[basket.station] || basket.station;
  const toneClass = getColorToneClass(inferColorFromBasketType(basket.basket_type));
  const kindLabel = isRework ? "Rework" : "Main";
  const cardTitle = isRework ? `${basket.basket_code} · REWORK` : basket.basket_code;
  const visualTitle = isRework
    ? `RW: ${normalizeBasketTypeLabel(basket.basket_type)}`
    : (String(basket.basket_type || "").trim() || "Route sheet");
  const metaMarkup = isRework
    ? renderBasketReworkFlags(basket, basketsById)
    : renderBasketReworkMeta(basket, basketsById);
  const itemsTotal = getRowItemsTotal(basket);
  const photosCount = Array.isArray(basket.images) ? basket.images.length : 0;

  return `
    <details class="order-detail-row order-basket-card order-basket-card-collapsible">
      <summary class="order-basket-card-summary">
        <strong>${escapeHtml(cardTitle)}</strong>
        <div class="order-basket-tags">
          <span class="pill ${isRework ? "warn" : ""}">${escapeHtml(kindLabel)}</span>
          <span class="pill">${escapeHtml(stationLabel)}</span>
          <span class="pill">${escapeHtml(String(itemsTotal))} pcs</span>
        </div>
      </summary>
      <div class="order-basket-card-body">
        <div class="order-basket-visual ${toneClass}">
          <img
            class="order-basket-image"
            src="${escapeHtml(getPreviewBasketImageByType(basket.basket_type, basket.basket_kind))}"
            alt="${escapeHtml(basket.basket_type || basket.basket_code)}"
            loading="lazy"
          />
          <div class="order-basket-visual-meta">
            <strong>${escapeHtml(visualTitle)}</strong>
            <div class="muted">${escapeHtml(`Photo: ${photosCount}`)}</div>
            ${metaMarkup}
          </div>
        </div>
        ${renderBasketItemsSummary(basket)}
        ${renderBasketImageStrip(basket.images)}
        <code>${escapeHtml(basket.qr_code)}</code>
      </div>
    </details>
  `;
}

function renderBasketSection(baskets, basketsById = new Map(), options = {}) {
  const title = options.title || "Route sheets and QR";
  const note = String(options.note || "").trim();
  const hideBasketCards = Boolean(options.hideBasketCards);

  return `
    <section class="order-modal-section ${options.wide ? "order-modal-section-wide" : ""}">
      <div class="order-modal-section-head">
        <div>${note ? `<strong>${escapeHtml(title)}</strong><div class="muted">${escapeHtml(note)}</div>` : `<strong>${escapeHtml(title)}</strong>`}</div>
        <span class="pill">${baskets.length}</span>
      </div>
      ${renderBasketSummaryStrip(baskets)}
      ${
        hideBasketCards
          ? ""
          : `
            <div class="order-detail-list order-modal-list">
              ${
                baskets.length
                  ? baskets.map((basket) => renderBasketCard(basket, basketsById)).join("")
                  : renderOrderDetailEmpty("Route sheets will appear after sorting.")
              }
            </div>
          `
      }
    </section>
  `;
}

function renderOrderModalAlert({ tone = "", title, body, actions = "" }) {
  return `
    <article class="order-modal-alert ${tone}">
      <div class="order-modal-alert-copy">
        <strong>${escapeHtml(title)}</strong>
        <span class="muted">${escapeHtml(body)}</span>
      </div>
      ${actions ? `<div class="order-modal-alert-actions">${actions}</div>` : ""}
    </article>
  `;
}

function getPendingApprovalRequests(reworkRequests) {
  return toArray(reworkRequests).filter((request) => request.request_status === "pending_customer_approval");
}

function renderOrderModalAlerts(order, reworkRequests, options = {}) {
  const alerts = [];
  const pendingRequests = getPendingApprovalRequests(reworkRequests).length;

  if (order.status === "hold") {
    alerts.push(renderOrderModalAlert({
      tone: "critical",
      title: "Order is on HOLD",
      body: "QC stopped this order. A manager must make a decision and return it to flow.",
      actions: options.managerView
        ? `<button data-release-hold="${order.id}" data-order-public-id="${escapeHtml(order.public_id)}">Release hold</button>`
        : ""
    }));
  }

  if (pendingRequests > 0) {
    alerts.push(renderOrderModalAlert({
      tone: "warn",
      title: "Cases require approval",
      body: `Waiting for additional treatment decisions: ${pendingRequests}. The decision block is shown first in the main column.`
    }));
  }

  if (isAwaitingCleanCloudClose(order)) {
    alerts.push(renderOrderModalAlert({
      tone: "warn",
      title: "Customer handoff completed",
      body: "The order has been handed to the customer, but is not closed in the external system yet.",
      actions: options.managerView
        ? `<button class="secondary" data-open-sync-modal>Open CleanCloud journal</button>`
        : ""
    }));
  }

  return alerts.join("");
}

function buildTimelineDefinitions(order, baskets, reworkRequests, latestScans) {
  const pendingRequests = reworkRequests.filter((request) => request.request_status === "pending_customer_approval").length;
  const approvedReworkRequests = reworkRequests.filter((request) => request.request_status === "approved").length;
  const hasApproval = pendingRequests > 0 || order.status === "customer_approval";
  const hasRework = approvedReworkRequests > 0
    || order.status === "rework"
    || baskets.some((basket) => String(basket.basket_kind || "main") === "rework");

  const definitions = [
    {
      key: "sorting",
      label: "Sorting",
      summary: baskets.length ? `Route sheets created: ${baskets.length}` : "Waiting for route sheet split.",
      meta: baskets[0]?.created_at ? `Started: ${formatOrderUpdatedAt(baskets[0].created_at)}` : "Not started yet"
    },
    {
      key: "washing",
      label: "Washing",
      summary: shortenText(latestScans.get("washing")?.message || (order.status === "sorted"
        ? "Route sheets are ready to start washing."
        : "Main production washing cycle.")),
      meta: latestScans.get("washing")
        ? `${latestScans.get("washing").actor} · ${formatOrderUpdatedAt(latestScans.get("washing").created_at)}`
        : "No recent station scan"
    },
    {
      key: "drying",
      label: "Drying",
      summary: shortenText(latestScans.get("drying")?.message || "Drying after washing before QC."),
      meta: latestScans.get("drying")
        ? `${latestScans.get("drying").actor} · ${formatOrderUpdatedAt(latestScans.get("drying").created_at)}`
        : "No recent drying scan"
    },
    {
      key: "qc",
      label: "QC",
      summary: order.status === "hold"
        ? "QC stopped the order until a manager decision."
        : (pendingRequests > 0
          ? `Waiting for additional treatment decisions: ${pendingRequests}.`
          : shortenText(latestScans.get("qc")?.message || "Quality check after drying.")),
      meta: latestScans.get("qc")
        ? `${latestScans.get("qc").actor} · ${formatOrderUpdatedAt(latestScans.get("qc").created_at)}`
        : "No recent QC scan"
    },
    hasApproval
      ? {
          key: "customer_approval",
          label: "Approval",
          summary: pendingRequests > 0
            ? `Waiting for customer response on extra treatment: ${pendingRequests}.`
            : "Approval case is prepared for the manager.",
          meta: latestScans.get("customer_approval")
            ? `${latestScans.get("customer_approval").actor} · ${formatOrderUpdatedAt(latestScans.get("customer_approval").created_at)}`
            : "Manager is contacting the customer"
        }
      : null,
    hasRework
      ? {
          key: "rework",
          label: "Rework",
          summary: `Rework cases: ${Math.max(approvedReworkRequests, baskets.filter((basket) => String(basket.basket_kind || "main") === "rework").length, reworkRequests.length || 1)}.`,
          meta: latestScans.get("rework")
            ? `${latestScans.get("rework").actor} · ${formatOrderUpdatedAt(latestScans.get("rework").created_at)}`
            : "Separate repeat cycle"
        }
      : null,
    {
      key: "ironing",
      label: "Ironing",
      summary: shortenText(latestScans.get("ironing")?.message || "Final preparation before handoff."),
      meta: latestScans.get("ironing")
        ? `${latestScans.get("ironing").actor} · ${formatOrderUpdatedAt(latestScans.get("ironing").created_at)}`
        : "No recent ironing scan"
    },
    {
      key: "pickup",
      label: "Dispatch",
      summary: isAwaitingCleanCloudClose(order)
        ? "Customer handoff is confirmed. Finalization in CleanCloud is required."
        : (order.ready_for_pickup
          ? "Order is placed in a storage location and ready for customer handoff."
          : (order.ready_to_place
            ? "Order is assembled. BIN -> LOC placement is required."
            : shortenText(latestScans.get("pickup")?.message || "Waiting for full dispatch assembly."))),
      meta: order.ready_for_pickup
        ? "Placed"
        : (latestScans.get("pickup")
          ? `${latestScans.get("pickup").actor} · ${formatOrderUpdatedAt(latestScans.get("pickup").created_at)}`
          : order.cleancloud_status || "No dispatch yet")
    }
  ];

  return definitions.filter(Boolean);
}

function renderOrderTimeline(order, baskets, scans, reworkRequests) {
  const latestScans = getLatestScansByStation(scans);
  const definitions = buildTimelineDefinitions(order, baskets, reworkRequests, latestScans);
  const activeStage = normalizeManagerActiveStage(order);
  const activeIndex = Math.max(0, definitions.findIndex((item) => item.key === activeStage));
  const currentStage = definitions[activeIndex] || definitions[0] || null;

  function getStageTone(stage, index) {
    let tone = "pending";
    if (index < activeIndex) {
      tone = "complete";
    } else if (index === activeIndex) {
      tone = "active";
    }

    if (stage.key === "qc" && order.status === "hold") tone = "attention";
    if (stage.key === "customer_approval" && order.status === "customer_approval") tone = "attention";
    if (stage.key === "rework" && order.status === "rework") tone = "attention";
    if (stage.key === "pickup" && isAwaitingCleanCloudClose(order)) tone = "attention";
    if (stage.key === "pickup" && order.ready_for_pickup) tone = "active";
    return tone;
  }

  function getStageStatusLabel(tone) {
    if (tone === "complete") return "done";
    if (tone === "attention") return "attention";
    if (tone === "active") return "now";
    return "next";
  }

  const compactRows = definitions
    .map((stage, index) => ({ stage, tone: getStageTone(stage, index), index }))
    .filter((row) => row.index !== activeIndex)
    .map((row) => `
      <div class="order-timeline-mini-row ${row.tone}">
        <span>${escapeHtml(row.stage.label)}</span>
        <span class="pill ${row.tone === "complete" ? "ok" : (row.tone === "attention" ? "warn" : "")}">
          ${escapeHtml(getStageStatusLabel(row.tone))}
        </span>
      </div>
    `)
    .join("");
  const currentTone = currentStage ? getStageTone(currentStage, activeIndex) : "pending";
  const currentLabel = getStageStatusLabel(currentTone);

  return `
    <section class="order-modal-section order-modal-section-timeline">
      <div class="order-modal-section-head">
        <strong>Current stage</strong>
        <span class="pill">${definitions.length}</span>
      </div>
      <div class="order-timeline">
        ${
          currentStage
            ? `
              <article class="order-timeline-focus ${currentTone}">
                <div class="order-timeline-focus-head">
                  <strong>${escapeHtml(currentStage.label)}</strong>
                  <span class="pill ${currentTone === "complete" ? "ok" : (currentTone === "attention" ? "warn" : "")}">
                    ${escapeHtml(currentLabel)}
                  </span>
                </div>
                <p>${escapeHtml(currentStage.summary)}</p>
              </article>
            `
            : '<article class="order-detail-row"><span class="muted">Route data is not available yet.</span></article>'
        }
        ${
          compactRows
            ? `
              <details class="order-timeline-more">
                <summary>Full route</summary>
                <div class="order-timeline-mini-list">${compactRows}</div>
              </details>
            `
            : ""
        }
      </div>
    </section>
  `;
}

function collectOrderMedia(baskets, reworkRequests, options = {}) {
  const seen = new Set();
  const media = [];
  const includeRequestEvidence = options.includeRequestEvidence !== false;

  function push(entry) {
    const url = String(entry?.url || "").trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    media.push({
      url,
      title: entry.title || "Photo",
      badge: entry.badge || "Media",
      note: entry.note || ""
    });
  }

  for (const basket of toArray(baskets)) {
    for (const image of toArray(basket.images)) {
      push({
        url: image.public_url || image.dataUrl,
        title: image.note || basket.basket_code,
        badge: basket.basket_code,
        note: `${basket.basket_type || "Basket"} · ${image.role === "issue" ? "issue" : "basket"}`
      });
    }
  }

  if (includeRequestEvidence) {
    for (const request of toArray(reworkRequests)) {
      const requestSummary = buildReworkRequestSummary(request);
      push({
        url: request.source_image_url,
        title: requestSummary,
        badge: "Sorting",
        note: request.source_image_note || "Original issue"
      });
      push({
        url: request.qc_photo_url,
        title: requestSummary,
        badge: "QC",
        note: "QC issue confirmation"
      });
    }
  }

  return media;
}

function renderOrderMediaGallery(baskets, reworkRequests, options = {}) {
  const media = collectOrderMedia(baskets, reworkRequests, options);
  if (!media.length) return "";
  const title = options.title || "Order photos";

  return renderModalCollapsibleSection({
    title,
    count: media.length,
    body: `
      <div class="order-media-grid">
        ${media.map((item) => `
          <figure class="order-media-card">
            <img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.title)}" loading="lazy" />
            <figcaption>
              <span class="order-media-badge">${escapeHtml(item.badge)}</span>
              <strong>${escapeHtml(shortenText(item.title, 56))}</strong>
            </figcaption>
          </figure>
        `).join("")}
      </div>
    `
  });
}

function renderManagerApprovalWorkbench(order, reworkRequests) {
  const pendingRequests = getPendingApprovalRequests(reworkRequests);

  if (!pendingRequests.length) {
    return "";
  }

  return `
    <section class="order-modal-section order-modal-section-wide order-approval-workbench" data-order-modal-anchor="approval">
      <div class="order-modal-section-head">
        <div>
          <strong>What must be resolved now</strong>
          <div class="muted">One focused block for the customer call: reason, evidence, and final decision without searching across sections.</div>
        </div>
        <span class="pill warn">${pendingRequests.length}</span>
      </div>
      <div class="order-approval-list">
        ${pendingRequests.map((request) => {
          const requestSummary = buildReworkRequestSummary(request);
          const requestStatus = formatReworkRequestStatus(request.request_status);
          const sourceBasket = request.source_basket_code || "Basket";
          const itemLabel = request.item_label
            ? `${formatReworkItemLabel(request.item_category)} · ${request.item_label}`
            : formatReworkItemLabel(request.item_category);
          return `
            <article class="order-approval-card">
              <div class="order-approval-top">
                <div class="order-approval-copy">
                  <span class="order-action-eyebrow">Approval case</span>
                  <strong>${escapeHtml(requestSummary)}</strong>
                  <p>${escapeHtml(`Source route sheet ${sourceBasket} is now waiting for customer decision and must not continue through the flow.`)}</p>
                </div>
                <div class="order-approval-pills">
                  <span class="pill warn">${escapeHtml(requestStatus)}</span>
                  <span class="pill">${escapeHtml(stationStatusLabels[order.status] || order.status)}</span>
                </div>
              </div>
              <div class="order-approval-grid">
                <div class="order-approval-evidence">
                  ${renderReworkEvidencePair(request)}
                </div>
                <div class="order-approval-summary">
                  <div class="order-approval-stat">
                    <span class="order-passport-label">Issue item</span>
                    <strong>${escapeHtml(itemLabel)}</strong>
                  </div>
                  <div class="order-approval-stat">
                    <span class="order-passport-label">Reason</span>
                    <strong>${escapeHtml(formatReworkReasonLabel(request.reason_code))}</strong>
                  </div>
                  <div class="order-approval-stat">
                    <span class="order-passport-label">Offer</span>
                    <strong>${escapeHtml(`${request.service_label} · ${formatExtraDays(request.extra_days)}`)}</strong>
                  </div>
                  <div class="order-approval-stat">
                    <span class="order-passport-label">Created by</span>
                    <strong>${escapeHtml(`${request.requested_by} · ${formatOrderUpdatedAt(request.requested_at) || "—"}`)}</strong>
                  </div>
                  ${
                    request.source_image_note
                      ? `
                        <div class="order-approval-stat">
                          <span class="order-passport-label">Sorting note</span>
                          <strong>${escapeHtml(request.source_image_note)}</strong>
                        </div>
                      `
                      : ""
                  }
                  <div class="order-approval-actions">
                    <button
                      data-approve-rework-request="${request.id}"
                      data-order-public-id="${escapeHtml(order.public_id)}"
                      data-request-summary="${escapeHtml(requestSummary)}"
                    >
                      Customer approved
                    </button>
                    <button
                      class="secondary"
                      data-decline-rework-request="${request.id}"
                      data-order-public-id="${escapeHtml(order.public_id)}"
                      data-request-summary="${escapeHtml(requestSummary)}"
                    >
                      Customer declined
                    </button>
                  </div>
                </div>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderManagerReworkSection(order, reworkRequests, options = {}) {
  const allRows = toArray(reworkRequests);
  const rows = options.managerView
    ? allRows.filter((request) => request.request_status !== "pending_customer_approval")
    : allRows;
  if (!rows.length) return "";
  const title = options.managerView ? "Decision and rework history" : "Approval and rework";
  const countTone = options.managerView ? "" : (order.has_pending_customer_approval ? "warn" : "");

  return renderModalCollapsibleSection({
    title,
    count: rows.length,
    countClass: countTone,
    body: `
      <div class="order-detail-list order-modal-list">
        ${
          rows.map((request) => {
            const status = String(request.request_status || "");
            const toneClass = status === "approved" ? "ok" : (status === "declined" ? "error" : "warn");
            const requestSummary = buildReworkRequestSummary(request);
            return `
              <article class="order-detail-row">
                <div class="order-detail-row-top">
                  <strong>${escapeHtml(requestSummary)}</strong>
                  <span class="pill ${toneClass}">${escapeHtml(formatReworkRequestStatus(status))}</span>
                </div>
                <div class="muted">${escapeHtml(`${formatReworkReasonLabel(request.reason_code)} · ${request.service_label} · ${formatExtraDays(request.extra_days)}`)}</div>
                ${
                  request.decision_note
                    ? `<div class="muted">${escapeHtml(`Decision: ${request.decision_note}`)}</div>`
                    : ""
                }
                ${renderReworkEvidencePair(request)}
              </article>
            `;
          }).join("")
        }
      </div>
    `
  });
}

function renderOrderEventsSection(scans) {
  if (!scans.length) return "";
  const recent = scans.slice(0, 3);
  const hiddenCount = Math.max(0, scans.length - recent.length);

  return renderModalCollapsibleSection({
    title: "Recent events",
    count: scans.length,
    body: `
      <div class="order-event-stream">
        ${recent.map((scan) => `
          <article class="order-event-card">
            <div class="order-event-head">
              <strong>${escapeHtml(stationStatusLabels[scan.station] || scan.station)}</strong>
              <span class="pill ${scan.result === "ok" ? "ok" : "error"}">${escapeHtml(scan.result)}</span>
            </div>
            <div class="order-event-meta">${escapeHtml(`${scan.actor} · ${formatOrderUpdatedAt(scan.created_at) || "—"}`)}</div>
            <p>${escapeHtml(shortenText(scan.message || "No message provided.", 88))}</p>
          </article>
        `).join("")}
        ${hiddenCount > 0 ? `<div class="muted">More events: ${hiddenCount}</div>` : ""}
      </div>
    `
  });
}

function formatArchiveMachineEntry(machine) {
  const code = String(machine?.machine_code || "").trim();
  const displayName = String(machine?.display_name || "").trim();
  if (displayName) return displayName;
  if (code) return code;
  return "";
}

function renderArchiveMachineLine(label, rows) {
  const entries = toArray(rows).map(formatArchiveMachineEntry).filter(Boolean);
  if (!entries.length) return "";
  return `<div class="muted">${escapeHtml(`${label}: ${entries.join(", ")}`)}</div>`;
}

function findOrderIssuedAt(scans) {
  const rows = toArray(scans);

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

function renderArchiveSummarySection(order, scans) {
  const createdAt = formatOrderUpdatedAt(order.created_at) || "—";
  const issuedAt = formatOrderUpdatedAt(findOrderIssuedAt(scans) || order.updated_at) || "—";
  const machineUsage = order?.machine_usage && typeof order.machine_usage === "object"
    ? order.machine_usage
    : {};

  const machineLines = [
    renderArchiveMachineLine("Washing", machineUsage.washing),
    renderArchiveMachineLine("Drying", machineUsage.drying)
  ];

  const otherMachines = toArray(machineUsage.other)
    .map((entry) => {
      const machineLabel = formatArchiveMachineEntry(entry);
      if (!machineLabel) return "";
      const station = String(entry?.station || "").trim();
      if (!station) return machineLabel;
      const stationLabel = stationStatusLabels[station] || station;
      return `${stationLabel}: ${machineLabel}`;
    })
    .filter(Boolean);

  if (otherMachines.length) {
    machineLines.push(`<div class="muted">${escapeHtml(`Other: ${otherMachines.join(", ")}`)}</div>`);
  }

  const hasMachineLines = machineLines.some(Boolean);

  return `
    <section class="order-modal-section order-modal-section-wide">
      <div class="order-modal-section-head">
        <strong>Order archive</strong>
      </div>
      <div class="order-detail-list order-modal-list">
        <article class="order-detail-row">
          <div class="order-detail-row-top">
            <strong>Created at</strong>
            <span class="pill">${escapeHtml(createdAt)}</span>
          </div>
        </article>
        <article class="order-detail-row">
          <div class="order-detail-row-top">
            <strong>Issued at</strong>
            <span class="pill">${escapeHtml(issuedAt)}</span>
          </div>
        </article>
        <article class="order-detail-row">
          <div class="order-detail-row-top">
            <strong>Machines by operation</strong>
          </div>
          ${
            hasMachineLines
              ? machineLines.filter(Boolean).join("")
              : '<div class="muted">No machine data recorded for this order.</div>'
          }
        </article>
      </div>
    </section>
  `;
}

export function renderManagerActionModal(dialog, pending = false) {
  if (!dialog) return "";

  const confirmClass = dialog.tone === "critical" ? "warn" : "";
  const toneLabel = String(dialog.eyebrow || "").trim() || (dialog.tone === "critical"
    ? "Manager decision"
    : (dialog.tone === "warn" ? "Customer confirmation" : "Confirmation"));

  return `
    <section class="manager-sync-modal manager-action-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(dialog.title || "Confirm action")}">
      <div class="manager-sync-modal-backdrop" data-close-manager-action></div>
      <article class="manager-sync-modal-sheet manager-ready-order-sheet manager-action-sheet">
        <header class="manager-sync-modal-head manager-ready-order-head manager-action-head">
          <div class="manager-ready-order-head-main">
            <div class="eyebrow">${escapeHtml(toneLabel)}</div>
            <h3>${escapeHtml(dialog.title || "Confirm action")}</h3>
            ${dialog.orderPublicId ? `<div class="pill">${escapeHtml(dialog.orderPublicId)}</div>` : ""}
          </div>
        </header>
        <div class="manager-action-body">
          ${dialog.body ? `<p class="manager-action-summary">${escapeHtml(dialog.body)}</p>` : ""}
        </div>
        <footer class="manager-ready-order-footer manager-action-footer">
          <div class="manager-ready-order-actions manager-action-actions">
            <button class="secondary" data-close-manager-action ${pending ? "disabled" : ""}>Cancel</button>
            <button class="${confirmClass}" data-confirm-manager-action ${pending ? "disabled" : ""}>
              ${escapeHtml(pending ? "Saving..." : (dialog.confirmLabel || "Confirm"))}
            </button>
          </div>
        </footer>
      </article>
    </section>
  `;
}

function renderOrderModalFooter(order, options = {}) {
  const managerView = Boolean(options.managerView);
  const actions = [];

  if (managerView && order.status === "pickup" && order.ready_for_pickup) {
    actions.push(`
      <button data-complete-pickup-order="${order.id}" data-order-public-id="${escapeHtml(order.public_id)}">
        Confirm handoff
      </button>
    `);
  }

  if (managerView && order.status === "hold") {
    actions.push(`
      <button data-release-hold="${order.id}" data-order-public-id="${escapeHtml(order.public_id)}">
        Release hold
      </button>
    `);
  }

  if (managerView && isAwaitingCleanCloudClose(order)) {
    actions.push('<button class="secondary" data-open-sync-modal>CleanCloud journal</button>');
  }

  if (!managerView) {
    actions.push('<button class="secondary" data-order-modal-close>Close</button>');
  }

  if (!actions.length) {
    return "";
  }

  return `
    <footer class="order-modal-footer workflow-modal-footer">
      <div class="workflow-modal-actions order-modal-footer-actions">
        ${actions.join("")}
      </div>
    </footer>
  `;
}

export function renderOrderDetailsModal(order, options = {}) {
  if (!order) return "";

  const managerView = Boolean(options.managerView);
  const issuedOrder = isIssuedOrder(order);
  const phone = formatOrderPhone(order.customer_phone);
  const titleLine = [order.public_id, order.customer_name].filter((value) => String(value || "").trim()).join(" · ");
  const baskets = toArray(order.baskets);
  const scans = toArray(order.scans);
  const reworkRequests = toArray(order.rework_requests);
  const pendingApprovalRequests = getPendingApprovalRequests(reworkRequests);
  const hasPendingApproval = managerView && pendingApprovalRequests.length > 0;
  const progressLabel = getOrderProgressLabel(order);
  const basketsById = new Map(baskets.map((basket) => [basket.id, basket]));
  const pendingActionsCount = reworkRequests.filter((request) => request.request_status === "pending_customer_approval").length;
  const quickActionsMarkup = renderOrderActionDeck(order, reworkRequests, { managerView });
  const openQuickActions = pendingActionsCount > 0 || order.status === "hold";
  const approvalWorkbench = managerView ? renderManagerApprovalWorkbench(order, reworkRequests) : "";
  const managerSections = [];
  const mediaSection = renderOrderMediaGallery(baskets, reworkRequests, managerView
    ? {
        includeRequestEvidence: false,
        title: "Order photos"
      }
    : {});
  const reworkSection = renderManagerReworkSection(order, reworkRequests, { managerView });
  const archiveSection = managerView && issuedOrder ? renderArchiveSummarySection(order, scans) : "";
  const eventSection = managerView && issuedOrder ? "" : renderOrderEventsSection(scans);
  const hasQuickActionsPanel = Boolean(quickActionsMarkup);

  if (hasPendingApproval && approvalWorkbench) {
    managerSections.push(approvalWorkbench);
  }
  if (!issuedOrder) {
    managerSections.push(renderOrderTimeline(order, baskets, scans, reworkRequests));
  }
  managerSections.push(renderBasketSection(baskets, basketsById, { wide: true, hideBasketCards: managerView && issuedOrder }));
  if (!hasPendingApproval && approvalWorkbench) {
    managerSections.push(approvalWorkbench);
  }
  if (mediaSection) managerSections.push(mediaSection);
  if (reworkSection) managerSections.push(reworkSection);
  if (archiveSection) managerSections.push(archiveSection);
  if (eventSection) managerSections.push(eventSection);

  return `
    <section class="order-modal" role="dialog" aria-modal="true">
      <div class="order-modal-backdrop" data-order-modal-close></div>
      <article class="order-modal-sheet ${managerView ? "manager-order-modal" : ""}">
        <header class="order-modal-head workflow-modal-header">
          <div class="order-modal-head-main workflow-modal-header-main">
            <div class="eyebrow">${managerView ? "Manager case" : "Order details"}</div>
            <h2>${escapeHtml(titleLine)}</h2>
            ${phone ? `<div class="muted">${escapeHtml(phone)}</div>` : ""}
          </div>
          <div class="workflow-modal-actions order-modal-header-actions">
            ${
              hasPendingApproval
                ? `<button class="order-modal-focus-action" data-scroll-order-section="approval">Go to decision (${pendingApprovalRequests.length})</button>`
                : ""
            }
            <button class="secondary order-modal-close" data-order-modal-close>Close</button>
          </div>
        </header>

        <div class="order-modal-content">
          <div class="order-case-layout">
            <div class="order-case-main">
              <div class="order-modal-grid manager-order-modal-grid">
                ${managerSections.filter(Boolean).join("")}
              </div>
            </div>
            <aside class="order-case-rail">
              <details class="sorting-preview order-case-rail-panel order-rail-collapsible">
                <summary class="sorting-config-header order-rail-summary">
                  <strong>Passport</strong>
                  <span class="pill">${escapeHtml(progressLabel)}</span>
                </summary>
                <div class="order-rail-body">
                  ${renderOrderModalAlerts(order, reworkRequests, { managerView })}
                  ${renderOrderPassport(order, baskets, reworkRequests)}
                </div>
              </details>
              ${
                hasQuickActionsPanel
                  ? `
                    <details class="sorting-preview order-case-rail-panel order-rail-collapsible" ${openQuickActions ? "open" : ""}>
                      <summary class="sorting-config-header order-rail-summary">
                        <strong>Quick actions</strong>
                        <span class="pill">${pendingActionsCount}</span>
                      </summary>
                      <div class="order-rail-body">
                        ${quickActionsMarkup}
                      </div>
                    </details>
                  `
                  : ""
              }
            </aside>
          </div>
        </div>
        ${renderOrderModalFooter(order, { managerView })}
      </article>
    </section>
  `;
}
