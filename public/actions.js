import { api, downloadScanExport } from "./api.js";
import { app, clearLastScan, resetSession, setLastScan, setNotice, setSimpleMode, state, stationLabels } from "./state.js";
import { renderSortingEditorModal } from "./render/orders.js";
import { escapeHtml } from "./utils.js";

let managerFilterTimeoutId = null;

function setButtonLoading(button, isLoading, loadingText) {
  if (!button) return;

  if (isLoading) {
    if (!button.dataset.defaultLabel) {
      button.dataset.defaultLabel = button.textContent || "";
    }
    button.dataset.wasDisabled = button.disabled ? "1" : "0";
    button.dataset.loading = "1";
    button.disabled = true;
    button.textContent = loadingText;
    return;
  }

  const wasDisabled = button.dataset.wasDisabled === "1";
  if (button.dataset.defaultLabel) {
    button.textContent = button.dataset.defaultLabel;
  }
  button.disabled = wasDisabled;
  delete button.dataset.loading;
  delete button.dataset.wasDisabled;
}

function setScanUiBusy(station, inputId, isBusy) {
  const loadingText = station === "qc" ? "Открываем..." : "Проверяем...";
  for (const button of app.querySelectorAll(`[data-run-scan="${station}"]`)) {
    setButtonLoading(button, isBusy, loadingText);
  }

  const input = document.getElementById(inputId);
  if (input) {
    if (isBusy) {
      input.dataset.wasDisabled = input.disabled ? "1" : "0";
      input.disabled = true;
    } else {
      input.disabled = input.dataset.wasDisabled === "1";
      delete input.dataset.wasDisabled;
    }
  }
}

function setCreateBasketsUiBusy(orderId, isBusy) {
  const button = app.querySelector(`[data-create-baskets="${orderId}"]`);
  setButtonLoading(button, isBusy, "Создаем...");
}

function setCompletePickupUiBusy(orderId, isBusy) {
  const button = app.querySelector(`[data-complete-pickup="${orderId}"]`);
  setButtonLoading(button, isBusy, "Подтверждаем...");
}

function playScanTone(ok) {
  const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextImpl) return;

  const context = new AudioContextImpl();
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.value = ok ? 880 : 220;
  gain.gain.value = 0.0001;

  oscillator.connect(gain);
  gain.connect(context.destination);

  const now = context.currentTime;
  gain.gain.exponentialRampToValueAtTime(0.09, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (ok ? 0.16 : 0.24));

  oscillator.start(now);
  oscillator.stop(now + (ok ? 0.17 : 0.25));

  oscillator.onended = () => context.close().catch(() => {});
}

const sortingColorLabels = {
  mixed: "Смешанные",
  white: "Белые",
  color: "Цветные",
  dark: "Темные",
  delicate: "Деликатные"
};

function createSortingRow(seed = null) {
  const source = seed || {};
  return {
    color: sortingColorLabels[source.color] ? source.color : "mixed"
  };
}

function normalizeSortingCount(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 1;
  return Math.max(1, Math.min(parsed, 20));
}

function ensureSortingDraft(orderId) {
  if (!state.sortingDrafts[orderId] || !Array.isArray(state.sortingDrafts[orderId].rows) || !state.sortingDrafts[orderId].rows.length) {
    state.sortingDrafts[orderId] = { rows: [createSortingRow()] };
  }
  return state.sortingDrafts[orderId];
}

function setSortingRowCount(orderId, nextCount) {
  const draft = ensureSortingDraft(orderId);
  const count = normalizeSortingCount(nextCount);
  const existing = draft.rows.slice(0, count).map((row) => createSortingRow(row));

  while (existing.length < count) {
    existing.push(createSortingRow());
  }

  draft.rows = existing;
}

function buildBasketType(row, index) {
  const color = sortingColorLabels[row.color] || sortingColorLabels.mixed;
  return `${color} #${index + 1}`;
}

function basketWord(count) {
  if (count % 10 === 1 && count % 100 !== 11) return "корзина";
  if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20)) return "корзины";
  return "корзин";
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

