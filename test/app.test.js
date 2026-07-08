const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const app = require('../server');
const { writeSeedData } = require('../lib/seed');
const { resolveStorageAdapter } = require('../lib/store');
const { createSupabaseStore } = require('../lib/supabaseStore');
const {
  calculatePlannedChargeDate,
  createScheduledOrderFromMilestone,
  getServiceZoneForPostalCode,
  isPostalCodeInZone,
  calculateEstimatedPrice,
  generateNextYearlyOccurrence,
  normalizePostalCode,
  isValidCanadianPostalCode,
} = require('../lib/logic');

const request = async (path, { method = 'GET', body, headers } = {}) => {
  const server = app.listen(0);
  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body,
      redirect: 'manual',
    });
    const text = await res.text();
    return { status: res.status, text, headers: res.headers };
  } finally {
    server.close();
  }
};

const resetData = () => {
  process.env.NODE_ENV = 'test';
  process.env.ADMIN_EMAILS = 'admin@example.com';
  process.env.INTERNAL_API_SECRET = 'test-secret';
  writeSeedData();
};

test('health endpoint returns ok', async () => {
  resetData();
  const response = await request('/health');
  assert.equal(response.status, 200);
  assert.match(response.text, /ok/i);
});

test('root endpoint returns service info', async () => {
  resetData();
  const response = await request('/');
  assert.equal(response.status, 200);
  assert.match(response.text, /TheFlowrist/i);
});

test('scheduled order dates calculate correctly', () => {
  resetData();
  assert.equal(calculatePlannedChargeDate('2026-08-15', 5), '2026-08-10');
});

test('pricing helper returns correct tier price plus delivery fee', () => {
  resetData();
  assert.equal(calculateEstimatedPrice('premium', 1200), 20700);
});

