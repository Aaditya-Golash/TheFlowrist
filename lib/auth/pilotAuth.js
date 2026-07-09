const { parseCookies, serializeCookie, clearCookie } = require('../cookies');
const { isAdminRequest, getAdminCookieValue, getAdminClearCookieValue } = require('../admin');
const { getState } = require('../store');

const CUSTOMER_COOKIE = 'pilotCustomerEmail';

function getCurrentUser(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const email = cookies[CUSTOMER_COOKIE] || '';
  return email ? { email } : null;
}

async function resolveCustomer(req) {
  const state = await getState();
  const current = getCurrentUser(req);
  if (current) {
    const match = (state.users || []).find((user) => user.email === current.email);
    if (match) {
      return match;
    }
  }
  return (state.users || [])[0] || null;
}

async function requireUser(req) {
  return resolveCustomer(req);
}

function requireAdmin(req, res) {
  if (!isAdminRequest(req)) {
    res.writeHead(302, { Location: '/admin/login' });
    res.end();
    return false;
  }
  return true;
}

function signInWithEmailPassword(email) {
  if (!email) {
    return { ok: false, error: 'Email is required for local pilot login.' };
  }
  return { ok: true, session: { email } };
}

function createSessionCookies(res, session) {
  res.setHeader('Set-Cookie', serializeCookie(CUSTOMER_COOKIE, session.email, { maxAgeSeconds: 86400 }));
}

function clearSessionCookies(res) {
  res.setHeader('Set-Cookie', clearCookie(CUSTOMER_COOKIE));
}

function signOut(req, res) {
  clearSessionCookies(res);
}

module.exports = {
  backend: 'pilot',
  getCurrentUser,
  requireUser,
  requireAdmin,
  signInWithEmailPassword,
  signOut,
  createSessionCookies,
  clearSessionCookies,
  adminCookieHelpers: { getAdminCookieValue, getAdminClearCookieValue },
};
