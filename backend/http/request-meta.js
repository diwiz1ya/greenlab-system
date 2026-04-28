function normalizeIp(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.startsWith("::ffff:")) return text.slice(7);
  return text;
}

function getForwardedForIp(req) {
  const forwardedFor = req?.headers?.["x-forwarded-for"];
  if (typeof forwardedFor !== "string" || !forwardedFor.trim()) {
    return "";
  }

  const parts = forwardedFor.split(",");
  for (const part of parts) {
    const ip = normalizeIp(part);
    if (ip) return ip;
  }
  return "";
}

function getClientIp(req, options = {}) {
  const trustProxy = options.trustProxy === true;
  if (trustProxy) {
    const forwardedIp = getForwardedForIp(req);
    if (forwardedIp) return forwardedIp;
  }

  const remoteIp = normalizeIp(req?.socket?.remoteAddress);
  return remoteIp || "unknown";
}

module.exports = {
  getClientIp
};