test('out-of-zone postal code is flagged', () => {
  resetData();
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
  resetData();
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

test('postal code normalization and annual occurrence helpers work', () => {
  resetData();
  assert.equal(normalizePostalCode('m5v2t6'), 'M5V 2T6');
  assert.equal(isValidCanadianPostalCode('M5V 2T6'), true);
  assert.equal(generateNextYearlyOccurrence('2026-08-15'), '2027-08-15');
});

test('admin login cookie behavior works', async () => {
  resetData();
  const loginResponse = await request('/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'email=admin@example.com',
  });
  assert.equal(loginResponse.status, 302);
  assert.match(loginResponse.headers.get('set-cookie') || '', /adminEmail/);

  const adminResponse = await request('/admin', {
    headers: { cookie: 'adminEmail=admin@example.com' },
  });
  assert.equal(adminResponse.status, 200);
});

test('admin status update creates event log', async () => {
  resetData();
  const state = require('../lib/store').getState();
  const order = state.orders[0];
  const response = await request(`/admin/orders/${order.id}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: 'adminEmail=admin@example.com',
    },
    body: 'status=pending_charge&supportMinutes=20',
  });
  assert.equal(response.status, 302);
  const nextState = require('../lib/store').getState();
  const updatedOrder = nextState.orders.find((entry) => entry.id === order.id);
  const createdEvent = nextState.orderEvents.find((entry) => entry.orderId === order.id && entry.message.includes('pending_charge'));
  assert.equal(updatedOrder.status, 'pending_charge');
  assert.ok(createdEvent);
});

test('payment consent create and revoke work', async () => {
  resetData();
  const consentResponse = await request('/account/payment-consent', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'consent=true',
  });
  assert.equal(consentResponse.status, 302);
  const state = require('../lib/store').getState();
  const consent = state.paymentConsents[state.paymentConsents.length - 1];
  assert.equal(consent.active, true);

  const revokeResponse = await request('/account/payment-consent/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `consentId=${consent.id}`,
  });
  assert.equal(revokeResponse.status, 302);
  const nextState = require('../lib/store').getState();
  const revokedConsent = nextState.paymentConsents.find((entry) => entry.id === consent.id);
  assert.equal(revokedConsent.active, false);
});

test('milestone pause updates milestone status', async () => {
  resetData();
  const state = require('../lib/store').getState();
  const milestone = state.milestones[0];
  const response = await request(`/milestones/${milestone.id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'action=pause',
  });
  assert.equal(response.status, 302);
  const nextState = require('../lib/store').getState();
  const updatedMilestone = nextState.milestones.find((entry) => entry.id === milestone.id);
  assert.equal(updatedMilestone.status, 'paused');
});

test('admin can assign florist', async () => {
  resetData();
  const state = require('../lib/store').getState();
  const order = state.orders[0];
  const florist = state.floristPartners[0];
  const response = await request(`/admin/orders/${order.id}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: 'adminEmail=admin@example.com',
    },
    body: `status=scheduled&floristPartnerId=${florist.id}`,
  });
  assert.equal(response.status, 302);
  const nextState = require('../lib/store').getState();
  const updatedOrder = nextState.orders.find((entry) => entry.id === order.id);
  assert.equal(updatedOrder.floristPartnerId, florist.id);
});

test('json storage adapter still works', () => {
  resetData();
  const adapter = require('../lib/store').getStorageAdapter();
  const state = adapter.getState();
  assert.ok(state.orders.length >= 1);
  assert.equal(adapter.listScheduledOrders().length, state.orders.length);
});

test('storage backend defaults to JSON', () => {
  const adapter = resolveStorageAdapter({ STORAGE_BACKEND: 'json' });
  assert.equal(typeof adapter.getState, 'function');
  assert.equal(typeof adapter.saveState, 'function');
});

test('invalid storage backend fails clearly', () => {
  assert.throws(() => resolveStorageAdapter({ STORAGE_BACKEND: 'redis' }), /STORAGE_BACKEND/i);
});

test('supabase backend requires env vars', () => {
  assert.throws(() => resolveStorageAdapter({ STORAGE_BACKEND: 'supabase' }), /SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY/i);
});

test('supabase adapter exports the expected interface', () => {
  const adapter = createSupabaseStore({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  });
  const requiredMethods = [
    'getState',
    'saveState',
    'listCustomers',
    'getCustomerById',
    'createRecipient',
    'updateRecipient',
    'createMilestone',
    'updateMilestone',
    'listScheduledOrders',
    'getScheduledOrderById',
    'createScheduledOrder',
    'updateScheduledOrder',
    'createOrderEventLog',
    'listOrderEventLogs',
    'createPaymentConsent',
    'revokePaymentConsent',
    'listFloristPartners',
    'createFloristPartner',
    'updateFloristPartner',
    'listServiceZones',
  ];
  requiredMethods.forEach((method) => {
    assert.equal(typeof adapter[method], 'function');
  });
});

test('internal endpoints reject missing secret', async () => {
  resetData();
  const response = await request('/internal/orders/upcoming');
  assert.equal(response.status, 401);
});

test('internal endpoints accept valid secret and return JSON', async () => {
  resetData();
  const response = await request('/internal/orders/upcoming', {
    headers: { 'x-internal-api-secret': 'test-secret' },
  });
  assert.equal(response.status, 200);
  const payload = JSON.parse(response.text);
  assert.ok(Array.isArray(payload.orders));
});

test('internal event endpoint creates an order event log', async () => {
  resetData();
  const state = require('../lib/store').getState();
  const order = state.orders[0];
  const response = await request(`/internal/orders/${order.id}/event`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-internal-api-secret': 'test-secret',
    },
    body: 'message=Reminder queued',
  });
  assert.equal(response.status, 200);
  const nextState = require('../lib/store').getState();
  const createdEvent = nextState.orderEvents.find((entry) => entry.orderId === order.id && entry.message === 'Reminder queued');
  assert.ok(createdEvent);
});

test('internal status endpoint updates order status and logs it', async () => {
  resetData();
  const state = require('../lib/store').getState();
  const order = state.orders[0];
  const response = await request(`/internal/orders/${order.id}/status`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-internal-api-secret': 'test-secret',
    },
    body: 'status=pending_charge',
  });
  assert.equal(response.status, 200);
  const nextState = require('../lib/store').getState();
  const updatedOrder = nextState.orders.find((entry) => entry.id === order.id);
  const createdEvent = nextState.orderEvents.find((entry) => entry.orderId === order.id && entry.message.includes('pending_charge'));
  assert.equal(updatedOrder.status, 'pending_charge');
  assert.ok(createdEvent);
});

test('check script env validation fails clearly', () => {
  const { validateSupabaseEnvironment } = require('../scripts/check-supabase');
  assert.throws(() => validateSupabaseEnvironment({}), /SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY/i);
});

test('smoke script env validation fails clearly', () => {
  const { validateSupabaseEnvironment } = require('../scripts/smoke-supabase');
  assert.throws(() => validateSupabaseEnvironment({}), /SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY/i);
});

test('migration dry-run does not require writing', async () => {
  const { runMigration } = require('../scripts/migrate-json-to-supabase');
  const result = await runMigration({
    env: {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    },
    dryRun: true,
    dataFilePath: path.join(__dirname, '..', 'data', 'app-data.json'),
    createClient: () => ({
      from: () => ({
        upsert: () => ({ select: () => ({ then: () => ({ catch: () => {} }) }) }),
      }),
    }),
  });
  assert.equal(result.dryRun, true);
  assert.ok(result.summary);
});

test('supabase key fallback logic works', () => {
  const { getSupabaseConfig } = require('../lib/supabase-env');
  const config = getSupabaseConfig({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SECRET_KEY: 'fallback-secret',
  });
  assert.equal(config.serviceRoleKey, 'fallback-secret');
});

test('scripts do not log secret values', async () => {
  const { runMigration } = require('../scripts/migrate-json-to-supabase');
  const lines = [];
  const result = await runMigration({
    env: {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'super-secret-value',
    },
    dryRun: true,
    dataFilePath: path.join(__dirname, '..', 'data', 'app-data.json'),
    logger: (message) => lines.push(message),
  });
  assert.equal(result.dryRun, true);
  assert.equal(lines.join('\n').includes('super-secret-value'), false);
});
