const crypto = require("node:crypto");

function parseAllowedStations(rawValue) {
  try {
    const parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function createSessionStore() {
  const sessions = new Map();

  function createFromUser(user) {
    const allowedStations = parseAllowedStations(user.allowed_stations);
    const token = crypto.randomUUID();
    const session = {
      token,
      userId: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      allowedStations,
      homeStation: allowedStations[0]
    };
    sessions.set(token, session);
    return session;
  }

  function getByToken(token) {
    if (!token || !sessions.has(token)) {
      return null;
    }
    return sessions.get(token);
  }

  function getFromRequest(req) {
    const header = req?.headers?.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    return getByToken(token);
  }

  function deleteByToken(token) {
    if (!token) return;
    sessions.delete(token);
  }

  return {
    createFromUser,
    getByToken,
    getFromRequest,
    deleteByToken
  };
}

module.exports = {
  createSessionStore,
  parseAllowedStations
};
