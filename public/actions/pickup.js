import { api } from "../api.js";
import { openQcQrScanner } from "./qc.js";
import { createPickupPlacementDraft, setNotice, state } from "../state.js";

function normalizePickupLocationQr(value) {
  let normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!normalized) return "";
  normalized = normalized.replace(/^QR[-]/, "QR:");
  if (/^LOC-[A-Z]\d{2}$/.test(normalized)) {
    return `QR:${normalized}`;
  }
  return normalized;
}

function ensurePlacementDraft() {
  if (!state.pickupPlacementDraft || typeof state.pickupPlacementDraft !== "object") {
    state.pickupPlacementDraft = createPickupPlacementDraft();
  }
  if (!Array.isArray(state.pickupPlacementDraft.placements)) {
    state.pickupPlacementDraft.placements = createPickupPlacementDraft().placements;
  }
  if (!Number.isFinite(Number(state.pickupPlacementDraft.containerCount))) {
    state.pickupPlacementDraft.containerCount = 1;
  }
  if (!Object.prototype.hasOwnProperty.call(state.pickupPlacementDraft, "feedback")) {
    state.pickupPlacementDraft.feedback = null;
  }
  return state.pickupPlacementDraft;
}

function resetPlacementDraft(orderId = null, options = {}) {
  state.pickupPlacementDraft = createPickupPlacementDraft();
  if (Number.isFinite(Number(orderId)) && Number(orderId) > 0) {
    state.pickupPlacementDraft.orderId = Number(orderId);
  }
  const locationQr = normalizePickupLocationQr(options.locationQr || "");
  state.pickupPlacementDraft.containerCount = 1;
  state.pickupPlacementDraft.placements = [{ locationQr }];
}

function setPlacementFeedback(type, text) {
  const draft = ensurePlacementDraft();
  const message = String(text || "").trim();
  draft.feedback = message ? { type, text: message } : null;
}

function clearPlacementFeedback() {
  const draft = ensurePlacementDraft();
  draft.feedback = null;
}

function focusPlacementInput() {
  const nextInput = document.querySelector("[data-pickup-placement-input][data-pickup-placement-active=\"true\"]");
  if (!(nextInput instanceof HTMLInputElement)) return;
  nextInput.focus();
  nextInput.select();
}

function getPlacementPayloadFromDraft() {
  const draft = ensurePlacementDraft();
  const containerCount = 1;
  const row = draft.placements[0] || {};
  const placements = [{
    locationQr: normalizePickupLocationQr(row.locationQr || "")
  }];
  return {
    orderId: Number(draft.orderId || 0),
    containerCount,
    placements
  };
}

function validatePlacementPayload(payload) {
  if (!Number.isFinite(payload.orderId) || payload.orderId <= 0) {
    return "Select an order from the Ready to place list.";
  }
  if (!Number.isInteger(payload.containerCount) || payload.containerCount !== 1) {
    return "Use one storage location for the order.";
  }
  for (let index = 0; index < payload.placements.length; index += 1) {
    const row = payload.placements[index];
    if (!row.locationQr) {
      return "Scan a storage location for this order.";
    }
  }
  return "";
}

