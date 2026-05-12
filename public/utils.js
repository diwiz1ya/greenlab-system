export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderCameraIconButton(options = {}) {
  const {
    className = "",
    attributes = {},
    disabled = false,
    label = "Open camera"
  } = options;
  const attrText = Object.entries(attributes)
    .map(([name, value]) => ` ${escapeHtml(name)}="${escapeHtml(value)}"`)
    .join("");
  return `
    <button
      class="qr-camera-button ${escapeHtml(className)}"
      type="button"
      aria-label="${escapeHtml(label)}"
      title="${escapeHtml(label)}"
      ${disabled ? "disabled" : ""}${attrText}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 8.8A2.8 2.8 0 0 1 6.8 6h1.7l1.2-1.7h4.6L15.5 6h1.7A2.8 2.8 0 0 1 20 8.8v7.4a2.8 2.8 0 0 1-2.8 2.8H6.8A2.8 2.8 0 0 1 4 16.2V8.8Z"></path>
        <circle cx="12" cy="12.5" r="3.2"></circle>
      </svg>
    </button>
  `;
}
