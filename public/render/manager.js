import { escapeHtml } from "../utils.js";
import { formatOrderPhone, formatOrderWeight, getOrderProgressLabel, stationStatusLabels } from "./order-shared.js";

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

function pluralizeRu(count, one, few, many) {
  const normalized = Math.abs(Number(count) || 0) % 100;
  const lastDigit = normalized % 10;
  if (normalized > 10 && normalized < 20) return many;
  if (lastDigit === 1) return one;
  if (lastDigit >= 2 && lastDigit <= 4) return few;
  return many;
}

function formatBasketCountLabel(count) {
  return `${count} ${count === 1 ? "basket" : "baskets"}`;
}

function formatReworkCountLabel(count) {
  return `${count} ${count === 1 ? "rework case" : "rework cases"}`;
}

function formatCompactUpdatedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatQrFull(value) {
  const qr = String(value || "").trim();
  return qr || "—";
}

function getOrderBasketCount(order) {
  const parsed = Number(order?.basket_count ?? order?.baskets?.length ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.trunc(parsed);
}

function getOrderReworkBasketCount(order) {
  const parsed = Number(order?.rework_basket_count || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.trunc(parsed);
}

function getPendingApprovalCount(order) {
  const parsed = Number(order?.pending_customer_approval_count || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.trunc(parsed);
}

const managerSlaMinutes = {
  approval: 20,
  transfer: 15,
  stalled: 90
};

function parseTimestampMs(value) {
  const stamp = String(value || "").trim();
  if (!stamp) return null;
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime();
}

function getAgeMinutes(value, nowMs = Date.now()) {
  const stampMs = parseTimestampMs(value);
  if (!Number.isFinite(stampMs)) return null;
  const deltaMs = Math.max(0, nowMs - stampMs);
  return Math.floor(deltaMs / 60000);
}

function formatDurationCompact(totalMinutes) {
  const minutes = Number(totalMinutes);
  if (!Number.isFinite(minutes) || minutes < 0) return "—";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

function formatPercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "0%";
  return `${Math.round(parsed)}%`;
}

function managerToneClass(tone) {
  if (tone === "critical") return "tone-critical";
  if (tone === "warn") return "tone-warn";
  if (tone === "ok") return "tone-ok";
  return "tone-neutral";
}

function getOrdersBasketTotal(orders) {
  return (Array.isArray(orders) ? orders : []).reduce((total, order) => total + getOrderBasketCount(order), 0);
}

function getOrdersReworkBasketTotal(orders) {
  return (Array.isArray(orders) ? orders : []).reduce((total, order) => total + getOrderReworkBasketCount(order), 0);
}

function renderManagerGlyph(kind, options = {}) {
  const decorative = options.decorative ? " manager-glyph-decorative" : "";
  const icons = {
    alert: `
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10 3.25 17 15.5H3L10 3.25Z"></path>
        <path d="M10 7.25V10.75"></path>
        <circle cx="10" cy="13.45" r="0.75" fill="currentColor" stroke="none"></circle>
      </svg>
    `,
    handoff: `
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3.5 11.5h4l1.5 1.5h2.5l1.5-1.5h3"></path>
        <path d="M6 8.5V6.75A1.75 1.75 0 0 1 7.75 5h4.5A1.75 1.75 0 0 1 14 6.75V8.5"></path>
        <path d="M4.5 9.5h11a1 1 0 0 1 1 1v3A2.5 2.5 0 0 1 14 16H6a2.5 2.5 0 0 1-2.5-2.5v-3a1 1 0 0 1 1-1Z"></path>
      </svg>
    `,
    qc: `
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="8.5" cy="8.5" r="4.25"></circle>
        <path d="M11.75 11.75 16 16"></path>
        <path d="m7.25 8.6 1 1 2.25-2.3"></path>
      </svg>
    `,
    cloud: `
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6.25 15.25h7a3.25 3.25 0 0 0 .3-6.49A4.5 4.5 0 0 0 5.1 8.5a2.9 2.9 0 0 0 1.15 6.75Z"></path>
      </svg>
    `,
    basket: `
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m6.25 8.5 3.75-4 3.75 4"></path>
        <path d="M4.5 8.5h11l-1 6.5H5.5l-1-6.5Z"></path>
        <path d="M7.5 8.5v6.5"></path>
        <path d="M10 8.5v6.5"></path>
        <path d="M12.5 8.5v6.5"></path>
      </svg>
    `,
    rework: `
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6.25 6.25h6.5a3 3 0 0 1 0 6H8.5"></path>
        <path d="m10.75 4.25 2 2-2 2"></path>
        <path d="M13.75 13.75h-6.5a3 3 0 0 1 0-6H11.5"></path>
        <path d="m9.25 15.75-2-2 2-2"></path>
      </svg>
    `,
    clock: `
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="10" cy="10" r="6"></circle>
        <path d="M10 6.75v3.5l2.25 1.5"></path>
      </svg>
    `,
    flow: `
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 6h8"></path>
        <path d="m10 3 3 3-3 3"></path>
        <path d="M16 14H8"></path>
        <path d="m10 11-3 3 3 3"></path>
      </svg>
    `,
    sorting: `
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4.5 5.5h6"></path>
        <path d="M4.5 10h11"></path>
        <path d="M4.5 14.5h8"></path>
        <circle cx="13.75" cy="5.5" r="1.25"></circle>
        <circle cx="6.25" cy="14.5" r="1.25"></circle>
      </svg>
    `,
    search: `
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="8.5" cy="8.5" r="4.5"></circle>
        <path d="M12 12 16 16"></path>
      </svg>
    `,
    report: `
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M5 3.75h7l3 3V16a1.25 1.25 0 0 1-1.25 1.25h-8.5A1.25 1.25 0 0 1 4 16V5A1.25 1.25 0 0 1 5.25 3.75Z"></path>
        <path d="M12 3.75V7h3"></path>
        <path d="M7.25 10.25h5.5"></path>
        <path d="M7.25 13h5.5"></path>
      </svg>
    `
  };

  return `<span class="manager-glyph${decorative}" aria-hidden="true">${icons[kind] || icons.flow}</span>`;
}

function renderManagerUtilityChip(icon, label, tone = "") {
  return `
    <span class="manager-utility-chip ${tone}">
      ${renderManagerGlyph(icon)}
      <span>${escapeHtml(label)}</span>
    </span>
  `;
}

function renderManagerEmptyCard(message, hint = "Data updates automatically. Check filters or wait for new events.") {
  return `
    <article class="manager-empty-card" role="status" aria-live="polite">
      <strong class="manager-empty-title">Empty</strong>
      <span class="muted">${escapeHtml(message)}</span>
      <span class="manager-empty-hint">${escapeHtml(hint)}</span>
    </article>
  `;
}

function isReadyOrder(order) {
  return Boolean(order.status === "pickup" && order.ready_for_pickup);
}

function isHoldOrder(order) {
  return order.status === "hold";
}

function isApprovalOrder(order) {
  return order.status === "customer_approval" || getPendingApprovalCount(order) > 0;
}

function isIssuedOrder(order) {
  const cleanCloudStatus = String(order.cleancloud_status || "").toLowerCase();
  return order.status === "overview"
    || (
      order.status === "pickup"
      && !order.ready_for_pickup
      && (
        cleanCloudStatus.includes("issued")
        || cleanCloudStatus.includes("completed")
        || cleanCloudStatus.includes("awaiting close")
        || cleanCloudStatus.includes("выдан")
        || cleanCloudStatus.includes("заверш")
        || cleanCloudStatus.includes("ожидает закрытия")
      )
    );
}

function isNewOrder(order) {
  return order.status === "sorting" || order.status === "sorted";
}

function isProductionOrder(order) {
  return !isReadyOrder(order)
    && !isHoldOrder(order)
    && !isApprovalOrder(order)
    && !isIssuedOrder(order)
    && !isNewOrder(order);
}

function getManagerCaseTone(order) {
  if (isHoldOrder(order)) return "tone-hold";
  if (isApprovalOrder(order)) return "tone-approval";
  if (isIssuedOrder(order)) return "tone-close";
  if (isReadyOrder(order)) return "tone-ready";
  if (order.status === "qc" || order.status === "rework") return "tone-qc";
  if (isNewOrder(order)) return "tone-new";
  return "tone-work";
}

function getManagerCaseCopy(order) {
  const stationLabel = stationStatusLabels[order.status] || order.status;

  if (isHoldOrder(order)) {
    return {
      eyebrow: "Решение менеджера",
      note: "Снимите HOLD только после принятого решения.",
      footer: "Пауза после QC"
    };
  }

  if (isApprovalOrder(order)) {
    return {
      eyebrow: "Согласование клиента",
      note: "Нужно решение по доп. обработке, иначе поток блокируется.",
      footer: "Ожидает решения по доп. обработке"
    };
  }

  if (isIssuedOrder(order)) {
    return {
      eyebrow: "Выдано",
      note: "Выдача подтверждена, корзины и места хранения освобождены.",
      footer: "Завершено"
    };
  }

  if (isReadyOrder(order)) {
    return {
      eyebrow: "К выдаче",
      note: "Проверьте комплект и завершите handoff.",
      footer: "Полный комплект подтвержден"
    };
  }

  if (isNewOrder(order)) {
    return {
      eyebrow: "Новый заказ",
      note: "Нужно запустить сортировку и создать корзины.",
      footer: stationLabel
    };
  }

  if (order.status === "qc") {
    return {
      eyebrow: "Контроль качества",
      note: "Проверьте кейс и примите решение без задержки.",
      footer: "Проверка после сушки"
    };
  }

  if (order.status === "rework") {
    return {
      eyebrow: "Доработка",
      note: "Нужен быстрый возврат вещи в QC после rework.",
      footer: "Приоритетный повторный цикл"
    };
  }

  return {
    eyebrow: "В работе",
    note: "Следите за SLA на текущей станции.",
    footer: stationLabel
  };
}

function getOrderRiskSnapshot(order, nowMs = Date.now()) {
  const approvalAgeMinutes = getAgeMinutes(order.pending_approval_since, nowMs);
  if (Number.isFinite(approvalAgeMinutes)) {
    const overdue = approvalAgeMinutes > managerSlaMinutes.approval;
    return {
      tone: overdue ? "critical" : "warn",
      icon: "alert",
      label: overdue ? "Просрочено согласование" : "Согласование в работе",
      value: formatDurationCompact(approvalAgeMinutes)
    };
  }

  const transferAgeMinutes = getAgeMinutes(order.pending_qc_task_since, nowMs);
  if (Number.isFinite(transferAgeMinutes)) {
    const isReturn = String(order.pending_qc_task_kind || "") === "declined_waiting_return";
    const overdue = transferAgeMinutes > managerSlaMinutes.transfer;
    return {
      tone: overdue ? "critical" : "warn",
      icon: isReturn ? "flow" : "handoff",
      label: overdue
        ? (isReturn ? "Просрочен возврат в поток" : "Просрочен перенос в RW")
        : (isReturn ? "Ожидает возврат в поток" : "Ожидает перенос в RW"),
      value: formatDurationCompact(transferAgeMinutes)
    };
  }

  if (isProductionOrder(order)) {
    const idleMinutes = getAgeMinutes(order.updated_at, nowMs);
    if (Number.isFinite(idleMinutes) && idleMinutes > managerSlaMinutes.stalled) {
      return {
        tone: "warn",
        icon: "clock",
        label: "Риск зависания в потоке",
        value: formatDurationCompact(idleMinutes)
      };
    }
  }

  return {
    tone: "ok",
    icon: "clock",
    label: "SLA в норме",
    value: "OK"
  };
}

function renderCaseMeta(order) {
  const phone = formatOrderPhone(order.customer_phone);
  const weight = formatOrderWeight(order.order_weight);
  const chunks = [];
  if (phone && phone !== "—") chunks.push(`Тел ${phone}`);
  if (weight && weight !== "—") chunks.push(weight);

  return chunks.map((chunk) => `<span>${escapeHtml(chunk)}</span>`).join("");
}

function renderManagerCaseOps(order, risk, options = {}) {
  const compact = Boolean(options.compact);
  const chips = [];
  const basketCount = getOrderBasketCount(order);
  const reworkCount = getOrderReworkBasketCount(order);
  const pendingApprovals = getPendingApprovalCount(order);

  chips.push(renderManagerUtilityChip("basket", basketCount > 0 ? formatBasketCountLabel(basketCount) : "Корзины не заданы"));

  if (compact) {
    if (pendingApprovals > 0) {
      chips.push(renderManagerUtilityChip("alert", `Соглас. ${pendingApprovals}`, "warn"));
    } else if (reworkCount > 0) {
      chips.push(renderManagerUtilityChip("rework", formatReworkCountLabel(reworkCount), "warn"));
    } else if (risk?.label && risk.tone !== "ok") {
      chips.push(renderManagerUtilityChip(risk.icon || "clock", `${risk.label}: ${risk.value}`, risk.tone === "critical" ? "critical" : "warn"));
    } else {
      const updatedAt = formatCompactUpdatedAt(order.updated_at);
      if (updatedAt) {
        chips.push(renderManagerUtilityChip("clock", `Обновлено ${updatedAt}`));
      }
    }
    return `<div class="manager-case-ops">${chips.join("")}</div>`;
  }

  if (reworkCount > 0) {
    chips.push(renderManagerUtilityChip("rework", formatReworkCountLabel(reworkCount), "warn"));
  }
  if (pendingApprovals > 0) {
    chips.push(renderManagerUtilityChip("alert", `Pending approval ${pendingApprovals}`, "warn"));
  }
  if (risk?.label) {
    chips.push(renderManagerUtilityChip(risk.icon || "clock", `${risk.label}: ${risk.value}`, risk.tone === "critical" ? "critical" : (risk.tone === "warn" ? "warn" : "")));
  } else {
    const updatedAt = formatCompactUpdatedAt(order.updated_at);
    if (updatedAt) {
      chips.push(renderManagerUtilityChip("clock", `Updated ${updatedAt}`));
    }
  }

  return `<div class="manager-case-ops">${chips.join("")}</div>`;
}

function getManagerCaseOpenLabel(order, options = {}) {
  if (options.compact) return "Open";
  if (isApprovalOrder(order)) return "Approval";
  if (isReadyOrder(order)) return "Open handoff";
  if (order.status === "qc") return "Open QC";
  if (order.status === "rework") return "Open rework";
  if (isNewOrder(order)) return "Open sorting";
  return "Open case";
}

function getOpenOrderActionAttributes(order) {
  const hasPendingApproval = getPendingApprovalCount(order) > 0;
  return `data-open-order="${order.id}"${hasPendingApproval ? ' data-open-order-focus="approval"' : ""}`;
}

function renderManagerCaseActions(order, options = {}) {
  const compact = Boolean(options.compact);
  const buttons = [];

  if (isHoldOrder(order)) {
    buttons.push(`
      <button class="manager-case-action" data-release-hold="${order.id}" data-order-public-id="${escapeHtml(order.public_id)}">
        Release HOLD
      </button>
    `);
  } else if (isReadyOrder(order)) {
    buttons.push(`
      <button class="manager-case-action" data-complete-pickup-order="${order.id}" data-order-public-id="${escapeHtml(order.public_id)}">
        Confirm handoff
      </button>
    `);
  }

  const highlightOpen = !buttons.length && (isApprovalOrder(order) || isReadyOrder(order));
  buttons.push(`
    <button class="${highlightOpen ? "manager-case-action" : "secondary manager-case-action"}" ${getOpenOrderActionAttributes(order)}>
      ${escapeHtml(getManagerCaseOpenLabel(order, { compact }))}
    </button>
  `);

  return `<div class="manager-case-actions">${buttons.join("")}</div>`;
}

function renderManagerCaseCard(order, options = {}) {
  const compact = Boolean(options.compact);
  const progressLabel = getOrderProgressLabel(order);
  const caseCopy = getManagerCaseCopy(order);
  const toneClass = getManagerCaseTone(order);
  const risk = getOrderRiskSnapshot(order);
  const pillTone = getManagerProgressPillTone(order);

  return `
    <article class="manager-case-card ${toneClass} ${compact ? "is-compact" : ""}">
      <div class="manager-case-top">
        <div class="manager-case-main">
          ${compact ? "" : `<span class="manager-case-eyebrow">${escapeHtml(caseCopy.eyebrow)}</span>`}
          <strong class="manager-case-code">${escapeHtml(order.public_id)}</strong>
          <span class="manager-case-customer">${escapeHtml(order.customer_name)}</span>
        </div>
        <span class="pill ${pillTone}">${escapeHtml(progressLabel)}</span>
      </div>
      ${compact ? "" : `<div class="manager-case-meta">${renderCaseMeta(order)}</div>`}
      ${renderManagerCaseOps(order, risk, { compact })}
      ${compact ? "" : `<p class="manager-case-note">${escapeHtml(caseCopy.note)}</p>`}
      <div class="manager-case-footer">
        ${compact ? "" : `<span class="manager-case-station">${escapeHtml(caseCopy.footer)}</span>`}
        ${renderManagerCaseActions(order, { compact })}
      </div>
    </article>
  `;
}

function getManagerProgressPillTone(order) {
  if (isHoldOrder(order)) return "error";
  if (isReadyOrder(order)) return "ok";
  if (isApprovalOrder(order)) return "warn";
  return "";
}

function getRiskToneClass(tone) {
  if (tone === "critical") return "critical";
  if (tone === "warn") return "warn";
  return "ok";
}

function renderManagerMiniCaseRow(order) {
  const risk = getOrderRiskSnapshot(order);
  const progressLabel = getOrderProgressLabel(order);
  const riskToneClass = getRiskToneClass(risk.tone);
  const pillTone = getManagerProgressPillTone(order);

  return `
    <button type="button" class="manager-mini-case ${riskToneClass}" ${getOpenOrderActionAttributes(order)}>
      <div class="manager-mini-case-main">
        <strong>${escapeHtml(order.public_id)}</strong>
        <span>${escapeHtml(order.customer_name)}</span>
      </div>
      <div class="manager-mini-case-side">
        <span class="pill ${pillTone}">${escapeHtml(progressLabel)}</span>
        <span class="manager-mini-risk ${riskToneClass}">
          ${renderManagerGlyph(risk.icon || "clock")}
          <span>${escapeHtml(risk.value)}</span>
        </span>
      </div>
    </button>
  `;
}

function renderManagerMiniLane(kind, title, caption, orders, emptyText, options = {}) {
  const list = Array.isArray(orders) ? orders : [];
  const preview = list.slice(0, options.previewLimit || 3);
  const basketTotal = getOrdersBasketTotal(list);
  const reworkTotal = getOrdersReworkBasketTotal(list);
  const pendingApprovals = list.reduce((total, order) => total + getPendingApprovalCount(order), 0);

  return `
    <article class="manager-mini-lane ${list.length ? "" : "is-empty"}">
      <header class="manager-mini-lane-head">
        <div class="manager-mini-lane-title">
          ${renderManagerGlyph(options.icon || "flow", { decorative: true })}
          <div>
            <span class="manager-column-eyebrow">${escapeHtml(caption)}</span>
            <h3>${escapeHtml(title)}</h3>
          </div>
        </div>
        <button type="button" class="ghost manager-mini-open" data-open-manager-quick-view="${escapeHtml(kind)}">
          ${list.length}
        </button>
      </header>
      <div class="manager-mini-lane-meta">
        ${renderManagerUtilityChip("basket", formatBasketCountLabel(basketTotal))}
        ${reworkTotal > 0 ? renderManagerUtilityChip("rework", formatReworkCountLabel(reworkTotal), "warn") : ""}
        ${pendingApprovals > 0 ? renderManagerUtilityChip("alert", `Approval ${pendingApprovals}`, "warn") : ""}
      </div>
      <div class="manager-mini-list">
        ${
          preview.length
            ? preview.map(renderManagerMiniCaseRow).join("")
            : renderManagerEmptyCard(emptyText, "New orders will appear here automatically.")
        }
      </div>
      ${
        list.length > preview.length
          ? `<button type="button" class="secondary manager-mini-more" data-open-manager-quick-view="${escapeHtml(kind)}">More ${list.length - preview.length}</button>`
          : ""
      }
    </article>
  `;
}

function renderManagerIntegrationLane(syncSummary = {}, syncHeadline = { tone: "ok", title: "", note: "" }) {
  const failed = Number(syncSummary.failed || 0);
  const pending = Number(syncSummary.pending || 0);
  const processing = Number(syncSummary.processing || 0);
  const queueLoad = pending + processing;
  const tone = syncHeadline.tone || "ok";

  return `
    <article class="manager-mini-lane manager-mini-lane-sync ${tone}">
      <header class="manager-mini-lane-head">
        <div class="manager-mini-lane-title">
          ${renderManagerGlyph("cloud", { decorative: true })}
          <div>
            <span class="manager-column-eyebrow">Интеграция</span>
            <h3>CleanCloud</h3>
          </div>
        </div>
        <button type="button" class="ghost manager-mini-open" data-open-sync-modal>Журнал</button>
      </header>
      <p class="manager-mini-sync-note">${escapeHtml(syncHeadline.title || "Интеграция под контролем")}</p>
      <div class="manager-mini-lane-meta">
        ${renderManagerUtilityChip("cloud", `Очередь ${queueLoad}`)}
        ${renderManagerUtilityChip("alert", `Ошибки ${failed}`, failed > 0 ? "critical" : "")}
      </div>
      <div class="manager-mini-sync-actions">
        <button type="button" class="secondary" data-open-sync-modal>Открыть инциденты</button>
      </div>
    </article>
  `;
}

function renderManagerKpiStrip(managerKpi = {}) {
  const approvalAvg = Number(managerKpi.approval_minutes_avg);
  const declineRate = Number(managerKpi.decline_rate_percent || 0);
  const repeatRate = Number(managerKpi.repeated_rework_rate_percent || 0);
  const pickupAvg = Number(managerKpi.pickup_cycle_minutes_avg);
  const decisionsTotal = Number(managerKpi.decisions_total || 0);
  const reworkTotal = Number(managerKpi.total_rework_baskets || 0);
  const handoffCount = Number(managerKpi.handoff_count || 0);

  const cards = [
    {
      label: "SLA согласования",
      value: Number.isFinite(approvalAvg) ? formatDurationCompact(Math.round(approvalAvg)) : "—",
      note: decisionsTotal > 0 ? `Решений: ${decisionsTotal}` : "Пока нет решений",
      tone: Number.isFinite(approvalAvg) && approvalAvg > managerSlaMinutes.approval ? "warn" : ""
    },
    {
      label: "% отказов",
      value: formatPercent(declineRate),
      note: decisionsTotal > 0 ? `Из ${decisionsTotal} решений` : "Пока без статистики",
      tone: decisionsTotal >= 3 && declineRate >= 35 ? "critical" : ""
    },
    {
      label: "% повторных доработок",
      value: formatPercent(repeatRate),
      note: reworkTotal > 0 ? `RW корзин: ${reworkTotal}` : "RW кейсов пока нет",
      tone: reworkTotal >= 3 && repeatRate >= 30 ? "warn" : ""
    },
    {
      label: "Время до выдачи",
      value: Number.isFinite(pickupAvg) ? formatDurationCompact(Math.round(pickupAvg)) : "—",
      note: handoffCount > 0 ? `Выдач: ${handoffCount}` : "Нет завершенных выдач",
      tone: Number.isFinite(pickupAvg) && pickupAvg > 24 * 60 ? "warn" : ""
    }
  ];

  return `
    <section class="manager-kpi-strip">
      ${cards.map((card) => `
        <article class="manager-kpi-card ${card.tone || ""}">
          <span class="manager-kpi-label">${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(card.value)}</strong>
          <span class="manager-kpi-note">${escapeHtml(card.note)}</span>
        </article>
      `).join("")}
    </section>
  `;
}

function buildManagerAlerts(data, managerKpi = {}, nowMs = Date.now()) {
  const approvalOverdue = data.filteredList.filter((order) => {
    const age = getAgeMinutes(order.pending_approval_since, nowMs);
    return Number.isFinite(age) && age > managerSlaMinutes.approval;
  });
  const transferOverdue = data.filteredList.filter((order) => {
    const age = getAgeMinutes(order.pending_qc_task_since, nowMs);
    return Number.isFinite(age) && age > managerSlaMinutes.transfer;
  });
  const staleProduction = data.productionOrders.filter((order) => {
    const age = getAgeMinutes(order.updated_at, nowMs);
    return Number.isFinite(age) && age > managerSlaMinutes.stalled;
  });
  const declineRate = Number(managerKpi.decline_rate_percent || 0);
  const decisionsTotal = Number(managerKpi.decisions_total || 0);
  const repeatRate = Number(managerKpi.repeated_rework_rate_percent || 0);
  const reworkTotal = Number(managerKpi.total_rework_baskets || 0);

  const alerts = [];
  if (approvalOverdue.length) {
    alerts.push({
      tone: "critical",
      icon: "alert",
      title: `Просрочено согласование: ${approvalOverdue.length}`,
      note: `SLA ${managerSlaMinutes.approval}м превышен.`,
      action: "urgent"
    });
  }
  if (transferOverdue.length) {
    alerts.push({
      tone: "warn",
      icon: "handoff",
      title: `Зависли задачи QC handoff: ${transferOverdue.length}`,
      note: `SLA ${managerSlaMinutes.transfer}м превышен.`,
      action: "urgent"
    });
  }
  if (staleProduction.length) {
    alerts.push({
      tone: "warn",
      icon: "clock",
      title: `Риск зависания в потоке: ${staleProduction.length}`,
      note: `Без движения больше ${Math.round(managerSlaMinutes.stalled / 60)}ч.`,
      action: "production"
    });
  }
  if (decisionsTotal >= 3 && declineRate >= 35) {
    alerts.push({
      tone: "critical",
      icon: "alert",
      title: `Высокий % отказов: ${formatPercent(declineRate)}`,
      note: "Проверьте качество согласований и формулировки причины.",
      action: "qc"
    });
  }
  if (reworkTotal >= 3 && repeatRate >= 30) {
    alerts.push({
      tone: "warn",
      icon: "rework",
      title: `Много повторных доработок: ${formatPercent(repeatRate)}`,
      note: "Проверьте качество первичной обработки на QC/rework.",
      action: "qc"
    });
  }

  return alerts.slice(0, 4);
}

function renderManagerAlerts(alerts) {
  const rows = Array.isArray(alerts) ? alerts : [];
  if (!rows.length) {
    return `
      <section class="manager-alert-strip-lite">
        <article class="manager-alert-card tone-ok">
          ${renderManagerGlyph("clock", { decorative: true })}
          <div>
            <strong>Критических просрочек нет</strong>
            <p>Фокус смены можно держать на обычном потоке.</p>
          </div>
        </article>
      </section>
    `;
  }

  return `
    <section class="manager-alert-strip-lite">
      ${rows.map((alert) => `
        <button
          type="button"
          class="manager-alert-card ${managerToneClass(alert.tone)}"
          ${alert.action ? `data-open-manager-quick-view="${escapeHtml(alert.action)}"` : ""}
        >
          ${renderManagerGlyph(alert.icon || "alert", { decorative: true })}
          <div>
            <strong>${escapeHtml(alert.title)}</strong>
            <p>${escapeHtml(alert.note)}</p>
          </div>
        </button>
      `).join("")}
    </section>
  `;
}

function formatSyncHeadline(syncSummary) {
  const failed = Number(syncSummary.failed || 0);
  const pending = Number(syncSummary.pending || 0);
  const processing = Number(syncSummary.processing || 0);
  if (failed > 0) {
    return { tone: "critical", title: "CleanCloud требует вмешательства", note: `Ошибок: ${failed}` };
  }
  if (pending + processing > 0) {
    return { tone: "warn", title: "Интеграция работает с очередью", note: `В очереди: ${pending + processing}` };
  }
  return { tone: "ok", title: "Интеграция под контролем", note: "Ошибок нет" };
}

function buildManagerOverviewData(orders, syncSummary = {}, filterQuery = "") {
  const list = Array.isArray(orders) ? orders.slice().reverse() : [];
  const query = normalizeFilter(filterQuery);
  const filteredList = query ? list.filter((order) => orderMatchesFilter(order, query)) : list;
  const nowMs = Date.now();
  const approvalOrders = filteredList.filter(isApprovalOrder);
  const holdOrders = filteredList.filter(isHoldOrder);
  const closingOrders = filteredList.filter(isIssuedOrder);
  const readyOrders = filteredList.filter(isReadyOrder);
  const productionOrders = filteredList.filter(isProductionOrder);
  const staleProductionOrders = productionOrders.filter((order) => {
    const age = getAgeMinutes(order.updated_at, nowMs);
    return Number.isFinite(age) && age > managerSlaMinutes.stalled;
  });
  const newOrders = filteredList.filter(isNewOrder);
  const qcOrders = filteredList.filter((order) => order.status === "qc" || order.status === "rework");

  return {
    query,
    filteredList,
    approvalOrders,
    holdOrders,
    closingOrders,
    readyOrders,
    productionOrders,
    staleProductionOrders,
    newOrders,
    qcOrders,
    urgentOrders: [...approvalOrders, ...holdOrders],
    syncHeadline: formatSyncHeadline(syncSummary)
  };
}

function dedupeOrdersById(orders) {
  const map = new Map();
  for (const order of Array.isArray(orders) ? orders : []) {
    const key = Number(order?.id);
    if (!Number.isFinite(key)) continue;
    if (!map.has(key)) {
      map.set(key, order);
    }
  }
  return Array.from(map.values());
}

function getRiskMinutes(order, nowMs = Date.now()) {
  const approvalAge = getAgeMinutes(order.pending_approval_since, nowMs);
  if (Number.isFinite(approvalAge)) return approvalAge;
  const transferAge = getAgeMinutes(order.pending_qc_task_since, nowMs);
  if (Number.isFinite(transferAge)) return transferAge;
  const idleAge = getAgeMinutes(order.updated_at, nowMs);
  if (Number.isFinite(idleAge)) return idleAge;
  return 0;
}

function getOrderPainScore(order, nowMs = Date.now()) {
  const risk = getOrderRiskSnapshot(order, nowMs);
  const urgency = risk.tone === "critical" ? 320 : (risk.tone === "warn" ? 170 : 30);
  const holdBoost = isHoldOrder(order) ? 120 : 0;
  const approvalBoost = isApprovalOrder(order) ? 90 : 0;
  const reworkBoost = order.status === "rework" ? 70 : 0;
  const ageBoost = Math.min(220, Math.floor(getRiskMinutes(order, nowMs) / 3));
  return urgency + holdBoost + approvalBoost + reworkBoost + ageBoost;
}

function sortOrdersByPain(orders, nowMs = Date.now()) {
  return (Array.isArray(orders) ? orders.slice() : [])
    .sort((a, b) => {
      const scoreDiff = getOrderPainScore(b, nowMs) - getOrderPainScore(a, nowMs);
      if (scoreDiff !== 0) return scoreDiff;
      const riskDiff = getRiskMinutes(b, nowMs) - getRiskMinutes(a, nowMs);
      if (riskDiff !== 0) return riskDiff;
      return String(a.public_id || "").localeCompare(String(b.public_id || ""), "ru");
    });
}

function buildExceptionMetrics(data, syncSummary = {}, nowMs = Date.now()) {
  const approvalOverdueCount = data.filteredList.reduce((total, order) => {
    const age = getAgeMinutes(order.pending_approval_since, nowMs);
    return total + (Number.isFinite(age) && age > managerSlaMinutes.approval ? 1 : 0);
  }, 0);
  const transferOverdueCount = data.filteredList.reduce((total, order) => {
    const age = getAgeMinutes(order.pending_qc_task_since, nowMs);
    return total + (Number.isFinite(age) && age > managerSlaMinutes.transfer ? 1 : 0);
  }, 0);
  const stalledCount = data.staleProductionOrders.length;
  const reworkBasketCount = getOrdersReworkBasketTotal(data.filteredList);
  const readyNowCount = data.readyOrders.length;
  const failed = Number(syncSummary.failed || 0);
  const pending = Number(syncSummary.pending || 0);
  const processing = Number(syncSummary.processing || 0);
  const integrationIncidentCount = failed + pending + processing;
  const slaRiskCount = approvalOverdueCount + transferOverdueCount;
  const oldestStalledMinutes = data.staleProductionOrders.reduce((max, order) => {
    const age = getAgeMinutes(order.updated_at, nowMs);
    if (!Number.isFinite(age)) return max;
    return Math.max(max, age);
  }, 0);
  const reworkOrderCount = data.qcOrders.filter((order) => order.status === "rework").length;
  const syncQueueCount = pending + processing;

  const cards = [
    {
      key: "stalled",
      label: "Зависли >2ч",
      value: stalledCount,
      tone: stalledCount > 0 ? "critical" : "ok",
      action: "production",
      note: stalledCount > 0 ? `Старейшая: ${formatDurationCompact(oldestStalledMinutes)}` : "В норме"
    },
    {
      key: "rework",
      label: "Доработка",
      value: reworkBasketCount,
      tone: reworkBasketCount > 0 ? "warn" : "ok",
      action: "qc",
      note: reworkBasketCount > 0 ? `В rework: ${reworkOrderCount}` : "Нет доработок"
    },
    {
      key: "reports",
      label: "Отчеты",
      value: null,
      tone: "neutral",
      action: "reports",
      note: "CSV выгрузка"
    },
    {
      key: "sync",
      label: "Инциденты интеграции",
      value: integrationIncidentCount,
      tone: integrationIncidentCount > 0 ? "critical" : "ok",
      action: "sync",
      note: integrationIncidentCount > 0
        ? `Ошибки: ${failed}, очередь: ${syncQueueCount}`
        : "Инцидентов нет"
    },
    {
      key: "archive",
      label: "Архив",
      value: null,
      tone: "neutral",
      action: "history",
      note: "Только выданные заказы"
    }
  ];

  let dominant = {
    tone: "ok",
    title: "Критических исключений нет",
    note: "Сейчас можно работать по плановому потоку.",
    action: "ready"
  };
  if (failed > 0) {
    dominant = {
      tone: "critical",
      title: `Внимание: ${failed} ошибок интеграции`,
      note: "Проверьте инциденты CleanCloud и журнал синка.",
      action: "sync"
    };
  } else if (slaRiskCount > 0) {
    dominant = {
      tone: "critical",
      title: `Внимание: SLA риск ${slaRiskCount}`,
      note: "Есть кейсы в риске по согласованию/передаче.",
      action: "urgent"
    };
  } else if (stalledCount > 0) {
    dominant = {
      tone: "warn",
      title: `Внимание: ${stalledCount} корзин без движения > 2ч`,
      note: "Проверьте узкие места и приоритетный разбор.",
      action: "production"
    };
  } else if (reworkBasketCount > 0) {
    dominant = {
      tone: "warn",
      title: `Доработка в очереди: ${reworkBasketCount}`,
      note: "Проверьте переносы и возвраты после согласования.",
      action: "qc"
    };
  }

  let dominantKey = "reports";
  if (failed > 0) dominantKey = "sync";
  else if (stalledCount > 0) dominantKey = "stalled";
  else if (reworkBasketCount > 0) dominantKey = "rework";

  return {
    cards,
    dominantKey,
    dominant,
    stalledCount,
    reworkBasketCount,
    readyNowCount,
    slaRiskCount,
    integrationIncidentCount,
    integrationFailedCount: failed
  };
}

function renderExceptionPriorityStrip(metrics) {
  function getPriorityCardActionAttributes(action) {
    if (action === "sync") return "data-open-sync-modal";
    if (action === "history") return "data-open-manager-history-modal";
    if (action === "reports") return "data-open-manager-reports-modal";
    return `data-open-manager-quick-view="${escapeHtml(action)}"`;
  }

  return `
    <section class="manager-exception-strip">
      ${metrics.cards.map((card) => `
        <button
          type="button"
          class="manager-exception-card ${managerToneClass(card.tone)} ${card.key === metrics.dominantKey ? "is-dominant" : ""}"
          ${getPriorityCardActionAttributes(card.action)}
        >
          <span class="manager-exception-label">${escapeHtml(card.label)}</span>
          ${
            card.value !== null && card.value !== undefined && String(card.value).trim() !== ""
              ? `<strong>${escapeHtml(String(card.value))}</strong>`
              : ""
          }
        </button>
      `).join("")}
    </section>
  `;
}

function renderExceptionOrderRow(order, options = {}) {
  const nowMs = options.nowMs || Date.now();
  const risk = getOrderRiskSnapshot(order, nowMs);
  const riskClass = risk.tone === "critical" ? "risk-critical" : (risk.tone === "warn" ? "risk-warn" : "risk-ok");
  const progressTone = getManagerProgressPillTone(order);
  const stationLabel = stationStatusLabels[order.status] || order.status;
  const basketCount = getOrderBasketCount(order);
  const reworkCount = getOrderReworkBasketCount(order);
  const subtitleParts = [String(order.customer_name || "").trim()];
  if (basketCount > 0) subtitleParts.push(formatBasketCountLabel(basketCount));
  if (reworkCount > 0) subtitleParts.push(formatReworkCountLabel(reworkCount));
  const subtitle = subtitleParts.filter(Boolean).join(" · ");

  return `
    <button type="button" class="manager-ex-row ${riskClass}" ${getOpenOrderActionAttributes(order)}>
      <div class="manager-ex-row-main">
        <strong>${escapeHtml(order.public_id)}</strong>
        <span>${escapeHtml(subtitle)}</span>
      </div>
      <div class="manager-ex-row-station">${escapeHtml(stationLabel)}</div>
      <div class="manager-ex-row-time ${riskClass}">
        ${renderManagerGlyph(risk.icon || "clock")}
        <span>${escapeHtml(risk.value)}</span>
      </div>
      <span class="pill ${progressTone}">${escapeHtml(getOrderProgressLabel(order))}</span>
    </button>
  `;
}

function renderManagerSearchResults(data, nowMs = Date.now()) {
  if (!data?.query) return "";

  const rows = sortOrdersByPain(
    dedupeOrdersById(data.filteredList),
    nowMs
  ).slice(0, 20);

  return `
    <section class="manager-ex-zone manager-search-results-zone">
      <header class="manager-ex-zone-head">
        <div>
          <span class="manager-column-eyebrow">Поиск</span>
          <h3>Результаты поиска</h3>
        </div>
        <span class="pill">${rows.length}</span>
      </header>
      <div class="manager-ex-zone-meta">
        ${renderManagerUtilityChip("search", `Запрос: ${data.query}`)}
      </div>
      <div class="manager-ex-list manager-search-results-list">
        ${
          rows.length
            ? rows.map((order) => renderExceptionOrderRow(order, { nowMs })).join("")
            : renderManagerEmptyCard("По этому запросу совпадений нет.", "Попробуйте убрать часть фильтра или ввести только ID заказа.")
        }
      </div>
    </section>
  `;
}

function renderReadyQueueMiniRow(order) {
  return `
    <button
      type="button"
      class="manager-ready-mini-row"
      data-open-manager-ready-order="${Number(order.id)}"
    >
      <strong>${escapeHtml(order.public_id)}</strong>
    </button>
  `;
}

function toSafeCount(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.trunc(parsed);
}

function getOrderItemTotals(order) {
  const totals = { top: 0, bottom: 0, underwear: 0, socksPairs: 0, total: 0 };
  const baskets = Array.isArray(order?.baskets) ? order.baskets : [];
  for (const basket of baskets) {
    const counts = basket?.item_counts || {};
    totals.top += toSafeCount(counts.top);
    totals.bottom += toSafeCount(counts.bottom);
    totals.underwear += toSafeCount(counts.underwear);
    totals.socksPairs += toSafeCount(counts.socksPairs);
  }
  totals.total = totals.top + totals.bottom + totals.underwear + totals.socksPairs;
  return totals;
}

function formatOrderItemsLine(order) {
  const totals = getOrderItemTotals(order);
  const parts = [];
  if (totals.top > 0) parts.push(`Top ${totals.top}`);
  if (totals.bottom > 0) parts.push(`Bottom ${totals.bottom}`);
  if (totals.underwear > 0) parts.push(`Underwear ${totals.underwear}`);
  if (totals.socksPairs > 0) parts.push(`Socks ${totals.socksPairs}`);
  if (!parts.length) return "Item breakdown is empty";
  return `${parts.join(" · ")} · Total ${totals.total}`;
}

function renderPlacementList(order) {
  const placements = Array.isArray(order?.pickup_placements) ? order.pickup_placements : [];
  if (placements.length) {
    return `
      <div class="manager-ready-order-placement-list">
        ${placements.map((placement) => `
          <div class="manager-ready-order-placement-item">
            <strong>Basket ${Number(placement.slot_index || 1)}</strong>
            <span>${escapeHtml(formatQrFull(placement.bin_qr_code))}</span>
            <em>→</em>
            <span>${escapeHtml(formatQrFull(placement.location_qr_code))}</span>
          </div>
        `).join("")}
      </div>
    `;
  }
  return '<div class="manager-ready-order-empty muted">BIN/LOC placement is not recorded.</div>';
}

function renderMachineUsage(order) {
  const usage = order?.machine_usage && typeof order.machine_usage === "object" ? order.machine_usage : {};
  const washing = Array.isArray(usage.washing) ? usage.washing : [];
  const drying = Array.isArray(usage.drying) ? usage.drying : [];
  const washingText = washing
    .map((entry) => String(entry?.machine_code || "").trim())
    .filter(Boolean)
    .join(", ");
  const dryingText = drying
    .map((entry) => String(entry?.machine_code || "").trim())
    .filter(Boolean)
    .join(", ");
  if (!washingText && !dryingText) {
    return '<div class="manager-ready-order-empty muted">Machine data is not recorded.</div>';
  }

  return `
    <div class="manager-ready-order-machine-list">
      <div class="manager-ready-order-machine-row">
        <span>Washing</span>
        <strong>${escapeHtml(washingText || "—")}</strong>
      </div>
      <div class="manager-ready-order-machine-row">
        <span>Drying</span>
        <strong>${escapeHtml(dryingText || "—")}</strong>
      </div>
    </div>
  `;
}

export function renderManagerReadyOrderModal(order) {
  if (!order) return "";

  return `
    <section class="manager-sync-modal manager-ready-order-modal" role="dialog" aria-modal="true" aria-label="Customer handoff order">
      <div class="manager-sync-modal-backdrop" data-close-manager-ready-modal></div>
      <article class="manager-sync-modal-sheet manager-ready-order-sheet">
        <header class="manager-sync-modal-head manager-ready-order-head">
          <div class="manager-ready-order-head-main">
            <div class="eyebrow">Customer handoff</div>
            <h3>${escapeHtml(order.public_id || "Order")}</h3>
            <div class="muted">${escapeHtml(String(order.customer_name || "").trim())}</div>
          </div>
          <div class="manager-sync-modal-actions">
            <button class="secondary" data-close-manager-ready-modal>Close</button>
          </div>
        </header>
        <div class="manager-ready-order-body">
          <article class="manager-ready-order-card">
            <span class="manager-ready-order-label">Customer phone</span>
            <strong>${escapeHtml(formatOrderPhone(order.customer_phone))}</strong>
          </article>
          <article class="manager-ready-order-card">
            <span class="manager-ready-order-label">Item breakdown</span>
            <strong>${escapeHtml(formatOrderItemsLine(order))}</strong>
          </article>
          <article class="manager-ready-order-card">
            <span class="manager-ready-order-label">Storage location</span>
            ${renderPlacementList(order)}
          </article>
          <article class="manager-ready-order-card">
            <span class="manager-ready-order-label">Machines</span>
            ${renderMachineUsage(order)}
          </article>
        </div>
        <footer class="manager-ready-order-footer">
          <div class="manager-ready-order-actions">
            <button data-complete-pickup-order="${Number(order.id)}" data-order-public-id="${escapeHtml(order.public_id || "")}">
              Confirm handoff
            </button>
          </div>
        </footer>
      </article>
    </section>
  `;
}

function renderManagerHistoryCard(order) {
  const orderId = Number(order?.id || 0);
  if (!Number.isFinite(orderId) || orderId <= 0) return "";

  return `
    <button type="button" class="manager-history-card manager-history-card-simple" data-open-order="${orderId}">
      <div class="manager-history-card-main">
        <strong>${escapeHtml(order.public_id || "—")}</strong>
        <span>${escapeHtml(String(order.customer_name || "").trim() || "Customer not specified")}</span>
        <span class="manager-history-phone">${escapeHtml(`Phone: ${formatOrderPhone(order.customer_phone)}`)}</span>
      </div>
    </button>
  `;
}

export function renderManagerHistoryModal(orders, options = {}) {
  if (!options?.open) return "";

  const query = normalizeFilter(options.filterQuery || "");
  const source = (Array.isArray(orders) ? orders : []).filter(isIssuedOrder);
  const filtered = query ? source.filter((order) => orderMatchesFilter(order, query)) : source;
  const sorted = filtered
    .slice()
    .sort((a, b) => {
      const stampDiff = (parseTimestampMs(b.updated_at) || 0) - (parseTimestampMs(a.updated_at) || 0);
      if (stampDiff !== 0) return stampDiff;
      return Number(b.id || 0) - Number(a.id || 0);
    });
  const visible = sorted;

  return `
    <section class="manager-sync-modal manager-history-modal" role="dialog" aria-modal="true" aria-label="Handoff archive">
      <div class="manager-sync-modal-backdrop" data-close-manager-history-modal></div>
      <article class="manager-sync-modal-sheet manager-history-sheet">
        <header class="manager-sync-modal-head manager-history-head">
          <div>
            <div class="eyebrow">Archive</div>
            <h3>Handoff archive</h3>
          </div>
          <div class="manager-sync-modal-actions">
            <button type="button" data-close-manager-history-modal>Close</button>
          </div>
        </header>
        <div class="manager-history-list">
          ${
            visible.length
              ? visible.map((order) => renderManagerHistoryCard(order)).join("")
              : renderManagerEmptyCard(
                query ? "No records in archive for the current filter." : "No issued orders in archive yet.",
                query ? "Clear or adjust the filter." : "Orders appear here after customer handoff confirmation."
              )
          }
        </div>
      </article>
    </section>
  `;
}

export function renderManagerReportsModal(options = {}) {
  if (!options?.open) return "";

  const rangePreset = String(options.rangePreset || "7d").trim();
  const dateFrom = String(options.dateFrom || "").trim();
  const dateTo = String(options.dateTo || "").trim();
  const showCustomDates = rangePreset === "custom";
  const presets = [
    { key: "today", label: "Today" },
    { key: "7d", label: "7 days" },
    { key: "30d", label: "30 days" },
    { key: "custom", label: "Custom" }
  ];
  const reports = [
    {
      key: "shift-summary",
      title: "Shift summary",
      note: "Received, in progress, ready for handoff, issued, and key shift KPIs."
    },
    {
      key: "issued-archive",
      title: "Issued in period",
      note: "Archive of issued orders: customer, phone, created date, issued date."
    },
    {
      key: "sla-exceptions",
      title: "Exceptions and SLA",
      note: "Overdue approvals and handoff, plus stalled cases in flow."
    },
    {
      key: "rework",
      title: "Rework",
      note: "Rework statuses, customer declines, repeats, and current case load."
    },
    {
      key: "machine-load",
      title: "Machine load",
      note: "Machines used by orders in washing and drying."
    }
  ];

  return `
    <section class="manager-sync-modal manager-reports-modal" role="dialog" aria-modal="true" aria-label="Report export">
      <div class="manager-sync-modal-backdrop" data-close-manager-reports-modal></div>
      <article class="manager-sync-modal-sheet manager-reports-sheet">
        <header class="manager-sync-modal-head manager-reports-head">
          <div>
            <div class="eyebrow">Reports</div>
            <h3>Report export</h3>
          </div>
          <div class="manager-sync-modal-actions">
            <button type="button" data-close-manager-reports-modal>Close</button>
          </div>
        </header>
        <section class="manager-reports-range">
          <div class="manager-reports-range-presets">
            ${presets.map((preset) => `
              <button
                type="button"
                class="secondary manager-reports-range-chip ${rangePreset === preset.key ? "is-active" : ""}"
                data-manager-report-range-preset="${escapeHtml(preset.key)}"
              >
                ${escapeHtml(preset.label)}
              </button>
            `).join("")}
          </div>
          <div class="manager-reports-range-dates ${showCustomDates ? "" : "is-hidden"}">
            <label class="manager-reports-date-field">
              <span>From</span>
              <input type="date" value="${escapeHtml(dateFrom)}" data-manager-reports-date-from />
            </label>
            <label class="manager-reports-date-field">
              <span>To</span>
              <input type="date" value="${escapeHtml(dateTo)}" data-manager-reports-date-to />
            </label>
          </div>
        </section>
        <div class="manager-reports-list">
          ${reports.map((report) => `
            <article class="manager-reports-card">
              <div class="manager-reports-card-copy">
                <strong>${escapeHtml(report.title)}</strong>
                <p>${escapeHtml(report.note)}</p>
              </div>
              <div class="manager-reports-card-actions">
                <button type="button" data-export-manager-report="${escapeHtml(report.key)}">Download</button>
              </div>
            </article>
          `).join("")}
        </div>
      </article>
    </section>
  `;
}

function buildFlowStageRows(orders, nowMs = Date.now()) {
  const stages = [
    { key: "sorting_new", label: "Unsorted", statuses: ["sorting"] },
    { key: "sorting_ready", label: "Sorted", statuses: ["sorted"] },
    { key: "washing", label: "Washing", statuses: ["washing"] },
    { key: "drying", label: "Drying", statuses: ["drying"] },
    { key: "qc", label: "QC / rework", statuses: ["qc", "rework"] },
    { key: "manager", label: "Manager decisions", statuses: ["customer_approval", "hold"] },
    { key: "ironing", label: "Ironing", statuses: ["ironing"] },
    {
      key: "pickup",
      label: "Handoff",
      statuses: ["pickup"],
      match: (order) => Boolean(order.status === "pickup" && order.ready_for_pickup)
    }
  ];
  return stages.map((stage) => {
    const items = (Array.isArray(orders) ? orders : []).filter((order) => {
      if (typeof stage.match === "function") return stage.match(order);
      return stage.statuses.includes(order.status);
    });
    let oldestMinutes = 0;
    for (const item of items) {
      const age = getAgeMinutes(item.updated_at, nowMs);
      if (Number.isFinite(age)) {
        oldestMinutes = Math.max(oldestMinutes, age);
      }
    }
    const tone = oldestMinutes > managerSlaMinutes.stalled
      ? "critical"
      : (oldestMinutes > Math.round(managerSlaMinutes.stalled * 0.66) ? "warn" : "ok");
    return {
      ...stage,
      count: items.length,
      oldestMinutes,
      tone
    };
  });
}

function renderFlowStageRow(stage) {
  return `
    <div class="manager-flow-row ${stage.tone}">
      <span class="manager-flow-name">${escapeHtml(stage.label)}</span>
      <span class="manager-flow-meta">
        <span class="manager-flow-count">${stage.count}</span>
        <span class="manager-flow-time">${escapeHtml(stage.count ? formatDurationCompact(stage.oldestMinutes) : "—")}</span>
      </span>
    </div>
  `;
}

function renderManagerQuickViewModal(data, kind, anchorY = 0) {
  const views = {
    urgent: {
      title: "Needs decision",
      orders: data.urgentOrders,
      emptyText: data.query ? "No critical cases for this filter." : "There are no cases requiring decision now."
    },
    ready: {
      title: "Ready for handoff",
      orders: data.readyOrders,
      emptyText: data.query ? "No handoff-ready orders for this filter." : "No handoff-ready orders yet."
    },
    qc: {
      title: "QC / rework",
      orders: data.qcOrders,
      emptyText: data.query ? "No QC or rework orders for this filter." : "QC and rework queue is empty now."
    },
    production: {
      title: "Stall risk",
      orders: data.staleProductionOrders,
      emptyText: data.query ? "No stalled orders for this filter." : "No stalled orders now."
    },
    new: {
      title: "New orders",
      orders: data.newOrders,
      emptyText: data.query ? "No new orders for this filter." : "No new orders now."
    }
  };

  const view = views[kind];
  if (!view) {
    return "";
  }
  const anchorValue = Number.isFinite(Number(anchorY)) && Number(anchorY) > 0
    ? Math.round(Number(anchorY))
    : "";
  const nowMs = Date.now();
  const sortedViewOrders = sortOrdersByPain(dedupeOrdersById(view.orders), nowMs);

  return `
    <section
      class="manager-sync-modal manager-quick-modal"
      role="dialog"
      aria-modal="true"
      aria-label="${escapeHtml(view.title)}"
      data-manager-quick-anchor-y="${escapeHtml(String(anchorValue))}"
    >
      <div class="manager-sync-modal-backdrop" data-close-manager-quick-view></div>
      <article class="manager-sync-modal-sheet manager-quick-modal-sheet">
        <header class="manager-sync-modal-head">
          <div>
            <h3>${escapeHtml(view.title)}</h3>
          </div>
          <div class="manager-sync-modal-actions">
            <button type="button" data-close-manager-quick-view>Close</button>
          </div>
        </header>
        <div class="manager-quick-view-list">
          ${
            sortedViewOrders.length
              ? sortedViewOrders.map((order) => renderManagerCaseCard(order, { compact: true })).join("")
              : renderManagerEmptyCard(view.emptyText, "The list will be populated automatically when data appears.")
          }
        </div>
      </article>
    </section>
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
    <div class="muted">Weight: ${escapeHtml(formatOrderWeight(order.order_weight))} · Phone: ${escapeHtml(formatOrderPhone(order.customer_phone))} · CleanCloud: ${escapeHtml(order.cleancloud_status)}</div>
    <div class="muted">Current station: ${escapeHtml(stationStatusLabels[order.status] || order.status)}</div>
  `;
}

export function renderOrderCard(order) {
  return `
    <article class="card">
      ${renderOrderMeta(order)}
      <div class="action-row">
        <button ${getOpenOrderActionAttributes(order)}>Open details</button>
      </div>
    </article>
  `;
}

export function renderOverview(orders) {
  return `
    <section class="panel stack">
      <div class="header-row">
        <div>
          <div class="eyebrow">Overview</div>
          <h2>Branch order list</h2>
        </div>
      </div>
      <div class="order-grid">
        ${orders.map(renderOrderCard).join("")}
      </div>
    </section>
  `;
}

export function renderManagerOverviewCompact(orders, syncSummary = {}, filterQuery = "", options = {}) {
  const data = buildManagerOverviewData(orders, syncSummary, filterQuery);
  const nowMs = Date.now();
  const metrics = buildExceptionMetrics(data, syncSummary, nowMs);
  const syncHeadline = formatSyncHeadline(syncSummary);
  const attentionOrders = sortOrdersByPain(
    dedupeOrdersById([
      ...data.urgentOrders,
      ...data.staleProductionOrders,
      ...data.qcOrders.filter((order) => order.status === "rework")
    ]),
    nowMs
  );
  const readyOrders = sortOrdersByPain(
    dedupeOrdersById(data.readyOrders),
    nowMs
  );
  const attentionLimit = 8;
  const readyLimit = 8;
  const attentionRows = attentionOrders.slice(0, attentionLimit);
  const readyRows = readyOrders.slice(0, readyLimit);
  const flowRows = buildFlowStageRows(data.filteredList, nowMs);
  const approvalOverdue = data.filteredList.filter((order) => {
    const age = getAgeMinutes(order.pending_approval_since, nowMs);
    return Number.isFinite(age) && age > managerSlaMinutes.approval;
  }).length;
  const transferOverdue = data.filteredList.filter((order) => {
    const age = getAgeMinutes(order.pending_qc_task_since, nowMs);
    return Number.isFinite(age) && age > managerSlaMinutes.transfer;
  }).length;

  return `
    <section class="panel stack manager-command-panel">
      <div class="manager-command-head">
        <div>
          <h2 class="manager-command-title">Shift exceptions</h2>
        </div>
        <div class="manager-command-tools">
          <label class="manager-search">
            <span class="manager-search-icon">${renderManagerGlyph("search")}</span>
            <input
              type="search"
              placeholder="Search: ID, customer, phone"
              value="${escapeHtml(filterQuery)}"
              data-manager-filter
            />
          </label>
          <button class="secondary manager-sync-shortcut ${managerToneClass(syncHeadline.tone)}" data-open-sync-modal>
            ${renderManagerGlyph("cloud")}
            <span class="manager-toolbar-copy">
              <span class="manager-toolbar-title">CleanCloud</span>
              <span class="manager-toolbar-note">Incidents</span>
            </span>
          </button>
        </div>
      </div>

      ${renderExceptionPriorityStrip(metrics)}
      ${renderManagerSearchResults(data, nowMs)}

      <div class="manager-ex-layout">
        <section class="manager-ex-zone attention">
          <header class="manager-ex-zone-head">
            <div>
              <span class="manager-column-eyebrow">Needs attention</span>
              <h3>Exceptions</h3>
            </div>
            <button type="button" class="secondary" data-open-manager-quick-view="urgent">Full list</button>
          </header>
          <div class="manager-ex-zone-meta">
            ${renderManagerUtilityChip("alert", `SLA risk ${metrics.slaRiskCount}`, metrics.slaRiskCount > 0 ? "critical" : "")}
          </div>
          <div class="manager-ex-list">
            ${
              attentionRows.length
                ? attentionRows.map((order) => renderExceptionOrderRow(order, { nowMs })).join("")
                : renderManagerEmptyCard(
                  data.query ? "No exceptions for this filter." : "There are no critical exceptions now.",
                  data.query ? "Clear the filter to see all orders." : "Good signal: shift flow is stable now."
                )
            }
          </div>
        </section>

        <section class="manager-ex-zone flow">
          <header class="manager-ex-zone-head">
            <h3>Flow</h3>
            <span class="pill ${metrics.stalledCount > 0 ? "warn" : "ok"}">>2ч: ${metrics.stalledCount}</span>
          </header>
          <div class="manager-flow-grid">
            ${flowRows.map(renderFlowStageRow).join("")}
          </div>
          <div class="manager-ex-zone-meta">
            ${renderManagerUtilityChip("alert", `Overdue ${approvalOverdue + transferOverdue}`, (approvalOverdue + transferOverdue) > 0 ? "critical" : "")}
          </div>
        </section>

        <section class="manager-ex-zone ready">
          <header class="manager-ex-zone-head">
            <h3>Ready for handoff</h3>
            <span class="pill">${metrics.readyNowCount}</span>
          </header>
          <div class="manager-ex-list">
            ${
              readyRows.length
                ? readyRows.map((order) => renderReadyQueueMiniRow(order)).join("")
                : renderManagerEmptyCard(
                  data.query ? "No handoff-ready orders for this filter." : "There are no orders ready for handoff now.",
                  data.query ? "Check filter by phone or order ID." : "When Dispatch placement is complete, the order appears here."
                )
            }
          </div>
        </section>
      </div>
      ${options.quickView ? renderManagerQuickViewModal(data, options.quickView, options.quickViewAnchorY) : ""}
    </section>
  `;
}

function shrinkPayload(payload) {
  const text = String(payload || "").trim();
  if (!text) return "—";
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

function formatStamp(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function renderSyncQueueItem(item, options = {}) {
  const compact = Boolean(options.compact);
  const toneClass = item.status === "failed" ? "error" : item.status === "processed" ? "ok" : "";

  return `
    <article class="manager-sync-item ${compact ? "compact" : ""}">
      <div class="manager-sync-item-top">
        <strong>${escapeHtml(item.action)}</strong>
        <span class="pill ${toneClass}">${escapeHtml(item.status)}</span>
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
  `;
}

function renderSyncQueueModal(syncQueue) {
  const items = Array.isArray(syncQueue.items) ? syncQueue.items : [];
  const summary = syncQueue.summary || {};

  return `
    <section class="manager-sync-modal" role="dialog" aria-modal="true" aria-label="CleanCloud incidents">
      <div class="manager-sync-modal-backdrop" data-close-sync-modal></div>
      <article class="manager-sync-modal-sheet">
        <header class="manager-sync-modal-head">
          <div>
            <div class="eyebrow">CleanCloud incidents</div>
            <h3>Sync queue and journal</h3>
            <p class="muted">The full integration log is moved out of the main screen to keep the command center clean.</p>
          </div>
          <div class="manager-sync-modal-actions">
            <button class="secondary" data-run-sync-now>Run sync now</button>
            <button type="button" data-close-sync-modal>Close</button>
          </div>
        </header>
        <div class="manager-sync-modal-summary">
          <span class="pill">pending: ${Number(summary.pending || 0)}</span>
          <span class="pill">processing: ${Number(summary.processing || 0)}</span>
          <span class="pill">processed: ${Number(summary.processed || 0)}</span>
          <span class="pill ${Number(summary.failed || 0) > 0 ? "error" : "ok"}">failed: ${Number(summary.failed || 0)}</span>
        </div>
        <div class="manager-sync-modal-list">
          ${
            items.length
              ? items.map((item) => renderSyncQueueItem(item)).join("")
              : renderManagerEmptyCard(
                "Queue is empty. No integration incidents now.",
                "Manual sync is still available when you need to check the channel."
              )
          }
        </div>
      </article>
    </section>
  `;
}

function renderSyncQueueHealthy(summary) {
  return `
    <section class="panel stack manager-sync-brief manager-sync-brief-compact">
      <div class="manager-sync-compact-row">
        <div class="manager-sync-compact-copy">
          <div class="eyebrow">Integration health</div>
          <h2>CleanCloud под контролем</h2>
          <p class="manager-sync-note">Инцидентов нет. Журнал и ручной запуск остаются доступны, но не перегружают главный экран.</p>
        </div>
        <div class="manager-sync-compact-metrics">
          <span class="manager-sync-inline-pill ok">Норма</span>
          <span class="manager-sync-inline-pill">Очередь ${Number(summary.pending || 0) + Number(summary.processing || 0)}</span>
          <span class="manager-sync-inline-pill">Ошибки ${Number(summary.failed || 0)}</span>
          <span class="manager-sync-inline-pill">Успешно ${Number(summary.processed || 0)}</span>
        </div>
        <div class="manager-sync-actions compact">
          <button class="secondary" data-open-sync-modal>Открыть журнал</button>
          <button data-run-sync-now>Запустить sync сейчас</button>
        </div>
      </div>
    </section>
  `;
}

export function renderSyncQueue(syncQueue, options = {}) {
  return options.modalOpen ? renderSyncQueueModal(syncQueue) : "";
}
