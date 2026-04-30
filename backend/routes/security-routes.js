const { parseRequiredString } = require("../http/validation");

async function handleSecurityRoutes(req, res, url, ctx) {
  const {
    requireAuth,
    requireManager,
    json,
    listSecurityEvents
  } = ctx;

  if (req.method === "GET" && url.pathname === "/api/security/events") {
    const session = requireAuth(req, res);
    if (!session) return true;
    if (!requireManager(session, res)) return true;

    const limitRaw = Number(url.searchParams.get("limit") || 50);
    const limit = Number.isInteger(limitRaw) ? Math.max(1, Math.min(limitRaw, 200)) : 50;
    const category = parseRequiredString(url.searchParams.get("category"), { minLength: 3, maxLength: 64 });

    json(res, 200, {
      total: limit,
      rows: await listSecurityEvents(limit, category || null)
    });
    return true;
  }

  return false;
}

module.exports = {
  handleSecurityRoutes
};
