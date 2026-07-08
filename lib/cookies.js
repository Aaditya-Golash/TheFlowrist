function parseCookies(cookieHeader) {
  return (cookieHeader || '')
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .reduce((accumulator, chunk) => {
      const separatorIndex = chunk.indexOf('=');
      if (separatorIndex === -1) {
        return accumulator;
      }
      const key = chunk.slice(0, separatorIndex).trim();
      const value = decodeURIComponent(chunk.slice(separatorIndex + 1).trim());
      accumulator[key] = value;
      return accumulator;
    }, {});
}

function isProduction(env = process.env) {
  return String(env.NODE_ENV || '').toLowerCase() === 'production';
}

function serializeCookie(name, value, options = {}) {
  const {
    maxAgeSeconds,
    httpOnly = true,
    sameSite = 'Lax',
    path = '/',
    secure,
    env = process.env,
  } = options;
  const shouldBeSecure = secure === undefined ? isProduction(env) : secure;
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`];
  if (maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  }
  if (httpOnly) {
    parts.push('HttpOnly');
  }
  if (sameSite) {
    parts.push(`SameSite=${sameSite}`);
  }
  if (shouldBeSecure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function clearCookie(name, options = {}) {
  return serializeCookie(name, '', { ...options, maxAgeSeconds: 0 });
}

module.exports = {
  parseCookies,
  serializeCookie,
  clearCookie,
  isProduction,
};
