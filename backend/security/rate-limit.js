function createSlidingWindowRateLimiter(options = {}) {
  const max = Number.isInteger(options.max) ? options.max : 10;
  const windowMs = Number.isInteger(options.windowMs) ? options.windowMs : 60000;
  const buckets = new Map();

  function now() {
    return Date.now();
  }

  function prune(key, currentTime) {
    const list = buckets.get(key);
    if (!list || !list.length) {
      buckets.delete(key);
      return [];
    }

    const active = list.filter((value) => currentTime - value < windowMs);
    if (active.length) {
      buckets.set(key, active);
      return active;
    }
    buckets.delete(key);
    return [];
  }

  function hit(key) {
    const currentTime = now();
    const active = prune(key, currentTime);
    if (active.length >= max) {
      const retryAfterMs = Math.max(0, windowMs - (currentTime - active[0]));
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000))
      };
    }

    active.push(currentTime);
    buckets.set(key, active);
    return {
      allowed: true,
      remaining: Math.max(0, max - active.length),
      retryAfterSec: 0
    };
  }

  return {
    hit
  };
}

module.exports = {
  createSlidingWindowRateLimiter
};
