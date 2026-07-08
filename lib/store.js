const { jsonStorageAdapter, writeSeedData, resetData } = require('./storage-adapter');
const { createSupabaseStore } = require('./supabaseStore');
const { validateSupabaseEnvironment } = require('./supabase-env');

let activeAdapter = null;

function resolveStorageAdapter(env = process.env) {
  const backend = String(env.STORAGE_BACKEND || 'json').toLowerCase();
  if (backend === 'json') {
    return jsonStorageAdapter;
  }

  if (backend === 'supabase') {
    validateSupabaseEnvironment(env);
    return createSupabaseStore(env);
  }

  throw new Error(`Unsupported STORAGE_BACKEND: ${backend}`);
}

function initializeStorageAdapter(env = process.env) {
  activeAdapter = resolveStorageAdapter(env);
  return activeAdapter;
}

function setStorageAdapter(adapter) {
  activeAdapter = adapter;
  return activeAdapter;
}

function getStorageAdapter() {
  if (!activeAdapter) {
    initializeStorageAdapter();
  }
  return activeAdapter;
}

function ensureStore() {
  return getStorageAdapter().getState();
}

function saveStore(state) {
  return getStorageAdapter().saveState(state);
}

function getState() {
  return ensureStore();
}

function setState(nextState) {
  return saveStore(nextState);
}

module.exports = {
  getState,
  setState,
  writeSeedData,
  resetData,
  setStorageAdapter,
  getStorageAdapter,
  resolveStorageAdapter,
  initializeStorageAdapter,
};
