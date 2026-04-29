function createSecurityEventService(securityEventRepository, options = {}) {
  const nowIso = options.nowIso || (() => new Date().toISOString());

  function logSecurityEvent(event = {}) {
    const createdAt = nowIso();
    const category = String(event.category || "security.unknown");
    const actor = String(event.actor || "anonymous");
    const ip = String(event.ip || "unknown");
    const path = String(event.path || "");
    const method = String(event.method || "");
    const status = Number.isInteger(event.status) ? event.status : 0;
    const message = String(event.message || "");

    securityEventRepository.insertSecurityEvent({
      category,
      actor,
      ip,
      path,
      method,
      status,
      message,
      createdAt
    });
  }

  function listSecurityEvents(limit = 50, category = null) {
    const normalizedLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 200)) : 50;
    return securityEventRepository.listSecurityEvents(normalizedLimit, category);
  }

  return {
    logSecurityEvent,
    listSecurityEvents
  };
}

module.exports = {
  createSecurityEventService
};
