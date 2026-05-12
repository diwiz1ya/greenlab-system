import { escapeHtml } from "../utils.js";

export const stationStatusLabels = {
  overview: "Overview",
  sorting: "Sorting",
  sorted: "Sorted (waiting for washing)",
  washing: "Washing",
  qc: "QC",
  customer_approval: "Customer approval",
  rework: "Rework",
  rework_transferred: "Transferred to rework",
  drying: "Drying",
  ironing: "Ironing",
  pickup: "Dispatch",
  hold: "HOLD (manager)"
};

const reworkReasonLabels = {
  stain_not_removed: "Stain not removed",
  spot_treatment: "Spot treatment required",
  hand_wash: "Hand wash required",
  extra_treatment: "Extra treatment required"
};

const reworkRequestStatusLabels = {
  pending_customer_approval: "Waiting for customer",
  approved_waiting_transfer: "Approved, waiting transfer",
  declined_waiting_return: "Declined, waiting QC confirmation",
  approved: "Customer approved",
  declined: "Customer declined"
};

const reworkItemLabels = {
  top: "Top",
  bottom: "Bottom",
  underwear: "Underwear",
  socksPairs: "Socks"
};

export function formatOrderWeight(weight) {
  const value = Number(weight);
  if (!Number.isFinite(value) || value <= 0) {
    return "—";
  }
  return `${value.toFixed(2)} kg`;
}

export function formatOrderPhone(phone) {
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

export function getRowItemCounts(row) {
  const source = row && typeof row === "object" ? row : {};
  const rawCounts = source.itemCounts || source.item_counts || {};
  return {
    top: normalizeItemCount(rawCounts.top),
    bottom: normalizeItemCount(rawCounts.bottom),
    underwear: normalizeItemCount(rawCounts.underwear),
    socksPairs: normalizeItemCount(rawCounts.socksPairs ?? rawCounts.socks_pairs)
  };
}

export function getRowItemsTotal(row) {
  const counts = getRowItemCounts(row);
  return counts.top + counts.bottom + counts.underwear + counts.socksPairs;
}

export function getColorToneClass(color) {
  const value = String(color || "");
  if (value === "white") return "tone-white";
  if (value === "color") return "tone-color";
  if (value === "dark") return "tone-dark";
  if (value === "delicate") return "tone-delicate";
  return "tone-mixed";
}

export function getPreviewBasketImageByColor(color) {
  const value = String(color || "mixed");
  if (value === "white") return "/images/baskets/white.png";
  if (value === "color") return "/images/baskets/color.png";
  if (value === "dark") return "/images/baskets/dark.png";
  if (value === "delicate") return "/images/baskets/delicate.png";
  return "/images/baskets/mixed.png";
}

export function inferColorFromBasketType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (type.includes("бел") || type.includes("white")) return "white";
  if (type.includes("цвет") || type.includes("color")) return "color";
  if (type.includes("темн") || type.includes("dark")) return "dark";
  if (type.includes("делик") || type.includes("delicate")) return "delicate";
  return "mixed";
}

export function getPreviewBasketImageByType(basketType, basketKind = "main") {
  if (String(basketKind || "main") === "rework") {
    return "/images/baskets/rework.png";
  }
  return getPreviewBasketImageByColor(inferColorFromBasketType(basketType));
}

export function renderBasketItemsSummary(basket) {
  const counts = getRowItemCounts(basket);
  const total = getRowItemsTotal(basket);
  return `
    <div class="order-basket-items">
      <div class="order-basket-items-total">${escapeHtml(`Total items: ${total}`)}</div>
      <div class="order-basket-items-grid">
        <span class="order-basket-item">${escapeHtml(`Top: ${counts.top}`)}</span>
        <span class="order-basket-item">${escapeHtml(`Bottom: ${counts.bottom}`)}</span>
        <span class="order-basket-item">${escapeHtml(`Underwear: ${counts.underwear}`)}</span>
        <span class="order-basket-item">${escapeHtml(`Socks: ${counts.socksPairs} pairs`)}</span>
      </div>
    </div>
  `;
}

export function formatReworkReasonLabel(value) {
  return reworkReasonLabels[String(value || "").trim()] || "Reason not specified";
}

export function formatReworkRequestStatus(value) {
  return reworkRequestStatusLabels[String(value || "").trim()] || "Status not specified";
}

export function formatReworkItemLabel(value) {
  return reworkItemLabels[String(value || "").trim()] || "Item";
}

export function renderBasketReworkMeta(basket, basketsById = new Map()) {
  if (String(basket?.basket_kind || "main") !== "rework") return "";

  const parentBasket = basketsById.get(basket.parent_basket_id);
  const parentCode = parentBasket?.basket_code || "Source basket";
  const reasonLabel = formatReworkReasonLabel(basket.rework_reason);
  const attempt = Number(basket.rework_attempt || 0) || 1;

  return `
    <div class="muted">${escapeHtml(`${parentCode} -> ${basket.basket_code} · ${reasonLabel} · attempt ${attempt}`)}</div>
  `;
}

export function renderBasketImageStrip(images) {
  const rows = Array.isArray(images) ? images.filter(Boolean) : [];
  if (!rows.length) return "";
  return `
    <div class="order-basket-image-strip">
      ${rows.map((image) => `
        <figure class="order-basket-image-chip">
          <img src="${escapeHtml(image.public_url || image.dataUrl || "")}" alt="" loading="lazy" />
          <figcaption>${escapeHtml(image.note || (image.role === "issue" ? "Issue item" : "Overview photo"))}</figcaption>
        </figure>
      `).join("")}
    </div>
  `;
}

export function getOrderProgressLabel(order) {
  if (order.status === "hold") {
    return "HOLD";
  }
  if (order.status === "customer_approval") {
    return "Approval";
  }
  const cleanCloudStatus = String(order.cleancloud_status || "").toLowerCase();
  if (cleanCloudStatus.includes("issued") || cleanCloudStatus.includes("completed")) {
    return "Issued";
  }
  if (order.status === "pickup" && order.ready_for_pickup) {
    return "Ready for handoff";
  }
  if (order.status === "pickup" && order.ready_to_place) {
    return "Ready to place";
  }
  const isHandoverAwaitingClose = order.status === "pickup" && !order.ready_for_pickup
    && cleanCloudStatus.includes("awaiting close");
  return isHandoverAwaitingClose ? "Issued" : "In progress";
}
