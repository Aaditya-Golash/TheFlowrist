const test = require('node:test');
const assert = require('node:assert/strict');

const app = require('../server');

const request = async (path) => {
  const server = app.listen(0);
  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const res = await fetch(`${baseUrl}${path}`);
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    server.close();
  }
};

test('health endpoint returns ok', async () => {
  const response = await request('/health');
  assert.equal(response.status, 200);
  assert.match(response.text, /ok/i);
});

test('root endpoint returns service info', async () => {
  const response = await request('/');
  assert.equal(response.status, 200);
  assert.match(response.text, /TheFlowrist/i);
});
