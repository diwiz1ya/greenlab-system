"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { getLastInsertRowId } = require("../db/statement-result");
const { normalizeBasketQrCode } = require("./basket-pool");
const { parseImageDataUrl, validateImageBuffer } = require("./image-safety");

function createSortingWorkflow(options) {
  const {
    db,
    sortingRepository,
    nowIso,
    publicUploadsDir,
    getOrderDetails,
    queueSync,
    normalizeItemCounts,
    itemCountsToJson
  } = options;

  const basketImageRoles = new Set(["overview", "issue"]);
  const maxOverviewBasketPhotos = 1;
  const maxIssueBasketPhotos = 10;
  const maxBasketPhotos = maxOverviewBasketPhotos + maxIssueBasketPhotos;
  const maxBasketImageBytes = 8 * 1024 * 1024;

  fs.mkdirSync(publicUploadsDir, { recursive: true });

  function sanitizeBasketPhotoNote(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    return text.slice(0, 160);
  }

  function normalizeBasketPhoto(rawPhoto, fallbackRole = "issue") {
    const binaryBuffer = Buffer.isBuffer(rawPhoto?.fileBuffer) ? rawPhoto.fileBuffer : null;
    const binaryMime = String(rawPhoto?.mimeType || rawPhoto?.mime_type || "").trim().toLowerCase();
    const imageData = String(rawPhoto?.dataUrl || rawPhoto?.data_url || rawPhoto?.src || "").trim();
    const hasInlineData = imageData.startsWith("data:image/");
    const hasBinaryData = Boolean(binaryBuffer && binaryBuffer.length > 0 && binaryMime.startsWith("image/"));
    if (!hasInlineData && !hasBinaryData) {
      return null;
    }

    const role = String(rawPhoto?.role || fallbackRole || "issue").trim().toLowerCase();
    const safeRole = basketImageRoles.has(role) ? role : fallbackRole;

    return {
      role: safeRole,
      note: sanitizeBasketPhotoNote(rawPhoto?.note),
      dataUrl: hasInlineData ? imageData : "",
      fileBuffer: hasBinaryData ? binaryBuffer : null,
      mimeType: hasBinaryData ? binaryMime : ""
    };
  }

  function normalizeBasketPhotos(rawPhotos) {
    if (!Array.isArray(rawPhotos) || !rawPhotos.length) {
      return [];
    }

    const normalized = [];
    let overviewCount = 0;
    let issueCount = 0;

    for (const rawPhoto of rawPhotos) {
      if (normalized.length >= maxBasketPhotos) break;

      const fallbackRole = overviewCount === 0 ? "overview" : "issue";
      const photo = normalizeBasketPhoto(rawPhoto, fallbackRole);
      if (!photo) continue;

      if (photo.role === "overview") {
        if (overviewCount >= maxOverviewBasketPhotos) continue;
        overviewCount += 1;
      } else {
        if (issueCount >= maxIssueBasketPhotos) continue;
        issueCount += 1;
      }

      normalized.push(photo);
    }

    return normalized;
  }

  function normalizeLabelPrintedAt(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }

  function normalizeLabelPrintCount(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.min(999, Math.floor(parsed));
  }

  function listKnownCatalogQrs() {
    return sortingRepository.listKnownCatalogQrs().map((row) => normalizeBasketQrCode(row.qr_code)).filter(Boolean);
  }

  function listFreeCatalogQrs(limit, excludeOrderId = 0) {
    const size = Number.isInteger(limit) ? Math.max(0, limit) : 0;
    if (size <= 0) return [];
    return sortingRepository.listFreeCatalogQrs({ limit: size, excludeOrderId })
      .map((row) => normalizeBasketQrCode(row.qr_code))
      .filter(Boolean);
  }

  function assignAndValidateCatalogQrs(baskets, options = {}) {
    const list = Array.isArray(baskets) ? baskets : [];
    const excludeOrderId = Number(options.excludeOrderId || 0);
    const knownQrs = new Set(listKnownCatalogQrs());
    const missingIndexes = [];

    for (let index = 0; index < list.length; index += 1) {
      const basket = list[index];
      basket.qrCode = normalizeBasketQrCode(basket?.qrCode || "");
      if (!basket.qrCode) {
        missingIndexes.push(index);
      }
    }

    if (missingIndexes.length) {
      const freeQrs = listFreeCatalogQrs(missingIndexes.length, excludeOrderId);
      if (freeQrs.length < missingIndexes.length) {
        return {
          error: `Not enough free baskets in BIN pool (needed ${missingIndexes.length}, available ${freeQrs.length}).`,
          status: 409
        };
      }
      for (let index = 0; index < missingIndexes.length; index += 1) {
        const basketIndex = missingIndexes[index];
        list[basketIndex].qrCode = freeQrs[index];
      }
    }

    for (const basket of list) {
      if (!knownQrs.has(basket.qrCode)) {
        return {
          error: `QR ${basket.qrCode} is not present in BIN basket catalog BIN-001..BIN-050.`,
          status: 400
        };
      }
    }

    return { ok: true, baskets: list };
  }

  async function writeBasketPhotoFile(orderId, basketCode, photo, sortOrder) {
    let declaredMimeType = "";
    let buffer = null;

    if (Buffer.isBuffer(photo?.fileBuffer) && photo.fileBuffer.length > 0) {
      declaredMimeType = String(photo?.mimeType || "").trim().toLowerCase();
      buffer = photo.fileBuffer;
    } else {
      const parsed = parseImageDataUrl(photo?.dataUrl || "");
      declaredMimeType = parsed.declaredMimeType;
      buffer = parsed.buffer;
    }

    const checked = validateImageBuffer(buffer, {
      declaredMimeType,
      maxBytes: maxBasketImageBytes
    });
    const extension = checked.extension;
    const fileName = `${orderId}-${basketCode}-${photo.role}-${sortOrder + 1}-${Date.now()}.${extension}`;
    const absolutePath = path.join(publicUploadsDir, fileName);
    await fsp.writeFile(absolutePath, buffer);
    return {
      filePath: absolutePath,
      publicUrl: `/uploads/baskets/${fileName}`
    };
  }

  function deleteBasketImageFilesByBasketIds(basketIds) {
    if (!Array.isArray(basketIds) || !basketIds.length) return;
    const images = sortingRepository.listBasketImagesByBasketIds(basketIds);

    for (const image of images) {
      try {
        if (image.file_path && fs.existsSync(image.file_path)) {
          fs.unlinkSync(image.file_path);
        }
      } catch {
        // ignore file cleanup errors in demo mode
      }
    }

    sortingRepository.deleteBasketImagesByBasketIds(basketIds);
  }

  function deleteBasketAssetsByOrderId(orderId) {
    const basketIds = sortingRepository.listBasketIdsByOrder(orderId);
    deleteBasketImageFilesByBasketIds(basketIds);
  }

  async function saveBasketPhotos(basketId, orderId, basketCode, photos, timestamp) {
    for (let index = 0; index < photos.length; index += 1) {
      const photo = photos[index];
      const stored = await writeBasketPhotoFile(orderId, basketCode, photo, index);
      sortingRepository.insertBasketImage({
        basketId,
        role: photo.role,
        sortOrder: index,
        note: photo.note || null,
        filePath: stored.filePath,
        publicUrl: stored.publicUrl,
        timestamp
      });
    }
  }

  function normalizeBasketDefinitions(payload) {
    const sourceTypes = Array.isArray(payload)
      ? payload
      : (Array.isArray(payload?.types) ? payload.types : []);
    const sourceBaskets = Array.isArray(payload?.baskets) ? payload.baskets : [];

    if (sourceBaskets.length) {
      const normalized = [];
      const usedQrCodes = new Set();

      for (const basket of sourceBaskets.slice(0, 20)) {
        const type = String(basket?.type || "").trim();
        if (!type) {
          return { error: "Specify linen type for each basket.", status: 400 };
        }
        const qrCode = normalizeBasketQrCode(String(basket?.qrCode || basket?.qr_code || ""));
        if (qrCode) {
          if (qrCode.length > 120) {
            return { error: "Basket QR is too long.", status: 400 };
          }
          if (usedQrCodes.has(qrCode)) {
            return { error: `QR ${qrCode} was added to the order multiple times.`, status: 400 };
          }
          usedQrCodes.add(qrCode);
        }

        const counts = normalizeItemCounts(
          basket?.itemCounts !== undefined ? basket.itemCounts : basket?.item_counts,
          true
        );
        if (counts.error) {
          return counts;
        }

        normalized.push({
          type,
          itemCounts: counts.itemCounts,
          photos: normalizeBasketPhotos(basket?.photos),
          qrCode,
          labelPrintedAt: normalizeLabelPrintedAt(basket?.labelPrintedAt || basket?.label_printed_at),
          labelPrintCount: normalizeLabelPrintCount(basket?.labelPrintCount ?? basket?.label_print_count)
        });
      }

      if (!normalized.length) {
        return { error: "Add at least one basket before starting sorting.", status: 400 };
      }

      return { ok: true, baskets: normalized };
    }

    const normalizedTypes = sourceTypes
      .map((type) => String(type || "").trim())
      .filter(Boolean)
      .slice(0, 20);

    if (!normalizedTypes.length) {
      return { error: "Add at least one basket before starting sorting.", status: 400 };
    }

    return {
      ok: true,
      baskets: normalizedTypes.map((type) => ({
        type,
        itemCounts: null,
        photos: [],
        qrCode: "",
        labelPrintedAt: null,
        labelPrintCount: 0
      }))
    };
  }

  function findConflictingQrCode(qrCodes, excludeOrderId = 0) {
    const list = Array.isArray(qrCodes)
      ? qrCodes.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    if (!list.length) return null;

    for (const qrCode of list) {
      const row = sortingRepository.findConflictingQrCode({ qrCode, excludeOrderId });
      if (row?.qr_code) return row.qr_code;
    }
    return null;
  }

  async function insertBaskets(order, baskets, timestamp) {
    const insertBasket = db.prepare(`
      INSERT INTO baskets (
        order_id, basket_code, basket_type, basket_items_json, station, status, qr_code,
        label_printed_at, label_print_count, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, 'washing', 'washing', ?, ?, ?, ?, ?)
    `);

    for (let index = 0; index < baskets.length; index += 1) {
      const basket = baskets[index];
      const basketCode = `B-${order.public_id.slice(3)}-${index + 1}`;
      const qrCode = normalizeBasketQrCode(basket?.qrCode || "");
      if (!qrCode) {
        throw new Error("Basket QR is not specified.");
      }
      const insertBasketResult = insertBasket.run(
        order.id,
        basketCode,
        basket.type,
        basket.itemCounts ? itemCountsToJson(basket.itemCounts) : null,
        qrCode,
        basket.labelPrintedAt || null,
        normalizeLabelPrintCount(basket.labelPrintCount),
        timestamp,
        timestamp
      );
      const basketId = getLastInsertRowId(insertBasketResult, "basket");
      if (Array.isArray(basket.photos) && basket.photos.length) {
        await saveBasketPhotos(basketId, order.id, basketCode, basket.photos, timestamp);
      }
    }
  }

  async function createBaskets(orderId, payload, actor) {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
    if (!order) {
      return { error: "Order not found.", status: 404 };
    }
    if (order.status !== "sorting") {
      return { error: "Order is not at sorting station.", status: 400 };
    }

    const existing = db.prepare("SELECT COUNT(*) AS count FROM baskets WHERE order_id = ?").get(orderId).count;
    if (existing > 0) {
      return { error: "Baskets are already created.", status: 400 };
    }

    const normalized = normalizeBasketDefinitions(payload);
    if (normalized.error) {
      return normalized;
    }
    const prepared = assignAndValidateCatalogQrs(normalized.baskets, { excludeOrderId: 0 });
    if (prepared.error) {
      return prepared;
    }
    const qrConflict = findConflictingQrCode(prepared.baskets.map((basket) => basket.qrCode));
    if (qrConflict) {
      return { error: `QR ${qrConflict} is already used by another order.`, status: 409 };
    }

    const timestamp = nowIso();
    try {
      await insertBaskets(order, prepared.baskets, timestamp);
    } catch (error) {
      if (String(error?.message || "").includes("UNIQUE constraint failed: baskets.qr_code")) {
        return { error: "One of the QR codes is already used by another order. Check that the basket is free.", status: 409 };
      }
      return { error: error?.message || "Failed to create baskets.", status: 500 };
    }

    db.prepare(`
      UPDATE orders
      SET status = 'sorted', cleancloud_status = 'In progress', ready_to_place = 0, ready_for_pickup = 0, updated_at = ?
      WHERE id = ?
    `).run(timestamp, orderId);

    db.prepare(`
      INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
      VALUES (?, NULL, 'sorting', ?, 'ok', 'Baskets created, QR labels prepared. Order is waiting for washing.', ?)
    `).run(orderId, actor, timestamp);

    queueSync(orderId, "cleancloud.status", {
      orderId: order.cleancloud_order_id,
      status: "In progress"
    });

    return { ok: true, order: getOrderDetails(orderId) };
  }

  async function updateSortedBaskets(orderId, payload, actor) {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
    if (!order) {
      return { error: "Order not found.", status: 404 };
    }
    if (order.status !== "sorted") {
      return { error: "Editing is available only for orders waiting for washing.", status: 400 };
    }

    const normalized = normalizeBasketDefinitions(payload);
    if (normalized.error) {
      return normalized;
    }
    const prepared = assignAndValidateCatalogQrs(normalized.baskets, { excludeOrderId: orderId });
    if (prepared.error) {
      return prepared;
    }
    const qrConflict = findConflictingQrCode(prepared.baskets.map((basket) => basket.qrCode), orderId);
    if (qrConflict) {
      return { error: `QR ${qrConflict} is already used by another order.`, status: 409 };
    }

    const basketCount = db.prepare("SELECT COUNT(*) AS count FROM baskets WHERE order_id = ?").get(orderId).count;
    if (!basketCount) {
      return { error: "Order has no baskets to edit.", status: 400 };
    }

    const timestamp = nowIso();
    try {
      deleteBasketAssetsByOrderId(orderId);
      db.prepare("DELETE FROM baskets WHERE order_id = ?").run(orderId);
      await insertBaskets(order, prepared.baskets, timestamp);
    } catch (error) {
      if (String(error?.message || "").includes("UNIQUE constraint failed: baskets.qr_code")) {
        return { error: "One of the QR codes is already used by another order. Check that the basket is free.", status: 409 };
      }
      return { error: error?.message || "Failed to update baskets.", status: 500 };
    }

    db.prepare(`
      UPDATE orders
      SET status = 'sorted', cleancloud_status = 'In progress', ready_to_place = 0, ready_for_pickup = 0, updated_at = ?
      WHERE id = ?
    `).run(timestamp, orderId);

    db.prepare(`
      INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
      VALUES (?, NULL, 'sorting', ?, 'ok', ?, ?)
    `).run(
      orderId,
      actor,
      `Basket set updated: ${normalized.baskets.length} pcs. Order remains waiting for washing.`,
      timestamp
    );

    return { ok: true, order: getOrderDetails(orderId) };
  }

  function returnSortedOrderToSorting(orderId, actor) {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
    if (!order) {
      return { error: "Order not found.", status: 404 };
    }
    if (order.status !== "sorted") {
      return { error: "Return is available only for orders waiting for washing.", status: 400 };
    }

    const basketCount = db.prepare("SELECT COUNT(*) AS count FROM baskets WHERE order_id = ?").get(orderId).count;
    if (!basketCount) {
      return { error: "Order has no baskets to return to sorting.", status: 400 };
    }

    const timestamp = nowIso();
    deleteBasketAssetsByOrderId(orderId);
    db.prepare("DELETE FROM baskets WHERE order_id = ?").run(orderId);

    db.prepare(`
      UPDATE orders
      SET status = 'sorting', cleancloud_status = 'New order', ready_to_place = 0, ready_for_pickup = 0, updated_at = ?
      WHERE id = ?
    `).run(timestamp, orderId);

    db.prepare(`
      INSERT INTO scan_events (order_id, basket_id, station, actor, result, message, created_at)
      VALUES (?, NULL, 'sorting', ?, 'ok', 'Order returned to sorting. Baskets were removed, new split is required.', ?)
    `).run(orderId, actor, timestamp);

    queueSync(orderId, "cleancloud.status", {
      orderId: order.cleancloud_order_id,
      status: "New order"
    });

    return { ok: true, order: getOrderDetails(orderId) };
  }

  return {
    createBaskets,
    updateSortedBaskets,
    returnSortedOrderToSorting
  };
}

module.exports = {
  createSortingWorkflow
};
