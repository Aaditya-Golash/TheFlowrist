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

function getAdminEmailFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies.adminEmail || '';
}

function isAdminRequest(req, env = process.env) {
  const adminEmails = (env.ADMIN_EMAILS || 'admin@example.com').split(',').map((email) => email.trim()).filter(Boolean);
  const headerValue = req.headers['x-admin-email'] || '';
  const cookieValue = getAdminEmailFromRequest(req);

  if (process.env.NODE_ENV === 'test' && headerValue) {
    return adminEmails.includes(String(headerValue));
  }

  return Boolean(cookieValue && adminEmails.includes(String(cookieValue)));
}

function getAdminCookieValue(email) {
  return `adminEmail=${encodeURIComponent(email)}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax`;
}

module.exports = {
  getAdminEmailFromRequest,
  isAdminRequest,
  getAdminCookieValue,
};
