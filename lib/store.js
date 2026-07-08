const fs = require('fs');
const path = require('path');
const { ensureDataFile, writeSeedData, resetData } = require('./seed');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'app-data.json');

function ensureStore() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveStore(state) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function getState() {
  return ensureStore();
}

function setState(nextState) {
  saveStore(nextState);
  return nextState;
}

module.exports = {
  getState,
  setState,
  writeSeedData,
  resetData,
};
