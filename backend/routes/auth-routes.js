const { parseRequiredString } = require("../http/validation");
const { getClientIp } = require("../http/request-meta");

function handleAuthRoutes(req, res, url, ctx) {
  const {
    db,
    readJson,
    json,
    requireAuth,
    auth,
    verifyHashedPassword,
    sessionStore,
    loginRateLimiter,
    logSecurityEvent
  } = ctx;

  if (req.method === "POST" && url.pathname === "/api/login") {
    readJson(req)
      .then((body) => {
        const clientIp = getClientIp(req);
        const username = parseRequiredString(body.username, { minLength: 2, maxLength: 64 });
        const password = parseRequiredString(body.password, { minLength: 1, maxLength: 256 });
        if (!username || !password) {
          logSecurityEvent({
            category: "auth.login.invalid_payload",
            actor: username || "anonymous",
            ip: clientIp,
            path: url.pathname,
            method: req.method,
            status: 400,
            message: "Нужны корректные username/password"
          });
          json(res, 400, { error: "Нужны корректные username/password" });
          return;
        }

        const limiterResult = loginRateLimiter.hit(`${clientIp}:${username}`);
        if (!limiterResult.allowed) {
          res.setHeader("Retry-After", String(limiterResult.retryAfterSec));
          logSecurityEvent({
            category: "auth.login.rate_limited",
            actor: username,
            ip: clientIp,
            path: url.pathname,
            method: req.method,
            status: 429,
            message: `Слишком много попыток входа. Retry after ${limiterResult.retryAfterSec}s`
          });
          json(res, 429, { error: "Слишком много попыток входа. Повторите позже." });
          return;
        }

        const user = db.prepare(`
          SELECT id, username, password_hash, display_name, role, allowed_stations
          FROM users
          WHERE username = ?
        `).get(username);

        if (!user || !verifyHashedPassword(password, user.password_hash)) {
          logSecurityEvent({
            category: "auth.login.failed",
            actor: username,
            ip: clientIp,
            path: url.pathname,
            method: req.method,
            status: 401,
            message: "Неверный логин или пароль"
          });
          json(res, 401, { error: "Неверный логин или пароль" });
          return;
        }

        const session = sessionStore.createFromUser(user);
        logSecurityEvent({
          category: "auth.login.success",
          actor: session.username,
          ip: clientIp,
          path: url.pathname,
          method: req.method,
          status: 200,
          message: `Успешный вход (${session.role})`
        });

        json(res, 200, {
          token: session.token,
          user: {
            username: session.username,
            displayName: session.displayName,
            role: session.role,
            allowedStations: session.allowedStations,
            homeStation: session.homeStation
          }
        });
      })
      .catch((error) => {
        const clientIp = getClientIp(req);
        logSecurityEvent({
          category: "auth.login.invalid_json",
          actor: "anonymous",
          ip: clientIp,
          path: url.pathname,
          method: req.method,
          status: 400,
          message: error.message
        });
        json(res, 400, { error: error.message });
      });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/session") {
    const session = requireAuth(req, res);
    if (!session) return true;

    json(res, 200, {
      user: {
        username: session.username,
        displayName: session.displayName,
        role: session.role,
        allowedStations: session.allowedStations,
        homeStation: session.homeStation
      }
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const session = auth(req);
    if (session) {
      sessionStore.deleteByToken(session.token);
      logSecurityEvent({
        category: "auth.logout",
        actor: session.username,
        ip: getClientIp(req),
        path: url.pathname,
        method: req.method,
        status: 200,
        message: "Пользователь вышел из системы"
      });
    }
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}

module.exports = {
  handleAuthRoutes
};