function getQcRejectActionText(reason) {
  return String(reason || "").trim() === "damage" ? "В HOLD менеджеру" : "На повторную стирку";
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

  const previewItems = modal.querySelectorAll(".sorting-preview-item");
  const preview = previewItems[rowIndex];
  if (preview) {
    applyToneClass(preview, getToneClass(rowValue));
    const previewText = preview.querySelector(".sorting-preview-text span");
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
    customer_phone: String(sheet.dataset.sortingOrderPhone || "").trim() || null
  };
}

function syncModalBodyClass() {
  const hasModal = Boolean(app.querySelector(".sorting-modal, .qc-modal"));
  document.body.classList.toggle("modal-open", hasModal);
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
  template.innerHTML = renderSortingEditorModal(order, draft.rows).trim();
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
  template.innerHTML = renderSortingEditorModal(order, draft.rows).trim();
  const nextModal = template.content.firstElementChild;
  if (!nextModal) return false;

  const nextGrid = nextModal.querySelector(".sorting-editor-grid");
  const currentGrid = modal.querySelector(".sorting-editor-grid");
  if (nextGrid && currentGrid) {
    currentGrid.replaceWith(nextGrid);
  } else {
    const nextSheet = nextModal.querySelector(".sorting-modal-sheet");
    const currentSheet = modal.querySelector(".sorting-modal-sheet");
    if (nextSheet && currentSheet) {
      currentSheet.replaceWith(nextSheet);
    } else {
      modal.replaceWith(nextModal);
      return true;
    }
  }

  const nextFooter = nextModal.querySelector(".sorting-modal-footer");
  const currentFooter = modal.querySelector(".sorting-modal-footer");
  if (nextFooter && currentFooter) {
    currentFooter.replaceWith(nextFooter);
  }

  const nextSheet = nextModal.querySelector(".sorting-modal-sheet");
  const currentSheet = modal.querySelector(".sorting-modal-sheet");
  if (nextSheet && currentSheet) {
    currentSheet.dataset.sortingOrderId = nextSheet.dataset.sortingOrderId || currentSheet.dataset.sortingOrderId;
    currentSheet.dataset.sortingPublicId = nextSheet.dataset.sortingPublicId || currentSheet.dataset.sortingPublicId;
    currentSheet.dataset.sortingCustomerName = nextSheet.dataset.sortingCustomerName || currentSheet.dataset.sortingCustomerName;
  }

  return true;
}

function showPickupScanFlash(payload, renderApp) {
  void renderApp;
  if (!payload || !payload.ok) return;

  state.pickupScanFlash = {
    ...payload,
    scannedAt: new Date().toISOString()
  };
}

const inlineScanStations = new Set(["washing", "drying", "ironing"]);

function canUseInlineStationUpdate(station) {
  return inlineScanStations.has(station)
    && state.screen === "station"
    && state.currentStation === station;
}

function renderInlineScanStatus(station, scan) {
  if (!scan || scan.station !== station) {
    return `
      <section class="scan-status idle" data-scan-status="${station}">
        <strong>Ожидание</strong>
        <div class="muted">Сканируйте QR-код, чтобы обновить статус.</div>
      </section>
    `;
  }

  if (scan.ok) {
    return `
      <section class="scan-status ok" data-scan-status="${station}">
        <strong>OK</strong>
        <div>${escapeHtml(scan.message || "QR подтвержден.")}</div>
      </section>
    `;
  }

  return `
    <section class="scan-status error" data-scan-status="${station}">
      <strong>Ошибка</strong>
      <div>${escapeHtml(scan.message || "QR не подтвержден.")}</div>
    </section>
  `;
}

function applyInlineScanStatus(station, scan) {
  const current = app.querySelector(`[data-scan-status="${station}"]`);
  if (!current) return false;

  const template = document.createElement("template");
  template.innerHTML = renderInlineScanStatus(station, scan).trim();
  const next = template.content.firstElementChild;
  if (!next) return false;

  current.replaceWith(next);
  return true;
}

async function refreshInlineKioskCount(station) {
  const badge = app.querySelector(`[data-kiosk-active-count="${station}"]`);
  if (!badge) return;

  try {
    const payload = await api(`/api/orders?station=${station}`);
    const count = Array.isArray(payload.orders) ? payload.orders.length : 0;
    badge.textContent = `В работе: ${count}`;
    badge.classList.toggle("ok", count > 0);
    badge.classList.toggle("warn", count === 0);
  } catch {
    // ignore count refresh failure in inline mode
  }
}

