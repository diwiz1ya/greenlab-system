import { buildRouteSheetQr } from "../route-sheets.js";
import { escapeHtml } from "../utils.js";

const sortingColorOptions = [
  { value: "mixed", label: "Mixed" },
  { value: "white", label: "White" },
  { value: "color", label: "Colored" },
  { value: "dark", label: "Dark" },
  { value: "delicate", label: "Delicate" }
];

const colorLabels = Object.fromEntries(sortingColorOptions.map((item) => [item.value, item.label]));
const sortingItemFields = [
  { key: "top", label: "Top", unit: "pcs" },
  { key: "bottom", label: "Bottom", unit: "pcs" },
  { key: "underwear", label: "Underwear", unit: "pcs" },
  { key: "socksPairs", label: "Socks", unit: "pcs" }
];
const sortingPhotoRoleLabels = {
  overview: "Overview photo",
  issue: "Issue item"
};
const sortingMaxOverviewPhotos = 1;
const sortingMaxIssuePhotos = 10;

function renderCameraGlyph() {
  return `
    <svg viewBox="0 0 24 24" class="sorting-camera-glyph" aria-hidden="true" focusable="false">
      <path d="M8.5 5.5h7l1.2 2H20a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2h3.3l1.2-2zM12 17.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0-2a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
    </svg>
  `;
}

function formatOrderWeight(weight) {
  const value = Number(weight);
  if (!Number.isFinite(value) || value <= 0) {
    return "—";
  }
  return `${value.toFixed(2)} kg`;
}

function formatOrderPhone(phone) {
  const text = String(phone || "").trim();
  return text || "—";
}

function normalizeItemCount(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }
  return Math.min(parsed, 999);
}

function getRowItemCounts(row) {
  const source = row && typeof row === "object" ? row : {};
  const rawCounts = source.itemCounts || source.item_counts || {};
  return {
    top: normalizeItemCount(rawCounts.top),
    bottom: normalizeItemCount(rawCounts.bottom),
    underwear: normalizeItemCount(rawCounts.underwear),
    socksPairs: normalizeItemCount(rawCounts.socksPairs ?? rawCounts.socks_pairs)
  };
}

function getRowItemsTotal(row) {
  const counts = getRowItemCounts(row);
  return counts.top + counts.bottom + counts.underwear + counts.socksPairs;
}

function getRowsItemsTotals(rows) {
  return rows.reduce((acc, row) => {
    const counts = getRowItemCounts(row);
    acc.total += counts.top + counts.bottom + counts.underwear + counts.socksPairs;
    acc.socksPairs += counts.socksPairs;
    return acc;
  }, { total: 0, socksPairs: 0 });
}

function getRowsPhotosTotal(rows) {
  return rows.reduce((total, row) => {
    const photos = Array.isArray(row?.photos) ? row.photos : [];
    return total + photos.length;
  }, 0);
}

function normalizeBasketQr(value) {
  return String(value || "").trim();
}

function getBasketQrPreview(orderPublicId, row, index) {
  const scanned = normalizeBasketQr(row?.scannedQr);
  if (scanned) return scanned;
  return buildRouteSheetQr(orderPublicId || "NEW", index);
}

function makeBasketLabel(row, index) {
  const color = colorLabels[row?.color] || colorLabels.mixed;
  return `${color} #${index + 1}`;
}

function getColorToneClass(color) {
  const value = String(color || "");
  if (value === "white") return "tone-white";
  if (value === "color") return "tone-color";
  if (value === "dark") return "tone-dark";
  if (value === "delicate") return "tone-delicate";
  return "tone-mixed";
}

function getPreviewBasketImageByColor(color) {
  const value = String(color || "mixed");
  if (value === "white") return "/images/baskets/white.png";
  if (value === "color") return "/images/baskets/color.png";
  if (value === "dark") return "/images/baskets/dark.png";
  if (value === "delicate") return "/images/baskets/delicate.png";
  return "/images/baskets/mixed.png";
}

