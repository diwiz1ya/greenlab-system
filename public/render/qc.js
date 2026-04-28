import { escapeHtml } from "../utils.js";

const qcReasonOptions = [
  { value: "stain_not_removed", label: "Stain not removed" },
  { value: "spot_treatment", label: "Spot treatment required" },
  { value: "hand_wash", label: "Hand wash required" },
  { value: "extra_treatment", label: "Extra treatment required" }
];
const qcReasonsRequiringCurrentPhoto = new Set(qcReasonOptions.map((option) => option.value));

const qcItemCategoryLabels = [
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
  { value: "underwear", label: "Underwear" },
  { value: "socksPairs", label: "Socks" }
];

const qcItemCategoryOptions = qcItemCategoryLabels;

export function normalizeQcReason(value) {
  return qcReasonOptions.some((option) => option.value === value) ? value : "stain_not_removed";
}

function getQcReasonLabel(value) {
  return qcReasonOptions.find((option) => option.value === value)?.label || "Stain not removed";
}

function reasonNeedsQcCurrentPhoto(value) {
  return qcReasonsRequiringCurrentPhoto.has(normalizeQcReason(value));
}

function getQcItemCategoryLabel(value) {
  return qcItemCategoryLabels.find((option) => option.value === value)?.label || "Item";
}

function getQcServicePreview(reason) {
  if (reason === "spot_treatment") return { serviceLabel: "Spot treatment", extraDays: 1 };
  if (reason === "hand_wash") return { serviceLabel: "Hand wash", extraDays: 1 };
  if (reason === "extra_treatment") return { serviceLabel: "Extra treatment", extraDays: 1 };
  return { serviceLabel: "Stain removal", extraDays: 1 };
}

function inferBasketColorFromType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (!type) return "mixed";
  if (type.includes("бел") || type.includes("white")) return "white";
  if (type.includes("цвет") || type.includes("color")) return "color";
  if (type.includes("темн") || type.includes("dark")) return "dark";
  if (type.includes("делик") || type.includes("delicate")) return "delicate";
  return "mixed";
}

function formatBasketTypeLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "Mixed";
  const normalized = raw.toLowerCase();
  if (normalized === "mixed") return "Mixed";
  if (normalized === "white") return "White";
  if (normalized === "color" || normalized === "colored") return "Color";
  if (normalized === "dark") return "Dark";
  if (normalized === "delicate") return "Delicate";
  return raw;
}

function normalizeItemCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function getBasketStats(itemCounts) {
  const top = normalizeItemCount(itemCounts?.top);
  const bottom = normalizeItemCount(itemCounts?.bottom);
  const underwear = normalizeItemCount(itemCounts?.underwear);
  const socksPairs = normalizeItemCount(
    itemCounts?.socksPairs !== undefined ? itemCounts?.socksPairs : itemCounts?.socks_pairs
  );
  const total = normalizeItemCount(itemCounts?.total ?? (top + bottom + underwear + socksPairs));
  return {
    total,
    top,
    bottom,
    underwear,
    socksPairs
  };
}

