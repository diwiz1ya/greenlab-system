import { api } from "../api.js";
import { app, clearLastScan, setNotice, state } from "../state.js";
import { renderSortingEditorModal } from "../render/sorting.js";
import { escapeHtml } from "../utils.js";

const sortingColorLabels = {
  mixed: "Mixed",
  white: "White",
  color: "Colored",
  dark: "Dark",
  delicate: "Delicate"
};

const sortingColorImages = {
  mixed: "/images/baskets/mixed.png",
  white: "/images/baskets/white.png",
  color: "/images/baskets/color.png",
  dark: "/images/baskets/dark.png",
  delicate: "/images/baskets/delicate.png"
};

const sortingItemKeys = ["top", "bottom", "underwear", "socksPairs"];
const sortingMaxOverviewPhotos = 1;
const sortingMaxIssuePhotos = 10;
const sortingMaxTotalPhotos = sortingMaxOverviewPhotos + sortingMaxIssuePhotos;
const sortingMaxBasketsPerOrder = 20;
const sortingPhotoMaxDimension = 1600;
const sortingPhotoJpegQuality = 0.74;
const sortingPhotoTargetDataUrlChars = 800000;
const sortingQrScannerState = {
  stream: null,
  intervalId: null,
  active: false,
  detector: null,
  html5Qrcode: null,
  lastErrorMessage: ""
};

function inferSortingColorFromBasketType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (!type) return "mixed";
  if (type.includes("white")) return "white";
  if (type.includes("color")) return "color";
  if (type.includes("dark")) return "dark";
  if (type.includes("delicate")) return "delicate";
  return "mixed";
}

function normalizeSortingItemCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(999, Math.floor(parsed)));
}

function normalizeSortingPrintCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(999, Math.floor(parsed)));
}

function normalizeSortingPrintedAt(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeSortingItemCounts(value) {
  const source = value && typeof value === "object" ? value : {};
  const socksSource = source.socksPairs !== undefined ? source.socksPairs : source.socks_pairs;
  return {
    top: normalizeSortingItemCount(source.top),
    bottom: normalizeSortingItemCount(source.bottom),
    underwear: normalizeSortingItemCount(source.underwear),
    socksPairs: normalizeSortingItemCount(socksSource)
  };
}

function getSortingRowItemsTotal(row) {
  const counts = normalizeSortingItemCounts(row?.itemCounts);
  return counts.top + counts.bottom + counts.underwear + counts.socksPairs;
}

function normalizeSortingPhotos(value) {
  if (!Array.isArray(value)) return [];
  const normalized = [];
  let overviewCount = 0;
  let issueCount = 0;

  for (const photo of value) {
    if (normalized.length >= sortingMaxTotalPhotos) break;

    const dataUrl = String(photo?.dataUrl || photo?.data_url || photo?.public_url || photo?.src || "").trim();
    if (!dataUrl) continue;

    const fallbackRole = overviewCount === 0 ? "overview" : "issue";
    const roleRaw = String(photo?.role || fallbackRole).trim().toLowerCase();
    const role = roleRaw === "overview" ? "overview" : "issue";
    if (role === "overview") {
      if (overviewCount >= sortingMaxOverviewPhotos) continue;
      overviewCount += 1;
    } else {
      if (issueCount >= sortingMaxIssuePhotos) continue;
      issueCount += 1;
    }

    normalized.push({
      role,
      note: String(photo?.note || "").trim().slice(0, 160),
      dataUrl
    });
  }

  return normalized;
}

function buildBasketType(row, index) {
  const color = sortingColorLabels[row.color] || sortingColorLabels.mixed;
  return `${color} #${index + 1}`;
}

function buildBasketPayload(row, index) {
  const qrCode = normalizeSortingQr(row?.scannedQr);
  return {
    type: buildBasketType(row, index),
    itemCounts: normalizeSortingItemCounts(row?.itemCounts),
    photos: normalizeSortingPhotos(row?.photos),
    qrCode: qrCode || null,
    labelPrintedAt: normalizeSortingPrintedAt(row?.labelPrintedAt || row?.label_printed_at),
    labelPrintCount: normalizeSortingPrintCount(row?.labelPrintCount ?? row?.label_print_count)
  };
}

function getPhotoFileExtension(mimeType) {
  const type = String(mimeType || "").toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  return "jpg";
}

function dataUrlToPhotoBlob(dataUrl) {
  const source = String(dataUrl || "").trim();
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(source);
  if (!match) return null;

  try {
    const mimeType = String(match[1] || "application/octet-stream");
    const decoded = atob(match[2]);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return new Blob([bytes], { type: mimeType });
  } catch {
    return null;
  }
}

function buildSortingMultipartBody(orderId, baskets) {
  const formData = new FormData();
  const payloadBaskets = baskets.map((basket, basketIndex) => {
    const photos = Array.isArray(basket?.photos) ? basket.photos : [];
    const payloadPhotos = [];

    for (let photoIndex = 0; photoIndex < photos.length; photoIndex += 1) {
      const photo = photos[photoIndex];
      const role = String(photo?.role || "").trim().toLowerCase() === "overview" ? "overview" : "issue";
      const note = String(photo?.note || "").trim().slice(0, 160);
      const blob = dataUrlToPhotoBlob(photo?.dataUrl || photo?.data_url);
      if (blob) {
        const fieldName = `basket_photo_${basketIndex}_${photoIndex}`;
        const extension = getPhotoFileExtension(blob.type);
        formData.append(fieldName, blob, `${fieldName}.${extension}`);
        payloadPhotos.push({
          role,
          note,
          uploadField: fieldName
        });
        continue;
      }

      const dataUrl = String(photo?.dataUrl || photo?.data_url || "").trim();
      if (dataUrl.startsWith("data:image/")) {
        payloadPhotos.push({
          role,
          note,
          dataUrl
        });
      }
    }

    return {
      type: String(basket?.type || "").trim(),
      itemCounts: basket?.itemCounts || null,
      photos: payloadPhotos,
      qrCode: basket?.qrCode || null,
      labelPrintedAt: basket?.labelPrintedAt || null,
      labelPrintCount: Number(basket?.labelPrintCount ?? 0)
    };
  });

  formData.append("payload", JSON.stringify({ orderId, baskets: payloadBaskets }));
  return formData;
}

function createClientIdempotencyKey(prefix) {
  const safePrefix = String(prefix || "req")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .slice(0, 60) || "req";
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${safePrefix}-${randomPart}`;
}

function createSortingRow(seed = null) {
  const source = seed || {};
  return {
    color: sortingColorLabels[source.color] ? source.color : "mixed",
    itemCounts: normalizeSortingItemCounts(source.itemCounts || source.item_counts),
    itemsExpanded: Boolean(source.itemsExpanded),
    photos: normalizeSortingPhotos(source.photos || source.images),
    scannedQr: normalizeSortingQr(source.scannedQr || source.qrCode || source.qr_code),
    labelPrintedAt: normalizeSortingPrintedAt(source.labelPrintedAt || source.label_printed_at),
    labelPrintCount: normalizeSortingPrintCount(source.labelPrintCount ?? source.label_print_count)
  };
}

function buildSortingRowsFromOrderDetails(order) {
  const baskets = Array.isArray(order?.baskets) ? order.baskets : [];
  if (!baskets.length) return [];

  return baskets.map((basket, index) => {
    const itemCounts = normalizeSortingItemCounts(basket?.item_counts);
    const total = itemCounts.top + itemCounts.bottom + itemCounts.underwear + itemCounts.socksPairs;
    return createSortingRow({
      color: inferSortingColorFromBasketType(basket?.basket_type),
      itemCounts,
      itemsExpanded: total <= 0 || index === 0,
      photos: basket?.images || [],
      scannedQr: basket?.qr_code || "",
      labelPrintedAt: basket?.label_printed_at || null,
      labelPrintCount: basket?.label_print_count || 0
    });
  });
}

function normalizeSortingQr(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeSortingWizardStep(value) {
  const parsed = Number(value);
  if (parsed === 2 || parsed === 3) return parsed;
  return 1;
}

function clampSortingRowIndex(index, rowsLength) {
  const parsed = Number(index);
  if (!Number.isInteger(parsed)) return 0;
  if (rowsLength <= 0) return 0;
  return Math.max(0, Math.min(parsed, rowsLength - 1));
}

function ensureSortingDraft(orderId) {
  if (!state.sortingDrafts[orderId] || !Array.isArray(state.sortingDrafts[orderId].rows)) {
    state.sortingDrafts[orderId] = {
      rows: [],
      wizardStep: 1,
      activeRowIndex: 0,
      scanInput: ""
    };
  }
  const draft = state.sortingDrafts[orderId];
  draft.wizardStep = normalizeSortingWizardStep(draft.wizardStep);
  draft.activeRowIndex = clampSortingRowIndex(draft.activeRowIndex, draft.rows.length);
  draft.scanInput = String(draft.scanInput || "");
  return draft;
}

function setSortingWizardStep(orderId, step) {
  const draft = ensureSortingDraft(orderId);
  draft.wizardStep = normalizeSortingWizardStep(step);
}

function setSortingActiveRow(orderId, index) {
  const draft = ensureSortingDraft(orderId);
  draft.activeRowIndex = clampSortingRowIndex(index, draft.rows.length);
}

function returnToSortingFillStep(orderId) {
  const draft = ensureSortingDraft(orderId);
  if (!draft.rows.length) {
    setSortingWizardStep(orderId, 1);
    setSortingActiveRow(orderId, 0);
    return;
  }
  const firstEmptyIndex = findFirstEmptySortingRowIndex(draft.rows);
  const targetIndex = firstEmptyIndex >= 0 ? firstEmptyIndex : (draft.rows.length - 1);
  setSortingWizardStep(orderId, 2);
  setSortingActiveRow(orderId, targetIndex);
}

function setSortingRowCount(orderId, nextCount) {
  const draft = ensureSortingDraft(orderId);
  const count = Math.max(0, Math.min(Number(nextCount) || 0, sortingMaxBasketsPerOrder));
  const existing = draft.rows.slice(0, count).map((row) => createSortingRow(row));
  while (existing.length < count) {
    existing.push(createSortingRow({ itemsExpanded: true }));
  }
  draft.rows = existing;
  draft.activeRowIndex = clampSortingRowIndex(draft.activeRowIndex, draft.rows.length);
}

function getToneClass(color) {
  if (color === "white") return "tone-white";
  if (color === "color") return "tone-color";
  if (color === "dark") return "tone-dark";
  if (color === "delicate") return "tone-delicate";
  return "tone-mixed";
}

function applyToneClass(element, toneClass) {
  if (!element) return;
  element.classList.remove("tone-mixed", "tone-white", "tone-color", "tone-dark", "tone-delicate");
  element.classList.add(toneClass);
}

function getSortingColorImage(color) {
  return sortingColorImages[color] || sortingColorImages.mixed;
}

function updateSortingChoiceDom(target, rowIndex, rowValue) {
  const row = target.closest(".sorting-row");
  if (row) {
    for (const chip of row.querySelectorAll(".sorting-chip")) {
      chip.classList.toggle("active", chip === target);
    }
    const selected = row.querySelector(".sorting-row-selected span");
    if (selected) {
      selected.textContent = sortingColorLabels[rowValue] || sortingColorLabels.mixed;
    }
    applyToneClass(row, getToneClass(rowValue));
  }

  const modal = app.querySelector(".sorting-modal");
  if (!modal) return;

  const preview =
    modal.querySelector(`.sorting-preview-item[data-preview-row-index="${rowIndex}"]`) ||
    modal.querySelectorAll(".sorting-preview-item")[rowIndex];
  if (preview) {
    applyToneClass(preview, getToneClass(rowValue));
    const previewImage = preview.querySelector(".sorting-preview-basket-image");
    if (previewImage) {
      previewImage.setAttribute("src", getSortingColorImage(rowValue));
    }
    const previewText = preview.querySelector(".sorting-preview-type");
    if (previewText) {
      previewText.textContent = `${sortingColorLabels[rowValue] || sortingColorLabels.mixed} #${rowIndex + 1}`;
    }
  }
}

