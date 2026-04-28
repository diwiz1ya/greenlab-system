"use strict";

const basketItemKeys = ["top", "bottom", "underwear", "socksPairs"];

function normalizeCountValue(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 999) {
    return null;
  }
  return parsed;
}

function normalizeItemCounts(raw, requireAnyItems) {
  const source = raw && typeof raw === "object" ? raw : {};
  const socksSource = source.socksPairs !== undefined ? source.socksPairs : source.socks_pairs;
  const top = normalizeCountValue(source.top);
  const bottom = normalizeCountValue(source.bottom);
  const underwear = normalizeCountValue(source.underwear);
  const socksPairs = normalizeCountValue(socksSource);

  if (top === null || bottom === null || underwear === null || socksPairs === null) {
    return { error: "Item count must be an integer from 0 to 999.", status: 400 };
  }

  const itemCounts = {
    top,
    bottom,
    underwear,
    socksPairs,
    total: top + bottom + underwear + socksPairs
  };

  if (requireAnyItems && itemCounts.total <= 0) {
    return {
      error: "Specify item counts for each basket (minimum 1 item).",
      status: 400
    };
  }

  return { ok: true, itemCounts };
}

function parseBasketItemCounts(rawJson) {
  if (!rawJson) return null;
  try {
    const parsed = JSON.parse(rawJson);
    const normalized = normalizeItemCounts(parsed, false);
    if (normalized.error) return null;
    return normalized.itemCounts;
  } catch {
    return null;
  }
}

function itemCountsToJson(itemCounts) {
  if (!itemCounts) return null;
  return JSON.stringify({
    top: Number(itemCounts.top || 0),
    bottom: Number(itemCounts.bottom || 0),
    underwear: Number(itemCounts.underwear || 0),
    socksPairs: Number(itemCounts.socksPairs || 0)
  });
}

function buildSingleItemCounts(itemCategory, quantity) {
  return {
    top: itemCategory === "top" ? quantity : 0,
    bottom: itemCategory === "bottom" ? quantity : 0,
    underwear: itemCategory === "underwear" ? quantity : 0,
    socksPairs: itemCategory === "socksPairs" ? quantity : 0,
    total: quantity
  };
}

function getRemainingItemCounts(itemCounts, itemCategory, quantity) {
  const normalized = itemCounts || buildSingleItemCounts("top", 0);
  if (!basketItemKeys.includes(itemCategory)) {
    return null;
  }
  if (Number(normalized[itemCategory] || 0) < quantity) {
    return null;
  }

  const next = {
    top: Number(normalized.top || 0),
    bottom: Number(normalized.bottom || 0),
    underwear: Number(normalized.underwear || 0),
    socksPairs: Number(normalized.socksPairs || 0)
  };
  next[itemCategory] -= quantity;
  next.total = next.top + next.bottom + next.underwear + next.socksPairs;
  return next;
}

module.exports = {
  basketItemKeys,
  normalizeItemCounts,
  parseBasketItemCounts,
  itemCountsToJson,
  buildSingleItemCounts,
  getRemainingItemCounts
};
