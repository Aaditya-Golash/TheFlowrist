function ensureWebSocketShim() {
  if (typeof globalThis.WebSocket === 'undefined') {
    globalThis.WebSocket = require('ws');
  }
}

module.exports = {
  ensureWebSocketShim,
};