function refocusScanInput(inputId) {
  const refreshedInput = document.getElementById(inputId);
  if (refreshedInput) {
    refreshedInput.focus();
    refreshedInput.select();
  }
}

export async function runScanFromInput(station, inputId, renderApp) {
  const inlineUpdate = canUseInlineStationUpdate(station);
  const input = document.getElementById(inputId);
  if (!input) {
    setLastScan({ station, ok: false, code: "", message: "Поле сканирования не найдено." });
    if (!inlineUpdate) {
      setNotice("error", "Поле сканирования не найдено.");
    } else {
      state.notice = null;
      applyInlineScanStatus(station, state.lastScan);
    }
    await renderApp();
    return;
  }
  const code = input.value.trim();
  if (!code) {
    setLastScan({ station, ok: false, code: "", message: "Пустой QR-код." });
    if (inlineUpdate) {
      state.notice = null;
      applyInlineScanStatus(station, state.lastScan);
      const refreshedInput = document.getElementById(inputId);
      if (refreshedInput) refreshedInput.focus();
      return;
    }
    setNotice("warn", "Скан не выполнен: пустой QR-код.");
    await renderApp();
    const refreshedInput = document.getElementById(inputId);
    if (refreshedInput) refreshedInput.focus();
    return;
  }

  if (state.submittingScanStation === station) {
    return;
  }

  state.submittingScanStation = station;
  setScanUiBusy(station, inputId, true);

  try {
    try {
      const result = await api("/api/scan", {
        method: "POST",
        body: JSON.stringify({ station, qrCode: code })
      });
      const statusMessage = station === "pickup" && result.pickupProgress
        ? `${result.message} (${Number(result.pickupProgress.scannedBaskets || 0)}/${Number(result.pickupProgress.totalBaskets || 0)})`
        : result.message;
      state.selectedOrderId = result.order.id;
      if (station === "pickup") {
        const progress = result.pickupProgress || null;
        const progressText = progress ? `${Number(progress.scannedBaskets || 0)}/${Number(progress.totalBaskets || 0)}` : null;
        state.pickupVerifiedOrderId = Number(result.order.id);
        showPickupScanFlash({
          ok: true,
          message: result.message,
          orderPublicId: result.order.public_id,
          basketCode: result.basket?.basket_code || code,
          progressText
        }, renderApp);
      }
      setLastScan({ station, ok: true, code, message: statusMessage });
      if (!inlineUpdate) {
        setNotice("ok", statusMessage);
      } else {
        state.notice = null;
      }
      playScanTone(true);
      input.value = "";
    } catch (error) {
      if (station === "pickup") {
        state.pickupVerifiedOrderId = null;
      }
      setLastScan({ station, ok: false, code, message: error.message });
      if (!inlineUpdate) {
        setNotice("error", error.message);
      } else {
        state.notice = null;
      }
      playScanTone(false);
    }
  } finally {
    state.submittingScanStation = null;
    setScanUiBusy(station, inputId, false);
  }

  if (inlineUpdate) {
    applyInlineScanStatus(station, state.lastScan);
    await refreshInlineKioskCount(station);
    refocusScanInput(inputId);
    return;
  }

  await renderApp();
  refocusScanInput(inputId);
}