function formatPrintedAtPreview(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderSortingQueue(orders, activeOrderId) {
  return orders
    .map(
      (order) => `
        <button
          class="sorting-order-item ${order.id === activeOrderId ? "active" : ""}"
          data-select-sorting-order="${order.id}"
          data-order-public-id="${escapeHtml(order.public_id)}"
          data-order-customer-name="${escapeHtml(order.customer_name)}"
          data-order-weight="${order.order_weight ?? ""}"
          data-order-phone="${escapeHtml(order.customer_phone || "")}"
          type="button"
        >
          <div class="sorting-order-head">
            <strong>${escapeHtml(order.public_id)}</strong>
          </div>
          <div class="muted">${escapeHtml(order.customer_name)}</div>
          <div class="muted">Weight: ${escapeHtml(formatOrderWeight(order.order_weight))} · Phone: ${escapeHtml(formatOrderPhone(order.customer_phone))}</div>
          <div class="sorting-order-foot">
            <span class="sorting-order-chevron">Open</span>
          </div>
        </button>
      `
    )
    .join("");
}

function renderSortedWaitingQueue(orders) {
  return orders
    .map(
      (order) => `
        <article class="sorting-order-item sorting-order-item-compact">
          <div class="sorting-order-head">
            <strong>${escapeHtml(order.public_id)}</strong>
          </div>
          <div class="muted">${escapeHtml(order.customer_name || "Customer not specified")}</div>
          <div class="muted">Phone: ${escapeHtml(formatOrderPhone(order.customer_phone))}</div>
          <div class="sorting-order-foot">
            <div class="sorting-order-actions">
              <button type="button" class="secondary" data-open-order="${order.id}">View</button>
              <button
                type="button"
                class="secondary"
                data-edit-sorted-baskets="${order.id}"
                data-order-public-id="${escapeHtml(order.public_id)}"
                data-order-customer-name="${escapeHtml(order.customer_name)}"
              >
                Edit
              </button>
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

function renderSortingScanSetup(orderId, rows, draft = {}) {
  void draft;
  const count = Math.max(1, rows.length || 0);
  return `
    <section class="sorting-step-panel">
      <div class="sorting-basket-head">
        <strong>Route sheets for this order</strong>
      </div>
      <p class="muted">Choose how many route sheets this order needs. QR codes will be generated automatically and printed on the next step.</p>
      ${renderSortingCountControl(orderId, count)}
      <div class="sorting-step-actions">
        <button type="button" data-sorting-step-next="${orderId}" data-sorting-step-next-mode="fill">Continue</button>
      </div>
    </section>
  `;
}

function renderSortingCountControl(orderId, count) {
  return `
    <section class="sorting-count">
      <span class="sorting-group-title">Route sheets</span>
      <div class="sorting-count-main">
        <button type="button" class="secondary sorting-count-btn" data-sorting-count-dec="${orderId}" tabindex="-1">−</button>
        <strong class="sorting-count-value">${count}</strong>
        <button type="button" class="secondary sorting-count-btn" data-sorting-count-inc="${orderId}">+</button>
      </div>
      <div class="sorting-count-presets">
        <button type="button" class="ghost sorting-count-chip ${count === 1 ? "active" : ""}" data-sorting-count-set="${orderId}" data-count-value="1">1</button>
        <button type="button" class="ghost sorting-count-chip ${count === 2 ? "active" : ""}" data-sorting-count-set="${orderId}" data-count-value="2">2</button>
        <button type="button" class="ghost sorting-count-chip ${count === 3 ? "active" : ""}" data-sorting-count-set="${orderId}" data-count-value="3">3</button>
        <button type="button" class="ghost sorting-count-chip ${count === 4 ? "active" : ""}" data-sorting-count-set="${orderId}" data-count-value="4">4</button>
        <button type="button" class="ghost sorting-count-chip ${count === 5 ? "active" : ""}" data-sorting-count-set="${orderId}" data-count-value="5">5</button>
      </div>
    </section>
  `;
}

function renderSortingItemInputs(orderId, rowIndex, counts) {
  return `
    <div class="sorting-items-grid">
      ${sortingItemFields.map((field) => `
        <label class="sorting-item-field ${field.key === "socksPairs" ? "is-socks" : ""}">
          <span>${escapeHtml(field.label)}</span>
          <div class="sorting-item-control">
            <button
              type="button"
              class="secondary sorting-item-step"
              data-sorting-items-step="${orderId}"
              data-row-index="${rowIndex}"
              data-item-key="${field.key}"
              data-step="-1"
            >
              −
            </button>
            <input
              type="number"
              min="0"
              max="999"
              inputmode="numeric"
              value="${counts[field.key]}"
              class="sorting-item-input"
              data-sorting-items-input="${orderId}"
              data-row-index="${rowIndex}"
              data-item-key="${field.key}"
            />
            <button
              type="button"
              class="secondary sorting-item-step"
              data-sorting-items-step="${orderId}"
              data-row-index="${rowIndex}"
              data-item-key="${field.key}"
              data-step="1"
            >
              +
            </button>
          </div>
          <span class="sorting-item-unit">${field.unit}</span>
        </label>
      `).join("")}
    </div>
  `;
}

function renderSortingPhotoEditor(orderId, rowIndex, row) {
  const photos = Array.isArray(row?.photos) ? row.photos : [];
  const overviewPhoto = photos.find((photo) => photo.role === "overview") || null;
  const issuePhotos = photos.filter((photo) => photo.role === "issue").slice(0, sortingMaxIssuePhotos);
  const overviewCount = overviewPhoto ? 1 : 0;
  const issueCount = issuePhotos.length;
  const overviewPhotoIndex = overviewPhoto ? photos.indexOf(overviewPhoto) : -1;

  return `
    <section class="sorting-photo-editor">
      <div class="sorting-photo-grid compact">
        <section class="sorting-photo-card ${overviewPhoto ? "has-photo" : ""}">
          <div class="sorting-photo-card-head">
            <strong>${sortingPhotoRoleLabels.overview}</strong>
          </div>
          <div class="sorting-photo-card-body">
            ${overviewPhoto
              ? `
                  <div class="sorting-photo-media">
                    <img src="${escapeHtml(overviewPhoto.dataUrl || overviewPhoto.public_url || "")}" alt="" class="sorting-photo-thumb sorting-photo-thumb-compact" />
                    <button
                      type="button"
                      class="sorting-photo-remove-icon"
                      data-sorting-remove-photo="${orderId}"
                      data-row-index="${rowIndex}"
                      data-photo-index="${overviewPhotoIndex}"
                      aria-label="Remove overview photo"
                      title="Remove photo"
                    >×</button>
                  </div>
                `
              : `<div class="muted sorting-photo-empty">Photo of all items for this route sheet.</div>`}
            <label class="sorting-photo-picker camera-only">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                data-sorting-photo-input="${orderId}"
                data-row-index="${rowIndex}"
                data-photo-role="overview"
              />
              <span class="sorting-photo-trigger" title="${overviewPhoto ? "Replace overview photo" : "Take overview photo"}">
                ${renderCameraGlyph()}
              </span>
              <span class="sorting-photo-trigger-text">${overviewPhoto ? "Replace photo" : "Take photo"}</span>
              <span class="sorting-photo-limit">${overviewCount}/${sortingMaxOverviewPhotos}</span>
            </label>
          </div>
        </section>
        <section class="sorting-photo-card">
          <div class="sorting-photo-card-head">
            <strong>${sortingPhotoRoleLabels.issue}</strong>
          </div>
          <div class="sorting-photo-card-body">
            ${issuePhotos.length
              ? `
                  <div class="sorting-photo-issues compact">
                    ${issuePhotos.map((photo) => `
                      <div class="sorting-photo-chip inline">
                        <div class="sorting-photo-media">
                          <img src="${escapeHtml(photo.dataUrl || photo.public_url || "")}" alt="" class="sorting-photo-thumb sorting-photo-thumb-inline" />
                          <button
                            type="button"
                            class="sorting-photo-remove-icon"
                            data-sorting-remove-photo="${orderId}"
                            data-row-index="${rowIndex}"
                            data-photo-index="${photos.indexOf(photo)}"
                            aria-label="Remove issue photo"
                            title="Remove photo"
                          >×</button>
                        </div>
                      </div>
                    `).join("")}
                  </div>
                `
              : `<div class="muted sorting-photo-empty">If there is a stain or risk, add a separate photo.</div>`}
            <label class="sorting-photo-picker camera-only ${issueCount >= sortingMaxIssuePhotos ? "is-disabled" : ""}">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                data-sorting-photo-input="${orderId}"
                data-row-index="${rowIndex}"
                data-photo-role="issue"
                ${issueCount >= sortingMaxIssuePhotos ? "disabled" : ""}
              />
              <span class="sorting-photo-trigger" title="${issueCount ? "Add issue photo" : "Take issue photo"}">
                ${renderCameraGlyph()}
              </span>
              <span class="sorting-photo-trigger-text">${issueCount ? "Add more" : "Take photo"}</span>
              <span class="sorting-photo-limit">${issueCount}/${sortingMaxIssuePhotos}</span>
            </label>
          </div>
        </section>
      </div>
    </section>
  `;
}

function renderSortingSingleBasketEditor(orderId, rows, activeIndex) {
  const row = rows[activeIndex] || rows[0] || { color: "mixed", itemCounts: {} };
  const counts = getRowItemCounts(row);
  const total = getRowItemsTotal(row);
  const canFinishActiveBasket = total > 0;
  const hasNext = activeIndex < rows.length - 1;

  return `
    <section class="sorting-step-panel">
      <div class="sorting-basket-head">
        <strong>Route sheet ${activeIndex + 1}</strong>
      </div>
      <div class="sorting-basket-tabs" aria-label="Route sheets">
          ${rows.map((basketRow, index) => {
            void basketRow;
            return `
              <span class="sorting-basket-tab-wrap ${index === activeIndex ? "active" : ""}">
                <button
                  type="button"
                  class="ghost sorting-basket-tab ${index === activeIndex ? "active" : ""}"
                  data-sorting-open-basket="${orderId}"
                  data-row-index="${index}"
                  aria-label="${escapeHtml(`Open route sheet ${index + 1}`)}"
                >
                  ${escapeHtml(`${index + 1}`)}
                </button>
                ${rows.length > 1 ? `
                  <button
                    type="button"
                    class="sorting-basket-tab-remove"
                    data-sorting-remove-basket="${orderId}"
                    data-row-index="${index}"
                    aria-label="${escapeHtml(`Remove route sheet ${index + 1}`)}"
                    title="${escapeHtml(`Remove route sheet ${index + 1}`)}"
                  >×</button>
                ` : ""}
              </span>
            `;
          }).join("")}
          <button
            type="button"
            class="ghost sorting-basket-tab sorting-basket-tab-add"
            data-sorting-add-route-sheet="${orderId}"
            aria-label="Add route sheet"
            title="Add route sheet"
          >+</button>
      </div>
      <div class="sorting-row compact ${getColorToneClass(row.color)}">
        <div class="sorting-row-head">
          <div class="sorting-row-selected">
            <strong>Laundry type</strong>
            <span>${escapeHtml(colorLabels[row.color] || colorLabels.mixed)}</span>
          </div>
        </div>
        <div class="sorting-option-group">
          <div class="sorting-option-chips">
            ${sortingColorOptions.map((option) => `
              <button
                type="button"
                class="ghost sorting-chip ${row.color === option.value ? "active" : ""}"
                data-sorting-choice="${orderId}"
                data-row-index="${activeIndex}"
                data-choice-field="color"
                data-choice-value="${option.value}"
              >
                <img
                  src="${escapeHtml(getPreviewBasketImageByColor(option.value))}"
                  alt=""
                  class="sorting-chip-icon"
                  loading="lazy"
                />
                <span class="sorting-chip-label">${escapeHtml(option.label)}</span>
              </button>
            `).join("")}
          </div>
        </div>
        <div class="sorting-items-head">
          <span class="sorting-group-title">Item breakdown</span>
          <div class="sorting-items-summary ${total > 0 ? "ok" : "warn"}">
            <span class="sorting-meta-line">${escapeHtml(`Total items: ${total}`)}</span>
            <span class="sorting-meta-line">${escapeHtml(`Socks (pcs): ${counts.socksPairs}`)}</span>
          </div>
        </div>
        ${renderSortingItemInputs(orderId, activeIndex, counts)}
        ${renderSortingPhotoEditor(orderId, activeIndex, row)}
      </div>
      <div class="sorting-step-actions">
        ${hasNext
          ? `
            <button
              type="button"
              data-sorting-step-next="${orderId}"
              data-sorting-step-next-mode="next-existing"
              ${canFinishActiveBasket ? "" : "disabled"}
            >
              Next route sheet
            </button>
          `
          : `
            <button
              type="button"
              data-sorting-step-next="${orderId}"
              data-sorting-step-next-mode="finish"
              ${canFinishActiveBasket ? "" : "disabled"}
            >
              Review
            </button>
          `}
      </div>
    </section>
  `;
}

function renderSortingReview(orderId, rows, options = {}) {
  const submitActionAttr = String(options.submitActionAttr || "data-create-baskets");
  const submitLabel = String(options.submitLabel || "Finish");
  const hasEmptyRows = Boolean(options.hasEmptyRows);
  const isSingleBasket = rows.length === 1;
  const backLabel = isSingleBasket ? "To route sheet" : "To route sheets";
  const totals = getRowsItemsTotals(rows);
  const photosTotal = getRowsPhotosTotal(rows);
  return `
    <section class="sorting-step-panel sorting-step-panel-review">
      <div class="sorting-basket-head">
        <strong>Final review</strong>
        <button type="button" class="secondary" data-sorting-print-all="${orderId}">Print sheets (${rows.length})</button>
      </div>
      <div class="sorting-review-summary">
        <article class="sorting-review-kpi">
          <span class="muted">Route sheets</span>
          <strong>${rows.length}</strong>
        </article>
        <article class="sorting-review-kpi">
          <span class="muted">Items</span>
          <strong>${totals.total}</strong>
        </article>
        <article class="sorting-review-kpi">
          <span class="muted">Photos</span>
          <strong>${photosTotal}</strong>
        </article>
      </div>
      <div class="sorting-review-list">
        ${rows.map((row, index) => {
          const counts = getRowItemCounts(row);
          const total = getRowItemsTotal(row);
          const basketImage = getPreviewBasketImageByColor(row.color);
          const printCount = normalizeItemCount(row?.labelPrintCount ?? row?.label_print_count);
          const printLabel = formatPrintedAtPreview(row?.labelPrintedAt || row?.label_printed_at);
          return `
            <article
              class="sorting-review-row ${total > 0 ? "ok" : "warn"}"
            >
              <div class="sorting-review-main">
                <strong>${escapeHtml(makeBasketLabel(row, index))}</strong>
                <span><code>${escapeHtml(getBasketQrPreview("", row, index))}</code></span>
                <span>${escapeHtml(`Items: ${total}`)}</span>
                <span class="sorting-print-state ${printCount > 0 ? "printed" : "not-printed"}">
                  ${printCount > 0
                    ? escapeHtml(`Sheet: ${printCount} · ${printLabel || "now"}`)
                    : "Sheet not printed"}
                </span>
              </div>
              <div class="sorting-review-visual">
                <img src="${escapeHtml(basketImage)}" alt="" class="sorting-review-basket-image" loading="lazy" />
              </div>
              <div class="sorting-review-meta">
                <div class="sorting-review-stats">
                  <span>${escapeHtml(`Top: ${counts.top}`)}</span>
                  <span>${escapeHtml(`Bottom: ${counts.bottom}`)}</span>
                  <span>${escapeHtml(`Underwear: ${counts.underwear}`)}</span>
                  <span>${escapeHtml(`Socks: ${counts.socksPairs}`)}</span>
                </div>
                <div class="sorting-review-actions">
                  ${isSingleBasket
                    ? ""
                    : `<button type="button" class="secondary" data-sorting-open-basket="${orderId}" data-row-index="${index}">Edit</button>`}
                  <button type="button" class="secondary" data-sorting-print-row="${orderId}" data-row-index="${index}">Print</button>
                </div>
              </div>
            </article>
          `;
        }).join("")}
      </div>
      <div class="sorting-step-actions review-actions">
        <button type="button" class="secondary" data-sorting-step-prev="${orderId}">${backLabel}</button>
        <button type="button" class="sorting-submit" ${submitActionAttr}="${orderId}" ${hasEmptyRows ? "disabled" : ""}>${escapeHtml(submitLabel)}</button>
      </div>
    </section>
  `;
}

function renderSortingMiniQueue(orderId, rows, activeIndex) {
  return `
    <div class="sorting-mini-queue">
      ${rows.map((row, index) => {
        const total = getRowItemsTotal(row);
        return `
          <button
            type="button"
            class="ghost sorting-mini-chip ${index === activeIndex ? "active" : ""} ${total > 0 ? "ok" : "warn"}"
            data-sorting-open-basket="${orderId}"
            data-row-index="${index}"
          >
            ${escapeHtml(`${index + 1}`)}
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderSortingPreview(order, rows) {
  return rows.map((row, index) => {
    const basketType = colorLabels[row.color] || colorLabels.mixed;
    const basketImage = getPreviewBasketImageByColor(row.color);
    const counts = getRowItemCounts(row);
    const total = getRowItemsTotal(row);
    const basketQr = getBasketQrPreview(order.public_id, row, index);
    return `
      <div class="sorting-preview-item ${getColorToneClass(row.color)}" data-preview-row-index="${index}">
        <div class="sorting-preview-text">
          <strong>Route sheet ${index + 1}</strong>
          <div class="sorting-preview-visual">
            <img src="${escapeHtml(basketImage)}" alt="" class="sorting-preview-basket-image" loading="lazy" />
            <div class="sorting-preview-visual-meta">
              <span class="sorting-preview-type">${escapeHtml(`${basketType} #${index + 1}`)}</span>
              <span class="sorting-preview-items">${escapeHtml(`Items: ${total} · Socks: ${counts.socksPairs} pcs`)}</span>
            </div>
          </div>
          <div class="sorting-preview-qr-block">
            <span class="sorting-preview-qr-label">Route sheet QR</span>
            <code>${escapeHtml(basketQr)}</code>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function renderSortingFocusedPreview(order, rows, activeIndex) {
  const row = rows[activeIndex] || rows[0] || { color: "mixed", itemCounts: {} };
  const basketImage = getPreviewBasketImageByColor(row.color);
  const counts = getRowItemCounts(row);
  const total = getRowItemsTotal(row);
  const basketQr = getBasketQrPreview(order.public_id, row, activeIndex);

  return `
    <div class="sorting-preview-item sorting-preview-focus ${getColorToneClass(row.color)}" data-preview-row-index="${activeIndex}">
      <div class="sorting-preview-text">
        <strong>Route sheet ${activeIndex + 1}</strong>
        <div class="sorting-preview-focus-image-wrap">
          <img src="${escapeHtml(basketImage)}" alt="" class="sorting-preview-basket-image" loading="lazy" />
        </div>
        <div class="sorting-preview-visual-meta">
          <span class="sorting-preview-type">${escapeHtml(`${colorLabels[row.color] || colorLabels.mixed} #${activeIndex + 1}`)}</span>
          <span class="sorting-preview-items">${escapeHtml(`Items: ${total} · Socks: ${counts.socksPairs} pcs`)}</span>
        </div>
        <div class="sorting-preview-qr-block">
          <span class="sorting-preview-qr-label">Route sheet QR</span>
          <code>${escapeHtml(basketQr)}</code>
        </div>
      </div>
    </div>
  `;
}

export function renderSortingEditorModal(order, rows, draft = {}) {
  const isEditMode = order?.status === "sorted" || order?.sortingMode === "edit";
  const submitActionAttr = isEditMode ? "data-update-baskets" : "data-create-baskets";
  const submitLabel = isEditMode ? "Save route sheets" : "Finish";
  const hasNoRows = !rows.length;
  const rawStep = Number(draft?.wizardStep || 1);
  const step = hasNoRows ? 1 : rawStep;
  const compactStep = step === 3 ? 2 : step;
  const activeBasketIndex = Math.max(0, Math.min(Number(draft?.activeRowIndex || 0), Math.max(0, rows.length - 1)));
  const rowsTotals = getRowsItemsTotals(rows);
  const hasEmptyRows = hasNoRows || rows.some((row) => getRowItemsTotal(row) <= 0);
  const isScanReturnStep = false;

  return `
    <section class="sorting-modal" role="dialog" aria-modal="true">
      <div class="sorting-modal-backdrop" data-sorting-close></div>
      <article
        class="sorting-modal-sheet workflow-modal-shell"
        data-sorting-order-id="${order.id}"
        data-sorting-public-id="${escapeHtml(order.public_id)}"
        data-sorting-customer-name="${escapeHtml(order.customer_name)}"
        data-sorting-order-weight="${order.order_weight ?? ""}"
        data-sorting-order-phone="${escapeHtml(order.customer_phone || "")}"
        data-sorting-order-status="${escapeHtml(order.status || "")}"
        data-sorting-mode="${escapeHtml(order.sortingMode || "")}"
      >
        <header class="sorting-modal-head workflow-modal-header">
          <div class="sorting-modal-head-main workflow-modal-header-main">
            <div class="eyebrow">Order breakdown</div>
            <h3>${escapeHtml(`${order.public_id} · ${order.customer_name}`)}</h3>
          </div>
          ${isScanReturnStep
            ? `<button type="button" class="secondary sorting-close" data-sorting-scan-back="${order.id}">Back</button>`
            : `<button type="button" class="secondary sorting-close" data-sorting-close>Close</button>`}
        </header>

        <div class="sorting-modal-content">
          <div class="sorting-editor-grid ${step === 3 ? "is-review" : ""}">
            <div class="sorting-editor-main">
              ${step === 1 ? `
                ${renderSortingScanSetup(order.id, rows, draft)}
              ` : ""}
              ${step === 2 ? renderSortingSingleBasketEditor(order.id, rows, activeBasketIndex) : ""}
              ${step === 3
                ? renderSortingReview(order.id, rows, {
                    submitActionAttr,
                    submitLabel,
                    hasEmptyRows
                  })
                : ""}
            </div>

            ${step !== 3 ? `
              <aside class="sorting-editor-side">
                <section class="sorting-preview">
                  <div class="sorting-config-header">
                    <strong>Preview</strong>
                    <span class="pill">${rows.length}</span>
                  </div>
                  ${(step >= 2 && rows.length)
                    ? renderSortingFocusedPreview(order, rows, activeBasketIndex)
                    : renderSortingPreview(order, rows)}
                  ${(step >= 2 && rows.length > 1) ? renderSortingMiniQueue(order.id, rows, activeBasketIndex) : ""}
                </section>
              </aside>
            ` : ""}
          </div>
        </div>

        <footer class="sorting-modal-footer workflow-modal-footer">
          <div class="sorting-footer-meta">
            <span class="pill">step ${compactStep}/2</span>
            ${step === 2 ? `<span class="pill">route sheet ${activeBasketIndex + 1}/${rows.length}</span>` : ""}
            ${step === 3 ? `<span class="pill">route sheets ready: ${rows.length}/${rows.length}</span>` : ""}
            ${step === 3 ? `<span class="pill">items: ${rowsTotals.total}</span>` : ""}
            ${step !== 1 && hasEmptyRows ? '<span class="pill warn">fill all route sheets</span>' : ""}
          </div>
        </footer>
      </article>
    </section>
  `;
}

export function renderSorting(orders, activeOrderId, sortingDrafts = {}) {
  const queue = Array.isArray(orders) ? orders : [];
  const incoming = queue.filter((order) => order.status === "sorting");
  const waitingWash = queue.filter((order) => order.status === "sorted");

  if (!incoming.length && !waitingWash.length) {
    return `
      <section class="panel stack">
        <div class="header-row">
          <div>
            <h2>Unsorted orders</h2>
          </div>
        </div>
        <div class="card"><span class="muted">No unsorted orders.</span></div>
      </section>
    `;
  }

  const activeOrder = incoming.find((order) => order.id === activeOrderId) || null;
  const draft = activeOrder
    ? (sortingDrafts[activeOrder.id] || {
        rows: [],
        wizardStep: 1,
        activeRowIndex: 0,
        scanInput: ""
      })
    : null;
  const rows = draft && Array.isArray(draft.rows)
    ? draft.rows
    : [];
  const modal = activeOrder ? renderSortingEditorModal(activeOrder, rows, draft || {}) : "";

  return `
    <section class="panel stack sorting-station-block sorting-station-block-incoming">
      <div class="header-row">
        <div>
          <h2>Unsorted orders</h2>
        </div>
      </div>
      <div class="sorting-orders-wall">
        ${
          incoming.length
            ? renderSortingQueue(incoming, activeOrder ? activeOrder.id : null)
            : '<div class="card"><span class="muted">No unsorted orders.</span></div>'
        }
      </div>
    </section>
    <section class="panel stack sorting-station-block sorting-station-block-sorted">
      <div class="header-row">
        <div>
          <h2>Sorted orders</h2>
        </div>
      </div>
      <div class="sorting-orders-wall">
        ${
          waitingWash.length
            ? renderSortedWaitingQueue(waitingWash)
            : '<div class="card"><span class="muted">No sorted orders.</span></div>'
        }
      </div>
    </section>
    ${modal}
  `;
}
