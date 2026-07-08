const pilotAuth = require('./pilotAuth');
const { createSupabaseAuthAdapter } = require('./supabaseAuth');

let activeAdapter = null;

function resolveAuthBackend(env = process.env) {
  const backend = String(env.AUTH_BACKEND || 'pilot').toLowerCase();
  if (backend !== 'pilot' && backend !== 'supabase') {
    throw new Error(`Unsupported AUTH_BACKEND: ${backend}`);
  }
  return backend;
}

function resolveAuthAdapter(env = process.env) {
  const backend = resolveAuthBackend(env);
  if (backend === 'pilot') {
    return pilotAuth;
  }
  return createSupabaseAuthAdapter(env);
}

function initializeAuthAdapter(env = process.env) {
  activeAdapter = resolveAuthAdapter(env);
  return activeAdapter;
}

function setAuthAdapter(adapter) {
  activeAdapter = adapter;
  return activeAdapter;
}

function getAuthAdapter() {
  if (!activeAdapter) {
    initializeAuthAdapter();
  }
  return activeAdapter;
}

function resetAuthAdapter() {
  activeAdapter = null;
}

module.exports = {
  resolveAuthBackend,
  resolveAuthAdapter,
  initializeAuthAdapter,
  setAuthAdapter,
  getAuthAdapter,
  resetAuthAdapter,
};
