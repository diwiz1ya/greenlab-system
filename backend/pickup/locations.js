"use strict";

const DEFAULT_PICKUP_LOCATION_COUNT = 40;

function toPickupLocationLabel(index) {
  const number = Number(index);
  if (!Number.isInteger(number) || number <= 0) return "";
  return `A${String(number).padStart(2, "0")}`;
}

function toPickupLocationQrCode(label) {
  const normalized = String(label || "").trim().toUpperCase();
  if (!normalized) return "";
  return `QR:LOC-${normalized}`;
}

function normalizePickupLocationQrCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function createDefaultPickupLocationEntries(size = DEFAULT_PICKUP_LOCATION_COUNT) {
  const total = Number.isInteger(size) && size > 0 ? size : DEFAULT_PICKUP_LOCATION_COUNT;
  const entries = [];
  for (let index = 1; index <= total; index += 1) {
    const label = toPickupLocationLabel(index);
    entries.push({
      label,
      qrCode: toPickupLocationQrCode(label)
    });
  }
  return entries;
}

module.exports = {
  DEFAULT_PICKUP_LOCATION_COUNT,
  toPickupLocationLabel,
  toPickupLocationQrCode,
  normalizePickupLocationQrCode,
  createDefaultPickupLocationEntries
};
