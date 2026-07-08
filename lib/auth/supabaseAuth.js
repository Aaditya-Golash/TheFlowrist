const { createClient } = require('@supabase/supabase-js');
const { parseCookies, serializeCookie, clearCookie } = require('../cookies');
const { validateSupabaseAuthEnvironment } = require('../supabase-env');
const { isAdminEmail } = require('../admin');
const { getState, setState } = require('../store');

const ACCESS_COOKIE = 'sbAccessToken';
const REFRESH_COOKIE = 'sbRefreshToken';
const DEFAULT_MAX_AGE_SECONDS = 3600;
const REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function createSupabaseAuthAdapter(env = process.env, { createClient: createClientImpl = createClient } = {}) {
  const { supabaseUrl, anonKey } = validateSupabaseAuthEnvironment(env);

  let client = null;
  function getClient() {
    if (!client) {
      if (typeof globalThis.WebSocket === 'undefined') {
        globalThis.WebSocket = require('ws');
      }
      client = createClientImpl(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
    return client;
  }

  function getSessionFromRequest(req) {
    const cookies = parseCookies(req.headers.cookie || '');
    const accessToken = cookies[ACCESS_COOKIE] || '';
    const refreshToken = cookies[REFRESH_COOKIE] || '';
    return accessToken ? { accessToken, refreshToken } : null;
  }

  async function getCurrentUser(req) {
    const session = getSessionFromRequest(req);
    if (!session) {
      return null;
    }
    const { data, error } = await getClient().auth.getUser(session.accessToken);
    if (error || !data || !data.user || !data.user.email) {
      return null;
    }
    return { email: data.user.email, id: data.user.id };
  }

  function resolveCustomerForUser(authUser) {
    const state = getState();
    state.users = state.users || [];
    let customer = state.users.find((entry) => entry.email && entry.email.toLowerCase() === authUser.email.toLowerCase());
    if (!customer) {
      const now = new Date().toISOString();
      customer = {
        id: `customer-${authUser.id || Date.now()}`,
        name: authUser.email.split('@')[0],
        email: authUser.email,
        phone: '',
        marketingEmailConsent: false,
        marketingSmsConsent: false,
        createdAt: now,
        updatedAt: now,
      };
      state.users.push(customer);
      setState(state);
    }
    return customer;
  }

  async function requireUser(req, res) {
    const authUser = await getCurrentUser(req);
    if (!authUser) {
      res.writeHead(302, { Location: '/login' });
      res.end();
      return null;
    }
    return resolveCustomerForUser(authUser);
  }

  async function requireAdmin(req, res) {
    const authUser = await getCurrentUser(req);
    if (!authUser) {
      res.writeHead(302, { Location: '/admin/login' });
      res.end();
      return false;
    }
    if (!isAdminEmail(authUser.email, env)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('That account is not authorized for admin access.');
      return false;
    }
    return true;
  }

  async function signInWithEmailPassword(email, password) {
    if (!email || !password) {
      return { ok: false, error: 'Email and password are required.' };
    }
    const { data, error } = await getClient().auth.signInWithPassword({ email, password });
    if (error || !data || !data.session) {
      return { ok: false, error: (error && error.message) || 'Invalid email or password.' };
    }
    return { ok: true, session: data.session };
  }

  function createSessionCookies(res, session) {
    const accessMaxAge = session.expires_in ? Math.floor(session.expires_in) : DEFAULT_MAX_AGE_SECONDS;
    res.setHeader('Set-Cookie', [
      serializeCookie(ACCESS_COOKIE, session.access_token, { maxAgeSeconds: accessMaxAge }),
      serializeCookie(REFRESH_COOKIE, session.refresh_token, { maxAgeSeconds: REFRESH_MAX_AGE_SECONDS }),
    ]);
  }

  function clearSessionCookies(res) {
    res.setHeader('Set-Cookie', [clearCookie(ACCESS_COOKIE), clearCookie(REFRESH_COOKIE)]);
  }

  function signOut(req, res) {
    clearSessionCookies(res);
  }

  return {
    backend: 'supabase',
    getCurrentUser,
    requireUser,
    requireAdmin,
    signInWithEmailPassword,
    signOut,
    createSessionCookies,
    clearSessionCookies,
  };
}

module.exports = {
  createSupabaseAuthAdapter,
};
