const test = require('node:test');
const assert = require('node:assert/strict');

const app = require('../server');
const {
  calculatePlannedChargeDate,
  createScheduledOrderFromMilestone,
  getServiceZoneForPostalCode,
  isPostalCodeInZone,
  calculateEstimatedPrice,
} = require('../lib/logic');

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

test('scheduled order dates calculate correctly', () => {
  assert.equal(calculatePlannedChargeDate('2026-08-15', 5), '2026-08-10');
});

test('pricing helper returns correct tier price plus delivery fee', () => {
  assert.equal(calculateEstimatedPrice('premium', 1200), 20700);
});

test('out-of-zone postal code is flagged', () => {
  const zones = [{
    id: 'zone-1',
    name: 'Downtown Toronto',
    prefixes: ['M5'],
    active: true,
    deliveryFeeCents: 1200,
  }];

  assert.equal(getServiceZoneForPostalCode(zones, 'L4B'), null);
  assert.equal(isPostalCodeInZone('L4B', zones), false);
});

test('scheduled orders are created from milestones with charge date and pricing', () => {
  const milestone = {
    id: 'm1',
    userId: 'u1',
    recipientId: 'r1',
    eventDate: '2026-08-15',
    chargeDaysBefore: 5,
    budgetTier: 'signature',
    status: 'active',
  };

  const order = createScheduledOrderFromMilestone(milestone, { id: 'u1' }, { id: 'zone-1', deliveryFeeCents: 1200 });

  assert.equal(order.status, 'scheduled');
  assert.equal(order.plannedChargeDate, '2026-08-10');
  assert.equal(order.estimatedCustomerPriceCents, 28700);
});
