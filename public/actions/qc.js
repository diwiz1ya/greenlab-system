import { api } from "../api.js";
import { normalizeProductionQrCode } from "../route-sheets.js";
import { app, resetQcState, setLastScan, setNotice, state } from "../state.js";

const QC_AUTO_SUBMIT_DELAY_MS = 120;
const QC_EVIDENCE_REASONS = new Set([
  "stain_not_removed",
  "spot_treatment",
  "hand_wash",
  "extra_treatment"
]);
let qcAutoSubmitTimer = null;
const qcQrScannerState = {
  stream: null,
  intervalId: null,
  active: false,
  detector: null,
  html5Qrcode: null,
  lastErrorMessage: ""
};

function normalizeQcCameraQrCode(value) {
  const productionQr = normalizeProductionQrCode(value);
  if (productionQr) return productionQr;
  let normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!normalized) return "";
  normalized = normalized.replace(/^QR[-]/, "QR:");
  if (/^B-\d{4,}-\d+$/.test(normalized)) return `QR:${normalized}`;
  return normalized;
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

function isQcBarcodeDetectorAvailable() {
  return "BarcodeDetector" in window;
}

function isQcLiveQrScannerAvailable() {
  return isQcBarcodeDetectorAvailable() || isHtml5QrcodeAvailable();
}

function isQcSecureCameraContext() {
  return Boolean(window?.isSecureContext);
}

function getQcScannerErrorDetails(error) {
  const name = String(error?.name || "Error").trim();
  const message = String(error?.message || "").trim();
  return message ? `${name}: ${message}` : name;
}

function setQcQrScannerStatus(message, tone = "") {
  const status = app.querySelector("[data-qc-qr-status]");
  if (!status) return;
  status.textContent = String(message || "");
  status.classList.remove("ok", "error");
  if (tone === "ok" || tone === "error") {
    status.classList.add(tone);
  }
}

async function startQcHtml5Scanner(scanner, onSuccess, onError) {
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
          cameras.find((camera) => /back|rear|environment|зад/i.test(String(camera?.label || ""))) || cameras[0];
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
      errors.push(`${attempt.label} -> ${getQcScannerErrorDetails(error)}`);
    }
  }

  throw new Error(errors.join(" | "));
}

