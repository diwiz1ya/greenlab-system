import { api } from "../api.js";
import { app, applyRoleDefaults, state } from "../state.js";
import { escapeHtml } from "../utils.js";

export function renderLogin(renderApp, error) {
  app.innerHTML = `
    <section class="shell login-shell">
      <div class="panel login-card stack">
        <div>
          <div class="eyebrow login-brand">Green Lab</div>
          <p class="muted">Enter employee credentials.</p>
        </div>
        ${error ? `<div class="notice error">${escapeHtml(error)}</div>` : ""}
        <label>
          Username
          <input
            id="login-username"
            placeholder="Enter username"
            autocomplete="username"
            autocapitalize="none"
            spellcheck="false"
          />
        </label>
        <label>
          Password
          <input id="login-password" type="password" placeholder="Enter password" autocomplete="current-password" />
        </label>
        <button id="login-submit" class="login-submit">Sign in</button>
      </div>
    </section>
  `;

  async function submitLogin() {
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value;

    try {
      const payload = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
      state.token = payload.token;
      localStorage.setItem("greenlab-demo-token", payload.token);
      state.user = payload.user;
      state.screen = "station-picker";
      state.currentStation = null;
      state.deniedStation = null;
      applyRoleDefaults();
      await renderApp();
    } catch (submitError) {
      renderLogin(renderApp, submitError.message);
    }
  }

  document.getElementById("login-submit").addEventListener("click", submitLogin);
  document.getElementById("login-password").addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitLogin();
  });
}
