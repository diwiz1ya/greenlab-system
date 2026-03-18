import { escapeHtml } from "../utils.js";

export function renderOverview(orders) {
  return `
    <section class="panel stack">
      <div class="header-row">
        <div>
          <div class="eyebrow">Обзор</div>
          <h2>Список заказов филиала</h2>
        </div>
      </div>
      <div class="order-grid">
        ${orders.map(renderOrderCard).join("")}
      </div>
    </section>
  `;
}

const stationStatusLabels = {
  overview: "Обзор",
  sorting: "Сортировка",
  sorted: "Отсортирован (ожидает стирку)",
  washing: "Стирка",
  qc: "QC",
  drying: "Сушка",
  ironing: "Глажка",
  pickup: "Выдача",
  hold: "HOLD (менеджер)"
};

function formatOrderWeight(weight) {
  const value = Number(weight);
  if (!Number.isFinite(value) || value <= 0) {
    return "—";
  }
  return `${value.toFixed(2)} кг`;
}

function formatOrderPhone(phone) {
  const text = String(phone || "").trim();
  return text || "—";
}

function normalizeFilter(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhoneForMatch(phone) {
  return String(phone || "").replace(/[^\d+]/g, "");
}

function orderMatchesFilter(order, query) {
  if (!query) return true;
  const compact = query.replace(/\s+/g, "");
  const publicId = String(order.public_id || "").toLowerCase();
  const customer = String(order.customer_name || "").toLowerCase();
  const phoneRaw = String(order.customer_phone || "");
  const phoneLower = phoneRaw.toLowerCase();
  const phoneCompact = normalizePhoneForMatch(phoneRaw).toLowerCase();
  return publicId.includes(query)
    || customer.includes(query)
    || phoneLower.includes(query)
    || phoneCompact.includes(compact);
}

function getOrderProgressLabel(order) {
  if (order.status === "hold") {
    return "HOLD";
  }
  const isHandoverAwaitingClose = order.status === "pickup" && !order.ready_for_pickup
    && String(order.cleancloud_status || "").toLowerCase().includes("ожидает закрытия");
  return isHandoverAwaitingClose ? "Выдано" : (order.ready_for_pickup ? "Готов" : "В работе");
}

export function renderManagerOverviewCompact(orders, limit = 12, filterQuery = "") {
  const list = Array.isArray(orders) ? orders.slice().reverse() : [];
  const query = normalizeFilter(filterQuery);
  const filteredList = query ? list.filter((order) => orderMatchesFilter(order, query)) : list;
  const isReady = (order) => Boolean(order.status === "pickup" && order.ready_for_pickup);
  const isHold = (order) => order.status === "hold";
  const isIssuedAwaitingClose = (order) => order.status === "pickup"
    && !order.ready_for_pickup
    && String(order.cleancloud_status || "").toLowerCase().includes("ожидает закрытия");
  const isInWork = (order) => !isReady(order) && !isHold(order) && !isIssuedAwaitingClose(order);

  const readyOrders = filteredList.filter(isReady).slice(0, 8);
  const holdOrders = filteredList.filter(isHold).slice(0, 8);
  const inWorkOrders = filteredList.filter(isInWork).slice(0, limit);

  function renderManagerQueueRow(order, tone = "") {
    const progressLabel = getOrderProgressLabel(order);
    return `
      <article class="manager-order-row ${tone}">
        <div class="manager-order-main">
          <strong>${escapeHtml(order.public_id)}</strong>
          <span class="muted">${escapeHtml(order.customer_name)} · ${escapeHtml(formatOrderPhone(order.customer_phone))}</span>
        </div>
        <div class="manager-order-meta">
          <span class="pill ${order.status === "hold" ? "error" : (order.ready_for_pickup ? "ok" : "warn")}">${escapeHtml(progressLabel)}</span>
        </div>
        <button class="secondary manager-order-open" data-open-order="${order.id}">Детали</button>
      </article>
    `;
  }

  return `
    <section class="panel stack manager-orders-panel manager-control-center">
      <div class="header-row">
        <div>
          <div class="eyebrow">Командный центр</div>
          <h2>Приоритет смены</h2>
        </div>
        <div class="manager-control-tools">
          <label class="manager-filter">
            <input
              type="search"
              placeholder="Поиск: ID, клиент, телефон"
              value="${escapeHtml(filterQuery)}"
              data-manager-filter
            />
          </label>
        </div>
      </div>
      <div class="manager-priority-grid">
        <section class="manager-priority-column">
          <div class="manager-priority-head">
            <strong>К выдаче</strong>
            <span class="pill ok">${readyOrders.length}</span>
          </div>
          <div class="manager-orders-list">
            ${readyOrders.length ? readyOrders.map((order) => renderManagerQueueRow(order, "priority-ready")).join("") : '<div class="card"><span class="muted">Нет заказов к выдаче.</span></div>'}
          </div>
        </section>
        <section class="manager-priority-column">
          <div class="manager-priority-head">
            <strong>HOLD</strong>
            <span class="pill error">${holdOrders.length}</span>
          </div>
          <div class="manager-orders-list">
            ${holdOrders.length ? holdOrders.map((order) => renderManagerQueueRow(order, "priority-hold")).join("") : '<div class="card"><span class="muted">HOLD-заказов нет.</span></div>'}
          </div>
        </section>
      </div>
      <div class="manager-priority-foot">
        <strong>Остальные в работе</strong>
        <span class="pill">${inWorkOrders.length}</span>
      </div>
      <div class="manager-orders-list manager-orders-list-compact">
        ${
          inWorkOrders.length
            ? inWorkOrders.map((order) => renderManagerQueueRow(order)).join("")
            : `<div class="card"><span class="muted">${query ? "По фильтру ничего не найдено." : "В работе заказов нет."}</span></div>`
        }
      </div>
    </section>
  `;
}

const sortingColorOptions = [
  { value: "mixed", label: "Смешанные" },
  { value: "white", label: "Белые" },
  { value: "color", label: "Цветные" },
  { value: "dark", label: "Темные" },
  { value: "delicate", label: "Деликатные" }
];

const colorLabels = Object.fromEntries(sortingColorOptions.map((item) => [item.value, item.label]));

function toBasketCodeSuffix(publicId) {
  const value = String(publicId || "").trim();
  return value.startsWith("GL-") ? value.slice(3) : value;
}

function makeBasketLabel(row, index) {
  const color = colorLabels[row?.color] || colorLabels.mixed;
  return `${color} #${index + 1}`;
}

function getColorToneClass(color) {
  const value = String(color || "");
  if (value === "white") return "tone-white";
  if (value === "color") return "tone-color";
  if (value === "dark") return "tone-dark";
  if (value === "delicate") return "tone-delicate";
  return "tone-mixed";
}

function renderSortingQueue(orders, activeOrderId) {
  return orders
    .map(
      (order) => `
        <button
          class="sorting-order-item ${order.id === activeOrderId ? "active" : ""}"
          data-select-sorting-order="${order.id}"
          data-order-public-id="${escapeHtml(order.public_id)}"
          data-order-customer-name="${escapeHtml(order.customer_name)}"
          data-order-weight="${order.order_weight ?? ""}"
          data-order-phone="${escapeHtml(order.customer_phone || "")}"
          type="button"
        >
          <div class="sorting-order-head">
            <strong>${escapeHtml(order.public_id)}</strong>
          </div>
          <div class="muted">${escapeHtml(order.customer_name)}</div>
          <div class="muted">Вес: ${escapeHtml(formatOrderWeight(order.order_weight))} · Тел: ${escapeHtml(formatOrderPhone(order.customer_phone))}</div>
          <div class="sorting-order-foot">
            <span class="sorting-order-chevron">Открыть</span>
          </div>
        </button>
      `
    )
    .join("");
}

function renderSortedWaitingQueue(orders) {
  return orders
    .map(
      (order) => `
        <article class="sorting-order-item" aria-disabled="true">
          <div class="sorting-order-head">
            <strong>${escapeHtml(order.public_id)}</strong>
            <span class="pill">ожидает стирку</span>
          </div>
          <div class="muted">${escapeHtml(order.customer_name)}</div>
          <div class="muted">Вес: ${escapeHtml(formatOrderWeight(order.order_weight))} · Тел: ${escapeHtml(formatOrderPhone(order.customer_phone))}</div>
          <div class="sorting-order-foot">
            <span class="muted">Ожидает скан на станции Стирка</span>
          </div>
        </article>
      `
    )
    .join("");
}

function renderSortingRows(orderId, rows) {
  return rows
    .map(
      (row, index) => `
        <div class="sorting-row compact ${getColorToneClass(row.color)}">
          <div class="sorting-row-head">
            <strong>Корзина ${index + 1}</strong>
            <div class="sorting-row-selected">
              <span>${escapeHtml(colorLabels[row.color] || colorLabels.mixed)}</span>
            </div>
          </div>
          <div class="sorting-option-group">
            <span class="sorting-group-title">Тип белья</span>
            <div class="sorting-option-chips">
              ${sortingColorOptions
                .map(
                  (option) => `
                    <button
                      type="button"
                      class="ghost sorting-chip ${row.color === option.value ? "active" : ""}"
                      data-sorting-choice="${orderId}"
                      data-row-index="${index}"
                      data-choice-field="color"
                      data-choice-value="${option.value}"
                    >
                      ${option.label}
                    </button>
                  `
                )
                .join("")}
            </div>
          </div>
        </div>
      `
    )
    .join("");
}

function renderSortingCountControl(orderId, count) {
  return `
    <section class="sorting-count">
      <span class="sorting-group-title">Количество корзин</span>
      <div class="sorting-count-main">
        <button type="button" class="secondary sorting-count-btn" data-sorting-count-dec="${orderId}">−</button>
        <strong class="sorting-count-value">${count}</strong>
        <button type="button" class="secondary sorting-count-btn" data-sorting-count-inc="${orderId}">+</button>
      </div>
      <div class="sorting-count-presets">
        <button type="button" class="ghost sorting-count-chip ${count === 1 ? "active" : ""}" data-sorting-count-set="${orderId}" data-count-value="1">1</button>
        <button type="button" class="ghost sorting-count-chip ${count === 2 ? "active" : ""}" data-sorting-count-set="${orderId}" data-count-value="2">2</button>
        <button type="button" class="ghost sorting-count-chip ${count === 3 ? "active" : ""}" data-sorting-count-set="${orderId}" data-count-value="3">3</button>
        <button type="button" class="ghost sorting-count-chip ${count === 4 ? "active" : ""}" data-sorting-count-set="${orderId}" data-count-value="4">4</button>
        <button type="button" class="ghost sorting-count-chip ${count === 5 ? "active" : ""}" data-sorting-count-set="${orderId}" data-count-value="5">5</button>
      </div>
    </section>
  `;
}

function renderSortingPreview(order, rows) {
  const suffix = toBasketCodeSuffix(order.public_id);
  return rows
    .map(
      (row, index) => `
        <div class="sorting-preview-item ${getColorToneClass(row.color)}">
          <div class="sorting-preview-text">
            <strong>${escapeHtml(`Корзина ${index + 1}`)}</strong>
            <span>${escapeHtml(makeBasketLabel(row, index))}</span>
          </div>
          <code>QR:B-${escapeHtml(suffix)}-${index + 1}</code>
        </div>
      `
    )
    .join("");
}

export function renderSortingEditorModal(order, rows) {
  return `
    <section class="sorting-modal" role="dialog" aria-modal="true">
      <div class="sorting-modal-backdrop" data-sorting-close></div>
      <article
        class="sorting-modal-sheet"
        data-sorting-order-id="${order.id}"
        data-sorting-public-id="${escapeHtml(order.public_id)}"
        data-sorting-customer-name="${escapeHtml(order.customer_name)}"
        data-sorting-order-weight="${order.order_weight ?? ""}"
        data-sorting-order-phone="${escapeHtml(order.customer_phone || "")}"
      >
        <header class="sorting-modal-head">
          <div>
            <div class="eyebrow">Разбивка заказа</div>
            <h3>${escapeHtml(order.public_id)} · ${escapeHtml(order.customer_name)}</h3>
            <p class="muted sorting-head-hint">Вес: ${escapeHtml(formatOrderWeight(order.order_weight))} · Тел: ${escapeHtml(formatOrderPhone(order.customer_phone))}</p>
            <p class="muted sorting-head-hint">Выберите количество корзин и тип белья, затем подтвердите.</p>
          </div>
          <button type="button" class="secondary sorting-close" data-sorting-close>Закрыть</button>
        </header>

        <div class="sorting-modal-content">
          <div class="sorting-editor-grid">
            <div class="sorting-editor-main">
              ${renderSortingCountControl(order.id, rows.length)}
              <div class="sorting-rows">
                ${renderSortingRows(order.id, rows)}
              </div>
            </div>
            <aside class="sorting-editor-side">
              <section class="sorting-preview">
                <div class="sorting-config-header">
                  <strong>QR</strong>
                  <span class="pill">${rows.length}</span>
                </div>
                ${renderSortingPreview(order, rows)}
              </section>
            </aside>
          </div>
        </div>

        <footer class="sorting-modal-footer">
          <div class="sorting-footer-meta">
            <span class="pill">${rows.length} корзин</span>
          </div>
          <button class="sorting-submit" data-create-baskets="${order.id}">
            Создать ${rows.length} и печать QR
          </button>
        </footer>
      </article>
    </section>
  `;
}

export function renderSorting(orders, activeOrderId, sortingDrafts = {}) {
  const queue = Array.isArray(orders) ? orders : [];
  const incoming = queue.filter((order) => order.status === "sorting");
  const waitingWash = queue.filter((order) => order.status === "sorted");

  if (!incoming.length && !waitingWash.length) {
    return `
      <section class="panel stack">
        <div class="header-row">
          <div>
            <h2>Входящие заказы</h2>
          </div>
        </div>
        <div class="card"><span class="muted">Новых заказов на сортировке сейчас нет.</span></div>
      </section>
    `;
  }

  const activeOrder = incoming.find((order) => order.id === activeOrderId) || null;
  const draft = activeOrder ? (sortingDrafts[activeOrder.id] || { rows: [{ color: "mixed" }] }) : null;
  const rows = draft && Array.isArray(draft.rows) && draft.rows.length ? draft.rows : [{ color: "mixed" }];
  const modal = activeOrder ? renderSortingEditorModal(activeOrder, rows) : "";

  return `
    <section class="panel stack">
      <div class="header-row">
        <div>
          <h2>Входящие заказы</h2>
        </div>
        <span class="pill">${incoming.length}</span>
      </div>
      <div class="sorting-orders-wall">
        ${
          incoming.length
            ? renderSortingQueue(incoming, activeOrder ? activeOrder.id : null)
            : '<div class="card"><span class="muted">Новых заказов на сортировке сейчас нет.</span></div>'
        }
      </div>
    </section>
    <section class="panel stack">
      <div class="header-row">
        <div>
          <h2>Отсортированы, ждут стирку</h2>
        </div>
        <span class="pill">${waitingWash.length}</span>
      </div>
      <div class="sorting-orders-wall">
        ${
          waitingWash.length
            ? renderSortedWaitingQueue(waitingWash)
            : '<div class="card"><span class="muted">Нет заказов в ожидании стирки.</span></div>'
        }
      </div>
    </section>
    ${modal}
  `;
}

function renderPickupQueue(orders, canOpenDetails = false) {
  return orders.map((order) => {
    const total = Number(order.total_baskets || 0);
    const scanned = Number(order.scanned_baskets || 0);
    const remaining = Math.max(0, total - scanned);
    const canConfirm = Boolean(order.can_confirm);
    const baskets = Array.isArray(order.baskets) ? order.baskets : [];

    return `
      <article class="card pickup-order-card">
        <div class="header-row pickup-order-head">
          <div>
            <strong>${escapeHtml(order.public_id)}</strong>
            <div class="muted pickup-order-customer">${escapeHtml(order.customer_name)}</div>
          </div>
          <span class="pill ${canConfirm ? "ok" : "warn"}">${scanned}/${total}</span>
        </div>
        <div class="pickup-basket-list">
          ${
            baskets.length
              ? baskets
                  .map(
                    (basket) => `
                      <span class="pickup-basket-chip ${basket.scanned ? "scanned" : ""}">
                        ${escapeHtml(basket.basket_code)}
                      </span>
                    `
                  )
                  .join("")
                : '<span class="muted">Корзины не найдены</span>'
          }
        </div>
        ${
          canConfirm
            ? `
              <div class="action-row pickup-actions">
                <button data-complete-pickup="${order.id}">Подтвердить выдачу</button>
                ${canOpenDetails ? `<button class="secondary" data-open-order="${order.id}">Открыть детали</button>` : ""}
              </div>
            `
            : `
              <div class="pickup-order-hint muted">
                До выдачи: ещё ${remaining}
              </div>
            `
        }
      </article>
    `;
  }).join("");
}

function renderPickupScanStatus(lastScan) {
  if (!lastScan) {
    return `
      <section class="scan-status idle" data-scan-status="pickup">
        <strong>Ожидание</strong>
        <div class="muted">Сканируйте QR корзины.</div>
      </section>
    `;
  }

  if (lastScan.ok) {
    return `
      <section class="scan-status ok" data-scan-status="pickup">
        <strong>OK</strong>
        <div>${escapeHtml(lastScan.message || "QR подтвержден.")}</div>
      </section>
    `;
  }

  return `
    <section class="scan-status error" data-scan-status="pickup">
      <strong>Ошибка</strong>
      <div>${escapeHtml(lastScan.message || "QR не подтвержден.")}</div>
    </section>
  `;
}

function renderPickupLastSuccess(lastSuccess) {
  if (!lastSuccess || !lastSuccess.ok) return "";
  const identity = [lastSuccess.orderPublicId, lastSuccess.basketCode].filter(Boolean).join(" · ");
  const stamp = lastSuccess.scannedAt
    ? new Date(lastSuccess.scannedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
  return `
    <section class="pickup-last-success">
      <div class="pickup-last-success-top">
        <strong class="pickup-last-success-title">Последний успешный скан</strong>
        ${lastSuccess.progressText ? `<span class="pill pickup-last-success-progress">${escapeHtml(lastSuccess.progressText)}</span>` : ""}
      </div>
      ${identity ? `<div class="pickup-last-success-main">${escapeHtml(identity)}</div>` : ""}
      <div class="pickup-last-success-note">${escapeHtml(lastSuccess.message || "")}</div>
      ${stamp ? `<div class="pickup-last-success-time muted">время: ${escapeHtml(stamp)}</div>` : ""}
    </section>
  `;
}

export function renderPickup(orders, lastScan = null, pickupLastSuccess = null, canOpenDetails = false) {
  const queue = Array.isArray(orders) ? orders : [];

  return `
    <section class="panel stack pickup-workbench">
      <div class="header-row">
        <div>
          <h2>Выдача</h2>
        </div>
        <span class="pill">${queue.length}</span>
      </div>
      <div class="pickup-layout">
        <section class="card pickup-scan-card">
          <strong>Скан-пост</strong>
          <div class="pickup-flow">
            <label class="pickup-scan-label">
              QR корзины
              <input
                id="pickup-scan-input"
                data-scan-input-for="pickup"
                placeholder="QR:B-2404-1"
              />
            </label>
            <div class="action-row pickup-scan-actions">
              <button data-run-scan="pickup" data-scan-input-id="pickup-scan-input">Проверить скан</button>
            </div>
            ${renderPickupScanStatus(lastScan)}
            ${renderPickupLastSuccess(pickupLastSuccess)}
            <p class="muted pickup-flow-note">Полный комплект корзин по заказу откроет выдачу.</p>
          </div>
        </section>
        <section class="pickup-orders-column">
          <div class="pickup-orders-header">
            <strong>Заказы к выдаче</strong>
          </div>
          <div class="pickup-orders-list">
            ${
              queue.length
                ? renderPickupQueue(queue, canOpenDetails)
                : '<div class="card"><span class="muted">Нет заказов, готовых к выдаче.</span></div>'
            }
          </div>
        </section>
      </div>
    </section>
  `;
}

export function renderOrderDetails(order) {
  if (!order) {
    return `
      <section class="panel order-details-compact">
        <div class="eyebrow">Детали заказа</div>
        <h2>Заказ не выбран</h2>
        <p class="muted">Выберите заказ в ленте, чтобы открыть детали.</p>
      </section>
    `;
  }

  const baskets = Array.isArray(order.baskets) ? order.baskets : [];
  const scans = Array.isArray(order.scans) ? order.scans : [];
  const progressLabel = getOrderProgressLabel(order);

  return `
    <section class="panel stack order-details-compact">
      <div class="order-details-head">
        <div>
          <div class="eyebrow">Детали заказа</div>
          <h2>${escapeHtml(order.public_id)} · ${escapeHtml(order.customer_name)}</h2>
        </div>
        <div class="order-details-pills">
          <span class="pill ${order.status === "hold" ? "error" : (order.ready_for_pickup ? "ok" : "warn")}">${escapeHtml(progressLabel)}</span>
          <span class="pill">${escapeHtml(stationStatusLabels[order.status] || order.status)}</span>
        </div>
      </div>
      ${
        order.status === "hold"
          ? `
            <div class="action-row">
              <button data-release-hold="${order.id}">Снять HOLD → стирка</button>
            </div>
          `
          : ""
      }
      <div class="order-details-summary">
        <span class="pill">корзин: ${baskets.length}</span>
        <span class="pill">сканов: ${scans.length}</span>
        <span class="pill">вес: ${escapeHtml(formatOrderWeight(order.order_weight))}</span>
        <span class="pill">тел: ${escapeHtml(formatOrderPhone(order.customer_phone))}</span>
        <span class="pill">${escapeHtml(order.service_tier)}</span>
      </div>
      <details class="order-details-fold">
        <summary>
          <strong>Корзины</strong>
          <span class="pill">${baskets.length}</span>
        </summary>
        <div class="order-detail-list">
          ${
            baskets.length
              ? baskets
                  .map(
                    (basket) => `
                      <article class="order-detail-row">
                        <div class="order-detail-row-top">
                          <strong>${escapeHtml(basket.basket_code)}</strong>
                          <span class="pill">${escapeHtml(stationStatusLabels[basket.station] || basket.station)}</span>
                        </div>
                        <div class="muted">${escapeHtml(basket.basket_type)}</div>
                        <code>${escapeHtml(basket.qr_code)}</code>
                      </article>
                    `
                  )
                  .join("")
              : '<article class="order-detail-row"><span class="muted">Корзины появятся после сортировки.</span></article>'
          }
        </div>
      </details>
      <details class="order-details-fold">
        <summary>
          <strong>Сканы</strong>
          <span class="pill">${scans.length}</span>
        </summary>
        <div class="order-detail-list">
          ${
            scans.length
              ? scans
                  .map(
                    (scan) => `
                      <article class="order-detail-row">
                        <div class="order-detail-row-top">
                          <strong>${escapeHtml(stationStatusLabels[scan.station] || scan.station)}</strong>
                          <span class="pill ${scan.result === "ok" ? "ok" : "error"}">${escapeHtml(scan.result)}</span>
                        </div>
                        <div class="muted">${escapeHtml(scan.actor)} · ${new Date(scan.created_at).toLocaleString()}</div>
                        <div>${escapeHtml(scan.message)}</div>
                      </article>
                    `
                  )
                  .join("")
              : '<article class="order-detail-row"><span class="muted">Событий сканирования пока нет.</span></article>'
          }
        </div>
      </details>
    </section>
  `;
}

export function renderSyncQueue(syncQueue) {
  const summary = syncQueue.summary || {};
  const failed = Number(summary.failed || 0);
  const pending = Number(summary.pending || 0);
  const processing = Number(summary.processing || 0);
  const processed = Number(summary.processed || 0);

  function shrinkPayload(payload) {
    const text = String(payload || "").trim();
    if (!text) return "—";
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  }

  function formatStamp(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString();
  }

  return `
    <section class="panel stack manager-sync-panel compact">
      <div class="header-row">
        <div>
          <div class="eyebrow">CleanCloud sync</div>
          <h2>Очередь синхронизации</h2>
        </div>
        <button class="secondary" data-run-sync-now>Запустить sync сейчас</button>
      </div>
      <div class="manager-sync-inline manager-sync-inline-panel">
        <div class="manager-sync-pills">
          <span class="pill">pending: ${pending}</span>
          <span class="pill">processing: ${processing}</span>
          <span class="pill">processed: ${processed}</span>
          <span class="pill ${failed > 0 ? "error" : "ok"}">failed: ${failed}</span>
        </div>
      </div>
      <details class="manager-sync-details" ${failed > 0 ? "open" : ""}>
        <summary>Журнал очереди (${syncQueue.items.length})</summary>
        <div class="manager-sync-list">
          ${
            syncQueue.items.length
              ? syncQueue.items
                  .map(
                    (item) => `
                      <article class="manager-sync-item">
                        <div class="manager-sync-item-top">
                          <strong>${escapeHtml(item.action)}</strong>
                          <span class="pill ${item.status === "failed" ? "error" : item.status === "processed" ? "ok" : ""}">
                            ${escapeHtml(item.status)}
                          </span>
                        </div>
                        <div class="muted">order: ${item.order_id || "—"} · attempts: ${item.attempts || 0}</div>
                        <div class="muted">created: ${escapeHtml(formatStamp(item.created_at))} · processed: ${escapeHtml(formatStamp(item.processed_at))}</div>
                        ${item.last_error ? `<div class="muted">error: ${escapeHtml(item.last_error)}</div>` : ""}
                        <code>${escapeHtml(shrinkPayload(item.payload))}</code>
                        ${
                          item.status === "failed" && item.order_id
                            ? `<div class="action-row"><button class="secondary" data-retry-sync-order="${Number(item.order_id)}">Retry order #${Number(item.order_id)}</button></div>`
                            : ""
                        }
                      </article>
                    `
                  )
                  .join("")
              : '<div class="manager-sync-item"><span class="muted">Очередь пуста.</span></div>'
          }
        </div>
      </details>
    </section>
  `;
}

export function renderOrderCard(order) {
  return `
    <article class="card">
      ${renderOrderMeta(order)}
      <div class="action-row">
        <button data-open-order="${order.id}">Открыть детали</button>
      </div>
    </article>
  `;
}

export function renderOrderMeta(order) {
  const progressLabel = getOrderProgressLabel(order);

  return `
    <div class="header-row">
      <div>
        <strong>${escapeHtml(order.public_id)}</strong>
        <div class="muted">${escapeHtml(order.customer_name)}</div>
      </div>
      <div class="meta">
        <span class="pill ${order.ready_for_pickup ? "ok" : "warn"}">${progressLabel}</span>
      </div>
    </div>
    <div class="muted">${escapeHtml(order.service_tier)} · Вес: ${escapeHtml(formatOrderWeight(order.order_weight))} · Тел: ${escapeHtml(formatOrderPhone(order.customer_phone))} · CleanCloud: ${escapeHtml(order.cleancloud_status)}</div>
    <div class="muted">Текущая станция: ${escapeHtml(stationStatusLabels[order.status] || order.status)}</div>
  `;
}

