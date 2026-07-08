function createRateLimiter({ windowMs = 15 * 60 * 1000, maxAttempts = 5 } = {}) {
  const attempts = new Map();

  function keyFor(req, email) {
    const forwardedFor = req.headers['x-forwarded-for'] || '';
    const ip = String(forwardedFor).split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
    return `${ip}::${String(email || '').trim().toLowerCase()}`;
  }

  function check(req, email) {
    const key = keyFor(req, email);
    const now = Date.now();
    const entry = attempts.get(key);
    if (!entry || entry.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true };
    }
    if (entry.count >= maxAttempts) {
      return { allowed: false, retryAfterMs: entry.resetAt - now };
    }
    entry.count += 1;
    return { allowed: true };
  }

  function reset(req, email) {
    attempts.delete(keyFor(req, email));
  }

  function clear() {
    attempts.clear();
  }

  return { check, reset, clear };
}

const loginRateLimiter = createRateLimiter();
const adminLoginRateLimiter = createRateLimiter();

function resetAllRateLimiters() {
  loginRateLimiter.clear();
  adminLoginRateLimiter.clear();
}

module.exports = {
  createRateLimiter,
  loginRateLimiter,
  adminLoginRateLimiter,
  resetAllRateLimiters,
};
