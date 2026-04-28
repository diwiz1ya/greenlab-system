import { state } from "./state.js";
import { deepTranslateRuToEn, translateRuToEnText } from "./i18n.js";

export async function api(url, options = {}) {
  const {
    timeoutMs = 60000,
    headers,
    signal,
    ...fetchOptions
  } = options;

  const hasExternalSignal = Boolean(signal);
  const controller = hasExternalSignal ? null : new AbortController();
  const effectiveSignal = hasExternalSignal ? signal : controller.signal;
  const timeoutHandle = (!hasExternalSignal && Number.isFinite(timeoutMs) && timeoutMs > 0)
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const isFormDataBody = typeof FormData !== "undefined" && fetchOptions.body instanceof FormData;
    const requestHeaders = {
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(headers || {})
    };
    const hasContentTypeHeader = Object.keys(requestHeaders).some(
      (headerName) => headerName.toLowerCase() === "content-type"
    );
    if (isFormDataBody) {
      for (const headerName of Object.keys(requestHeaders)) {
        if (headerName.toLowerCase() === "content-type") {
          delete requestHeaders[headerName];
        }
      }
    } else if (!hasContentTypeHeader) {
      requestHeaders["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      ...fetchOptions,
      signal: effectiveSignal,
      headers: requestHeaders
    });

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    payload = deepTranslateRuToEn(payload);

    if (!response.ok) {
      const error = new Error(translateRuToEnText(payload.error || payload.message || `HTTP ${response.status}`));
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(translateRuToEnText("Server response timeout. Please try again."));
    }
    throw error;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function downloadScanExport(format, orderId = null) {
  const params = new URLSearchParams({ format });
  if (orderId) {
    params.set("orderId", String(orderId));
  }

  const response = await fetch(`/api/export/scans?${params.toString()}`, {
    headers: {
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
    }
  });

  if (!response.ok) {
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    payload = deepTranslateRuToEn(payload);
    throw new Error(translateRuToEnText(payload.error || `Export failed (${response.status})`));
  }

  let blob;
  let extension;

  if (format === "json") {
    const data = deepTranslateRuToEn(await response.json());
    blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    extension = "json";
  } else {
    const text = await response.text();
    blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    extension = "csv";
  }

  const stamp = new Date().toISOString().replaceAll(":", "-");
  const scope = orderId ? `order-${orderId}` : "all";
  const fileName = `scan-log-${scope}-${stamp}.${extension}`;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
