const { jsonStorageAdapter, writeSeedData, resetData } = require('./storage-adapter');

let activeAdapter = jsonStorageAdapter;

function setStorageAdapter(adapter) {
  activeAdapter = adapter;
  return activeAdapter;
}

function getStorageAdapter() {
  return activeAdapter;
}

function ensureStore() {
  return activeAdapter.getState();
}

function saveStore(state) {
  return activeAdapter.saveState(state);
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
};