async function runQcInspectFromInput(inputId, renderApp) {
  const inlineQc = state.screen === "station" && state.currentStation === "qc";
  const input = document.getElementById(inputId);
  if (!input) {
    setLastScan({ station: "qc", ok: false, code: "", message: "Поле сканирования не найдено." });
    if (!inlineQc) {
      setNotice("error", "Поле сканирования не найдено.");
    } else {
      state.notice = null;
      applyInlineScanStatus("qc", state.lastScan);
    }
    await renderApp();
    return;
  }

  const code = input.value.trim();
  if (!code) {
    setLastScan({ station: "qc", ok: false, code: "", message: "Пустой QR-код." });
    if (inlineQc) {
      state.notice = null;
      applyInlineScanStatus("qc", state.lastScan);
      const refreshedInput = document.getElementById(inputId);
      if (refreshedInput) refreshedInput.focus();
      return;
    }
    setNotice("warn", "Введите QR-код корзины для проверки QC.");
    await renderApp();
    const refreshedInput = document.getElementById(inputId);
    if (refreshedInput) refreshedInput.focus();
    return;
  }

  if (state.submittingScanStation === "qc") {
    return;
  }

  state.submittingScanStation = "qc";
  setScanUiBusy("qc", inputId, true);

  try {
    try {
      const result = await api("/api/qc/inspect", {
        method: "POST",
        body: JSON.stringify({ qrCode: code })
      });
      state.selectedOrderId = result.order.id;
      state.qcInspection = {
        code,
        order: result.order,
        basket: result.basket
      };
      setLastScan({ station: "qc", ok: true, code, message: "Корзина открыта в окне QC. Выберите решение." });
      setNotice("ok", "QC: корзина найдена, выберите решение.");
      playScanTone(true);
      input.value = "";
    } catch (error) {
      state.qcInspection = null;
      setLastScan({ station: "qc", ok: false, code, message: error.message });
      if (!inlineQc) {
        setNotice("error", error.message);
      } else {
        state.notice = null;
        applyInlineScanStatus("qc", state.lastScan);
        refocusScanInput(inputId);
        playScanTone(false);
        return;
      }
      playScanTone(false);
    }
  } finally {
    state.submittingScanStation = null;
    setScanUiBusy("qc", inputId, false);
  }

  await renderApp();
  const refreshedInput = document.getElementById(inputId);
  if (refreshedInput) {
    refreshedInput.focus();
    refreshedInput.select();
  }
}

async function runQcDecision(action, reason, renderApp) {
  const code = String(state.qcInspection?.code || "").trim();
  if (!code) {
    setNotice("warn", "Сначала отсканируйте корзину для QC.");
    await renderApp();
    return;
  }

  try {
    let result;
    if (action === "pass") {
      result = await api("/api/scan", {
        method: "POST",
        body: JSON.stringify({ station: "qc", qrCode: code })
      });
    } else {
      result = await api("/api/qc/reject", {
        method: "POST",
        body: JSON.stringify({ qrCode: code, reason })
      });
    }

    state.selectedOrderId = result.order.id;
    state.qcInspection = null;
    setLastScan({ station: "qc", ok: true, code, message: result.message });
    setNotice("ok", result.message);
    playScanTone(true);
  } catch (error) {
    setLastScan({ station: "qc", ok: false, code, message: error.message });
    setNotice("error", error.message);
    playScanTone(false);
  }

  await renderApp();
  const refreshedInput = document.getElementById("simple-scan-input")
    || document.getElementById("scan-input");
  if (refreshedInput) {
    refreshedInput.focus();
    refreshedInput.select();
  }
}