function getSortingModalOrder(orderId) {
  const sheet = app.querySelector(".sorting-modal-sheet");
  if (!sheet) return null;

  const sheetOrderId = Number(sheet.dataset.sortingOrderId);
  if (!Number.isFinite(sheetOrderId) || sheetOrderId !== orderId) return null;

  return {
    id: sheetOrderId,
    public_id: String(sheet.dataset.sortingPublicId || "").trim(),
    customer_name: String(sheet.dataset.sortingCustomerName || "").trim(),
    order_weight: (() => {
      const weight = Number(String(sheet.dataset.sortingOrderWeight || "").trim());
      return Number.isFinite(weight) && weight > 0 ? weight : null;
    })(),
    customer_phone: String(sheet.dataset.sortingOrderPhone || "").trim() || null,
    status: String(sheet.dataset.sortingOrderStatus || "").trim() || null,
    sortingMode: String(sheet.dataset.sortingMode || "").trim() || null
  };
}

function syncModalBodyClass() {
  const hasModal = Boolean(app.querySelector(".sorting-modal, .qc-modal, .order-modal"));
  document.body.classList.toggle("modal-open", hasModal);
}

function focusSortingScanInput(orderId) {
  setTimeout(() => {
    const input = app.querySelector(`[data-sorting-basket-scan-input="${orderId}"]`);
    if (!input) return;
    input.focus();
    if (typeof input.select === "function") input.select();
  }, 0);
}

function setSortingQrScannerStatus(message, tone = "") {
  const status = app.querySelector("[data-sorting-qr-status]");
  if (!status) return;
  status.textContent = String(message || "");
  status.classList.remove("ok", "error");
  if (tone === "ok" || tone === "error") {
    status.classList.add(tone);
  }
}

function getHtml5QrcodeClass() {
  const value = window?.Html5Qrcode;
  return typeof value === "function" ? value : null;
}

function isHtml5QrcodeAvailable() {
  return Boolean(getHtml5QrcodeClass());
}

function isLikelyIPhoneWebkit() {
  const ua = String(navigator?.userAgent || "");
  return /iPhone|iPad|iPod/i.test(ua);
}

function shouldPreferHtml5Scanner() {
  return isLikelyIPhoneWebkit() && isHtml5QrcodeAvailable();
}

function closeSortingQrScanner() {
  if (sortingQrScannerState.intervalId) {
    clearInterval(sortingQrScannerState.intervalId);
    sortingQrScannerState.intervalId = null;
  }

  if (sortingQrScannerState.stream) {
    for (const track of sortingQrScannerState.stream.getTracks()) {
      track.stop();
    }
    sortingQrScannerState.stream = null;
  }

  sortingQrScannerState.active = false;
  sortingQrScannerState.detector = null;
  if (sortingQrScannerState.html5Qrcode) {
    const scanner = sortingQrScannerState.html5Qrcode;
    sortingQrScannerState.html5Qrcode = null;
    try {
      const stopResult = typeof scanner.stop === "function" ? scanner.stop() : null;
      if (stopResult && typeof stopResult.then === "function") {
        stopResult
          .catch(() => {})
          .finally(() => {
            try {
              if (typeof scanner.clear === "function") scanner.clear();
            } catch {
              // ignore scanner clear errors
            }
          });
      } else if (typeof scanner.clear === "function") {
        scanner.clear();
      }
    } catch {
      try {
        if (typeof scanner.clear === "function") scanner.clear();
      } catch {
        // ignore scanner clear errors
      }
    }
  }

  const scanner = app.querySelector("[data-sorting-qr-scanner]");
  if (scanner) {
    scanner.remove();
  }
}

function isSortingBarcodeDetectorAvailable() {
  return "BarcodeDetector" in window;
}

function isSortingLiveQrScannerAvailable() {
  return isSortingBarcodeDetectorAvailable() || isHtml5QrcodeAvailable();
}

function isSortingSecureCameraContext() {
  return Boolean(window?.isSecureContext);
}

