import { stationLabels } from "../state.js";
import { escapeHtml } from "../utils.js";
import { renderOrderCard, renderOrderMeta } from "./orders.js";

const qcReasonOptions = [
  { value: "stain", label: "Пятна" },
  { value: "damage", label: "Повреждение" },
];

function normalizeQcReason(value) {
  return qcReasonOptions.some((option) => option.value === value) ? value : "stain";
}

function getQcRejectActionText(reason) {
  return normalizeQcReason(reason) === "damage" ? "В HOLD менеджеру" : "На повторную стирку";
}

function renderQcInspectionModal(inspection, selectedReason) {
  if (!inspection) return "";

  const reason = normalizeQcReason(selectedReason);
  const rejectText = getQcRejectActionText(reason);
  const phone = String(inspection.order?.customer_phone || "").trim() || "—";
  const weight = Number(inspection.order?.order_weight);
  const weightText = Number.isFinite(weight) && weight > 0 ? `${weight.toFixed(2)} кг` : "—";

  return `
    <section class="qc-modal" role="dialog" aria-modal="true">
      <div class="qc-modal-backdrop" data-qc-modal-close></div>
      <article class="qc-modal-sheet">
        <header class="qc-modal-head">
          <div>
            <div class="eyebrow">Решение QC</div>
            <h3>${escapeHtml(inspection.order?.public_id || "Заказ")} · ${escapeHtml(inspection.basket?.basket_code || "")}</h3>
            <p class="muted">${escapeHtml(inspection.order?.customer_name || "Клиент")} · ${escapeHtml(weightText)} · Тел: ${escapeHtml(phone)}</p>
          </div>
          <button type="button" class="secondary" data-qc-modal-close>Закрыть</button>
        </header>
        <div class="qc-modal-body stack">
          <div class="card">
            <div class="muted">Тип белья</div>
            <strong>${escapeHtml(inspection.basket?.basket_type || "—")}</strong>
            <div class="muted"><code>${escapeHtml(inspection.basket?.qr_code || "")}</code></div>
          </div>
          ${renderQcReasonSelector(reason)}
          <div class="action-row scan-action-dual">
            <button data-qc-modal-pass>QC ок → в сушку</button>
            <button class="warn" data-qc-modal-reject data-qc-reason="${reason}">${rejectText}</button>
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderQcReasonSelector(selectedReason) {
  const active = normalizeQcReason(selectedReason);
  return `
    <div class="qc-reason-selector">
      <span class="muted">Причина возврата</span>
      <div class="qc-reason-grid">
        ${qcReasonOptions
          .map(
            (option) => `
              <button
                type="button"
                class="ghost qc-reason-chip ${active === option.value ? "active" : ""}"
                data-qc-reason-select="${option.value}"
              >
                ${escapeHtml(option.label)}
              </button>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderScanStatus(lastScan, station) {
  if (!lastScan || lastScan.station !== station) {
    return `
      <section class="scan-status idle" data-scan-status="${station}">
        <strong>Ожидание</strong>
        <div class="muted">Сканируйте QR-код, чтобы обновить статус.</div>
      </section>
    `;
  }

  if (lastScan.ok) {
    return `
      <section class="scan-status ok" data-scan-status="${station}">
        <strong>OK</strong>
        <div>${escapeHtml(lastScan.message || "QR подтвержден.")}</div>
      </section>
    `;
  }

  return `
    <section class="scan-status error" data-scan-status="${station}">
      <strong>Ошибка</strong>
      <div>${escapeHtml(lastScan.message || "QR не подтвержден.")}</div>
    </section>
  `;
}

export function renderScanScreen(station, orders, lastScan = null, qcRejectReason = "stain", qcInspection = null) {
  const isQc = station === "qc";

  return `
    <section class="panel stack">
      <div class="two-up">
        <div class="stack">
          <div>
            <div class="eyebrow">Станция сканирования</div>
            <h2>${escapeHtml(stationLabels[station])}</h2>
            <p class="muted">
              ${
                isQc
                  ? "На QC скан открывает карточку решения. Дальше оператор явно выбирает действие."
                  : "Сканируйте QR корзины. Корректный скан переводит корзину на следующий этап. Неверный маршрут отклоняется и записывается в лог."
              }
            </p>
          </div>
          <label>
            QR-код корзины
            <input id="scan-input" data-scan-input-for="${station}" placeholder="QR:B-2402-1" />
          </label>
          <div class="action-row">
            <button data-run-scan="${station}" data-scan-input-id="scan-input">
              ${isQc ? "Открыть проверку" : "Провести скан"}
            </button>
          </div>
          ${renderScanStatus(lastScan, station)}
        </div>
        <div class="qr-preview">
          <div class="eyebrow">Примеры QR</div>
          <strong>Попробуйте эти коды</strong>
          <div><code>QR:B-2402-1</code></div>
          <div><code>QR:B-2402-2</code></div>
          ${station === "drying" ? `<div><code>QR:B-2403-1</code></div>` : ""}
          ${station === "ironing" ? `<div><code>QR:B-2403-1</code></div>` : ""}
          <p>Каждый успешный скан двигает корзину вперёд и приближает выдачу.</p>
        </div>
      </div>
      <div class="order-grid">
        ${
          orders.length
            ? orders.map(renderOrderCard).join("")
            : '<div class="card"><span class="muted">На этой станции нет заказов.</span></div>'
        }
      </div>
      ${isQc ? renderQcInspectionModal(qcInspection, qcRejectReason) : ""}
    </section>
  `;
}

export function renderSimpleScanMode(station, orders, recentScans) {
  return renderSimpleScanModeWithStatus(station, orders, recentScans, null);
}

export function renderSimpleScanModeWithStatus(station, orders, recentScans, lastScan, qcRejectReason = "stain", qcInspection = null) {
  void recentScans;
  const stationLabel = stationLabels[station] || station;
  const isQc = station === "qc";
  const reason = normalizeQcReason(qcRejectReason);

  return `
    <section class="panel simple-scan-shell">
      <div class="kiosk-layout">
        <div>
          <div class="eyebrow">Скан-пост · ${escapeHtml(stationLabel)}</div>
          <p class="muted">
            ${
              isQc
                ? "Сканируйте QR и нажмите Enter."
                : "Сканируйте QR и нажмите Enter."
            }
          </p>
        </div>
        <div class="scan-kiosk-form">
          <label>
            QR-код корзины
            <input
              class="scan-large"
              id="simple-scan-input"
              data-scan-input-for="${station}"
              placeholder="QR:B-2402-1"
              autocomplete="off"
              spellcheck="false"
            />
          </label>
          <div class="action-row">
            <button data-run-scan="${station}" data-scan-input-id="simple-scan-input">
              ${isQc ? "Открыть проверку" : "Проверить скан"}
            </button>
          </div>
          ${renderScanStatus(lastScan, station)}
          <div class="kiosk-meta">
            <span class="pill ${orders.length ? "ok" : "warn"}" data-kiosk-active-count="${station}">В работе: ${orders.length}</span>
          </div>
        </div>

        ${station === "pickup" ? `
          <div class="simple-pickup-list stack">
            <div class="eyebrow">Готовые к выдаче</div>
            ${orders.length
              ? orders.map((order) => `
                  <article class="card">
                    ${renderOrderMeta(order)}
                    <div class="action-row">
                      <button data-open-order="${order.id}">Открыть детали</button>
                      <button data-complete-pickup="${order.id}" ${order.ready_for_pickup ? "" : "disabled"}>Подтвердить выдачу</button>
                    </div>
                  </article>
                `).join("")
              : '<div class="card"><span class="muted">Нет заказов для выдачи.</span></div>'}
          </div>
        ` : ""}
      </div>
      ${isQc ? renderQcInspectionModal(qcInspection, reason) : ""}
    </section>
  `;
}
