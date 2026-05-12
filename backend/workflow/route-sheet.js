"use strict";

const routeSheetQrPattern = /^QR:RS-[A-Z0-9][A-Z0-9-]{0,100}$/;
const legacyProductionBinQrPattern = /^QR:BIN-\d{3}$/;
const routeSheetTokenPattern = /^RS-[A-Z0-9][A-Z0-9-]{0,100}$/;
const legacyProductionBinTokenPattern = /^BIN-\d{3}$/;

function normalizeProductionQrCode(value) {
  let normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!normalized) return "";
  normalized = normalized.replace(/^QR[-]/, "QR:");
  if (routeSheetTokenPattern.test(normalized) || legacyProductionBinTokenPattern.test(normalized)) {
    return `QR:${normalized}`;
  }
  return normalized;
}

function toRouteSheetToken(value, fallback = "ORDER") {
  return String(value || fallback)
    .trim()
    .toUpperCase()
    .replace(/^GL-/, "")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || fallback;
}

function buildRouteSheetQr(orderPublicId, index) {
  return `QR:RS-${toRouteSheetToken(orderPublicId)}-${Number(index || 0) + 1}`;
}

function buildReworkRouteSheetQr(reworkCode) {
  return `QR:RS-${toRouteSheetToken(reworkCode, "RW").slice(0, 100)}`;
}

function isRouteSheetQr(qrCode) {
  return routeSheetQrPattern.test(String(qrCode || ""));
}

function isLegacyProductionBinQr(qrCode) {
  return legacyProductionBinQrPattern.test(String(qrCode || ""));
}

function isProductionQr(qrCode) {
  const normalized = normalizeProductionQrCode(qrCode);
  return isRouteSheetQr(normalized) || isLegacyProductionBinQr(normalized);
}

module.exports = {
  routeSheetQrPattern,
  legacyProductionBinQrPattern,
  normalizeProductionQrCode,
  toRouteSheetToken,
  buildRouteSheetQr,
  buildReworkRouteSheetQr,
  isRouteSheetQr,
  isLegacyProductionBinQr,
  isProductionQr
};