function getSortingScannerErrorDetails(error) {
  const name = String(error?.name || "Error").trim();
  const message = String(error?.message || "").trim();
  return message ? `${name}: ${message}` : name;
}

async function startSortingHtml5Scanner(scanner, onSuccess, onError) {
  const Html5Qrcode = getHtml5QrcodeClass();
  if (!Html5Qrcode) {
    throw new Error("Html5Qrcode API is unavailable");
  }

  const attempts = [
    { label: "facingMode=environment (exact)", cameraConfig: { facingMode: { exact: "environment" } } },
    { label: "facingMode=environment", cameraConfig: { facingMode: "environment" } }
  ];

  if (typeof Html5Qrcode.getCameras === "function") {
    try {
      const cameras = await Html5Qrcode.getCameras();
      if (Array.isArray(cameras) && cameras.length) {
        const preferred =
          cameras.find((camera) => /back|rear|environment/i.test(String(camera?.label || ""))) || cameras[0];
        if (preferred?.id) {
          attempts.push({
            label: `cameraId=${String(preferred.label || preferred.id || "unknown")}`,
            cameraConfig: preferred.id
          });
        }
      }
    } catch {
      // keep facingMode attempts
    }
  }

  const errors = [];
  for (const attempt of attempts) {
    try {
      await scanner.start(
        attempt.cameraConfig,
        {
          fps: 10,
          qrbox: { width: 260, height: 260 }
        },
        onSuccess,
        onError
      );
      return;
    } catch (error) {
      errors.push(`${attempt.label} -> ${getSortingScannerErrorDetails(error)}`);
    }
  }

  throw new Error(errors.join(" | "));
}

function openSortingQrCameraCapture(orderId) {
  const cameraInput = app.querySelector(`[data-sorting-qr-camera-input="${orderId}"]`);
  if (!(cameraInput instanceof HTMLInputElement)) return false;
  cameraInput.value = "";
  cameraInput.click();
  return true;
}

async function decodeSortingQrFromCameraPhoto(file) {
  if (!(file instanceof File)) return "";
  if (shouldPreferHtml5Scanner()) {
    const result = await decodeSortingQrWithHtml5Qrcode(file);
    if (result) return result;
  }

  if (isSortingBarcodeDetectorAvailable() && typeof createImageBitmap === "function") {
    let bitmap = null;
    try {
      bitmap = await createImageBitmap(file);
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      const barcodes = await detector.detect(bitmap);
      if (!Array.isArray(barcodes) || !barcodes.length) return "";
      return normalizeSortingQr(barcodes[0]?.rawValue || "");
    } catch {
      return "";
    } finally {
      if (bitmap && typeof bitmap.close === "function") {
        bitmap.close();
      }
    }
  }

  return decodeSortingQrWithHtml5Qrcode(file);
}

async function decodeSortingQrWithHtml5Qrcode(file) {
  if (!(file instanceof File)) return "";
  const Html5Qrcode = getHtml5QrcodeClass();
  if (!Html5Qrcode) return "";

  const hostId = `sorting-qr-file-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const host = document.createElement("div");
  host.id = hostId;
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "-10000px";
  host.style.width = "1px";
  host.style.height = "1px";
  app.appendChild(host);

  const scanner = new Html5Qrcode(hostId, { verbose: false });
  try {
    const decoded = await scanner.scanFile(file, false);
    return normalizeSortingQr(decoded || "");
  } catch {
    return "";
  } finally {
    try {
      if (typeof scanner.clear === "function") scanner.clear();
    } catch {
      // ignore scanner clear errors
    }
    if (host.parentElement) {
      host.parentElement.removeChild(host);
    }
  }
}

function openSortingQrScanner(orderId) {
  return new Promise(async (resolve) => {
    closeSortingQrScanner();
    sortingQrScannerState.lastErrorMessage = "";

    if (!isSortingLiveQrScannerAvailable()) {
      sortingQrScannerState.lastErrorMessage = "This browser does not support live QR camera scanning.";
      resolve(null);
      return;
    }

    if (!isSortingSecureCameraContext()) {
      sortingQrScannerState.lastErrorMessage = "Camera works only in a secure context (HTTPS or localhost).";
      resolve(null);
      return;
    }

    const scanner = document.createElement("section");
    scanner.className = "sorting-qr-scanner";
    scanner.dataset.sortingQrScanner = "1";
    scanner.innerHTML = `
      <div class="sorting-qr-scanner-backdrop" data-sorting-qr-close></div>
      <article class="sorting-qr-scanner-sheet" role="dialog" aria-modal="true">
        <div class="sorting-qr-scanner-head">
          <div>
            <strong>QR scanning</strong>
            <div class="muted">Point the camera at a basket QR code</div>
          </div>
          <button type="button" class="secondary" data-sorting-qr-close>Close</button>
        </div>
        <div class="sorting-qr-scanner-video-wrap">
          <video class="sorting-qr-scanner-video" data-sorting-qr-video autoplay playsinline muted></video>
          <div class="sorting-qr-scanner-camera-host" data-sorting-qr-camera-host></div>
        </div>
        <div class="sorting-qr-scanner-status" data-sorting-qr-status>Starting camera...</div>
        <div class="sorting-qr-scanner-actions">
          <button type="button" class="secondary" data-sorting-qr-close>Cancel</button>
        </div>
      </article>
    `;
    app.appendChild(scanner);

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      closeSortingQrScanner();
      resolve(value);
    };

    for (const closer of scanner.querySelectorAll("[data-sorting-qr-close]")) {
      closer.addEventListener("click", () => finish(null), { once: true });
    }

    const video = scanner.querySelector("[data-sorting-qr-video]");
    const cameraHost = scanner.querySelector("[data-sorting-qr-camera-host]");
    const shouldUseHtml5Scanner = shouldPreferHtml5Scanner() || !isSortingBarcodeDetectorAvailable();

    if (!(video instanceof HTMLVideoElement) || !(cameraHost instanceof HTMLElement)) {
      finish(null);
      return;
    }

    if (shouldUseHtml5Scanner && isHtml5QrcodeAvailable()) {
      try {
        const Html5Qrcode = getHtml5QrcodeClass();
        if (!Html5Qrcode) {
          sortingQrScannerState.lastErrorMessage = "QR scanning module is not available in this browser.";
          setSortingQrScannerStatus(sortingQrScannerState.lastErrorMessage, "error");
          finish(null);
          return;
        }
        const hostId = `sorting-qr-live-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        cameraHost.id = hostId;
        video.classList.add("hidden");

        const html5Scanner = new Html5Qrcode(hostId, { verbose: false });
        sortingQrScannerState.html5Qrcode = html5Scanner;
        sortingQrScannerState.active = true;
        setSortingQrScannerStatus("Requesting camera access...");

        await startSortingHtml5Scanner(
          html5Scanner,
          (decodedText) => {
            if (!decodedText || settled) return;
            setSortingQrScannerStatus(`QR found: ${decodedText}`, "ok");
            finish(decodedText);
          },
          () => {}
        );
        setSortingQrScannerStatus("Camera is ready. Point it at the QR code.");
      } catch (error) {
        sortingQrScannerState.active = false;
        if (sortingQrScannerState.html5Qrcode) {
          try {
            sortingQrScannerState.html5Qrcode.clear();
          } catch {
            // ignore scanner clear errors
          }
          sortingQrScannerState.html5Qrcode = null;
        }
        const details = getSortingScannerErrorDetails(error);
        sortingQrScannerState.lastErrorMessage = `Live scanner failed to start (${details || "unknown error"}).`;
        setSortingQrScannerStatus(sortingQrScannerState.lastErrorMessage, "error");
      setSortingQrScannerStatus(`${sortingQrScannerState.lastErrorMessage} Press "Cancel" and check camera permission.`, "error");
      }
      return;
    }

    if (!navigator?.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      sortingQrScannerState.lastErrorMessage = "This browser does not support camera access via getUserMedia.";
      setSortingQrScannerStatus(sortingQrScannerState.lastErrorMessage, "error");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" }
        },
        audio: false
      });
      sortingQrScannerState.stream = stream;
      sortingQrScannerState.active = true;
      video.srcObject = stream;
      await video.play();
    } catch (error) {
      const details = getSortingScannerErrorDetails(error);
      sortingQrScannerState.lastErrorMessage = `Camera access was not granted (${details || "unknown error"}).`;
      setSortingQrScannerStatus(sortingQrScannerState.lastErrorMessage, "error");
      return;
    }

    try {
      sortingQrScannerState.detector = new BarcodeDetector({ formats: ["qr_code"] });
    } catch (error) {
      const details = getSortingScannerErrorDetails(error);
      sortingQrScannerState.lastErrorMessage = `Live-camera QR decoding is unavailable (${details || "unknown error"}).`;
      setSortingQrScannerStatus(sortingQrScannerState.lastErrorMessage, "error");
      return;
    }

    setSortingQrScannerStatus("Camera is ready. Point it at the QR code.");

    sortingQrScannerState.intervalId = setInterval(async () => {
      if (!sortingQrScannerState.active || settled) return;
      try {
        const barcodes = await sortingQrScannerState.detector.detect(video);
        if (!Array.isArray(barcodes) || !barcodes.length) return;
        const rawValue = String(barcodes[0]?.rawValue || "").trim();
        if (!rawValue) return;
        setSortingQrScannerStatus(`QR found: ${rawValue}`, "ok");
        finish(rawValue);
      } catch {
        // ignore intermittent camera decode errors
      }
    }, 260);

    window.setTimeout(() => {
      if (!settled && sortingQrScannerState.active) {
        setSortingQrScannerStatus("Scanning QR... If it does not read, move the camera closer.", "");
      }
    }, 1200);

    void orderId;
  });
}

