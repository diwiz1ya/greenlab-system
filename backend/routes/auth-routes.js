const { parseRequiredString } = require("../http/validation");
const { getClientIp } = require("../http/request-meta");

async function handleAuthRoutes(req, res, url, ctx) {
  const {
    userRepository,
    readJson,
    json,
    requireAuth,
    auth,
    verifyHashedPassword,
    sessionStore,
    loginRateLimiter,
    logSecurityEvent,
    trustProxy
  } = ctx;

  if (req.method === "POST" && url.pathname === "/api/login") {
    return (async () => {
      try {
        const body = await readJson(req);
        const clientIp = getClientIp(req, { trustProxy });
        const username = parseRequiredString(body.username, { minLength: 2, maxLength: 64 });
        const password = parseRequiredString(body.password, { minLength: 1, maxLength: 256 });
        if (!username || !password) {
          await logSecurityEvent({
            category: "auth.login.invalid_payload",
            actor: username || "anonymous",
            ip: clientIp,
            path: url.pathname,
            method: req.method,
            status: 400,
            message: "Valid username/password are required"
          });
          json(res, 400, { error: "Valid username/password are required" });
          return true;
        }

        const normalizedUsername = String(username || "").trim().toLowerCase();
        const loginUsername = normalizedUsername === "pickup" ? "dispatch" : normalizedUsername;
        const limiterResult = loginRateLimiter.hit(`${clientIp}:${loginUsername}`);
        if (!limiterResult.allowed) {
          res.setHeader("Retry-After", String(limiterResult.retryAfterSec));
          await logSecurityEvent({
            category: "auth.login.rate_limited",
            actor: loginUsername,
            ip: clientIp,
            path: url.pathname,
            method: req.method,
            status: 429,
            message: `Too many login attempts. Retry after ${limiterResult.retryAfterSec}s`
          });
          json(res, 429, { error: "Too many login attempts. Please try again later." });
          return true;
        }

        const user = await userRepository.findLoginUserByUsername(loginUsername);

        if (!user || !verifyHashedPassword(password, user.password_hash)) {
          await logSecurityEvent({
            category: "auth.login.failed",
            actor: loginUsername,
            ip: clientIp,
            path: url.pathname,
            method: req.method,
            status: 401,
            message: "Invalid username or password"
          });
          json(res, 401, { error: "Invalid username or password" });
          return true;
        }

        const session = sessionStore.createFromUser(user);
        await logSecurityEvent({
          category: "auth.login.success",
          actor: session.username,
          ip: clientIp,
          path: url.pathname,
          method: req.method,
          status: 200,
          message: `Successful login (${session.role})`
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
        return true;
      } catch (error) {
        const clientIp = getClientIp(req, { trustProxy });
        await logSecurityEvent({
          category: "auth.login.invalid_json",
          actor: "anonymous",
          ip: clientIp,
          path: url.pathname,
          method: req.method,
          status: 400,
          message: error.message
        });
        json(res, 400, { error: error.message });
        return true;
      }
    })();
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
      await logSecurityEvent({
        category: "auth.logout",
        actor: session.username,
        ip: getClientIp(req, { trustProxy }),
        path: url.pathname,
        method: req.method,
        status: 200,
        message: "User logged out"
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