function closeQcQrScanner() {
  if (qcQrScannerState.intervalId) {
    clearInterval(qcQrScannerState.intervalId);
    qcQrScannerState.intervalId = null;
  }

  if (qcQrScannerState.stream) {
    for (const track of qcQrScannerState.stream.getTracks()) {
      track.stop();
    }
    qcQrScannerState.stream = null;
  }

  qcQrScannerState.active = false;
  qcQrScannerState.detector = null;
  if (qcQrScannerState.html5Qrcode) {
    const scanner = qcQrScannerState.html5Qrcode;
    qcQrScannerState.html5Qrcode = null;
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

  const scanner = app.querySelector("[data-qc-qr-scanner]");
  if (scanner) {
    scanner.remove();
  }
}

export function openQcQrScanner({ title = "QR scanning", subtitle = "Point camera at route sheet QR" } = {}) {
  return new Promise(async (resolve) => {
    closeQcQrScanner();
    qcQrScannerState.lastErrorMessage = "";

    if (!isQcLiveQrScannerAvailable()) {
      qcQrScannerState.lastErrorMessage = "This browser does not support live QR scanning via camera.";
      resolve(null);
      return;
    }

    if (!isQcSecureCameraContext()) {
      qcQrScannerState.lastErrorMessage = "Camera works only in a secure context (HTTPS or localhost).";
      resolve(null);
      return;
    }

    const scanner = document.createElement("section");
    scanner.className = "sorting-qr-scanner";
    scanner.dataset.qcQrScanner = "1";
    scanner.innerHTML = `
      <div class="sorting-qr-scanner-backdrop" data-qc-qr-close></div>
      <article class="sorting-qr-scanner-sheet" role="dialog" aria-modal="true">
        <div class="sorting-qr-scanner-head">
          <div>
            <strong>${title}</strong>
            <div class="muted">${subtitle}</div>
          </div>
          <button type="button" class="secondary" data-qc-qr-close>Close</button>
        </div>
        <div class="sorting-qr-scanner-video-wrap">
          <video class="sorting-qr-scanner-video" data-qc-qr-video autoplay playsinline muted></video>
          <div class="sorting-qr-scanner-camera-host" data-qc-qr-camera-host></div>
        </div>
        <div class="sorting-qr-scanner-status" data-qc-qr-status>Starting camera...</div>
        <div class="sorting-qr-scanner-actions">
          <button type="button" class="secondary" data-qc-qr-close>Cancel</button>
        </div>
      </article>
    `;
    app.appendChild(scanner);

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      closeQcQrScanner();
      resolve(value);
    };

    for (const closer of scanner.querySelectorAll("[data-qc-qr-close]")) {
      closer.addEventListener("click", () => finish(null), { once: true });
    }

    const video = scanner.querySelector("[data-qc-qr-video]");
    const cameraHost = scanner.querySelector("[data-qc-qr-camera-host]");
    const shouldUseHtml5Scanner = shouldPreferHtml5Scanner() || !isQcBarcodeDetectorAvailable();

    if (!(video instanceof HTMLVideoElement) || !(cameraHost instanceof HTMLElement)) {
      finish(null);
      return;
    }

    if (shouldUseHtml5Scanner && isHtml5QrcodeAvailable()) {
      try {
        const Html5Qrcode = getHtml5QrcodeClass();
        if (!Html5Qrcode) {
          qcQrScannerState.lastErrorMessage = "QR scanning module is unavailable in this browser.";
          setQcQrScannerStatus(qcQrScannerState.lastErrorMessage, "error");
          finish(null);
          return;
        }
        const hostId = `qc-qr-live-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        cameraHost.id = hostId;
        video.classList.add("hidden");

        const html5Scanner = new Html5Qrcode(hostId, { verbose: false });
        qcQrScannerState.html5Qrcode = html5Scanner;
        qcQrScannerState.active = true;
        setQcQrScannerStatus("Requesting camera access...");

        await startQcHtml5Scanner(
          html5Scanner,
          (decodedText) => {
            if (!decodedText || settled) return;
            setQcQrScannerStatus(`QR detected: ${decodedText}`, "ok");
            finish(decodedText);
          },
          () => {}
        );
        setQcQrScannerStatus("Camera is ready. Point it at a QR code.");
      } catch (error) {
        qcQrScannerState.active = false;
        if (qcQrScannerState.html5Qrcode) {
          try {
            qcQrScannerState.html5Qrcode.clear();
          } catch {
            // ignore scanner clear errors
          }
          qcQrScannerState.html5Qrcode = null;
        }
        const details = getQcScannerErrorDetails(error);
        qcQrScannerState.lastErrorMessage = `Live scanner failed to start (${details || "unknown error"}).`;
        setQcQrScannerStatus(`${qcQrScannerState.lastErrorMessage} Tap "Cancel" and check camera permissions.`, "error");
      }
      return;
    }

    if (!navigator?.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      qcQrScannerState.lastErrorMessage = "This browser does not support camera access via getUserMedia.";
      setQcQrScannerStatus(qcQrScannerState.lastErrorMessage, "error");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" }
        },
        audio: false
      });
      qcQrScannerState.stream = stream;
      qcQrScannerState.active = true;
      video.srcObject = stream;
      await video.play();
    } catch (error) {
      const details = getQcScannerErrorDetails(error);
      qcQrScannerState.lastErrorMessage = `Camera access was denied (${details || "unknown error"}).`;
      setQcQrScannerStatus(qcQrScannerState.lastErrorMessage, "error");
      return;
    }

    try {
      qcQrScannerState.detector = new BarcodeDetector({ formats: ["qr_code"] });
    } catch (error) {
      const details = getQcScannerErrorDetails(error);
      qcQrScannerState.lastErrorMessage = `Live camera QR detection is unavailable (${details || "unknown error"}).`;
      setQcQrScannerStatus(qcQrScannerState.lastErrorMessage, "error");
      return;
    }

    setQcQrScannerStatus("Camera is ready. Point it at a QR code.");

    qcQrScannerState.intervalId = setInterval(async () => {
      if (!qcQrScannerState.active || settled) return;
      try {
        const barcodes = await qcQrScannerState.detector.detect(video);
        if (!Array.isArray(barcodes) || !barcodes.length) return;
        const rawValue = String(barcodes[0]?.rawValue || "").trim();
        if (!rawValue) return;
        setQcQrScannerStatus(`QR detected: ${rawValue}`, "ok");
        finish(rawValue);
      } catch {
        // ignore intermittent camera decode errors
      }
    }, 260);
  });
}

function requiresQcEvidencePhoto(reason) {
  return QC_EVIDENCE_REASONS.has(String(reason || "").trim());
}

function getItemOptions(itemCounts) {
  return [
    { value: "top", count: Number(itemCounts?.top || 0) },
    { value: "bottom", count: Number(itemCounts?.bottom || 0) },
    { value: "underwear", count: Number(itemCounts?.underwear || 0) },
    { value: "socksPairs", count: Number(itemCounts?.socksPairs || 0) }
  ].filter((item) => item.count > 0);
}

function getIssueImages(inspection) {
  return (Array.isArray(inspection?.basket?.images) ? inspection.basket.images : [])
    .map((image, index) => {
      const role = String(image?.role || (index === 0 ? "overview" : "issue")).trim() === "overview"
        ? "overview"
        : "issue";
      return {
        id: String(image?.id || `qc-issue-${index}`),
        role,
        note: String(image?.note || "").trim()
      };
    })
    .filter((image) => image.role === "issue");
}

function ensureDefaultQcItemCategory() {
  if (!state.qcInspection || state.qcSelectedItemCategory) return;
  const itemOptions = getItemOptions(state.qcInspection.basket?.item_counts || null);
  if (itemOptions.length === 1) {
    state.qcSelectedItemCategory = itemOptions[0].value;
  }
}

function ensureDefaultQcIssueSelection() {
  if (!state.qcInspection) return;
  const issueImages = getIssueImages(state.qcInspection);
  if (!issueImages.length) return;

  const activeIssue = issueImages.find((image) => image.id === state.qcSelectedIssueImageId) || issueImages[0];
  state.qcSelectedIssueImageId = activeIssue.id;
  if (!String(state.qcSelectedItemLabel || "").trim() && activeIssue.note) {
    state.qcSelectedItemLabel = activeIssue.note.slice(0, 120);
  }
}

function getQcServicePreview(reason) {
  if (reason === "spot_treatment") return { serviceLabel: "Spot treatment", extraDays: 1 };
  if (reason === "hand_wash") return { serviceLabel: "Hand wash", extraDays: 1 };
  if (reason === "extra_treatment") return { serviceLabel: "Extra treatment", extraDays: 1 };
  return { serviceLabel: "Stain removal", extraDays: 1 };
}

function clearQcCurrentPhoto() {
  state.qcCurrentPhotoDataUrl = "";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read photo file."));
    reader.readAsDataURL(file);
  });
}

function removeQcImageLightbox() {
  document.querySelector(".qc-image-lightbox")?.remove();
}

function openQcImageLightbox(button) {
  const imageUrl = String(button?.dataset?.qcPreviewImage || "").trim();
  if (!imageUrl) return;

  removeQcImageLightbox();

  const title = String(button.dataset.qcPreviewTitle || "Photo").trim();
  const note = String(button.dataset.qcPreviewNote || "").trim();
  const overlay = document.createElement("div");
  overlay.className = "qc-image-lightbox";
  const backdrop = document.createElement("div");
  backdrop.className = "qc-image-lightbox-backdrop";
  backdrop.dataset.qcPreviewClose = "1";

  const dialog = document.createElement("section");
  dialog.className = "qc-image-lightbox-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", title);

  const toolbar = document.createElement("div");
  toolbar.className = "qc-image-lightbox-toolbar";

  const copy = document.createElement("div");
  copy.className = "qc-image-lightbox-copy";

  const strong = document.createElement("strong");
  strong.textContent = title;
  copy.appendChild(strong);

  if (note) {
    const noteNode = document.createElement("span");
    noteNode.textContent = note;
    copy.appendChild(noteNode);
  }

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "secondary";
  closeButton.dataset.qcPreviewClose = "1";
  closeButton.textContent = "Close";

  const media = document.createElement("img");
  media.className = "qc-image-lightbox-media";
  media.src = imageUrl;
  media.alt = title;

  toolbar.append(copy, closeButton);
  dialog.append(toolbar, media);
  overlay.append(backdrop, dialog);

  overlay.querySelectorAll("[data-qc-preview-close]").forEach((closeTarget) => {
    closeTarget.addEventListener("click", () => {
      overlay.remove();
    });
  });

  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      overlay.remove();
    }
  });

  document.body.appendChild(overlay);
  overlay.tabIndex = -1;
  overlay.focus();
}

function setActiveButtonInScope(button, selector) {
  const scope = button.closest(".qc-reason-selector, .qc-case-grid");
  if (!scope) return;
  for (const candidate of scope.querySelectorAll(selector)) {
    candidate.classList.toggle("active", candidate === button);
  }
}

function setActiveIssueCard(button) {
  const scope = button.closest(".qc-case-grid");
  if (!scope) return;
  for (const candidate of scope.querySelectorAll(".qc-case-card")) {
    candidate.classList.toggle("active", candidate.contains(button));
  }
}

function syncQcNextStepButton() {
  const nextButton = app.querySelector("[data-qc-modal-next-step]");
  if (!nextButton) return;
  const itemCategory = String(nextButton.dataset.qcItemCategory || state.qcSelectedItemCategory || "").trim();
  nextButton.disabled = state.submittingQcDecision || !itemCategory;
}

function syncQcReworkSubmitButton() {
  const submitButton = app.querySelector("[data-qc-modal-rework]");
  if (!submitButton) return;
  const reason = String(submitButton.dataset.qcReason || state.qcRejectReason || "stain_not_removed").trim();
  const requiresPhoto = requiresQcEvidencePhoto(reason);
  submitButton.disabled = Boolean(
    state.submittingQcDecision
    || !state.qcSelectedItemCategory
    || (requiresPhoto && !String(state.qcCurrentPhotoDataUrl || "").trim())
  );
}

function syncQcReasonPreview(reason) {
  const preview = getQcServicePreview(reason);
  const serviceChip = app.querySelector("[data-qc-service-label-chip]");
  if (serviceChip) serviceChip.textContent = preview.serviceLabel;

  const extraDaysChip = app.querySelector("[data-qc-extra-days-chip]");
  if (extraDaysChip) {
    extraDaysChip.textContent = `+${preview.extraDays} d`;
  }

  const submitButton = app.querySelector("[data-qc-modal-rework]");
  if (submitButton) {
    submitButton.dataset.qcReason = reason;
  }

  syncQcReworkSubmitButton();
}

function focusQcInput(inputId, helpers) {
  helpers.refocusScanInput(inputId || "simple-scan-input");
}

function clearQcAutoSubmitTimer() {
  if (qcAutoSubmitTimer) {
    clearTimeout(qcAutoSubmitTimer);
    qcAutoSubmitTimer = null;
  }
}

function looksLikeQcQrCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^QR:[A-Z]-\d{4,}-\d+$/.test(code);
}

function scheduleQcAutoSubmit(inputId, renderApp, helpers) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const value = String(input.value || "").trim();
  clearQcAutoSubmitTimer();
  if (!looksLikeQcQrCode(value) || state.submittingScanStation === "qc" || state.submittingQcDecision) {
    return;
  }
  qcAutoSubmitTimer = setTimeout(async () => {
    qcAutoSubmitTimer = null;
    await runQcInspectFromInput(inputId, renderApp, helpers);
  }, QC_AUTO_SUBMIT_DELAY_MS);
}

function normalizeTransferQrCode(value) {
  return String(value || "").trim().toUpperCase();
}

function transferQrMatched(actual, expected) {
  return Boolean(
    normalizeTransferQrCode(actual)
    && normalizeTransferQrCode(expected)
    && normalizeTransferQrCode(actual) === normalizeTransferQrCode(expected)
  );
}

function getQcTransferDraftKey(requestId) {
  const id = Number(requestId);
  if (!Number.isFinite(id) || id <= 0) return "";
  return String(id);
}

function getQcTransferDraft(requestId) {
  const key = getQcTransferDraftKey(requestId);
  if (!key) {
    return { sourceQrCode: "", targetQrCode: "" };
  }

  if (!state.qcTransferScanDrafts || typeof state.qcTransferScanDrafts !== "object") {
    state.qcTransferScanDrafts = {};
  }

  if (!state.qcTransferScanDrafts[key]) {
    state.qcTransferScanDrafts[key] = { sourceQrCode: "", targetQrCode: "" };
  }

  return state.qcTransferScanDrafts[key];
}

function updateQcTransferDraft(requestId, nextPatch) {
  const key = getQcTransferDraftKey(requestId);
  if (!key) return;
  const draft = getQcTransferDraft(requestId);
  state.qcTransferScanDrafts[key] = {
    sourceQrCode: String(nextPatch?.sourceQrCode ?? draft.sourceQrCode ?? "").trim(),
    targetQrCode: String(nextPatch?.targetQrCode ?? draft.targetQrCode ?? "").trim()
  };
}

function syncQcTransferTaskCard(card) {
  if (!card) return;

  const sourceInput = card.querySelector("[data-qc-transfer-source-input]");
  const targetInput = card.querySelector("[data-qc-transfer-target-input]");
  const confirmButton = card.querySelector("[data-confirm-qc-transfer-task]");
  if (!confirmButton) return;
  const taskKind = String(confirmButton.dataset.qcTransferTaskKind || "transfer_to_rework");
  const isReturnToFlow = taskKind === "return_to_flow";

  if (isReturnToFlow) {
    const isBusy = confirmButton.dataset.qcTransferBusy === "1";
    confirmButton.disabled = isBusy;
    return;
  }

  if (!sourceInput) return;

  const sourceValue = String(sourceInput.value || "").trim();
  const targetValue = String(targetInput?.value || "").trim();
  const expectedSource = String(sourceInput.dataset.qcTransferExpectedSource || "").trim();
  const expectedTarget = String(confirmButton.dataset.qcTransferExpectedTarget || targetInput?.dataset.qcTransferExpectedTarget || "").trim();
  const targetRequired = Boolean(expectedTarget);

  const sourceMatched = transferQrMatched(sourceValue, expectedSource);
  const targetMatched = targetRequired ? transferQrMatched(targetValue, expectedTarget) : true;

  const sourceHint = card.querySelector("[data-qc-transfer-source-hint]");
  if (sourceHint) {
    sourceHint.textContent = sourceMatched ? "QR matched" : "Scan source basket";
    sourceHint.classList.toggle("ok-text", sourceMatched);
  }

  const targetHint = card.querySelector("[data-qc-transfer-target-hint]");
  if (targetHint) {
    targetHint.textContent = targetMatched ? "QR matched" : "Scan target basket";
    targetHint.classList.toggle("ok-text", targetMatched);
  }

  const chips = card.querySelectorAll(".qc-transfer-check-row .qc-inline-chip");
  if (chips[0]) {
    chips[0].textContent = sourceMatched ? "Source: OK" : "Source: not confirmed";
    chips[0].classList.toggle("accent", sourceMatched);
  }
  if (chips[1]) {
    if (targetRequired) {
      chips[1].textContent = targetMatched ? "Target: OK" : "Target: not confirmed";
      chips[1].classList.toggle("accent", targetMatched);
    } else {
      chips[1].textContent = "Route: return to QC";
      chips[1].classList.add("accent");
    }
  }

  confirmButton.dataset.qcTransferSource = sourceValue;
  confirmButton.dataset.qcTransferTarget = targetValue;

  const isBusy = confirmButton.dataset.qcTransferBusy === "1";
  confirmButton.disabled = isBusy || !sourceMatched || !targetMatched;
}

export async function runQcInspectFromInput(inputId, renderApp, helpers) {
  const inlineQc = state.screen === "station" && state.currentStation === "qc";
  if (state.submittingQcDecision) return;
  clearQcAutoSubmitTimer();
  removeQcImageLightbox();

  const input = document.getElementById(inputId);
  if (!input) {
    setLastScan({ station: "qc", ok: false, code: "", message: "Scan input field not found." });
    if (!inlineQc) {
      setNotice("error", "Scan input field not found.");
    } else {
      state.notice = null;
      helpers.applyInlineScanStatus("qc", state.lastScan);
    }
    await renderApp();
    return;
  }

  const code = input.value.trim();
  if (!code) {
    setLastScan({ station: "qc", ok: false, code: "", message: "Empty QR code." });
    if (inlineQc) {
      state.notice = null;
      const updated = helpers.applyInlineScanStatus("qc", state.lastScan);
      if (!updated) {
        await renderApp();
      }
      const refreshedInput = document.getElementById(inputId);
      if (refreshedInput) refreshedInput.focus();
      return;
    }
    setNotice("warn", "Enter route sheet QR code for QC check.");
    await renderApp();
    const refreshedInput = document.getElementById(inputId);
    if (refreshedInput) refreshedInput.focus();
    return;
  }

  if (state.submittingScanStation === "qc") return;

  state.submittingScanStation = "qc";
  helpers.setScanUiBusy("qc", inputId, true);

  try {
    try {
      const result = await api("/api/qc/inspect", {
        method: "POST",
        body: JSON.stringify({ qrCode: code })
      });
      const itemOptions = getItemOptions(result.basket?.item_counts || null);
      state.selectedOrderId = result.order.id;
      state.qcInspection = {
        code,
        order: result.order,
        basket: result.basket,
        pending_rework_requests: Array.isArray(result.pending_rework_requests) ? result.pending_rework_requests : []
      };
      state.qcSelectedIssueImageId = getIssueImages(state.qcInspection)[0]?.id || "";
      state.qcSelectedItemCategory = itemOptions.length === 1 ? itemOptions[0].value : "";
      state.qcSelectedItemLabel = "";
      clearQcCurrentPhoto();
      state.qcModalOpen = false;
      state.qcModalStep = 1;
      setLastScan({
        station: "qc",
        ok: true,
        code,
        message: "Basket opened.",
        orderPublicId: result.order?.public_id || "",
        basketCode: result.basket?.basket_code || "",
        basketType: result.basket?.basket_type || "",
        basketQrCode: result.basket?.qr_code || code
      });
      if (inlineQc) {
        state.notice = null;
      } else {
        setNotice("ok", "QC: basket opened, choose a decision.");
      }
      helpers.playScanTone(true);
      input.value = "";
    } catch (error) {
      state.qcSelectedIssueImageId = "";
      state.qcSelectedItemCategory = "";
      state.qcSelectedItemLabel = "";
      clearQcCurrentPhoto();
      state.qcInspection = null;
      state.qcModalOpen = false;
      state.qcModalStep = 1;
      setLastScan({ station: "qc", ok: false, code, message: error.message });
      if (!inlineQc) {
        setNotice("error", error.message);
      } else {
        state.notice = null;
        const updated = helpers.applyInlineScanStatus("qc", state.lastScan);
        if (!updated) {
          await renderApp();
        }
        helpers.refocusScanInput(inputId);
        helpers.playScanTone(false);
        return;
      }
      helpers.playScanTone(false);
    }
  } finally {
    state.submittingScanStation = null;
    helpers.setScanUiBusy("qc", inputId, false);
  }

  await renderApp();
  focusQcInput(inputId, helpers);
}

export async function runQcDecision(action, reason, renderApp, helpers) {
  if (state.submittingQcDecision) return;
  removeQcImageLightbox();

  const code = String(state.qcInspection?.code || "").trim();
  const inlineQc = state.screen === "station" && state.currentStation === "qc";
  const selectedItemCategory = String(state.qcSelectedItemCategory || "").trim();
  const selectedItemLabel = String(state.qcSelectedItemLabel || "").trim();
  const selectedIssueImageId = String(state.qcSelectedIssueImageId || "").trim();
  const qcCurrentPhotoDataUrl = String(state.qcCurrentPhotoDataUrl || "").trim();
  const inspectionSnapshot = state.qcInspection ? {
    order: state.qcInspection.order,
    basket: state.qcInspection.basket
  } : null;

  if (!code) {
    setNotice("warn", "Scan route sheet for QC first.");
    await renderApp();
    return;
  }

  if (action === "rework" && requiresQcEvidencePhoto(reason) && !qcCurrentPhotoDataUrl) {
    setNotice("warn", "Add post-drying photo for current item state.");
    await renderApp();
    return;
  }

  state.submittingQcDecision = true;
  try {
    await renderApp();
    let result;
    if (action === "pass") {
      result = await api("/api/scan", {
        method: "POST",
        body: JSON.stringify({ station: "qc", qrCode: code })
      });
    } else if (action === "damage") {
      result = await api("/api/qc/reject", {
        method: "POST",
        body: JSON.stringify({ qrCode: code, reason: "damage" })
      });
    } else {
      result = await api("/api/qc/rework", {
        method: "POST",
        body: JSON.stringify({
          qrCode: code,
          reason,
          itemCategory: selectedItemCategory,
          itemLabel: selectedItemLabel,
          quantity: 1,
          issueImageId: selectedIssueImageId,
          qcPhotoDataUrl: qcCurrentPhotoDataUrl
        })
      });
    }
    const successMessage = action === "pass"
      ? "QC passed. Basket moved to ironing."
      : (action === "damage" ? "Order moved to HOLD." : "Rework request sent for approval.");

    state.selectedOrderId = result.order.id;
    if (action === "rework") {
      state.qcInspection = null;
      state.qcModalOpen = false;
      state.qcModalStep = 1;
    } else {
      state.qcInspection = null;
      state.qcModalOpen = false;
      state.qcModalStep = 1;
    }
    state.qcSelectedItemCategory = "";
    state.qcSelectedIssueImageId = "";
    state.qcSelectedItemLabel = "";
    clearQcCurrentPhoto();
    setLastScan({
      station: "qc",
      ok: true,
      code,
      message: successMessage,
      orderPublicId: result.order?.public_id || inspectionSnapshot?.order?.public_id || "",
      basketCode: result.basket?.basket_code || inspectionSnapshot?.basket?.basket_code || "",
      basketType: result.basket?.basket_type || inspectionSnapshot?.basket?.basket_type || "",
      basketQrCode: result.basket?.qr_code || inspectionSnapshot?.basket?.qr_code || code
    });
    if (inlineQc) {
      state.notice = null;
    } else {
      setNotice("ok", successMessage);
    }
    helpers.playScanTone(true);
  } catch (error) {
    setLastScan({ station: "qc", ok: false, code, message: error.message });
    if (inlineQc) {
      state.notice = null;
    } else {
      setNotice("error", error.message);
    }
    helpers.playScanTone(false);
  } finally {
    state.submittingQcDecision = false;
  }

  await renderApp();
  focusQcInput("simple-scan-input", helpers);
}

export function bindQcActions(renderApp, helpers) {
  for (const input of app.querySelectorAll("[data-qc-auto-submit]")) {
    input.addEventListener("input", () => {
      scheduleQcAutoSubmit(input.id, renderApp, helpers);
    });
  }

  for (const button of app.querySelectorAll("[data-qc-open-camera]")) {
    button.addEventListener("click", async () => {
      if (state.submittingQcDecision || state.submittingScanStation === "qc") return;
      const inputId = String(button.dataset.qcCameraInputId || "simple-scan-input");
      const scannedValue = await openQcQrScanner();
      if (!scannedValue) {
        const reason = String(qcQrScannerState.lastErrorMessage || "").trim();
        if (reason) {
          setNotice("warn", reason);
          await renderApp();
        }
        return;
      }

      const normalizedValue = normalizeQcCameraQrCode(scannedValue);
      if (!normalizedValue) {
        setNotice("warn", "QR code was not recognized.");
        await renderApp();
        return;
      }

      const input = document.getElementById(inputId);
      if (!(input instanceof HTMLInputElement)) {
        setNotice("error", "Scan input field not found.");
        await renderApp();
        return;
      }

      input.value = normalizedValue;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await runQcInspectFromInput(inputId, renderApp, helpers);
    });
  }

  for (const button of app.querySelectorAll("[data-qc-reason-select]")) {
    button.addEventListener("click", () => {
      if (state.submittingQcDecision) return;
      const reason = String(button.dataset.qcReasonSelect || "").trim();
      if (!reason) return;

      state.qcRejectReason = reason;
      setActiveButtonInScope(button, "[data-qc-reason-select]");
      syncQcReasonPreview(reason);
    });
  }

  for (const button of app.querySelectorAll("[data-qc-item-category]")) {
    button.addEventListener("click", () => {
      if (state.submittingQcDecision) return;
      const category = String(button.dataset.qcItemCategory || "").trim();
      if (!category) return;

      state.qcSelectedItemCategory = category;
      setActiveButtonInScope(button, "[data-qc-item-category]");
      syncQcNextStepButton();
    });
  }

  for (const button of app.querySelectorAll("[data-qc-issue-id]")) {
    button.addEventListener("click", () => {
      if (state.submittingQcDecision) return;
      const issueId = String(button.dataset.qcIssueId || "").trim();
      if (!issueId) return;

      state.qcSelectedIssueImageId = issueId;
      state.qcSelectedItemLabel = String(button.dataset.qcIssueNote || "").trim().slice(0, 120);
      setActiveButtonInScope(button, "[data-qc-issue-id]");
    });
  }

  for (const button of app.querySelectorAll("[data-run-qc-pass]")) {
    button.addEventListener("click", async () => {
      if (state.submittingQcDecision) return;
      await runQcDecision("pass", null, renderApp, helpers);
    });
  }

  for (const button of app.querySelectorAll("[data-qc-open-rework-modal]")) {
    button.addEventListener("click", async () => {
      if (state.submittingQcDecision) return;
      if (!state.qcInspection) return;
      removeQcImageLightbox();
      ensureDefaultQcItemCategory();
      ensureDefaultQcIssueSelection();
      clearQcCurrentPhoto();
      state.qcModalOpen = true;
      state.qcModalStep = 1;
      await renderApp();
    });
  }

  for (const button of app.querySelectorAll("[data-run-qc-damage]")) {
    button.addEventListener("click", async () => {
      if (state.submittingQcDecision) return;
      await runQcDecision("damage", "damage", renderApp, helpers);
    });
  }

  for (const button of app.querySelectorAll("[data-qc-modal-rework]")) {
    button.addEventListener("click", async () => {
      if (state.submittingQcDecision) return;
      const reason = String(button.dataset.qcReason || state.qcRejectReason || "stain_not_removed").trim() || "stain_not_removed";
      const itemCategory = String(button.dataset.qcItemCategory || state.qcSelectedItemCategory || "").trim();
      state.qcSelectedItemCategory = itemCategory;
      await runQcDecision("rework", reason, renderApp, helpers);
    });
  }

  for (const input of app.querySelectorAll("[data-qc-item-label]")) {
    input.addEventListener("input", () => {
      state.qcSelectedItemLabel = String(input.value || "").slice(0, 120);
    });
  }

  for (const button of app.querySelectorAll("[data-qc-current-photo-pick]")) {
    button.addEventListener("click", () => {
      if (state.submittingQcDecision) return;
      const field = button.closest(".qc-photo-capture");
      const input = field?.querySelector("[data-qc-current-photo-input]");
      input?.click();
    });
  }

  for (const input of app.querySelectorAll("[data-qc-current-photo-input]")) {
    input.addEventListener("change", async () => {
      if (state.submittingQcDecision) return;
      const file = input.files?.[0];
      if (!file) return;

      try {
        state.qcCurrentPhotoDataUrl = await readFileAsDataUrl(file);
        await renderApp();
      } catch (error) {
        setNotice("error", error.message || "Failed to upload photo.");
        await renderApp();
      }
    });
  }

  for (const button of app.querySelectorAll("[data-qc-current-photo-clear]")) {
    button.addEventListener("click", async () => {
      if (state.submittingQcDecision) return;
      clearQcCurrentPhoto();
      await renderApp();
    });
  }

  for (const button of app.querySelectorAll("[data-qc-preview-image]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openQcImageLightbox(button);
    });
  }

  for (const button of app.querySelectorAll("[data-open-qc-transfer-panel]")) {
    button.addEventListener("click", async () => {
      if (state.submittingQcTransferRequestId) return;
      state.qcTransferPanelOpen = true;
      await renderApp();
    });
  }

  for (const button of app.querySelectorAll("[data-close-qc-transfer-panel]")) {
    button.addEventListener("click", async () => {
      if (state.submittingQcTransferRequestId) return;
      state.qcTransferPanelOpen = false;
      state.qcTransferScanDrafts = {};
      await renderApp();
    });
  }

  for (const input of app.querySelectorAll("[data-qc-transfer-source-input]")) {
    input.addEventListener("input", () => {
      const requestId = Number(input.dataset.qcTransferSourceInput);
      if (!Number.isFinite(requestId)) return;
      const draft = getQcTransferDraft(requestId);
      updateQcTransferDraft(requestId, {
        sourceQrCode: input.value,
        targetQrCode: draft.targetQrCode
      });
      syncQcTransferTaskCard(input.closest("[data-qc-transfer-task-card]"));
    });
  }

  for (const input of app.querySelectorAll("[data-qc-transfer-target-input]")) {
    input.addEventListener("input", () => {
      const requestId = Number(input.dataset.qcTransferTargetInput);
      if (!Number.isFinite(requestId)) return;
      const draft = getQcTransferDraft(requestId);
      updateQcTransferDraft(requestId, {
        sourceQrCode: draft.sourceQrCode,
        targetQrCode: input.value
      });
      syncQcTransferTaskCard(input.closest("[data-qc-transfer-task-card]"));
    });
  }

  for (const button of app.querySelectorAll("[data-confirm-qc-transfer-task]")) {
    button.addEventListener("click", async () => {
      const requestId = Number(button.dataset.confirmQcTransferTask);
      if (!Number.isFinite(requestId) || state.submittingQcTransferRequestId) return;

      const sourceQrCode = String(button.dataset.qcTransferSource || "").trim();
      const targetQrCode = String(button.dataset.qcTransferTarget || "").trim();
      const expectedSourceQrCode = String(button.dataset.qcTransferExpectedSource || "").trim();
      const expectedTargetQrCode = String(button.dataset.qcTransferExpectedTarget || "").trim();
      const taskKind = String(button.dataset.qcTransferTaskKind || "transfer_to_rework");
      const isReturnToFlow = taskKind === "return_to_flow";
      const sourceMatched = isReturnToFlow ? true : transferQrMatched(sourceQrCode, expectedSourceQrCode);
      const targetMatched = isReturnToFlow ? true : (expectedTargetQrCode ? transferQrMatched(targetQrCode, expectedTargetQrCode) : true);

      if (!sourceMatched || !targetMatched) {
        setNotice("warn", expectedTargetQrCode
          ? "Scan source and target baskets until QR codes match."
          : "Scan source basket until QR code matches.");
        await renderApp();
        return;
      }

      state.submittingQcTransferRequestId = requestId;
      await renderApp();
      try {
        const result = await api(`/api/qc/transfer-tasks/${requestId}/confirm`, {
          method: "POST",
          body: JSON.stringify(isReturnToFlow
            ? {}
            : {
                sourceQrCode,
                targetQrCode
              })
        });
        delete state.qcTransferScanDrafts[String(requestId)];
        setNotice("ok", "Transfer task confirmed.");
      } catch (error) {
        setNotice("error", error.message || "Failed to confirm transfer.");
      } finally {
        state.submittingQcTransferRequestId = null;
      }
      await renderApp();
      helpers.refocusScanInput("simple-scan-input");
    });
  }

  for (const button of app.querySelectorAll("[data-qc-modal-close]")) {
    button.addEventListener("click", async () => {
      if (state.submittingQcDecision) return;
      removeQcImageLightbox();
      clearQcCurrentPhoto();
      state.qcModalOpen = false;
      state.qcModalStep = 1;
      await renderApp();
      helpers.refocusScanInput("simple-scan-input");
    });
  }

  for (const button of app.querySelectorAll("[data-qc-modal-next-step]")) {
    button.addEventListener("click", async () => {
      if (state.submittingQcDecision) return;
      const itemCategory = String(button.dataset.qcItemCategory || state.qcSelectedItemCategory || "").trim();
      if (!itemCategory) return;
      state.qcSelectedItemCategory = itemCategory;
      removeQcImageLightbox();
      state.qcModalStep = 2;
      await renderApp();
    });
  }

  for (const button of app.querySelectorAll("[data-qc-modal-prev-step]")) {
    button.addEventListener("click", async () => {
      if (state.submittingQcDecision) return;
      removeQcImageLightbox();
      state.qcModalStep = 1;
      await renderApp();
    });
  }

  for (const card of app.querySelectorAll("[data-qc-transfer-task-card]")) {
    syncQcTransferTaskCard(card);
  }
}

export function resetQcUiState() {
  closeQcQrScanner();
  clearQcAutoSubmitTimer();
  resetQcState();
}