export function bindPickupActions(renderApp) {
  for (const button of document.querySelectorAll("[data-pickup-mode]")) {
    button.addEventListener("click", async () => {
      const mode = String(button.dataset.pickupMode || "").trim();
      if (mode !== "assembly" && mode !== "placement") return;
      if (mode === "placement" && state.pickupAssemblyCompletionPrompt?.orderId) {
        return;
      }

      state.pickupMode = mode;
      const placeOrderId = Number(button.dataset.pickupPlaceOrder || 0);
      if (mode === "placement" && Number.isFinite(placeOrderId) && placeOrderId > 0) {
        resetPlacementDraft(placeOrderId);
      }
      await renderApp();
      if (mode === "placement") {
        focusPlacementInput();
      }
    });
  }

  for (const button of document.querySelectorAll("[data-pickup-assembly-ack]")) {
    button.addEventListener("click", async () => {
      const prompt = state.pickupAssemblyCompletionPrompt;
      const orderId = Number(prompt?.orderId || 0);
      state.pickupAssemblyCompletionPrompt = null;
      if (orderId > 0) {
        state.activePickupOrderId = orderId;
      }
      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-pickup-place-order]")) {
    button.addEventListener("click", async () => {
      const orderId = Number(button.dataset.pickupPlaceOrder || 0);
      if (!Number.isFinite(orderId) || orderId <= 0) return;
      const locationQr = normalizePickupLocationQr(button.dataset.pickupPlaceLocation || "");
      state.pickupMode = "placement";
      resetPlacementDraft(orderId, { locationQr });
      await renderApp();
      focusPlacementInput();
    });
  }

  for (const button of document.querySelectorAll("[data-pickup-confirm-assembled]")) {
    button.addEventListener("click", async () => {
      const orderId = Number(button.dataset.pickupConfirmAssembled || 0);
      if (!Number.isFinite(orderId) || orderId <= 0) return;
      try {
        const result = await api("/api/pickup/confirm-assembled", {
          method: "POST",
          body: JSON.stringify({ orderId })
        });
        setNotice("ok", result.message || "Order is ready for handoff.");
      } catch (error) {
        setNotice("error", error.message || "Failed to confirm assembly.");
      }
      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-pickup-place-close]")) {
    button.addEventListener("click", async () => {
      resetPlacementDraft();
      await renderApp();
    });
  }

  for (const button of document.querySelectorAll("[data-pickup-place-clear]")) {
    button.addEventListener("click", async () => {
      const orderId = Number(ensurePlacementDraft().orderId || 0);
      resetPlacementDraft(orderId > 0 ? orderId : null);
      await renderApp();
      focusPlacementInput();
    });
  }

  for (const input of document.querySelectorAll("[data-pickup-placement-input]")) {
    input.addEventListener("input", () => {
      const draft = ensurePlacementDraft();
      const slotIndex = Number(input.dataset.slotIndex || 0);
      const field = String(input.dataset.pickupPlacementInput || "").trim();
      if (!Number.isFinite(slotIndex) || slotIndex < 0 || slotIndex > 5) return;
      if (field !== "locationQr") return;
      if (!draft.placements[slotIndex]) {
        draft.placements[slotIndex] = { locationQr: "" };
      }
      draft.placements[slotIndex][field] = input.value;
      clearPlacementFeedback();
    });

    input.addEventListener("change", async () => {
      const slotIndex = Number(input.dataset.slotIndex || 0);
      const field = String(input.dataset.pickupPlacementInput || "").trim();
      if (!Number.isFinite(slotIndex) || slotIndex < 0 || slotIndex > 5) return;
      if (field !== "locationQr") return;

      const draft = ensurePlacementDraft();
      if (!draft.placements[slotIndex]) {
        draft.placements[slotIndex] = { locationQr: "" };
      }
      const normalized = normalizePickupLocationQr(input.value);
      draft.placements[slotIndex][field] = normalized;
      input.value = normalized;
      clearPlacementFeedback();
      await renderApp();
      focusPlacementInput();
    });

    input.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();

      const slotIndex = Number(input.dataset.slotIndex || 0);
      const field = String(input.dataset.pickupPlacementInput || "").trim();
      if (!Number.isFinite(slotIndex) || slotIndex < 0 || slotIndex > 5) return;
      if (field !== "locationQr") return;

      const draft = ensurePlacementDraft();
      if (!draft.placements[slotIndex]) {
        draft.placements[slotIndex] = { locationQr: "" };
      }
      const normalized = normalizePickupLocationQr(input.value);
      draft.placements[slotIndex][field] = normalized;
      input.value = normalized;
      clearPlacementFeedback();
      await renderApp();
      focusPlacementInput();
    });
  }

  for (const button of document.querySelectorAll("[data-pickup-placement-open-camera]")) {
    button.addEventListener("click", async () => {
      if (state.submittingPickupPlacement) return;

      const slotIndex = Number(button.dataset.slotIndex || 0);
      const field = String(button.dataset.pickupPlacementField || "").trim();
      if (!Number.isFinite(slotIndex) || slotIndex < 0 || slotIndex > 5) return;
      if (field !== "locationQr") return;

      const scannedValue = await openQcQrScanner({
        title: "Storage location scanning",
        subtitle: "Point the camera at the storage location QR"
      });
      if (!scannedValue) return;

      const normalized = normalizePickupLocationQr(scannedValue);
      if (!normalized) {
        setPlacementFeedback("warn", "QR code was not recognized.");
        await renderApp();
        focusPlacementInput();
        return;
      }

      const draft = ensurePlacementDraft();
      if (!draft.placements[slotIndex]) {
        draft.placements[slotIndex] = { locationQr: "" };
      }
      draft.placements[slotIndex][field] = normalized;
      clearPlacementFeedback();

      await renderApp();
      focusPlacementInput();
    });
  }

  for (const button of document.querySelectorAll("[data-pickup-place-submit]")) {
    button.addEventListener("click", async () => {
      if (state.submittingPickupPlacement) return;
      const payload = getPlacementPayloadFromDraft();
      const validationError = validatePlacementPayload(payload);
      if (validationError) {
        setPlacementFeedback("warn", validationError);
        await renderApp();
        focusPlacementInput();
        return;
      }

      state.submittingPickupPlacement = true;
      clearPlacementFeedback();
      try {
        const result = await api("/api/pickup/place-order", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        state.activePickupOrderId = null;
        resetPlacementDraft();
        setNotice("ok", result.message || "Storage location assigned.");
      } catch (error) {
        setPlacementFeedback("error", error.message);
      } finally {
        state.submittingPickupPlacement = false;
      }
      await renderApp();
      focusPlacementInput();
    });
  }
}
