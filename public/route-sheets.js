export const ROUTE_SHEET_QR_PATTERN = /^QR:RS-[A-Z0-9][A-Z0-9-]{0,100}$/;
export const LEGACY_PRODUCTION_BIN_QR_PATTERN = /^QR:BIN-\d{3}$/;

const ROUTE_SHEET_TOKEN_PATTERN = /^RS-[A-Z0-9][A-Z0-9-]{0,100}$/;
const LEGACY_PRODUCTION_BIN_TOKEN_PATTERN = /^BIN-\d{3}$/;

export function normalizeProductionQrCode(value) {
  let normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!normalized) return "";
  normalized = normalized.replace(/^QR[-]/, "QR:");
  if (ROUTE_SHEET_TOKEN_PATTERN.test(normalized) || LEGACY_PRODUCTION_BIN_TOKEN_PATTERN.test(normalized)) {
    return `QR:${normalized}`;
  }
  return normalized;
}

export function isProductionQr(value) {
  const normalized = normalizeProductionQrCode(value);
  return ROUTE_SHEET_QR_PATTERN.test(normalized) || LEGACY_PRODUCTION_BIN_QR_PATTERN.test(normalized);
}

export function toRouteSheetToken(value, fallback = "ORDER") {
  return String(value || fallback)
    .trim()
    .toUpperCase()
    .replace(/^GL-/, "")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || fallback;
}

export function buildRouteSheetQr(orderPublicId, index) {
  return `QR:RS-${toRouteSheetToken(orderPublicId)}-${Number(index || 0) + 1}`;
}