export function bindGlobalActions(renderApp, renderLogin) {
  if (!app.dataset.sortingDelegatedBound) {
    app.dataset.sortingDelegatedBound = "1";
    app.addEventListener("click", async (event) => {
      const target = event.target.closest(
        "[data-select-sorting-order], [data-sorting-close], [data-sorting-count-inc], [data-sorting-count-dec], [data-sorting-count-set], [data-sorting-choice], [data-create-baskets]"
      );
      if (!target || !app.contains(target)) return;

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

      if (target.dataset.sortingClose !== undefined) {
        state.activeSortingOrderId = null;
        if (!closeSortingModal()) {
          await renderApp();
        }
        return;
      }

      if (target.dataset.sortingCountInc) {
        const orderId = Number(target.dataset.sortingCountInc);
        if (!Number.isFinite(orderId)) return;
        const draft = ensureSortingDraft(orderId);
        setSortingRowCount(orderId, draft.rows.length + 1);
        if (!rerenderSortingModal(orderId)) {
          await renderApp();
        }
        return;
      }

      if (target.dataset.sortingCountDec) {
        const orderId = Number(target.dataset.sortingCountDec);
        if (!Number.isFinite(orderId)) return;
        const draft = ensureSortingDraft(orderId);
        setSortingRowCount(orderId, draft.rows.length - 1);
        if (!rerenderSortingModal(orderId)) {
          await renderApp();
        }
        return;
      }

      if (target.dataset.sortingCountSet) {
        const orderId = Number(target.dataset.sortingCountSet);
        const nextCount = Number(target.dataset.countValue);
        if (!Number.isFinite(orderId)) return;
        setSortingRowCount(orderId, nextCount);
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

      if (target.dataset.createBaskets) {
        const orderId = Number(target.dataset.createBaskets);
        const draft = ensureSortingDraft(orderId);
        const types = draft.rows.map((row, index) => buildBasketType(row, index));

        if (state.submittingCreateOrderId === orderId) {
          return;
        }

        state.submittingCreateOrderId = orderId;
        setCreateBasketsUiBusy(orderId, true);

        try {
          await api("/api/sorting/create-baskets", {
            method: "POST",
            body: JSON.stringify({ orderId, types })
          });
          delete state.sortingDrafts[orderId];
          state.activeSortingOrderId = null;
          state.currentStation = "sorting";
          state.screen = "station";
          state.selectedOrderId = null;
          clearLastScan();
          setNotice("ok", `Готово: создано ${types.length} ${basketWord(types.length)}. Заказ отсортирован и ожидает стирку.`);
        } catch (error) {
          setNotice("error", error.message);
        } finally {
          state.submittingCreateOrderId = null;
          setCreateBasketsUiBusy(orderId, false);
        }
        await renderApp();
        return;
      }

    });
  }

  const stationPickerButton = document.getElementById("station-picker-button");
  if (stationPickerButton) {
    stationPickerButton.addEventListener("click", async () => {
      state.screen = "station-picker";
      state.deniedStation = null;
      await renderApp();
    });
  }

  const homeStationButton = document.getElementById("home-station-button");
  if (homeStationButton) {
    homeStationButton.addEventListener("click", async () => {
      state.screen = "station";
      clearLastScan();
      await renderApp();
    });
  }

  const simpleModeToggle = document.getElementById("simple-mode-toggle");
  if (simpleModeToggle) {
    simpleModeToggle.addEventListener("click", async () => {
      setSimpleMode(!state.simpleMode);
      setNotice("ok", `Простой режим ${state.simpleMode ? "включён" : "выключен"}.`);
      await renderApp();
    });
  }

  for (const button of app.querySelectorAll("[data-open-station]")) {
    button.addEventListener("click", async () => {
      const station = button.dataset.openStation;
      try {
        await api("/api/open-station", {
          method: "POST",
          body: JSON.stringify({ station })
        });
        state.currentStation = station;
        state.screen = "station";
        state.deniedStation = null;
        state.activePickupOrderId = null;
        state.pickupVerifiedOrderId = null;
        state.pickupScanFlash = null;
        state.qcRejectReason = "stain";
        state.qcInspection = null;
        clearLastScan();
        if (station !== "overview") {
          setNotice("ok", `${stationLabels[station]} открыта.`);
        }
      } catch (error) {
        if (error.status === 403) {
          state.deniedStation = {
            station,
            label: error.payload?.label || stationLabels[station] || station
          };
          state.screen = "forbidden";
          setNotice("error", `Доступ запрещён для ${state.deniedStation.label}.`);
        } else {
          setNotice("error", error.message);
        }
      }
      await renderApp();
    });
  }

  for (const button of app.querySelectorAll("[data-open-order]")) {
    button.addEventListener("click", async () => {
      state.selectedOrderId = Number(button.dataset.openOrder);
      await renderApp();
    });
  }

  const managerFilterInput = app.querySelector("[data-manager-filter]");
  if (managerFilterInput) {
    managerFilterInput.addEventListener("input", async () => {
      const nextValue = String(managerFilterInput.value || "");
      state.managerFilter = nextValue;
      if (managerFilterTimeoutId) {
        clearTimeout(managerFilterTimeoutId);
      }
      managerFilterTimeoutId = setTimeout(async () => {
        managerFilterTimeoutId = null;
        await renderApp();
        const refreshedInput = app.querySelector("[data-manager-filter]");
        if (refreshedInput) {
          refreshedInput.focus();
          refreshedInput.setSelectionRange(nextValue.length, nextValue.length);
        }
      }, 120);
    });
  }

  for (const button of app.querySelectorAll("[data-run-scan]")) {
    button.addEventListener("click", async () => {
      const station = button.dataset.runScan;
      const inputId = button.dataset.scanInputId || (station === "pickup" ? "pickup-scan-input" : "scan-input");
      if (station === "qc") {
        await runQcInspectFromInput(inputId, renderApp);
        return;
      }
      await runScanFromInput(station, inputId, renderApp);
    });
  }

  for (const button of app.querySelectorAll("[data-qc-reason-select]")) {
    button.addEventListener("click", () => {
      const reason = String(button.dataset.qcReasonSelect || "").trim();
      if (!reason) return;

      state.qcRejectReason = reason;
      const scope = button.closest(".qc-reason-selector");
      if (scope) {
        for (const chip of scope.querySelectorAll("[data-qc-reason-select]")) {
          chip.classList.toggle("active", chip === button);
        }
      }
      const rejectButton = app.querySelector("[data-run-qc-reject]");
      if (rejectButton) {
        rejectButton.dataset.qcReason = reason;
        rejectButton.textContent = getQcRejectActionText(reason);
      }
      const modalRejectButton = app.querySelector("[data-qc-modal-reject]");
      if (modalRejectButton) {
        modalRejectButton.dataset.qcReason = reason;
        modalRejectButton.textContent = getQcRejectActionText(reason);
      }
    });
  }

  for (const button of app.querySelectorAll("[data-qc-modal-pass]")) {
    button.addEventListener("click", async () => {
      await runQcDecision("pass", null, renderApp);
    });
  }

  for (const button of app.querySelectorAll("[data-qc-modal-reject]")) {
    button.addEventListener("click", async () => {
      const reason = String(button.dataset.qcReason || state.qcRejectReason || "stain").trim() || "stain";
      await runQcDecision("reject", reason, renderApp);
    });
  }

  for (const button of app.querySelectorAll("[data-qc-modal-close]")) {
    button.addEventListener("click", async () => {
      state.qcInspection = null;
      await renderApp();
      const refreshedInput = document.getElementById("simple-scan-input")
        || document.getElementById("scan-input");
      if (refreshedInput) {
        refreshedInput.focus();
        refreshedInput.select();
      }
    });
  }

  for (const input of app.querySelectorAll("[data-scan-input-for]")) {
    input.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const station = input.dataset.scanInputFor;
      if (station === "qc") {
        await runQcInspectFromInput(input.id, renderApp);
        return;
      }
      await runScanFromInput(station, input.id, renderApp);
    });
  }

  for (const button of app.querySelectorAll("[data-complete-pickup]")) {
    button.addEventListener("click", async () => {
      const orderId = Number(button.dataset.completePickup);
      if (!Number.isFinite(orderId) || orderId <= 0) return;
      if (state.submittingCompletePickupOrderId === orderId) {
        return;
      }

      state.submittingCompletePickupOrderId = orderId;
      setCompletePickupUiBusy(orderId, true);

      try {
        await api("/api/pickup/complete", {
          method: "POST",
          body: JSON.stringify({ orderId })
        });
        state.currentStation = "pickup";
        state.screen = "station";
        state.activePickupOrderId = null;
        state.pickupVerifiedOrderId = null;
        state.pickupScanFlash = null;
        state.selectedOrderId = null;
        clearLastScan();
        setNotice("ok", "Выдача подтверждена. Финальное закрытие заказа выполняется менеджером в CleanCloud.");
      } catch (error) {
        setNotice("error", error.message);
      } finally {
        state.submittingCompletePickupOrderId = null;
        setCompletePickupUiBusy(orderId, false);
      }
      await renderApp();
    });
  }

  for (const button of app.querySelectorAll("[data-release-hold]")) {
    button.addEventListener("click", async () => {
      const orderId = Number(button.dataset.releaseHold);
      if (!Number.isFinite(orderId)) return;
      try {
        const result = await api(`/api/orders/${orderId}/release-hold`, {
          method: "POST",
          body: {}
        });
        state.selectedOrderId = result.order.id;
        setNotice("ok", "HOLD снят: заказ возвращён на стирку.");
      } catch (error) {
        setNotice("error", error.message);
      }
      await renderApp();
    });
  }

  for (const button of app.querySelectorAll("[data-demo-reset]")) {
    button.addEventListener("click", async () => {
      const confirmed = window.confirm("Сбросить демо-данные к начальному сценарию?");
      if (!confirmed) {
        return;
      }
      try {
        await api("/api/demo/reset", { method: "POST" });
        state.screen = "station-picker";
        state.currentStation = null;
        state.selectedOrderId = null;
        state.activeSortingOrderId = null;
        state.activePickupOrderId = null;
        state.pickupVerifiedOrderId = null;
        state.pickupScanFlash = null;
        state.qcRejectReason = "stain";
        state.qcInspection = null;
        state.sortingDrafts = {};
        state.deniedStation = null;
        clearLastScan();
        setNotice("ok", "Демо-данные сброшены. Сценарий восстановлен.");
      } catch (error) {
        setNotice("error", error.message);
      }
      await renderApp();
    });
  }

  for (const button of app.querySelectorAll("[data-run-sync-now]")) {
    button.addEventListener("click", async () => {
      try {
        const result = await api("/api/sync/run", { method: "POST", body: JSON.stringify({}) });
        setNotice("ok", result.message || "Очередь синхронизации запущена вручную.");
      } catch (error) {
        setNotice("error", error.message);
      }
      await renderApp();
    });
  }

  for (const button of app.querySelectorAll("[data-retry-sync-order]")) {
    button.addEventListener("click", async () => {
      const orderId = Number(button.dataset.retrySyncOrder);
      if (!Number.isFinite(orderId) || orderId <= 0) {
        setNotice("error", "Некорректный orderId для retry.");
        await renderApp();
        return;
      }

      try {
        const result = await api("/api/sync/retry-order", {
          method: "POST",
          body: JSON.stringify({ orderId })
        });
        setNotice("ok", result.message || `Retry для заказа #${orderId} выполнен.`);
      } catch (error) {
        setNotice("error", error.message);
      }
      await renderApp();
    });
  }

  for (const button of app.querySelectorAll("[data-export-scans]")) {
    button.addEventListener("click", async () => {
      const format = button.dataset.exportScans;
      try {
        await downloadScanExport(format);
        setNotice("ok", `Лог сканов экспортирован в ${format.toUpperCase()}.`);
      } catch (error) {
        setNotice("error", error.message);
      }
      await renderApp();
    });
  }

  for (const button of app.querySelectorAll("[data-export-order]")) {
    button.addEventListener("click", async () => {
      const format = button.dataset.exportOrder;
      if (!state.selectedOrderId) {
        setNotice("warn", "Сначала выберите заказ для экспорта его сканов.");
        await renderApp();
        return;
      }
      try {
        await downloadScanExport(format, state.selectedOrderId);
        setNotice("ok", `Сканы заказа ${state.selectedOrderId} экспортированы в ${format.toUpperCase()}.`);
      } catch (error) {
        setNotice("error", error.message);
      }
      await renderApp();
    });
  }

  const backToStations = document.getElementById("back-to-stations");
  if (backToStations) {
    backToStations.addEventListener("click", async () => {
      state.screen = "station-picker";
      state.deniedStation = null;
      await renderApp();
    });
  }

  const logoutFromDenied = document.getElementById("logout-from-denied");
  if (logoutFromDenied) {
    logoutFromDenied.addEventListener("click", async () => {
      try {
        await api("/api/logout", { method: "POST" });
      } catch {
        // ignore
      }
      resetSession();
      renderLogin();
    });
  }

  const logoutButton = document.getElementById("logout-button");
  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      try {
        await api("/api/logout", { method: "POST" });
      } catch {
        // ignore
      }
      resetSession();
      renderLogin();
    });
  }

  const focusTarget = document.getElementById("simple-scan-input")
    || document.getElementById("scan-input")
    || document.getElementById("pickup-scan-input");
  if (focusTarget) {
    setTimeout(() => focusTarget.focus(), 0);
  }
}
