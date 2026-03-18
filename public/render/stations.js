import { state, stationDescriptions, stationLabels } from "../state.js";
import { escapeHtml } from "../utils.js";

export function renderHero(counts = {}) {
  return `
    <section class="hero">
      <div>
        <div class="eyebrow">Менеджерский хаб</div>
        <h1>Операционный поток прачечной: корзины, станции, QR и контроль синка.</h1>
        <p class="lead">
          Интерфейс разделён по ролям: сортировка и менеджер работают в полной панели,
          скан-посты работают в киоск-режиме с мгновенным результатом скана.
        </p>
      </div>
      <div class="grid">
        <div class="stat"><span class="muted">Обзор</span><strong>${counts.overview || 0}</strong></div>
        <div class="stat"><span class="muted">Сортировка</span><strong>${counts.sorting || 0}</strong></div>
        <div class="stat"><span class="muted">Стирка</span><strong>${counts.washing || 0}</strong></div>
        <div class="stat"><span class="muted">QC</span><strong>${counts.qc || 0}</strong></div>
        <div class="stat"><span class="muted">Сушка</span><strong>${counts.drying || 0}</strong></div>
        <div class="stat"><span class="muted">Глажка</span><strong>${counts.ironing || 0}</strong></div>
        <div class="stat"><span class="muted">Готово к выдаче</span><strong>${counts.ready || 0}</strong></div>
      </div>
    </section>
  `;
}

export function renderManagerCabinet(stations, counts = {}, syncSummary = {}, currentStation = null) {
  void stations;
  void currentStation;
  const holdCount = Number(counts.hold || 0);
  const inProgress = Number(counts.washing || 0)
    + Number(counts.qc || 0)
    + Number(counts.drying || 0)
    + Number(counts.ironing || 0)
    + holdCount;
  const failed = Number(syncSummary.failed || 0);
  const pending = Number(syncSummary.pending || 0);
  const processing = Number(syncSummary.processing || 0);
  const queueLoad = pending + processing;

  return `
    <section class="panel stack manager-cabinet-clean">
      <div class="header-row">
        <div>
          <div class="eyebrow">Менеджерский кабинет</div>
          <h2>Пульт смены</h2>
        </div>
        <span class="pill ${failed > 0 ? "error" : "ok"}">${failed > 0 ? `sync errors: ${failed}` : "sync ok"}</span>
      </div>

      <div class="manager-kpi-row manager-kpi-row-lite">
        <div class="manager-kpi-card">
          <span class="muted">Новые</span>
          <strong>${Number(counts.sorting || 0)}</strong>
        </div>
        <div class="manager-kpi-card">
          <span class="muted">В работе</span>
          <strong>${inProgress}</strong>
        </div>
        <div class="manager-kpi-card">
          <span class="muted">К выдаче</span>
          <strong>${Number(counts.ready || 0)}</strong>
        </div>
        <div class="manager-kpi-card ${failed > 0 ? "warn" : ""}">
          <span class="muted">Sync ошибки</span>
          <strong>${failed}</strong>
        </div>
      </div>

      <section class="manager-alert-strip">
        <article class="manager-alert-card ${holdCount > 0 ? "critical" : "ok"}">
          <div class="muted">HOLD</div>
          <strong>${holdCount}</strong>
        </article>
        <article class="manager-alert-card ${failed > 0 ? "critical" : "ok"}">
          <div class="muted">Sync fail</div>
          <strong>${failed}</strong>
        </article>
        <article class="manager-alert-card ${queueLoad > 0 ? "warn" : "ok"}">
          <div class="muted">Очередь sync</div>
          <strong>${queueLoad}</strong>
        </article>
      </section>

      <div class="manager-sync-inline">
        <div class="manager-sync-pills">
          <span class="pill">pending: ${pending}</span>
          <span class="pill">processing: ${processing}</span>
          <span class="pill ${failed > 0 ? "error" : "ok"}">failed: ${failed}</span>
        </div>
      </div>
    </section>
  `;
}

export function renderStationPicker(stations, compact = false) {
  return `
    <section class="panel">
      <div class="header-row">
        <div>
          <div class="eyebrow">Доступ по роли</div>
          <h2>${compact ? "Смена станции" : "Выбор станции"}</h2>
        </div>
      </div>
      <div class="station-grid ${compact ? "station-grid-compact" : ""}">
        ${stations
          .map(
            (station) => `
              <article class="station-card ${station.allowed ? "" : "disabled"}">
                <div class="eyebrow">${station.allowed ? "доступно" : "заблокировано"}</div>
                <h3>${escapeHtml(station.label)}</h3>
                <p class="muted">${escapeHtml(stationDescriptions[station.key])}</p>
                <button class="${station.allowed ? "" : "secondary"}" data-open-station="${station.key}">
                  ${station.allowed ? "Открыть станцию" : "Попробовать открыть"}
                </button>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

export function renderDemoControls() {
  const canReset = state.user.role === "manager";
  return `
    <section class="panel manager-tools">
      <details class="manager-tools-details">
        <summary>Сервисные инструменты демо</summary>
        <div class="manager-tools-body">
          <div class="manager-kpi-card">
            <span class="muted">Сброс</span>
            <button class="warn" data-demo-reset ${canReset ? "" : "disabled"}>Сбросить демо-данные</button>
          </div>
          <div class="manager-kpi-card">
            <span class="muted">Экспорт лога</span>
            <div class="controls-grid">
              <button class="secondary" data-export-scans="json">JSON</button>
              <button class="secondary" data-export-scans="csv">CSV</button>
            </div>
          </div>
          <div class="manager-kpi-card">
            <span class="muted">Экспорт выбранного заказа</span>
            <div class="controls-grid">
              <button class="ghost" data-export-order="json" ${state.selectedOrderId ? "" : "disabled"}>JSON</button>
              <button class="ghost" data-export-order="csv" ${state.selectedOrderId ? "" : "disabled"}>CSV</button>
            </div>
          </div>
        </div>
      </details>
    </section>
  `;
}

export function renderNoAccess() {
  const station = state.deniedStation || { station: "unknown", label: "Неизвестная станция" };
  return `
    <section class="panel no-access-shell">
      <div class="eyebrow">Доступ запрещён</div>
      <h2>Нет доступа к станции ${escapeHtml(station.label)}</h2>
      <p class="lead">
        Эта роль не может открыть запрошенную станцию. Доступ ограничен матрицей ролей,
        а станция остаётся видимой только для наглядной демонстрации границы доступа.
      </p>
      <div class="badge-row">
        <div class="badge"><strong>${escapeHtml(station.label)}</strong><span class="muted">Запрошенная станция</span></div>
        <div class="badge"><strong>${escapeHtml(state.user.role)}</strong><span class="muted">Текущая роль</span></div>
      </div>
      <div class="action-row">
        <button id="back-to-stations">К списку станций</button>
        <button class="secondary" id="logout-from-denied">Выйти</button>
      </div>
    </section>
  `;
}

export function renderSimpleWorkerHome() {
  const stationLabel = stationLabels[state.currentStation] || "Рабочая станция";
  return `
    <section class="panel stack">
      <div class="eyebrow">Рабочее место</div>
      <h2>${escapeHtml(stationLabel)}</h2>
      <p class="muted">После входа сотрудник работает только на своей станции. Переключение и демо-панели скрыты.</p>
      <div class="action-row">
        <button id="home-station-button">Открыть рабочий экран</button>
      </div>
    </section>
  `;
}
