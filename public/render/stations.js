import { state, stationDescriptions, stationLabels } from "../state.js";
import { escapeHtml } from "../utils.js";

export function renderHero(counts = {}) {
  return `
    <section class="hero">
      <div>
        <div class="eyebrow">Manager Hub</div>
        <h1>Laundry operations flow: baskets, stations, QR, and sync control.</h1>
        <p class="lead">
          The interface is role-based: sorting and manager roles use full panels,
          scan stations run in kiosk mode with immediate scan feedback.
        </p>
      </div>
      <div class="grid">
        <div class="stat"><span class="muted">Overview</span><strong>${counts.overview || 0}</strong></div>
        <div class="stat"><span class="muted">Sorting</span><strong>${counts.sorting || 0}</strong></div>
        <div class="stat"><span class="muted">Washing</span><strong>${counts.washing || 0}</strong></div>
        <div class="stat"><span class="muted">Drying</span><strong>${counts.drying || 0}</strong></div>
        <div class="stat"><span class="muted">QC</span><strong>${counts.qc || 0}</strong></div>
        <div class="stat"><span class="muted">Rework</span><strong>${counts.rework || 0}</strong></div>
        <div class="stat"><span class="muted">Ironing</span><strong>${counts.ironing || 0}</strong></div>
        <div class="stat"><span class="muted">Ready for pickup</span><strong>${counts.ready || 0}</strong></div>
      </div>
    </section>
  `;
}

export function renderStationPicker(stations, compact = false) {
  return `
    <section class="panel">
      <div class="header-row">
        <div>
          <div class="eyebrow">Role-based access</div>
          <h2>${compact ? "Switch station" : "Choose station"}</h2>
        </div>
      </div>
      <div class="station-grid ${compact ? "station-grid-compact" : ""}">
        ${stations
          .map(
            (station) => `
              <article class="station-card ${station.allowed ? "" : "disabled"}">
                <div class="eyebrow">${station.allowed ? "available" : "blocked"}</div>
                <h3>${escapeHtml(station.label)}</h3>
                <p class="muted">${escapeHtml(stationDescriptions[station.key])}</p>
                <button class="${station.allowed ? "" : "secondary"}" data-open-station="${station.key}">
                  ${station.allowed ? "Open station" : "Try to open"}
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
        <summary>Demo service tools</summary>
        <div class="manager-tools-body">
          <div class="manager-kpi-card">
            <span class="muted">Reset</span>
            <button class="warn" data-demo-reset ${canReset ? "" : "disabled"}>Reset demo data</button>
          </div>
          <div class="manager-kpi-card">
            <span class="muted">Log export</span>
            <div class="controls-grid">
              <button class="secondary" data-export-scans="json">JSON</button>
              <button class="secondary" data-export-scans="csv">CSV</button>
            </div>
          </div>
          <div class="manager-kpi-card">
            <span class="muted">Selected order export</span>
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
  const station = state.deniedStation || { station: "unknown", label: "Unknown station" };
  return `
    <section class="panel no-access-shell">
      <div class="eyebrow">Access denied</div>
      <h2>No access to station ${escapeHtml(station.label)}</h2>
      <p class="lead">
        This role cannot open the requested station. Access is limited by the role matrix,
        and the station remains visible only to demonstrate access boundaries.
      </p>
      <div class="badge-row">
        <div class="badge"><strong>${escapeHtml(station.label)}</strong><span class="muted">Requested station</span></div>
        <div class="badge"><strong>${escapeHtml(state.user.role)}</strong><span class="muted">Current role</span></div>
      </div>
      <div class="action-row">
        <button id="back-to-stations">Back to stations</button>
        <button class="secondary" id="logout-from-denied">Log out</button>
      </div>
    </section>
  `;
}

export function renderSimpleWorkerHome() {
  const stationLabel = stationLabels[state.currentStation] || "Workstation";
  return `
    <section class="panel stack">
      <div class="eyebrow">Workstation</div>
      <h2>${escapeHtml(stationLabel)}</h2>
      <p class="muted">After login, the operator works only at their assigned station. Station switching and demo panels are hidden.</p>
      <div class="action-row">
        <button id="home-station-button">Open workstation</button>
      </div>
    </section>
  `;
}
