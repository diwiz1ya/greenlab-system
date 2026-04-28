"use strict";

const DEFAULT_BASKET_POOL_SIZE = 50;

function toBasketLabel(index) {
  const number = Number(index);
  if (!Number.isInteger(number) || number <= 0) {
    return "";
  }
  return `BIN-${String(number).padStart(3, "0")}`;
}

function toBasketQrCode(label) {
  const basketLabel = String(label || "").trim().toUpperCase();
  if (!basketLabel) return "";
  return `QR:${basketLabel}`;
}

function normalizeBasketQrCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function createDefaultBasketCatalogEntries(size = DEFAULT_BASKET_POOL_SIZE) {
  const total = Number.isInteger(size) && size > 0 ? size : DEFAULT_BASKET_POOL_SIZE;
  const entries = [];
  for (let index = 1; index <= total; index += 1) {
    const label = toBasketLabel(index);
    entries.push({
      label,
      qrCode: toBasketQrCode(label)
    });
  }
  return entries;
}

module.exports = {
  DEFAULT_BASKET_POOL_SIZE,
  toBasketLabel,
  toBasketQrCode,
  normalizeBasketQrCode,
  createDefaultBasketCatalogEntries
};