function renderBasketStats(itemCounts, options = {}) {
  const { compact = false } = options;
  if (!itemCounts || typeof itemCounts !== "object") {
    return '<div class="qc-empty-note">Basket item breakdown is not specified.</div>';
  }

  const stats = getBasketStats(itemCounts);
  const rows = [
    { label: "Total", value: String(stats.total), accent: true },
    { label: "Top", value: String(stats.top) },
    { label: "Bottom", value: String(stats.bottom) },
    { label: "Underwear", value: String(stats.underwear) },
    { label: "Socks", value: `${stats.socksPairs} pcs` }
  ];

  return `
    <section class="qc-stats ${compact ? "compact" : ""}">
      <div class="qc-stats-inline" aria-label="Basket item breakdown">
        ${rows.map((row) => `
          <span class="qc-stats-inline-item ${row.accent ? "accent" : ""}">
            <span>${escapeHtml(row.label)}</span>
            <strong>${escapeHtml(row.value)}</strong>
          </span>
        `).join("")}
      </div>
      <div class="qc-stats-grid ${compact ? "compact" : ""}">
        ${rows.map((row) => `
          <div class="qc-stat ${row.accent ? "accent" : ""}">
            <span>${escapeHtml(row.label)}</span>
            <strong>${escapeHtml(row.value)}</strong>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function normalizeQcBasketImages(images, limit = 3) {
  const rows = (Array.isArray(images) ? images : [])
    .map((image, index) => {
      const url = String(image?.public_url || image?.dataUrl || image?.data_url || image?.src || "").trim();
      if (!url) return null;
      return {
        id: image?.id || `qc-image-${index}`,
        role: String(image?.role || (index === 0 ? "overview" : "issue")).trim() === "overview" ? "overview" : "issue",
        note: String(image?.note || "").trim(),
        url
      };
    })
    .filter(Boolean);

  return Number.isInteger(limit) && limit > 0
    ? rows.slice(0, limit)
    : rows;
}

function truncateText(value, maxLength = 72) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatQcExtraDays(extraDays) {
  const days = Number(extraDays || 0);
  if (!Number.isFinite(days) || days <= 0) return "";
  return `+${days} d`;
}

function resolveQcSelectedItemCategory(itemOptions, selectedItemCategory) {
  if (itemOptions.some((option) => option.value === selectedItemCategory)) {
    return selectedItemCategory;
  }
  return itemOptions.length === 1 ? itemOptions[0].value : "";
}

function formatPendingRequestSummary(request) {
  if (!request) return "";
  return [
    String(request.item_label || "").trim() || getQcItemCategoryLabel(request.item_category),
    getQcReasonLabel(request.reason_code),
    formatQcExtraDays(request.extra_days)
  ].filter(Boolean).join(" · ");
}

function formatQcTransferTaskSummary(task) {
  if (!task) return "";
  const actionLabel = String(task.task_kind || "") === "return_to_flow"
    ? "Customer decline"
    : "Transfer to RW";
  return [
    actionLabel,
    String(task.item_label || "").trim() || getQcItemCategoryLabel(task.item_category),
    getQcReasonLabel(task.reason_code),
    `${Number(task.quantity || 1)} pcs`
  ].filter(Boolean).join(" · ");
}

function formatTransferDecisionStamp(task) {
  const stamp = String(task?.decision_at || "").trim();
  if (!stamp) return "";
  const parsed = new Date(stamp);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function normalizeQrCodeForCompare(value) {
  return String(value || "").trim().toUpperCase();
}

function isTransferQrMatched(scannedQrCode, expectedQrCode) {
  return Boolean(
    normalizeQrCodeForCompare(scannedQrCode)
    && normalizeQrCodeForCompare(expectedQrCode)
    && normalizeQrCodeForCompare(scannedQrCode) === normalizeQrCodeForCompare(expectedQrCode)
  );
}

function getQcTransferDraft(transferScanDrafts, requestId) {
  const key = String(Number(requestId) || "");
  if (!key) {
    return { sourceQrCode: "", targetQrCode: "" };
  }
  const draft = transferScanDrafts && typeof transferScanDrafts === "object"
    ? transferScanDrafts[key]
    : null;
  return {
    sourceQrCode: String(draft?.sourceQrCode || "").trim(),
    targetQrCode: String(draft?.targetQrCode || "").trim()
  };
}

function getQcIssueCases(inspection) {
  return normalizeQcBasketImages(inspection?.basket?.images, 6)
    .filter((image) => image.role === "issue")
    .map((image, index) => ({
      id: String(image.id || `qc-issue-${index}`),
      url: image.url,
      note: image.note,
      badge: `Case ${index + 1}`,
      title: image.note || `Issue item ${index + 1}`,
      summary: image.note
        ? `Marked during sorting`
        : "Photo without note"
    }));
}

function getActiveQcIssueCase(inspection, selectedIssueImageId) {
  const issueCases = getQcIssueCases(inspection);
  if (!issueCases.length) return null;
  return issueCases.find((issueCase) => issueCase.id === selectedIssueImageId) || issueCases[0];
}

function getQcPhotoRoleLabel(role) {
  return role === "overview" ? "Overview photo" : "Issue item";
}

function renderQcPhotoRail(images, options = {}) {
  const { compact = false } = options;
  const rows = normalizeQcBasketImages(images);
  if (!rows.length) return "";

  return `
    <section class="qc-photo-block ${compact ? "compact" : ""}">
      <div class="qc-section-row">
        <strong>Photo</strong>
        <span class="muted">${escapeHtml(String(rows.length))}</span>
      </div>
      <div class="qc-photo-grid ${compact ? "compact" : ""}">
        ${rows.map((image) => `
          <figure class="qc-photo-tile ${image.role === "issue" ? "issue" : ""}">
            <img
              src="${escapeHtml(image.url)}"
              alt="${escapeHtml(image.note || getQcPhotoRoleLabel(image.role))}"
              loading="lazy"
            />
            <figcaption>${escapeHtml(getQcPhotoRoleLabel(image.role))}</figcaption>
          </figure>
        `).join("")}
      </div>
    </section>
  `;
}

function getAvailableQcItemOptions(itemCounts) {
  if (!itemCounts || typeof itemCounts !== "object") return [];
  return qcItemCategoryOptions
    .map((option) => {
      const count = normalizeItemCount(itemCounts[option.value]);
      return count > 0 ? { ...option, count } : null;
    })
    .filter(Boolean);
}

function getBasketImageByType(basketType, basketKind = "main") {
  if (String(basketKind || "main") === "rework") return "/images/baskets/rework.png";
  const color = inferBasketColorFromType(basketType);
  if (color === "white") return "/images/baskets/white.png";
  if (color === "color") return "/images/baskets/color.png";
  if (color === "dark") return "/images/baskets/dark.png";
  if (color === "delicate") return "/images/baskets/delicate.png";
  return "/images/baskets/mixed.png";
}

function formatScanTime(isoStamp) {
  if (!isoStamp) return "";
  const parsed = new Date(isoStamp);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatScanTimeShort(isoStamp) {
  if (!isoStamp) return "";
  const parsed = new Date(isoStamp);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderQcScanMeta(lastScan, station) {
  if (!lastScan || lastScan.station !== station) return "";
  const orderPublicId = String(lastScan.orderPublicId || "").trim();
  const basketCode = String(lastScan.basketCode || "").trim();
  const chunks = [orderPublicId, basketCode].filter(Boolean);
  return chunks.length ? escapeHtml(chunks.join(" · ")) : "";
}

function getQcScanShortStatus(lastScan) {
  if (!lastScan?.ok) return "error";
  const message = String(lastScan?.message || "").trim().toLowerCase();
  if (message.includes("opened") || message.includes("откры")) return "open";
  if (message.includes("confirm") || message.includes("подтверж")) return "confirmed";
  return "ok";
}

function renderQcCurrentBasketCard(qcInspection, transferTask = null) {
  if (!qcInspection) {
    return `
      <section class="qc-panel qc-basket-panel qc-basket-panel-empty">
        <div class="qc-panel-head">
          <div>
            <div class="qc-section-label">Basket</div>
            <h3>No basket open</h3>
            <p class="muted">After scan, customer, item breakdown and photos appear here.</p>
          </div>
        </div>
        <div class="qc-empty-state-row">
          <img src="/images/baskets/mixed.png" alt="Basket" class="qc-basket-icon idle" loading="lazy" />
          <div class="qc-empty-note">Scan QR to load context and make a decision.</div>
        </div>
      </section>
    `;
  }

  const basketTypeLabel = formatBasketTypeLabel(qcInspection.basket?.basket_type || "Mixed");
  const basketCode = String(qcInspection.basket?.basket_code || "—");
  const customerName = String(qcInspection.order?.customer_name || "Customer");
  const basketImage = getBasketImageByType(basketTypeLabel, qcInspection.basket?.basket_kind);
  const isRework = String(qcInspection.basket?.basket_kind || "main") === "rework";
  const reworkReason = String(qcInspection.basket?.rework_reason || "").trim();
  const reworkAttempt = Number(qcInspection.basket?.rework_attempt || 0);
  const pendingRequest = Array.isArray(qcInspection.pending_rework_requests)
    ? qcInspection.pending_rework_requests[0]
    : null;
  const markers = [];

  if (isRework) {
    markers.push(
      `<span class="qc-inline-chip warn">${escapeHtml(`${getQcReasonLabel(reworkReason)} · attempt ${String(reworkAttempt || 1)}`)}</span>`
    );
  }
  if (pendingRequest) {
    markers.push(
      `<span class="qc-inline-chip warn">${escapeHtml(`Waiting for customer: ${getQcItemCategoryLabel(pendingRequest.item_category)}`)}</span>`
    );
  }
  if (transferTask) {
    const targetLabel = String(
      transferTask.planned_rework_basket_code
      || transferTask.rework_basket_code
      || "new RW basket"
    ).trim();
    markers.push(
      `<span class="qc-inline-chip warn">${escapeHtml(`Transfer to ${targetLabel}`)}</span>`
    );
  }

  return `
    <section class="qc-panel qc-basket-panel">
      <div class="qc-panel-head">
        <div>
          <div class="qc-section-label">Basket</div>
          <h3>${escapeHtml(basketCode)}</h3>
          <p class="muted">${escapeHtml(customerName)}</p>
        </div>
      </div>
      <div class="qc-basket-hero">
        <div class="qc-basket-identity">
          <img
            src="${escapeHtml(basketImage)}"
            alt="${escapeHtml(`Basket: ${basketTypeLabel}`)}"
            class="qc-basket-icon"
            loading="lazy"
          />
          <div class="qc-basket-identity-copy">
            <strong>${escapeHtml(basketTypeLabel)}</strong>
          </div>
        </div>
        ${
          markers.length
            ? `
              <div class="qc-inline-chip-row">
                ${markers.join("")}
              </div>
            `
            : ""
        }
      </div>
      ${renderBasketStats(qcInspection.basket?.item_counts)}
      ${
        transferTask
          ? `
            <div class="qc-transfer-inline-alert">
              <strong>There is a confirmed task after approval</strong>
              <span class="muted">${escapeHtml(formatQcTransferTaskSummary(transferTask))}</span>
            </div>
          `
          : ""
      }
      ${renderQcPhotoRail(qcInspection.basket?.images)}
    </section>
  `;
}

function renderQcChoiceSelector(options, selectedValue, attributeName, title, isSubmitting = false, preferFirst = true) {
  if (!options.length) {
    return `
      <section class="qc-picker">
        <div class="qc-picker-label">${escapeHtml(title)}</div>
        <div class="qc-empty-note">No options available.</div>
      </section>
    `;
  }

  const activeValue = options.some((option) => option.value === selectedValue)
    ? selectedValue
    : (preferFirst ? options[0].value : "");

  return `
    <section class="qc-picker qc-reason-selector">
      <div class="qc-picker-label">${escapeHtml(title)}</div>
      <div class="qc-chip-grid">
        ${options.map((option) => `
          <button
            type="button"
            class="qc-chip ${activeValue === option.value ? "active" : ""}"
            ${attributeName}="${escapeHtml(option.value)}"
            ${isSubmitting ? "disabled" : ""}
          >
            ${escapeHtml(option.label)}
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function renderQcItemSelector(itemCounts, selectedCategory, isSubmitting = false, title = "Item category") {
  const availableOptions = getAvailableQcItemOptions(itemCounts).map((option) => ({
    value: option.value,
    label: `${option.label} · ${option.count}`
  }));

  if (!availableOptions.length) {
    return `
      <section class="qc-picker">
        <div class="qc-picker-label">${escapeHtml(title)}</div>
        <div class="qc-empty-note">Item breakdown must be filled for approval.</div>
      </section>
    `;
  }

  return renderQcChoiceSelector(
    availableOptions,
    selectedCategory,
    "data-qc-item-category",
    title,
    isSubmitting,
    false
  );
}

function renderQcReasonSelector(selectedReason, options = {}) {
  const { disabled = false } = options;
  return renderQcChoiceSelector(
    qcReasonOptions,
    normalizeQcReason(selectedReason),
    "data-qc-reason-select",
    "Rework reason",
    disabled,
    true
  );
}

function renderQcSingleCaseSelector(inspection, issueCase, activeItemCategory, itemOptions, isSubmitting = false) {
  if (!issueCase) return "";

  const singleCaseTitle = issueCase.note
    ? truncateText(issueCase.title, 80)
    : "Issue item";
  const singleCaseNote = issueCase.note
    ? "Issue photo from sorting station."
    : "Sorting attached an issue photo without note. Open it in full size if needed.";
  const singleCategoryLabel = itemOptions.length === 1 && activeItemCategory
    ? getQcItemCategoryLabel(activeItemCategory)
    : "";

  return `
    <section class="qc-picker qc-picker-single">
      <div class="qc-picker-label">Issue item</div>
      ${
        itemOptions.length > 1
          ? `
            ${renderQcItemSelector(inspection?.basket?.item_counts, activeItemCategory, isSubmitting, "Item category")}
            ${
              !activeItemCategory
                ? '<div class="qc-empty-note">Select an item category to enable To reason.</div>'
                : ""
            }
          `
          : ""
      }
      <article class="qc-single-case">
        <button
          type="button"
          class="qc-single-case-media"
          data-qc-preview-image="${escapeHtml(issueCase.url)}"
          data-qc-preview-title="${escapeHtml(singleCaseTitle)}"
          data-qc-preview-note="${escapeHtml(issueCase.note || singleCaseNote)}"
        >
          <img
            src="${escapeHtml(issueCase.url)}"
            alt="${escapeHtml(singleCaseTitle)}"
            loading="lazy"
          />
          <span class="qc-case-preview-hint">Open photo</span>
        </button>
        <div class="qc-single-case-copy">
          <span class="qc-section-label">${escapeHtml(issueCase.badge)}</span>
          <strong>${escapeHtml(singleCaseTitle)}</strong>
          <p class="muted">${escapeHtml(singleCaseNote)}</p>
          <div class="qc-inline-chip-row">
            <span class="qc-inline-chip">Photo from sorting</span>
            ${singleCategoryLabel ? `<span class="qc-inline-chip accent">Category: ${escapeHtml(singleCategoryLabel)}</span>` : ""}
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderQcCaseSelector(inspection, selectedIssueImageId, selectedItemCategory, isSubmitting = false) {
  const issueCases = getQcIssueCases(inspection);
  const itemOptions = getAvailableQcItemOptions(inspection?.basket?.item_counts);
  const activeIssueCase = getActiveQcIssueCase(inspection, selectedIssueImageId);
  const activeItemCategory = resolveQcSelectedItemCategory(itemOptions, selectedItemCategory);

  if (!issueCases.length) {
    return `
      <section class="qc-case-empty">
        <strong>Issue items are not marked in sorting</strong>
        <span class="muted">You can continue manually: select a category and add a short note on the next step.</span>
      </section>
      ${renderQcItemSelector(inspection?.basket?.item_counts, activeItemCategory, isSubmitting, "Item category")}
    `;
  }

  if (issueCases.length === 1) {
    return renderQcSingleCaseSelector(
      inspection,
      activeIssueCase,
      activeItemCategory,
      itemOptions,
      isSubmitting
    );
  }

  return `
    <section class="qc-picker">
      <div class="qc-picker-label">Issue item</div>
      <div class="qc-case-grid">
        ${issueCases.map((issueCase) => `
          <article class="qc-case-card ${activeIssueCase?.id === issueCase.id ? "active" : ""}">
            <button
              type="button"
              class="qc-case-preview"
              data-qc-preview-image="${escapeHtml(issueCase.url)}"
              data-qc-preview-title="${escapeHtml(issueCase.title)}"
              data-qc-preview-note="${escapeHtml(issueCase.note || issueCase.summary)}"
            >
              <img
                src="${escapeHtml(issueCase.url)}"
                alt="${escapeHtml(issueCase.title)}"
                loading="lazy"
              />
              <span class="qc-case-preview-hint">Open photo</span>
            </button>
            <button
              type="button"
              class="qc-case-select"
              data-qc-issue-id="${escapeHtml(issueCase.id)}"
              data-qc-issue-note="${escapeHtml(issueCase.note || "")}"
              ${isSubmitting ? "disabled" : ""}
            >
              <div class="qc-case-copy">
                <span class="qc-section-label">${escapeHtml(issueCase.badge)}</span>
                <strong>${escapeHtml(truncateText(issueCase.title, 72))}</strong>
                <span class="muted">${escapeHtml(issueCase.summary)}</span>
              </div>
            </button>
          </article>
        `).join("")}
      </div>
    </section>
    ${
      itemOptions.length > 1
        ? renderQcItemSelector(inspection?.basket?.item_counts, activeItemCategory, isSubmitting, "Category")
        : ""
    }
  `;
}

function renderQcSelectedCaseSummary(selectedIssueCase, activeItemCategory) {
  if (!selectedIssueCase) return "";

  return `
    <section class="qc-selected-case">
      <button
        type="button"
        class="qc-case-preview qc-case-preview-compact"
        data-qc-preview-image="${escapeHtml(selectedIssueCase.url)}"
        data-qc-preview-title="${escapeHtml(selectedIssueCase.title)}"
        data-qc-preview-note="${escapeHtml(selectedIssueCase.note || "Issue photo from sorting.")}"
      >
        <img
          src="${escapeHtml(selectedIssueCase.url)}"
          alt="${escapeHtml(selectedIssueCase.title)}"
          loading="lazy"
        />
      </button>
      <div class="qc-selected-case-copy">
        <span class="qc-section-label">${escapeHtml(selectedIssueCase.badge)}</span>
        <strong>${escapeHtml(truncateText(selectedIssueCase.title, 88))}</strong>
        <span class="muted">${escapeHtml(selectedIssueCase.note || "Issue photo from sorting.")}</span>
        <div class="qc-inline-chip-row">
          ${activeItemCategory ? `<span class="qc-inline-chip accent">${escapeHtml(getQcItemCategoryLabel(activeItemCategory))}</span>` : ""}
          <span class="qc-inline-chip">Photo from sorting</span>
        </div>
      </div>
    </section>
  `;
}

function renderQcCurrentPhotoField(currentPhotoDataUrl, options = {}) {
  const { required = false, disabled = false } = options;
  const photoUrl = String(currentPhotoDataUrl || "").trim();
  const hasPhoto = Boolean(photoUrl);

  return `
    <section class="qc-picker qc-photo-capture">
      <div class="qc-picker-label">Photo after drying (QC)</div>
      <div class="qc-photo-capture-shell ${hasPhoto ? "has-photo" : ""}">
        <div class="qc-photo-capture-media">
          ${
            hasPhoto
              ? `
                <button
                  type="button"
                  class="qc-case-preview qc-photo-capture-preview"
                  data-qc-preview-image="${escapeHtml(photoUrl)}"
                  data-qc-preview-title="Photo after drying (QC)"
                  data-qc-preview-note="Current item state after drying"
                >
                  <img
                    src="${escapeHtml(photoUrl)}"
                    alt="Photo after drying (QC)"
                    loading="lazy"
                  />
                  <span class="qc-case-preview-hint">Open photo</span>
                </button>
              `
              : `
                <div class="qc-photo-capture-empty">
                  <strong>Add current item photo</strong>
                  <span class="muted">Manager will see this photo next to photo from sorting.</span>
                </div>
              `
          }
        </div>
        <div class="qc-photo-capture-copy">
          <p class="muted">
            ${
              required
                ? "For this scenario, post-drying photo is required: manager must see current item state."
                : "Add current photo if manager needs to verify item condition after drying."
            }
          </p>
          <div class="qc-inline-chip-row">
            <span class="qc-inline-chip accent">${required ? "Required" : "Optional"}</span>
            ${hasPhoto ? '<span class="qc-inline-chip">Photo added</span>' : '<span class="qc-inline-chip warn">Photo missing</span>'}
          </div>
          <div class="qc-photo-capture-actions">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              class="qc-photo-capture-input"
              data-qc-current-photo-input
              ${disabled ? "disabled" : ""}
            />
            <button type="button" class="secondary" data-qc-current-photo-pick ${disabled ? "disabled" : ""}>
              ${hasPhoto ? "Replace photo" : "Take photo"}
            </button>
            ${
              hasPhoto
                ? `<button type="button" class="secondary" data-qc-current-photo-clear ${disabled ? "disabled" : ""}>Remove</button>`
                : ""
            }
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderQcStepIndicator(step) {
  return `
    <div class="qc-stepper" aria-label="Approval steps">
      <span class="qc-step ${step === 1 ? "active" : "done"}">1. Case</span>
      <span class="qc-step ${step === 2 ? "active" : ""}">2. Reason</span>
    </div>
  `;
}

function renderQcInspectionModal(
  inspection,
  selectedReason,
  selectedIssueImageId,
  selectedItemCategory,
  selectedItemLabel,
  currentPhotoDataUrl,
  isOpen,
  modalStep = 1,
  isSubmitting = false
) {
  if (!inspection || !isOpen) return "";

  const reason = normalizeQcReason(selectedReason);
  const itemOptions = getAvailableQcItemOptions(inspection.basket?.item_counts);
  const activeItemCategory = resolveQcSelectedItemCategory(itemOptions, selectedItemCategory);
  const activeItemLabel = String(selectedItemLabel || "").trim();
  const selectedIssueCase = getActiveQcIssueCase(inspection, selectedIssueImageId);
  const servicePreview = getQcServicePreview(reason);
  const needsQcCurrentPhoto = reasonNeedsQcCurrentPhoto(reason);
  const hasQcCurrentPhoto = Boolean(String(currentPhotoDataUrl || "").trim());
  const pendingRequest = Array.isArray(inspection.pending_rework_requests)
    ? inspection.pending_rework_requests[0]
    : null;
  const issueCases = getQcIssueCases(inspection);
  const hasIssueCases = issueCases.length > 0;
  const stepOneIntro = !hasIssueCases
    ? "Issue item was not marked during sorting. Continue manually."
    : (
        issueCases.length === 1
          ? (itemOptions.length > 1
            ? "Check the issue photo and choose the item category below."
            : "Check the issue photo from sorting.")
          : (itemOptions.length > 1
            ? "Select issue photo. Choose the item category below if needed."
            : "Select issue item from basket. You can open the photo in full size.")
      );
  const step = modalStep === 2 ? 2 : 1;
  const disabledAttr = isSubmitting ? "disabled" : "";
  const reworkButtonText = isSubmitting ? "Saving..." : "Send for approval";
  const primaryDisabled = Boolean(
    isSubmitting
    || !activeItemCategory
    || pendingRequest
    || (needsQcCurrentPhoto && !hasQcCurrentPhoto)
  );
  const headerMeta = String(inspection.order?.customer_name || "").trim() || "Customer";

  return `
    <section class="qc-modal" role="dialog" aria-modal="true">
      <div class="qc-modal-backdrop" data-qc-modal-close></div>
      <article class="qc-modal-sheet">
        <header class="qc-modal-header">
          <div>
            <div class="qc-section-label">Approval</div>
            <h3>${escapeHtml(inspection.order?.public_id || "Order")} · ${escapeHtml(inspection.basket?.basket_code || "")}</h3>
            <p class="muted">${escapeHtml(headerMeta)}</p>
          </div>
          <div class="qc-modal-tools">
            ${renderQcStepIndicator(step)}
          </div>
        </header>
        ${
          pendingRequest
            ? `
              <div class="qc-warning-banner">
                <strong>Already waiting for customer response</strong>
                <span class="muted">${escapeHtml(formatPendingRequestSummary(pendingRequest))}</span>
              </div>
            `
            : ""
        }
        <div class="qc-modal-body">
          <div class="qc-modal-main">
            <section class="qc-panel qc-modal-stage">
              <div class="qc-panel-head">
                <div>
                  <h3>${step === 1 ? "Select issue item" : "What to offer the customer"}</h3>
                  <p class="muted">${
                    step === 1
                      ? stepOneIntro
                      : "Provide reason and short note visible to the manager."
                  }</p>
                </div>
              </div>
              <div class="qc-modal-stage-body">
                ${
                  step === 1
                    ? renderQcCaseSelector(inspection, selectedIssueImageId, activeItemCategory, isSubmitting)
                    : `
                        ${renderQcSelectedCaseSummary(selectedIssueCase, activeItemCategory)}
                        ${renderQcReasonSelector(reason, { disabled: isSubmitting })}
                        ${renderQcCurrentPhotoField(currentPhotoDataUrl, {
                          required: needsQcCurrentPhoto,
                          disabled: isSubmitting
                        })}
                        <label class="qc-input-field">
                          <span>Short note</span>
                          <input
                            type="text"
                            maxlength="120"
                            placeholder="E.g. white shirt with stain on collar"
                            value="${escapeHtml(activeItemLabel)}"
                            data-qc-item-label
                            ${disabledAttr}
                          />
                        </label>
                        <div class="qc-inline-chip-row">
                          ${activeItemCategory ? `<span class="qc-inline-chip accent">${escapeHtml(getQcItemCategoryLabel(activeItemCategory))}</span>` : ""}
                          <span class="qc-inline-chip" data-qc-service-label-chip>${escapeHtml(servicePreview.serviceLabel)}</span>
                          ${
                            servicePreview.extraDays
                              ? `<span class="qc-inline-chip warn" data-qc-extra-days-chip>${escapeHtml(formatQcExtraDays(servicePreview.extraDays))}</span>`
                              : ""
                          }
                        </div>
                      `
                }
              </div>
            </section>
          </div>
        </div>
        <footer class="qc-modal-footer">
          ${
            step === 1
              ? `
                <button type="button" class="secondary" data-qc-modal-close ${disabledAttr}>Cancel</button>
                <button
                  type="button"
                  data-qc-modal-next-step
                  data-qc-item-category="${escapeHtml(activeItemCategory)}"
                  ${(!activeItemCategory || pendingRequest || isSubmitting) ? "disabled" : ""}
                >
                  To reason
                </button>
              `
              : `
                <button type="button" class="secondary" data-qc-modal-prev-step ${disabledAttr}>Back</button>
                <button
                  type="button"
                  data-qc-modal-rework
                  data-qc-reason="${escapeHtml(reason)}"
                  data-qc-item-category="${escapeHtml(activeItemCategory)}"
                  ${primaryDisabled ? "disabled" : ""}
                >
                  ${reworkButtonText}
                </button>
              `
          }
        </footer>
      </article>
    </section>
  `;
}

function renderQcInlineDecisionCard(qcInspection, isSubmitting = false) {
  if (!qcInspection) {
    return `
      <section class="qc-panel qc-actions-panel qc-actions-panel-empty">
        <div class="qc-panel-head">
          <div>
            <div class="qc-section-label">Decision</div>
            <h3>Open basket</h3>
            <p class="muted">Available actions appear after scan.</p>
          </div>
        </div>
      </section>
    `;
  }

  const passText = isSubmitting ? "Saving..." : "OK -> to ironing";
  const reworkText = isSubmitting ? "Opening..." : "Send for approval";
  const damageText = isSubmitting ? "Saving..." : "Move to HOLD";
  const pendingRequest = Array.isArray(qcInspection.pending_rework_requests)
    ? qcInspection.pending_rework_requests[0]
    : null;
  const passDisabledAttr = isSubmitting || pendingRequest ? "disabled" : "";
  const reworkDisabledAttr = isSubmitting || pendingRequest ? "disabled" : "";
  const damageDisabledAttr = isSubmitting ? "disabled" : "";

  return `
    <section class="qc-panel qc-actions-panel">
      <div class="qc-panel-head">
        <div>
          <div class="qc-section-label">Decision</div>
          <p class="muted">One primary route and two exceptions.</p>
        </div>
      </div>
      ${
        pendingRequest
          ? `
            <div class="qc-warning-banner compact">
              <strong>Waiting for customer response</strong>
              <span class="muted">${escapeHtml(formatPendingRequestSummary(pendingRequest))}</span>
            </div>
          `
          : ""
      }
      <div class="qc-actions-stack">
        <button type="button" class="qc-action qc-action-primary" data-run-qc-pass ${passDisabledAttr}>
          <span class="qc-action-kicker">Primary route</span>
          <strong>${escapeHtml(passText)}</strong>
          <span class="qc-action-meta">No extra steps.</span>
        </button>
        <div class="qc-action-row">
          <button type="button" class="qc-action qc-action-secondary" data-qc-open-rework-modal ${reworkDisabledAttr}>
            <span class="qc-action-kicker">Approval</span>
            <strong>${escapeHtml(reworkText)}</strong>
            <span class="qc-action-meta">Choose problematic item and reason.</span>
          </button>
          <button type="button" class="qc-action qc-action-danger" data-run-qc-damage ${damageDisabledAttr}>
            <span class="qc-action-kicker">Stop scenario</span>
            <strong>${escapeHtml(damageText)}</strong>
            <span class="qc-action-meta">Move order to HOLD.</span>
          </button>
        </div>
      </div>
    </section>
  `;
}

function renderQcTransferBanner(tasks, panelOpen, pendingRequestId = null) {
  const rows = Array.isArray(tasks) ? tasks : [];
  if (!rows.length) return "";

  const transferCount = rows.filter((task) => String(task?.task_kind || "") !== "return_to_flow").length;
  const returnCount = rows.length - transferCount;
  const pending = Number.isInteger(pendingRequestId) && pendingRequestId > 0;
  return `
    <section class="qc-transfer-banner">
      <div class="qc-transfer-banner-copy">
        <span class="qc-section-label">Task inbox</span>
        <strong>${escapeHtml(`New tasks: ${rows.length}`)}</strong>
        <span class="muted qc-transfer-banner-note">${escapeHtml(rows.length === 1 ? "One task is waiting for QC confirmation." : "Tasks are waiting for QC confirmation.")}</span>
        <div class="qc-transfer-banner-metrics">
          <span class="qc-inline-chip ${transferCount ? "warn" : ""}">${escapeHtml(`Transfer to RW: ${transferCount}`)}</span>
          <span class="qc-inline-chip ${returnCount ? "accent" : ""}">${escapeHtml(`Return to flow: ${returnCount}`)}</span>
        </div>
      </div>
      <div class="qc-transfer-banner-actions">
        <button
          type="button"
          class="secondary"
          data-open-qc-transfer-panel
          ${pending ? "disabled" : ""}
        >
          ${panelOpen ? "Panel open" : "Open tasks"}
        </button>
      </div>
    </section>
  `;
}

function renderQcTransferDrawer(tasks, panelOpen, pendingRequestId = null, transferScanDrafts = {}, activeSourceBasketId = null) {
  if (!panelOpen) return "";

  const rows = Array.isArray(tasks) ? tasks : [];
  const sortedRows = rows.slice().sort((left, right) => {
    const leftReturn = String(left?.task_kind || "") === "return_to_flow";
    const rightReturn = String(right?.task_kind || "") === "return_to_flow";
    if (leftReturn !== rightReturn) return leftReturn ? -1 : 1;
    return Number(right?.id || 0) - Number(left?.id || 0);
  });
  const transferCount = rows.filter((task) => String(task?.task_kind || "") !== "return_to_flow").length;
  const returnCount = rows.length - transferCount;

  return `
    <section class="qc-transfer-drawer" role="dialog" aria-modal="false" aria-label="Tasks after approval">
      <button class="qc-transfer-drawer-backdrop" data-close-qc-transfer-panel aria-label="Close panel"></button>
      <article class="qc-transfer-drawer-sheet">
        <header class="qc-transfer-drawer-header">
          <div>
            <span class="qc-section-label">Task inbox</span>
            <h3>Tasks after approval</h3>
            <p class="muted">Action-first: process flow returns first, then transfers to RW.</p>
            <div class="qc-transfer-banner-metrics">
              <span class="qc-inline-chip ${returnCount ? "accent" : ""}">${escapeHtml(`Returns: ${returnCount}`)}</span>
              <span class="qc-inline-chip ${transferCount ? "warn" : ""}">${escapeHtml(`RW: ${transferCount}`)}</span>
            </div>
          </div>
          <button type="button" class="secondary" data-close-qc-transfer-panel>Close</button>
        </header>
        <div class="qc-transfer-drawer-body">
          ${
            sortedRows.length
              ? sortedRows.map((task) => {
                  const requestId = Number(task.id);
                  const isBusy = Number(pendingRequestId) === requestId;
                  const isReturnTask = String(task.task_kind || "") === "return_to_flow";
                  const isContextTask = Number(activeSourceBasketId || 0) > 0
                    && Number(task.source_basket_id || 0) === Number(activeSourceBasketId || 0);
                  const sourceLabel = String(task.source_basket_code || "").trim() || "Source basket";
                  const reworkLabel = String(task.planned_rework_basket_code || task.rework_basket_code || "").trim() || "New RW basket";
                  const sourceQrLabel = String(task.source_basket_qr_code || "").trim();
                  const reworkQrLabel = String(task.planned_rework_basket_qr_code || task.rework_basket_qr_code || "").trim();
                  const transferDraft = getQcTransferDraft(transferScanDrafts, requestId);
                  const sourceMatched = isReturnTask ? true : isTransferQrMatched(transferDraft.sourceQrCode, sourceQrLabel);
                  const targetMatched = isReturnTask ? true : isTransferQrMatched(transferDraft.targetQrCode, reworkQrLabel);
                  const canConfirmTransfer = sourceMatched && targetMatched && !isBusy;
                  const decisionStamp = formatTransferDecisionStamp(task);
                  const returnTaskPhotoUrl = String(task.source_image_url || task.qc_photo_url || "").trim();
                  const returnTaskPhotoTitle = String(task.source_image_url ? "Photo from sorting" : "Photo from QC").trim();

                  if (isReturnTask) {
                    return `
                      <article class="qc-transfer-task-card qc-transfer-task-card-compact ${isContextTask ? "qc-transfer-task-context" : ""}" data-qc-transfer-task-card="${requestId}">
                        <div class="qc-transfer-task-head">
                          <strong>${escapeHtml(`${task.order_public_id || "Order"} · ${sourceLabel}`)}</strong>
                          <span class="pill warn">Return to flow</span>
                        </div>
                        <div class="qc-transfer-task-mini muted">
                          ${escapeHtml(sourceQrLabel || "Source basket QR is missing")}
                          ${decisionStamp ? ` · ${escapeHtml(`manager decision ${decisionStamp}`)}` : ""}
                        </div>
                        ${
                          returnTaskPhotoUrl
                            ? `
                              <button
                                type="button"
                                class="qc-return-task-photo"
                                data-qc-preview-image="${escapeHtml(returnTaskPhotoUrl)}"
                                data-qc-preview-title="${escapeHtml(returnTaskPhotoTitle)}"
                                data-qc-preview-note="${escapeHtml(task.source_image_note || "Problem item reference before return to flow")}"
                              >
                                <img src="${escapeHtml(returnTaskPhotoUrl)}" alt="${escapeHtml(returnTaskPhotoTitle)}" loading="lazy" />
                                <span class="qc-case-preview-hint">Open photo</span>
                              </button>
                            `
                            : '<div class="qc-empty-note">Photo missing.</div>'
                        }
                        <div class="action-row">
                          <button
                            type="button"
                            data-confirm-qc-transfer-task="${requestId}"
                            data-qc-transfer-busy="${isBusy ? "1" : "0"}"
                            data-qc-transfer-task-kind="${escapeHtml(task.task_kind || "return_to_flow")}"
                            data-qc-transfer-source=""
                            data-qc-transfer-target=""
                            data-qc-transfer-expected-source=""
                            data-qc-transfer-expected-target=""
                            ${isBusy ? "disabled" : ""}
                          >
                            ${isBusy ? "Confirming..." : "Confirm return to flow"}
                          </button>
                        </div>
                      </article>
                    `;
                  }

                  return `
                    <article class="qc-transfer-task-card qc-transfer-task-card-transfer ${isContextTask ? "qc-transfer-task-context" : ""}" data-qc-transfer-task-card="${requestId}">
                      <div class="qc-transfer-task-head">
                        <strong>${escapeHtml(`${task.order_public_id || "Order"} · ${sourceLabel}`)}</strong>
                        <span class="pill warn">${escapeHtml(reworkLabel)}</span>
                      </div>
                      <div class="qc-transfer-task-summary">${escapeHtml(formatQcTransferTaskSummary(task))}</div>
                      <div class="qc-transfer-route">
                        <div class="qc-transfer-route-point">
                          <span class="qc-section-label">From</span>
                          <strong>${escapeHtml(sourceLabel)}</strong>
                          <span class="muted">${escapeHtml(sourceQrLabel || "Source basket QR")}</span>
                        </div>
                        <span class="qc-transfer-route-arrow" aria-hidden="true">→</span>
                        <div class="qc-transfer-route-point">
                          <span class="qc-section-label">To</span>
                          <strong>${escapeHtml(reworkLabel)}</strong>
                          <span class="muted">${escapeHtml(reworkQrLabel || "RW basket QR")}</span>
                        </div>
                      </div>
                      <div class="qc-transfer-task-hint">
                        <span>1) Move item physically 2) confirm source and target QR.</span>
                      </div>
                      ${
                        decisionStamp
                          ? `<div class="qc-transfer-task-meta muted">${escapeHtml(`Confirmed by manager: ${decisionStamp}`)}</div>`
                          : ""
                      }
                      <div class="qc-transfer-scan-grid">
                        <label class="qc-transfer-scan-field">
                          <span>Source scan</span>
                          <input
                            type="text"
                            class="qc-transfer-scan-input"
                            data-qc-transfer-source-input="${requestId}"
                            data-qc-transfer-expected-source="${escapeHtml(sourceQrLabel)}"
                            placeholder="${escapeHtml(sourceQrLabel || "Source basket QR")}"
                            value="${escapeHtml(transferDraft.sourceQrCode)}"
                            autocomplete="off"
                            spellcheck="false"
                            ${isBusy ? "disabled" : ""}
                          />
                          <small class="muted ${sourceMatched ? "ok-text" : ""}" data-qc-transfer-source-hint>
                            ${escapeHtml(sourceMatched ? "Source confirmed" : "Scan source basket")}
                          </small>
                        </label>
                        <label class="qc-transfer-scan-field">
                          <span>Target scan</span>
                          <input
                            type="text"
                            class="qc-transfer-scan-input"
                            data-qc-transfer-target-input="${requestId}"
                            data-qc-transfer-expected-target="${escapeHtml(reworkQrLabel)}"
                            placeholder="${escapeHtml(reworkQrLabel || "Target basket QR")}"
                            value="${escapeHtml(transferDraft.targetQrCode)}"
                            autocomplete="off"
                            spellcheck="false"
                            ${isBusy ? "disabled" : ""}
                          />
                          <small class="muted ${targetMatched ? "ok-text" : ""}" data-qc-transfer-target-hint>
                            ${escapeHtml(targetMatched ? "Target confirmed" : "Scan RW basket")}
                          </small>
                        </label>
                      </div>
                      <div class="qc-transfer-check-row">
                        <span class="qc-inline-chip ${sourceMatched ? "accent" : ""}">${escapeHtml(sourceMatched ? "Source: OK" : "Source: not confirmed")}</span>
                        <span class="qc-inline-chip ${targetMatched ? "accent" : ""}">${escapeHtml(targetMatched ? "Target: OK" : "Target: not confirmed")}</span>
                      </div>
                      <div class="qc-transfer-task-evidence-wrap">
                        <span class="qc-section-label">Evidence photos</span>
                        <div class="qc-transfer-task-evidence">
                          ${
                            task.source_image_url
                              ? `
                                <button
                                  type="button"
                                  class="secondary"
                                  data-qc-preview-image="${escapeHtml(task.source_image_url)}"
                                  data-qc-preview-title="Photo from sorting"
                                  data-qc-preview-note="${escapeHtml(task.source_image_note || "Original issue item")}"
                                >
                                  Photo from sorting
                                </button>
                              `
                              : ""
                          }
                          ${
                            task.qc_photo_url
                              ? `
                                <button
                                  type="button"
                                  class="secondary"
                                  data-qc-preview-image="${escapeHtml(task.qc_photo_url)}"
                                  data-qc-preview-title="Photo from QC"
                                  data-qc-preview-note="Photo after drying"
                                >
                                  Photo from QC
                                </button>
                              `
                              : ""
                          }
                        </div>
                      </div>
                      <div class="action-row">
                        <button
                          type="button"
                          data-confirm-qc-transfer-task="${requestId}"
                          data-qc-transfer-busy="${isBusy ? "1" : "0"}"
                          data-qc-transfer-task-kind="${escapeHtml(task.task_kind || "transfer_to_rework")}"
                          data-qc-transfer-source="${escapeHtml(transferDraft.sourceQrCode)}"
                          data-qc-transfer-target="${escapeHtml(transferDraft.targetQrCode)}"
                          data-qc-transfer-expected-source="${escapeHtml(sourceQrLabel)}"
                          data-qc-transfer-expected-target="${escapeHtml(reworkQrLabel)}"
                          ${canConfirmTransfer ? "" : "disabled"}
                        >
                          ${isBusy ? "Confirming..." : "Confirm transfer"}
                        </button>
                      </div>
                    </article>
                  `;
                }).join("")
              : '<article class="qc-transfer-task-card"><span class="muted">No active tasks.</span></article>'
          }
        </div>
      </article>
    </section>
  `;
}

function renderQcScanStatus(lastScan, station) {
  if (!lastScan || lastScan.station !== station) return "";
  const stamp = formatScanTime(lastScan.createdAt);
  const stampShort = formatScanTimeShort(lastScan.createdAt);
  const toneClass = lastScan.ok ? "ok" : "error";
  const messageText = lastScan.message || "QR not confirmed.";
  const metaLine = renderQcScanMeta(lastScan, station);
  const basketCode = String(lastScan?.basketCode || "").trim();
  const shortParts = [basketCode, getQcScanShortStatus(lastScan), stampShort].filter(Boolean);
  const compactScanLine = shortParts.length >= 2 ? shortParts.join(" · ") : "";

  return `
    <section class="scan-status ${toneClass} scan-status-compact" data-scan-status="${station}">
      <div class="scan-status-compact-head">
        <span class="scan-status-compact-label">Last scan</span>
      </div>
      <div class="scan-status-compact-body">
        ${
          compactScanLine
            ? `<span class="scan-status-compact-text">${escapeHtml(compactScanLine)}</span>`
            : `
              ${metaLine ? `<span class="scan-status-compact-meta muted">${metaLine}</span>` : ""}
              <span class="scan-status-compact-text">${escapeHtml(messageText)}</span>
              ${stamp ? `<span class="scan-status-compact-time muted">${escapeHtml(stamp)}</span>` : ""}
            `
        }
      </div>
    </section>
  `;
}

function renderQcScanPanel(lastScan, submittingQcDecision, hasInspection) {
  return `
    <section class="qc-panel qc-scan-panel">
      <div class="qc-panel-head">
        <div>
          <div class="qc-section-label">Scan</div>
          <h3>${hasInspection ? "Next basket" : "Scan basket"}</h3>
          <p class="muted">QR opens basket card automatically.</p>
        </div>
      </div>
      <div class="qc-scan-form">
        <input
          class="scan-large qc-command-input"
          id="simple-scan-input"
          data-scan-input-for="qc"
          data-qc-auto-submit="1"
          placeholder="QR:BIN-001"
          autocomplete="off"
          spellcheck="false"
          ${submittingQcDecision ? "disabled" : ""}
        />
        <div class="qc-scan-actions">
          <button
            type="button"
            class="secondary qc-scan-camera"
            data-qc-open-camera
            data-qc-camera-input-id="simple-scan-input"
            ${submittingQcDecision ? "disabled" : ""}
          >
            Open camera
          </button>
        </div>
      </div>
      ${renderQcScanStatus(lastScan, "qc")}
    </section>
  `;
}

export function renderQcWorkbench({
  orders,
  stationMetrics,
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
  qcTransferScanDrafts = {}
}) {
  void orders;
  void stationMetrics;
  const reason = normalizeQcReason(qcRejectReason);
  const hasInspection = Boolean(qcInspection);
  const shellGridClass = hasInspection ? "qc-shell-grid" : "qc-shell-grid is-scan-only";
  const transferRows = Array.isArray(qcTransferTasks) ? qcTransferTasks : [];
  const activeTransferTask = hasInspection
    ? (
        transferRows.find((task) => Number(task.source_basket_id) === Number(qcInspection?.basket?.id))
        || transferRows.find((task) => String(task.source_basket_code || "") === String(qcInspection?.basket?.basket_code || ""))
      )
    : null;
  const modal = renderQcInspectionModal(
    qcInspection,
    reason,
    qcSelectedIssueImageId,
    qcSelectedItemCategory,
    qcSelectedItemLabel,
    qcCurrentPhotoDataUrl,
    qcModalOpen,
    qcModalStep,
    submittingQcDecision
  );

  return `
    <section class="panel simple-scan-shell qc-shell">
      ${renderQcTransferBanner(transferRows, qcTransferPanelOpen, submittingQcTransferRequestId)}
      <div class="${shellGridClass}">
        <div class="qc-shell-scan">
          ${renderQcScanPanel(lastScan, submittingQcDecision, hasInspection)}
        </div>
        ${
          hasInspection
            ? `
              <div class="qc-shell-side">
                ${renderQcCurrentBasketCard(qcInspection, activeTransferTask)}
              </div>
              <div class="qc-shell-actions">
                ${renderQcInlineDecisionCard(qcInspection, submittingQcDecision)}
              </div>
            `
            : ""
        }
      </div>
    </section>
    ${renderQcTransferDrawer(
      transferRows,
      qcTransferPanelOpen,
      submittingQcTransferRequestId,
      qcTransferScanDrafts,
      hasInspection ? Number(qcInspection?.basket?.id || 0) : null
    )}
    ${modal}
  `;
}