function formatSortingSheetStamp(value) {
  const stamp = String(value || "").trim();
  if (!stamp) return "—";
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function buildSortingSheetPartyCode(orderPublicId, rowIndex) {
  const safeOrder = String(orderPublicId || "").trim() || "ORDER";
  return `${safeOrder}-P${rowIndex + 1}`;
}

function buildSortingSheetsHtml(order, rowsWithMeta, printedAtIso) {
  const operatorName = String(state?.user?.name || state?.user?.username || "").trim() || "operator";
  const printedAtLabel = formatSortingSheetStamp(printedAtIso);
  const sheets = rowsWithMeta.map(({ row, rowIndex }) => {
    const counts = normalizeSortingItemCounts(row?.itemCounts || row?.item_counts);
    const total = counts.top + counts.bottom + counts.underwear + counts.socksPairs;
    const partyCode = buildSortingSheetPartyCode(order?.public_id, rowIndex);
    const category = sortingColorLabels[row?.color] || sortingColorLabels.mixed;

    return `
      <section class="sheet">
        <header class="sheet-head">
          <div class="sheet-eyebrow">Green Lab · Batch sheet</div>
          <div class="sheet-code">${escapeHtml(partyCode)}</div>
        </header>
        <section class="sheet-meta">
          <div class="meta-cell"><span>Order</span><strong>${escapeHtml(String(order?.public_id || "—"))}</strong></div>
          <div class="meta-cell"><span>Customer</span><strong>${escapeHtml(String(order?.customer_name || "—"))}</strong></div>
          <div class="meta-cell"><span>Phone</span><strong>${escapeHtml(String(order?.customer_phone || "—"))}</strong></div>
          <div class="meta-cell"><span>Batch type</span><strong>${escapeHtml(`${category} #${rowIndex + 1}`)}</strong></div>
        </section>
        <section class="sheet-counts">
          <div class="count-cell"><span>Top</span><strong>${counts.top}</strong></div>
          <div class="count-cell"><span>Bottom</span><strong>${counts.bottom}</strong></div>
          <div class="count-cell"><span>Underwear</span><strong>${counts.underwear}</strong></div>
          <div class="count-cell"><span>Socks (pcs)</span><strong>${counts.socksPairs}</strong></div>
          <div class="count-cell total"><span>Total items</span><strong>${total}</strong></div>
        </section>
        <footer class="sheet-foot">
          <span>Printed: ${escapeHtml(printedAtLabel)}</span>
          <span>Operator: ${escapeHtml(operatorName)}</span>
        </footer>
      </section>
    `;
  }).join("");

  return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Batch sheets ${escapeHtml(String(order?.public_id || ""))}</title>
  <style>
    @page { size: A5 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; font-family: "Segoe UI", Arial, sans-serif; color: #0f1916; }
    .sheet {
      border: 1px solid #b8cdc5;
      border-radius: 10px;
      margin: 0 0 10mm 0;
      padding: 10mm;
      page-break-after: always;
    }
    .sheet:last-child { page-break-after: auto; }
    .sheet-head {
      align-items: end;
      border-bottom: 1px solid #d3e1dc;
      display: flex;
      justify-content: space-between;
      margin-bottom: 8mm;
      padding-bottom: 4mm;
    }
    .sheet-eyebrow { color: #537268; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
    .sheet-code { font-size: 22px; font-weight: 700; letter-spacing: .02em; }
    .sheet-meta {
      display: grid;
      gap: 4mm;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      margin-bottom: 8mm;
    }
    .meta-cell {
      background: #f3faf7;
      border: 1px solid #d5e5df;
      border-radius: 8px;
      display: grid;
      gap: 2mm;
      padding: 3mm;
    }
    .meta-cell span { color: #567066; font-size: 12px; }
    .meta-cell strong { font-size: 16px; }
    .sheet-counts {
      display: grid;
      gap: 3mm;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      margin-bottom: 8mm;
    }
    .count-cell {
      border: 1px solid #d5e5df;
      border-radius: 8px;
      display: flex;
      justify-content: space-between;
      min-height: 12mm;
      padding: 3mm 4mm;
    }
    .count-cell.total {
      background: #ecf8f2;
      border-color: #8ec8b4;
      grid-column: 1 / -1;
    }
    .count-cell span { color: #567066; }
    .count-cell strong { font-size: 20px; line-height: 1; }
    .sheet-foot {
      border-top: 1px solid #d3e1dc;
      color: #567066;
      display: flex;
      font-size: 12px;
      justify-content: space-between;
      padding-top: 4mm;
    }
  </style>
</head>
<body>${sheets}</body>
</html>
  `;
}

function openSortingSheetsPrint(order, rowsWithMeta) {
  if (!Array.isArray(rowsWithMeta) || !rowsWithMeta.length) {
    throw new Error("No batches to print.");
  }
  const printedAtIso = new Date().toISOString();
  const html = buildSortingSheetsHtml(order, rowsWithMeta, printedAtIso);
  let printFrame = document.getElementById("sorting-print-frame");
  if (!printFrame) {
    printFrame = document.createElement("iframe");
    printFrame.id = "sorting-print-frame";
    printFrame.setAttribute("aria-hidden", "true");
    printFrame.style.position = "fixed";
    printFrame.style.right = "0";
    printFrame.style.bottom = "0";
    printFrame.style.width = "0";
    printFrame.style.height = "0";
    printFrame.style.border = "0";
    printFrame.style.opacity = "0";
    printFrame.style.pointerEvents = "none";
    document.body.appendChild(printFrame);
  }

  const frameDoc = printFrame.contentDocument;
  const frameWin = printFrame.contentWindow;
  if (!frameDoc || !frameWin || typeof frameWin.print !== "function") {
    throw new Error("Printing is unavailable in this browser.");
  }

  frameDoc.open();
  frameDoc.write(html);
  frameDoc.close();

  let didTriggerPrint = false;
  const triggerPrint = () => {
    if (didTriggerPrint) return;
    didTriggerPrint = true;
    try {
      frameWin.focus();
      frameWin.print();
    } catch {
      // ignore: browser handles print dialog failures silently
    }
  };

  printFrame.onload = () => {
    printFrame.onload = null;
    setTimeout(triggerPrint, 80);
  };

  if (frameDoc.readyState === "complete") {
    setTimeout(triggerPrint, 80);
  }

  return printedAtIso;
}

function markSortingRowsPrinted(orderId, rowIndexes, printedAtIso) {
  const draft = ensureSortingDraft(orderId);
  for (const rowIndex of rowIndexes) {
    if (!Number.isInteger(rowIndex) || !draft.rows[rowIndex]) continue;
    const row = draft.rows[rowIndex];
    row.labelPrintedAt = normalizeSortingPrintedAt(printedAtIso) || new Date().toISOString();
    row.labelPrintCount = normalizeSortingPrintCount(row.labelPrintCount) + 1;
  }
}

function getSortingOrderFromButton(button) {
  const orderId = Number(button?.dataset?.selectSortingOrder);
  if (!Number.isFinite(orderId)) return null;

  const weightRaw = String(button.dataset.orderWeight || "").trim();
  const weightParsed = Number(weightRaw);

  return {
    id: orderId,
    public_id: String(button.dataset.orderPublicId || "").trim(),
    customer_name: String(button.dataset.orderCustomerName || "").trim(),
    order_weight: Number.isFinite(weightParsed) && weightParsed > 0 ? weightParsed : null,
    customer_phone: String(button.dataset.orderPhone || "").trim() || null
  };
}

function openSortingModal(order) {
  const draft = ensureSortingDraft(order.id);
  const template = document.createElement("template");
  template.innerHTML = renderSortingEditorModal(order, draft.rows, draft).trim();
  const nextModal = template.content.firstElementChild;
  if (!nextModal) return false;

  const existingModal = app.querySelector(".sorting-modal");
  if (existingModal) {
    existingModal.replaceWith(nextModal);
  } else {
    app.appendChild(nextModal);
  }
  syncModalBodyClass();
  return true;
}

function closeSortingModal() {
  closeSortingQrScanner();
  const modal = app.querySelector(".sorting-modal");
  if (!modal) return false;
  modal.remove();
  syncModalBodyClass();
  return true;
}

function rerenderSortingModal(orderId) {
  const modal = app.querySelector(".sorting-modal");
  if (!modal) return false;

  const order = getSortingModalOrder(orderId);
  if (!order) return false;

  const draft = ensureSortingDraft(orderId);
  const template = document.createElement("template");
  template.innerHTML = renderSortingEditorModal(order, draft.rows, draft).trim();
  const nextModal = template.content.firstElementChild;
  if (!nextModal) return false;
  modal.replaceWith(nextModal);
  syncModalBodyClass();
  return true;
}

function rerenderSortingCountUi(orderId) {
  const modal = app.querySelector(".sorting-modal");
  if (!modal) return false;

  const order = getSortingModalOrder(orderId);
  if (!order) return false;

  const draft = ensureSortingDraft(orderId);
  const template = document.createElement("template");
  template.innerHTML = renderSortingEditorModal(order, draft.rows, draft).trim();
  const nextModal = template.content.firstElementChild;
  if (!nextModal) return false;

  const currentCount = modal.querySelector(".sorting-count");
  const nextCount = nextModal.querySelector(".sorting-count");
  if (currentCount && nextCount) {
    currentCount.replaceWith(nextCount);
  }

  const currentPreview = modal.querySelector(".sorting-preview");
  const nextPreview = nextModal.querySelector(".sorting-preview");
  if (currentPreview && nextPreview) {
    currentPreview.replaceWith(nextPreview);
  }

  const currentMeta = modal.querySelector(".sorting-head-meta");
  const nextMeta = nextModal.querySelector(".sorting-head-meta");
  if (currentMeta && nextMeta) {
    currentMeta.replaceWith(nextMeta);
  }

  return true;
}

function rerenderSortingScanUi(orderId) {
  const modal = app.querySelector(".sorting-modal");
  if (!modal) return false;
  const order = getSortingModalOrder(orderId);
  if (!order) return false;
  const draft = ensureSortingDraft(orderId);
  const template = document.createElement("template");
  template.innerHTML = renderSortingEditorModal(order, draft.rows, draft).trim();
  const nextModal = template.content.firstElementChild;
  if (!nextModal) return false;
  modal.replaceWith(nextModal);
  syncModalBodyClass();
  return true;
}

async function addSortingBasketFromScan(orderId, rawQrCode, renderApp, options = {}) {
  const notifyErrors = options.notifyErrors !== false;
  const draft = ensureSortingDraft(orderId);
  const qrCode = normalizeSortingQr(rawQrCode || draft.scanInput);
  draft.scanInput = qrCode;

  if (!qrCode) {
    if (notifyErrors) {
      setNotice("warn", "Scan a basket QR code first.");
      await renderApp();
    }
    return { ok: false, error: "empty_qr" };
  }

  if (draft.rows.length >= sortingMaxBasketsPerOrder) {
    if (notifyErrors) {
      setNotice("warn", `A single order can contain at most ${sortingMaxBasketsPerOrder} baskets.`);
      await renderApp();
    }
    return { ok: false, error: "max_reached" };
  }

  if (draft.rows.some((row) => normalizeSortingQr(row?.scannedQr) === qrCode)) {
    if (notifyErrors) {
      setNotice("warn", `Basket ${qrCode} is already added.`);
      await renderApp();
    }
    return { ok: false, error: "duplicate_qr" };
  }

  draft.rows.push(createSortingRow({ itemsExpanded: true, scannedQr: qrCode }));
  draft.scanInput = "";
  setSortingWizardStep(orderId, 2);
  setSortingActiveRow(orderId, draft.rows.length - 1);

  if (!rerenderSortingScanUi(orderId) && !rerenderSortingModal(orderId)) {
    await renderApp();
  }

  return { ok: true, qrCode };
}

function readFileAsDataUrlRaw(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function loadImageForCompression(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to prepare image."));
    image.src = dataUrl;
  });
}

async function optimizeSortingPhotoDataUrl(dataUrl) {
  const source = String(dataUrl || "").trim();
  if (!source.startsWith("data:image/")) return source;

  const image = await loadImageForCompression(source);
  const width = Number(image.naturalWidth || image.width || 0);
  const height = Number(image.naturalHeight || image.height || 0);
  if (!width || !height) return source;

  const longest = Math.max(width, height);
  const scale = longest > sortingPhotoMaxDimension ? (sortingPhotoMaxDimension / longest) : 1;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return source;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  let quality = sortingPhotoJpegQuality;
  let optimized = canvas.toDataURL("image/jpeg", quality);
  while (optimized.length > sortingPhotoTargetDataUrlChars && quality > 0.46) {
    quality -= 0.08;
    optimized = canvas.toDataURL("image/jpeg", quality);
  }

  return optimized.length < source.length ? optimized : source;
}

async function readFileAsDataUrl(file) {
  const source = await readFileAsDataUrlRaw(file);
  try {
    return await optimizeSortingPhotoDataUrl(source);
  } catch {
    return source;
  }
}

async function addSortingPhotos(orderId, rowIndex, role, files) {
  const draft = ensureSortingDraft(orderId);
  if (!draft.rows[rowIndex]) return;

  const row = draft.rows[rowIndex];
  const nextPhotos = normalizeSortingPhotos(row.photos);
  const limit = role === "overview" ? sortingMaxOverviewPhotos : sortingMaxIssuePhotos;
  const existingCount = role === "overview"
    ? nextPhotos.filter((photo) => photo.role === "overview").length
    : nextPhotos.filter((photo) => photo.role === "issue").length;
  const allowed = Math.max(0, limit - existingCount);
  const selectedFiles = Array.from(files || []).slice(0, allowed);
  if (!selectedFiles.length) return;

  for (const file of selectedFiles) {
    const dataUrl = await readFileAsDataUrl(file);
    if (role === "overview") {
      for (let index = nextPhotos.length - 1; index >= 0; index -= 1) {
        if (nextPhotos[index].role === "overview") {
          nextPhotos.splice(index, 1);
        }
      }
      nextPhotos.unshift({ role: "overview", note: "", dataUrl });
    } else {
      nextPhotos.push({ role: "issue", note: "", dataUrl });
    }
  }

  row.photos = normalizeSortingPhotos(nextPhotos);
}

function findFirstEmptySortingRowIndex(rows) {
  const index = rows.findIndex((row) => getSortingRowItemsTotal(row) <= 0);
  return index >= 0 ? index : -1;
}

function syncSortingDraftFromInputs(orderId) {
  const draft = ensureSortingDraft(orderId);
  const inputs = app.querySelectorAll(`[data-sorting-items-input="${orderId}"]`);
  for (const input of inputs) {
    const rowIndex = Number(input.dataset.rowIndex);
    const key = String(input.dataset.itemKey || "").trim();
    if (!Number.isFinite(rowIndex) || !sortingItemKeys.includes(key) || !draft.rows[rowIndex]) continue;
    const current = normalizeSortingItemCounts(draft.rows[rowIndex].itemCounts);
    current[key] = normalizeSortingItemCount(input.value);
    draft.rows[rowIndex].itemCounts = current;
  }
  return draft;
}

function syncSortingCountsDom(orderId, rowIndex) {
  const draft = ensureSortingDraft(orderId);
  const row = draft.rows[rowIndex];
  if (!row) return;

  const counts = normalizeSortingItemCounts(row.itemCounts);
  const total = getSortingRowItemsTotal(row);

  const activeSummary = app.querySelector(".sorting-items-summary");
  if (activeSummary) {
    const lines = activeSummary.querySelectorAll(".sorting-meta-line");
    if (lines[0]) lines[0].textContent = `Total items: ${total}`;
    if (lines[1]) lines[1].textContent = `Socks (pcs): ${counts.socksPairs}`;
    activeSummary.classList.toggle("ok", total > 0);
    activeSummary.classList.toggle("warn", total <= 0);
  }

  const activeTab = app.querySelector(`.sorting-basket-tab[data-sorting-open-basket="${orderId}"][data-row-index="${rowIndex}"]`);
  if (activeTab) {
    activeTab.textContent = `${rowIndex + 1}`;
  }

  const miniChip = app.querySelector(`.sorting-mini-chip[data-sorting-open-basket="${orderId}"][data-row-index="${rowIndex}"]`);
  if (miniChip) {
    miniChip.classList.toggle("ok", total > 0);
    miniChip.classList.toggle("warn", total <= 0);
  }

  const previewItems = app.querySelector(".sorting-preview-focus .sorting-preview-items");
  if (previewItems) {
    previewItems.textContent = `Items: ${total} · Socks: ${counts.socksPairs} pcs`;
  }

  const finishButton = app.querySelector(
    `[data-sorting-step-next="${orderId}"][data-sorting-step-next-mode="finish"]`
  );
  if (finishButton instanceof HTMLButtonElement) {
    finishButton.disabled = total <= 0;
  }
}

function setCreateBasketsUiBusy(orderId, isBusy, helpers) {
  const button = app.querySelector(`[data-create-baskets="${orderId}"]`);
  helpers.setButtonLoading(button, isBusy, "Creating...");
}

function setUpdateBasketsUiBusy(orderId, isBusy, helpers) {
  const button = app.querySelector(`[data-update-baskets="${orderId}"]`);
  helpers.setButtonLoading(button, isBusy, "Saving...");
}

function setReturnToSortingUiBusy(orderId, isBusy, helpers) {
  const button = app.querySelector(`[data-return-to-sorting="${orderId}"]`);
  helpers.setButtonLoading(button, isBusy, "Returning...");
}

export function bindSortingActions(renderApp, helpers) {
  if (!app.dataset.sortingDelegatedBound) {
    app.dataset.sortingDelegatedBound = "1";
    app.addEventListener("click", async (event) => {
      const target = event.target.closest(
        "[data-order-modal-close], [data-select-sorting-order], [data-edit-sorted-baskets], [data-return-to-sorting], [data-sorting-close], [data-sorting-scan-back], [data-sorting-open-qr-scanner], [data-sorting-add-basket-scan], [data-sorting-remove-basket], [data-sorting-choice], [data-sorting-open-basket], [data-sorting-step-next], [data-sorting-step-prev], [data-sorting-items-toggle], [data-sorting-items-step], [data-sorting-remove-photo], [data-sorting-print-row], [data-sorting-print-all], [data-create-baskets], [data-update-baskets]"
      );
      if (!target || !app.contains(target)) return;

      if (target.dataset.orderModalClose !== undefined) {
        state.selectedOrderId = null;
        state.managerActionDialog = null;
        state.submittingManagerAction = false;
        await renderApp();
        return;
      }

      if (target.dataset.selectSortingOrder) {
        const order = getSortingOrderFromButton(target);
        if (!order) return;
        state.activeSortingOrderId = order.id;
        ensureSortingDraft(order.id);
        if (!openSortingModal(order)) {
          await renderApp();
        }
        return;
      }

      if (target.dataset.editSortedBaskets) {
        const orderId = Number(target.dataset.editSortedBaskets);
        if (!Number.isFinite(orderId) || state.submittingEditSortedOrderId === orderId) return;

        state.submittingEditSortedOrderId = orderId;
        helpers.setButtonLoading(target, true, "Opening...");

        try {
          const order = await api(`/api/orders/${orderId}`);
          state.activeSortingOrderId = orderId;
          state.sortingDrafts[orderId] = {
            rows: buildSortingRowsFromOrderDetails(order),
            wizardStep: 1,
            activeRowIndex: 0,
            scanInput: ""
          };

          const modalOrder = {
            id: order.id,
            public_id: order.public_id,
            customer_name: order.customer_name,
            order_weight: order.order_weight,
            customer_phone: order.customer_phone,
            status: "sorted",
            sortingMode: "edit"
          };
          if (!openSortingModal(modalOrder)) {
            await renderApp();
          }
        } catch (error) {
          setNotice("error", error.message);
          await renderApp();
        } finally {
          state.submittingEditSortedOrderId = null;
          helpers.setButtonLoading(target, false, "Opening...");
        }
        return;
      }

      if (target.dataset.returnToSorting) {
        const orderId = Number(target.dataset.returnToSorting);
        if (!Number.isFinite(orderId) || state.submittingReturnOrderId === orderId) return;
        if (!window.confirm('Return this order to "Unsorted orders" and delete current baskets?')) return;

        state.submittingReturnOrderId = orderId;
        setReturnToSortingUiBusy(orderId, true, helpers);
        try {
          await api("/api/sorting/return-to-sorting", {
            method: "POST",
            body: JSON.stringify({ orderId })
          });
          delete state.sortingDrafts[orderId];
          if (state.activeSortingOrderId === orderId) {
            state.activeSortingOrderId = null;
            closeSortingModal();
          }
          setNotice("ok", 'Order returned to "Unsorted orders" and ready for re-sorting.');
        } catch (error) {
          setNotice("error", error.message);
        } finally {
          state.submittingReturnOrderId = null;
          setReturnToSortingUiBusy(orderId, false, helpers);
        }
        await renderApp();
        return;
      }

      if (target.dataset.sortingClose !== undefined) {
        const modalSheet = app.querySelector(".sorting-modal-sheet");
        const modalOrderId = Number(modalSheet?.dataset?.sortingOrderId || 0);
        if (Number.isFinite(modalOrderId) && modalOrderId > 0) {
          const draft = ensureSortingDraft(modalOrderId);
          if (draft.wizardStep === 1 && draft.rows.length > 0) {
            returnToSortingFillStep(modalOrderId);
            if (!rerenderSortingModal(modalOrderId)) {
              await renderApp();
            }
            return;
          }
        }
        state.activeSortingOrderId = null;
        if (!closeSortingModal()) {
          await renderApp();
        }
        return;
      }

      if (target.dataset.sortingScanBack !== undefined) {
        const orderId = Number(target.dataset.sortingScanBack);
        if (!Number.isFinite(orderId)) return;
        returnToSortingFillStep(orderId);
        if (!rerenderSortingModal(orderId)) {
          await renderApp();
        }
        return;
      }

      if (target.dataset.sortingOpenQrScanner) {
        const orderId = Number(target.dataset.sortingOpenQrScanner);
        if (!Number.isFinite(orderId)) return;

        if (isSortingLiveQrScannerAvailable()) {
          const scannedValue = await openSortingQrScanner(orderId);
          if (scannedValue) {
            await addSortingBasketFromScan(orderId, scannedValue, renderApp, { notifyErrors: true });
            return;
          }
          const reason = String(sortingQrScannerState.lastErrorMessage || "").trim();
          if (reason) {
            setNotice("error", reason);
            await renderApp();
          } else {
            setNotice("warn", "Scan cancelled.");
            await renderApp();
          }
          return;
        }

        setNotice("error", "Live scanner is not available in this browser.");
        await renderApp();
        return;
      }

      if (target.dataset.sortingAddBasketScan) {
        const orderId = Number(target.dataset.sortingAddBasketScan);
        if (!Number.isFinite(orderId)) return;
        const draft = ensureSortingDraft(orderId);
        const scanInput = app.querySelector(`[data-sorting-basket-scan-input="${orderId}"]`);
        await addSortingBasketFromScan(orderId, scanInput?.value || draft.scanInput, renderApp, { notifyErrors: true });
        return;
      }

      if (target.dataset.sortingRemoveBasket) {
        const orderId = Number(target.dataset.sortingRemoveBasket);
        const rowIndex = Number(target.dataset.rowIndex);
        if (!Number.isFinite(orderId) || !Number.isFinite(rowIndex)) return;
        const draft = ensureSortingDraft(orderId);
        if (!draft.rows[rowIndex]) return;
        draft.rows.splice(rowIndex, 1);
        if (!draft.rows.length) {
          setSortingWizardStep(orderId, 1);
          setSortingActiveRow(orderId, 0);
        } else {
          setSortingActiveRow(orderId, Math.max(0, rowIndex - 1));
        }
        if (!rerenderSortingScanUi(orderId) && !rerenderSortingModal(orderId)) {
          await renderApp();
          return;
        }
        focusSortingScanInput(orderId);
        return;
      }

      if (target.dataset.sortingOpenBasket) {
        const orderId = Number(target.dataset.sortingOpenBasket);
        const rowIndex = Number(target.dataset.rowIndex);
        if (!Number.isFinite(orderId) || !Number.isFinite(rowIndex)) return;
        setSortingWizardStep(orderId, 2);
        setSortingActiveRow(orderId, rowIndex);
        if (!rerenderSortingModal(orderId)) {
          await renderApp();
        }
        return;
      }

      if (target.dataset.sortingStepNext) {
        const orderId = Number(target.dataset.sortingStepNext);
        const mode = String(target.dataset.sortingStepNextMode || "").trim();
        if (!Number.isFinite(orderId)) return;
        const draft = syncSortingDraftFromInputs(orderId);

        if (draft.wizardStep === 1) {
          if (!draft.rows.length) {
            setNotice("warn", "Add at least one basket.");
            await renderApp();
            return;
          }
          setSortingWizardStep(orderId, 2);
          const firstEmptyIndex = findFirstEmptySortingRowIndex(draft.rows);
          const defaultIndex = draft.rows.length - 1;
          setSortingActiveRow(orderId, firstEmptyIndex >= 0 ? firstEmptyIndex : defaultIndex);
        } else if (draft.wizardStep === 2) {
          const activeIndex = clampSortingRowIndex(draft.activeRowIndex, draft.rows.length);
          const activeRow = draft.rows[activeIndex];
          if (getSortingRowItemsTotal(activeRow) <= 0) {
            setNotice("warn", `Fill Basket ${activeIndex + 1}.`);
            await renderApp();
            return;
          }
          if (mode === "add-more") {
            setSortingWizardStep(orderId, 1);
          } else {
            const firstEmptyIndex = findFirstEmptySortingRowIndex(draft.rows);
            if (firstEmptyIndex >= 0) {
              setNotice("warn", `Fill Basket ${firstEmptyIndex + 1}.`);
              setSortingWizardStep(orderId, 2);
              setSortingActiveRow(orderId, firstEmptyIndex);
              await renderApp();
              return;
            }
            setSortingWizardStep(orderId, 3);
          }
        }

        if (!rerenderSortingModal(orderId)) {
          await renderApp();
        }
        if (draft.wizardStep === 1) {
          focusSortingScanInput(orderId);
        }
        return;
      }

      if (target.dataset.sortingStepPrev) {
        const orderId = Number(target.dataset.sortingStepPrev);
        if (!Number.isFinite(orderId)) return;
        const draft = ensureSortingDraft(orderId);

        if (draft.wizardStep === 3) {
          setSortingWizardStep(orderId, 2);
          const firstEmptyIndex = findFirstEmptySortingRowIndex(draft.rows);
          setSortingActiveRow(orderId, firstEmptyIndex >= 0 ? firstEmptyIndex : (draft.rows.length - 1));
        } else if (draft.wizardStep === 2) {
          const activeIndex = clampSortingRowIndex(draft.activeRowIndex, draft.rows.length);
          if (activeIndex > 0) {
            setSortingActiveRow(orderId, activeIndex - 1);
          } else {
            setSortingWizardStep(orderId, 1);
          }
        }

        if (!rerenderSortingModal(orderId)) {
          await renderApp();
        }
        return;
      }

      if (target.dataset.sortingChoice) {
        const orderId = Number(target.dataset.sortingChoice);
        const rowIndex = Number(target.dataset.rowIndex);
        const rowField = target.dataset.choiceField;
        const rowValue = String(target.dataset.choiceValue || "");
        if (!Number.isFinite(orderId) || !Number.isFinite(rowIndex) || !rowField || !rowValue) return;

        const draft = ensureSortingDraft(orderId);
        if (!draft.rows[rowIndex]) return;

        if (rowField === "color") {
          draft.rows[rowIndex].color = sortingColorLabels[rowValue] ? rowValue : "mixed";
        }

        draft.rows[rowIndex] = createSortingRow(draft.rows[rowIndex]);
        updateSortingChoiceDom(target, rowIndex, draft.rows[rowIndex].color);
        return;
      }

      if (target.dataset.sortingItemsToggle) {
        const orderId = Number(target.dataset.sortingItemsToggle);
        const rowIndex = Number(target.dataset.rowIndex);
        if (!Number.isFinite(orderId) || !Number.isFinite(rowIndex)) return;
        const draft = ensureSortingDraft(orderId);
        if (!draft.rows[rowIndex]) return;
        draft.rows[rowIndex].itemsExpanded = !Boolean(draft.rows[rowIndex].itemsExpanded);
        if (!rerenderSortingModal(orderId)) {
          await renderApp();
        }
        return;
      }

      if (target.dataset.sortingItemsStep) {
        const orderId = Number(target.dataset.sortingItemsStep);
        const rowIndex = Number(target.dataset.rowIndex);
        const key = String(target.dataset.itemKey || "").trim();
        const step = Number(target.dataset.step || 0);
        if (!Number.isFinite(orderId) || !Number.isFinite(rowIndex) || !sortingItemKeys.includes(key) || !Number.isFinite(step)) return;
        const draft = ensureSortingDraft(orderId);
        if (!draft.rows[rowIndex]) return;

        const current = normalizeSortingItemCounts(draft.rows[rowIndex].itemCounts);
        current[key] = normalizeSortingItemCount(current[key] + step);
        draft.rows[rowIndex].itemCounts = current;
        draft.rows[rowIndex].itemsExpanded = true;
        setSortingWizardStep(orderId, 2);
        setSortingActiveRow(orderId, rowIndex);
        const input = app.querySelector(`[data-sorting-items-input="${orderId}"][data-row-index="${rowIndex}"][data-item-key="${key}"]`);
        if (input) {
          input.value = String(current[key]);
        }
        syncSortingCountsDom(orderId, rowIndex);
        return;
      }

      if (target.dataset.sortingRemovePhoto) {
        const orderId = Number(target.dataset.sortingRemovePhoto);
        const rowIndex = Number(target.dataset.rowIndex);
        const photoIndex = Number(target.dataset.photoIndex);
        if (!Number.isFinite(orderId) || !Number.isFinite(rowIndex) || !Number.isFinite(photoIndex)) return;
        const draft = ensureSortingDraft(orderId);
        if (!draft.rows[rowIndex]) return;
        const nextPhotos = normalizeSortingPhotos(draft.rows[rowIndex].photos);
        nextPhotos.splice(photoIndex, 1);
        draft.rows[rowIndex].photos = nextPhotos;
        if (!rerenderSortingModal(orderId)) {
          await renderApp();
        }
        return;
      }

      if (target.dataset.sortingPrintRow) {
        const orderId = Number(target.dataset.sortingPrintRow);
        const rowIndex = Number(target.dataset.rowIndex);
        if (!Number.isFinite(orderId) || !Number.isFinite(rowIndex)) return;
        const draft = syncSortingDraftFromInputs(orderId);
        const row = draft.rows[rowIndex];
        if (!row) return;
        const order = getSortingModalOrder(orderId);
        if (!order) return;

        try {
          const printedAtIso = openSortingSheetsPrint(order, [{ row, rowIndex }]);
          markSortingRowsPrinted(orderId, [rowIndex], printedAtIso);
          if (!rerenderSortingModal(orderId)) {
            await renderApp();
          }
        } catch (error) {
          setNotice("error", error.message);
          await renderApp();
        }
        return;
      }

      if (target.dataset.sortingPrintAll) {
        const orderId = Number(target.dataset.sortingPrintAll);
        if (!Number.isFinite(orderId)) return;
        const draft = syncSortingDraftFromInputs(orderId);
        const order = getSortingModalOrder(orderId);
        if (!order) return;
        const rowsWithMeta = draft.rows.map((row, rowIndex) => ({ row, rowIndex }));
        if (!rowsWithMeta.length) {
          setNotice("warn", "No batches to print.");
          await renderApp();
          return;
        }

        try {
          const printedAtIso = openSortingSheetsPrint(order, rowsWithMeta);
          markSortingRowsPrinted(orderId, rowsWithMeta.map((entry) => entry.rowIndex), printedAtIso);
          if (!rerenderSortingModal(orderId)) {
            await renderApp();
          }
        } catch (error) {
          setNotice("error", error.message);
          await renderApp();
        }
        return;
      }

      if (target.dataset.updateBaskets) {
        const orderId = Number(target.dataset.updateBaskets);
        const draft = syncSortingDraftFromInputs(orderId);
        const baskets = draft.rows.map((row, index) => buildBasketPayload(row, index));
        if (!baskets.length) {
          setNotice("warn", "Add at least one basket before saving.");
          await renderApp();
          return;
        }
        const hasEmptyRows = draft.rows.some((row) => getSortingRowItemsTotal(row) <= 0);
        if (hasEmptyRows) {
          setNotice("warn", "Fill item counts in all baskets before saving.");
          await renderApp();
          return;
        }
        if (state.submittingUpdateOrderId === orderId) return;

        state.submittingUpdateOrderId = orderId;
        setUpdateBasketsUiBusy(orderId, true, helpers);
        try {
          const idempotencyKey = createClientIdempotencyKey(`sorting-update-${orderId}`);
          const formData = buildSortingMultipartBody(orderId, baskets);
          await api("/api/sorting/update-baskets", {
            method: "POST",
            body: formData,
            headers: {
              "X-Idempotency-Key": idempotencyKey
            },
            timeoutMs: 180000
          });
          delete state.sortingDrafts[orderId];
          state.activeSortingOrderId = null;
          closeSortingModal();
        } catch (error) {
          setNotice("error", error.message);
        } finally {
          state.submittingUpdateOrderId = null;
          setUpdateBasketsUiBusy(orderId, false, helpers);
        }
        await renderApp();
        return;
      }

      if (target.dataset.createBaskets) {
        const orderId = Number(target.dataset.createBaskets);
        const draft = syncSortingDraftFromInputs(orderId);
        const baskets = draft.rows.map((row, index) => buildBasketPayload(row, index));
        if (!baskets.length) {
          setNotice("warn", "Add at least one basket before starting sorting.");
          await renderApp();
          return;
        }
        const hasEmptyRows = draft.rows.some((row) => getSortingRowItemsTotal(row) <= 0);
        if (hasEmptyRows) {
          setNotice("warn", "Fill item counts in all baskets before starting sorting.");
          await renderApp();
          return;
        }
        if (state.submittingCreateOrderId === orderId) return;

        state.submittingCreateOrderId = orderId;
        setCreateBasketsUiBusy(orderId, true, helpers);
        try {
          const idempotencyKey = createClientIdempotencyKey(`sorting-create-${orderId}`);
          const formData = buildSortingMultipartBody(orderId, baskets);
          await api("/api/sorting/create-baskets", {
            method: "POST",
            body: formData,
            headers: {
              "X-Idempotency-Key": idempotencyKey
            },
            timeoutMs: 180000
          });
          delete state.sortingDrafts[orderId];
          state.activeSortingOrderId = null;
          state.currentStation = "sorting";
          state.screen = "station";
          state.selectedOrderId = null;
          clearLastScan();
        } catch (error) {
          setNotice("error", error.message);
        } finally {
          state.submittingCreateOrderId = null;
          setCreateBasketsUiBusy(orderId, false, helpers);
        }
        await renderApp();
      }
    });
  }

  if (!app.dataset.sortingDelegatedKeydownBound) {
    app.dataset.sortingDelegatedKeydownBound = "1";
    app.addEventListener("keydown", async (event) => {
      if ((event.key === "Enter" || event.key === " ") && event.target instanceof HTMLElement) {
        const card = event.target.closest("[data-sorting-open-basket]");
        if (card && card.getAttribute("role") === "button" && event.target.tagName !== "BUTTON") {
          event.preventDefault();
          card.click();
          return;
        }
      }

      if (event.key !== "Enter") return;
      const input = event.target.closest("[data-sorting-basket-scan-input]");
      if (!input || !app.contains(input)) return;
      event.preventDefault();
      const orderId = Number(input.dataset.sortingBasketScanInput);
      if (!Number.isFinite(orderId)) return;
      await addSortingBasketFromScan(orderId, input.value, renderApp, { notifyErrors: true });
    });
  }

  if (!app.dataset.sortingDelegatedChangeBound) {
    app.dataset.sortingDelegatedChangeBound = "1";
    app.addEventListener("change", async (event) => {
      const photoInput = event.target.closest("[data-sorting-photo-input]");
      if (photoInput && app.contains(photoInput)) {
        const orderId = Number(photoInput.dataset.sortingPhotoInput);
        const rowIndex = Number(photoInput.dataset.rowIndex);
        const role = String(photoInput.dataset.photoRole || "").trim();
        if (!Number.isFinite(orderId) || !Number.isFinite(rowIndex) || !role) return;
        try {
          await addSortingPhotos(orderId, rowIndex, role, photoInput.files);
        } catch (error) {
          setNotice("error", error.message);
        }
        photoInput.value = "";
        if (!rerenderSortingModal(orderId)) {
          await renderApp();
        }
        return;
      }

      const target = event.target.closest("[data-sorting-items-input]");
      if (!target || !app.contains(target)) return;

      const orderId = Number(target.dataset.sortingItemsInput);
      const rowIndex = Number(target.dataset.rowIndex);
      const key = String(target.dataset.itemKey || "").trim();
      if (!Number.isFinite(orderId) || !Number.isFinite(rowIndex) || !sortingItemKeys.includes(key)) return;

      const draft = ensureSortingDraft(orderId);
      if (!draft.rows[rowIndex]) return;

      const current = normalizeSortingItemCounts(draft.rows[rowIndex].itemCounts);
      current[key] = normalizeSortingItemCount(target.value);
      draft.rows[rowIndex].itemCounts = current;
      draft.rows[rowIndex].itemsExpanded = true;
      setSortingWizardStep(orderId, 2);
      setSortingActiveRow(orderId, rowIndex);
      syncSortingCountsDom(orderId, rowIndex);
    });
  }
}
