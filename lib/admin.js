const { parseCookies, serializeCookie, clearCookie } = require('./cookies');

function getAdminEmailFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies.adminEmail || '';
}

function getAdminEmailList(env = process.env) {
  return (env.ADMIN_EMAILS || 'admin@example.com').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
}

function isAdminEmail(email, env = process.env) {
  return getAdminEmailList(env).includes(String(email || '').trim().toLowerCase());
}

function isAdminRequest(req, env = process.env) {
  const headerValue = req.headers['x-admin-email'] || '';
  const cookieValue = getAdminEmailFromRequest(req);

  if (process.env.NODE_ENV === 'test' && headerValue) {
    return isAdminEmail(headerValue, env);
  }

  return Boolean(cookieValue && isAdminEmail(cookieValue, env));
}

function getAdminCookieValue(email) {
  return serializeCookie('adminEmail', email, { maxAgeSeconds: 86400 });
}

function getAdminClearCookieValue() {
  return clearCookie('adminEmail');
}

module.exports = {
  getAdminEmailFromRequest,
  isAdminRequest,
  getAdminCookieValue,
  getAdminClearCookieValue,
  getAdminEmailList,
  isAdminEmail,
};
