import { api } from "../api.js";
import { app, applyRoleDefaults, state } from "../state.js";
import { escapeHtml } from "../utils.js";

export function renderLogin(renderApp, error) {
  app.innerHTML = `
    <section class="shell login-shell">
      <div class="panel login-card stack">
        <div>
          <div class="eyebrow">Green Lab</div>
          <h2>Вход в рабочую систему</h2>
          <p class="muted">Введите учетные данные сотрудника.</p>
        </div>
        ${error ? `<div class="notice error">${escapeHtml(error)}</div>` : ""}
        <label>
          Логин
          <input id="login-username" placeholder="manager" value="manager" />
        </label>
        <label>
          Пароль
          <input id="login-password" type="password" placeholder="demo123" value="demo123" />
        </label>
        <button id="login-submit">Войти</button>
        <details class="login-details">
          <summary>Демо-учетки</summary>
          <div class="demo-credentials">
            ${[
              ["sorting", "Оператор сортировки"],
              ["washing", "Оператор стирки"],
              ["qc", "Оператор контроля качества"],
              ["drying", "Оператор сушки"],
              ["ironing", "Оператор глажки"],
              ["pickup", "Оператор выдачи"],
              ["manager", "Менеджер"]
            ]
              .map(
                ([username, role]) => `
                  <div class="credential-row">
                    <strong>${username}</strong> / <code>demo123</code>
                    <span class="muted">${role}</span>
                  </div>
                `
              )
              .join("")}
          </div>
        </details>
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
