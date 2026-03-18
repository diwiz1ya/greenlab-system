const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");

const rootDir = path.resolve(__dirname, "..");

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadDotEnv(path.join(rootDir, ".env"));

function getFlagValue(name, fallback = "") {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return arg.slice(name.length + 3);
}

function parsePositiveNumber(name, fallback) {
  const raw = getFlagValue(name, "");
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function postAlert(webhookUrl, payload) {
  if (!webhookUrl) return;
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await response.json()
      : { raw: await response.text() };
    return { response, data };
  } finally {
    clearTimeout(timeoutId);
  }
}

function formatIssues(issues) {
  if (!issues.length) return "ok";
  return issues.map((item, index) => `${index + 1}) ${item}`).join("; ");
}

async function run() {
  const appPort = Number(process.env.GREENLAB_PORT || process.env.PORT || 3010);
  const defaultUrl = `http://127.0.0.1:${Number.isFinite(appPort) && appPort > 0 ? appPort : 3010}/healthz`;
  const url = getFlagValue("url", process.env.OPS_HEALTH_URL || defaultUrl);
  const timeoutMs = parsePositiveNumber("timeout-ms", 5000);
  const maxFailed = parsePositiveNumber("max-failed", 0);
  const maxPending = parsePositiveNumber("max-pending", 20);
  const maxProcessing = parsePositiveNumber("max-processing", 10);
  const webhookUrl = getFlagValue("webhook-url", process.env.OPS_ALERT_WEBHOOK_URL || "");

  let response;
  let payload;
  try {
    const result = await fetchWithTimeout(url, timeoutMs);
    response = result.response;
    payload = result.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const issues = [`health endpoint unavailable: ${message}`];
    const alertPayload = {
      source: "green-lab-monitor",
      status: "critical",
      message: `Health check failed: ${formatIssues(issues)}`,
      at: new Date().toISOString(),
      details: { url, timeoutMs }
    };
    try {
      await postAlert(webhookUrl, alertPayload);
    } catch {
      // ignore alert transport failure
    }
    console.error(alertPayload.message);
    process.exit(2);
    return;
  }

  const issues = [];
  if (!response.ok) {
    issues.push(`health http status ${response.status}`);
  }
  if (!payload || payload.ok !== true) {
    issues.push("payload ok=false");
  }
  if (!payload?.db?.ok) {
    issues.push(`db not ok${payload?.db?.error ? `: ${payload.db.error}` : ""}`);
  }

  const failed = Number(payload?.syncQueue?.failed || 0);
  const pending = Number(payload?.syncQueue?.pending || 0);
  const processing = Number(payload?.syncQueue?.processing || 0);

  if (failed > maxFailed) {
    issues.push(`sync failed=${failed} > maxFailed=${maxFailed}`);
  }
  if (pending > maxPending) {
    issues.push(`sync pending=${pending} > maxPending=${maxPending}`);
  }
  if (processing > maxProcessing) {
    issues.push(`sync processing=${processing} > maxProcessing=${maxProcessing}`);
  }

  const status = issues.length ? "critical" : "ok";
  const message = issues.length
    ? `Health check failed: ${formatIssues(issues)}`
    : `Health check ok: failed=${failed}, pending=${pending}, processing=${processing}`;

  const output = {
    source: "green-lab-monitor",
    status,
    message,
    at: new Date().toISOString(),
    details: {
      url,
      timeoutMs,
      thresholds: { maxFailed, maxPending, maxProcessing },
      health: payload
    }
  };

  if (issues.length && webhookUrl) {
    try {
      await postAlert(webhookUrl, output);
    } catch (error) {
      const transportError = error instanceof Error ? error.message : String(error);
      console.error(`Alert webhook failed: ${transportError}`);
    }
  }

  if (issues.length) {
    console.error(message);
    process.exit(2);
    return;
  }

  console.log(message);
}

run().catch((error) => {
  console.error("monitor-health failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
