const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const app = require('../server');
const { writeSeedData } = require('../lib/seed');
const { resolveStorageAdapter } = require('../lib/store');
const { createSupabaseStore } = require('../lib/supabaseStore');
const { resolveAuthBackend, resetAuthAdapter, setAuthAdapter } = require('../lib/auth');
const { createSupabaseAuthAdapter } = require('../lib/auth/supabaseAuth');
const { buildReadiness, validateProductionEnvironment } = require('../lib/env-check');
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
  process.env.STORAGE_BACKEND = 'json';
  process.env.AUTH_BACKEND = 'pilot';
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  resetAuthAdapter();
  writeSeedData();
};

const getSetCookies = (headers) => (
  typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie') || '']
);

test('health endpoint returns ok', async () => {
  resetData();
  const response = await request('/health');
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.text), { status: 'ok' });
  assert.doesNotMatch(response.text, /environment|production|development|test/i);
});

test('root endpoint returns service info', async () => {
  resetData();
  const response = await request('/');
  assert.equal(response.status, 200);
  assert.match(response.text, /TheFlowrist/i);
});

test('landing page includes key trust copy', async () => {
  resetData();
  const response = await request('/');
  assert.equal(response.status, 200);
  assert.match(response.text, /no weekly subscription/i);
  assert.match(response.text, /pause or cancel/i);
  assert.match(response.text, /designer's[- ]choice/i);
  assert.match(response.text, /toronto/i);
  assert.match(response.text, /reminder/i);
});

test('payment page includes no-charge-today copy', async () => {
  resetData();
  const response = await request('/account/payment-consent');
  assert.equal(response.status, 200);
  assert.match(response.text, /not charged today/i);
  assert.match(response.text, /remind you before/i);
  assert.match(response.text, /pause or cancel/i);
});

test('dashboard includes add important date CTA', async () => {
  resetData();
  const response = await request('/dashboard');
  assert.equal(response.status, 200);
  assert.match(response.text, /add another important date/i);
});

test('admin order detail still renders', async () => {
  resetData();
  const state = require('../lib/store').getState();
  const order = state.orders[0];
  const response = await request(`/admin/orders/${order.id}`, {
    headers: { cookie: 'adminEmail=admin%40example.com' },
  });
  assert.equal(response.status, 200);
  assert.match(response.text, /Planned charge date/i);
  assert.match(response.text, /Customer:/i);
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
  assert.match(response.headers.get('content-type') || '', /application\/json/);
  assert.deepEqual(JSON.parse(response.text), { error: 'unauthorized' });
  assert.doesNotMatch(response.text, /stack|SUPABASE|INTERNAL_API_SECRET|test-secret/i);
});

test('internal endpoints reject wrong secret and fail closed when unconfigured', async () => {
  resetData();
  const wrongSecretResponse = await request('/internal/orders/needing-reminder', {
    headers: { 'x-internal-api-secret': 'wrong-secret' },
  });
  assert.equal(wrongSecretResponse.status, 401);
  assert.match(wrongSecretResponse.headers.get('content-type') || '', /application\/json/);
  assert.deepEqual(JSON.parse(wrongSecretResponse.text), { error: 'unauthorized' });

  delete process.env.INTERNAL_API_SECRET;
  const unconfiguredResponse = await request('/internal/orders/upcoming', {
    headers: { 'x-internal-api-secret': 'anything' },
  });
  assert.equal(unconfiguredResponse.status, 401);
  assert.deepEqual(JSON.parse(unconfiguredResponse.text), { error: 'unauthorized' });
});

test('internal endpoints accept valid secret and return JSON', async () => {
  resetData();
  const response = await request('/internal/orders/upcoming', {
    headers: { 'x-internal-api-secret': 'test-secret' },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /application\/json/);
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
  const { runSmoke } = require('../scripts/smoke-supabase');
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

  const smokeLines = [];
  const chain = {
    select: () => Promise.resolve({ data: [{ id: 'row-1', status: 'pending_charge', active: false }], error: null }),
    update: () => chain,
    eq: () => chain,
    then: (resolve, reject) => Promise.resolve({ data: [{ id: 'row-1', status: 'pending_charge', active: false }], error: null }).then(resolve, reject),
  };
  await runSmoke({
    env: {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'super-secret-value',
    },
    logger: (message) => smokeLines.push(message),
    createClient: () => ({
      from: () => ({
        upsert: () => chain,
        update: () => chain,
        select: () => chain,
      }),
    }),
  });
  const smokeOutput = smokeLines.join('\n');
  assert.equal(smokeOutput.includes('super-secret-value'), false);
  assert.equal(smokeOutput.includes('pilot-smoke-test@example.com'), false);
});

test('AUTH_BACKEND defaults to pilot', () => {
  assert.equal(resolveAuthBackend({}), 'pilot');
  assert.equal(resolveAuthBackend({ AUTH_BACKEND: 'pilot' }), 'pilot');
});

test('invalid AUTH_BACKEND fails clearly', () => {
  assert.throws(() => resolveAuthBackend({ AUTH_BACKEND: 'firebase' }), /AUTH_BACKEND/i);
});

test('supabase auth backend requires env vars', () => {
  assert.throws(() => createSupabaseAuthAdapter({}), /SUPABASE_URL|SUPABASE_ANON_KEY/i);
});

test('pilot login sets a customer session cookie', async () => {
  resetData();
  const response = await request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'email=mina@example.com',
  });
  assert.equal(response.status, 302);
  const cookies = getSetCookies(response.headers).join('; ');
  assert.match(cookies, /pilotCustomerEmail=/);
  assert.match(cookies, /HttpOnly/);
  assert.match(cookies, /SameSite=Lax/);
});

test('logout clears session cookie', async () => {
  resetData();
  const response = await request('/logout', { method: 'POST' });
  assert.equal(response.status, 302);
  const cookies = getSetCookies(response.headers).join('; ');
  assert.match(cookies, /pilotCustomerEmail=.*Max-Age=0/);
});

test('admin guard still works in pilot mode', async () => {
  resetData();
  const response = await request('/admin', { headers: { cookie: 'adminEmail=someone-else@example.com' } });
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location') || '', /\/admin\/login/);
});

test('x-admin-email header is ignored outside test mode', async () => {
  resetData();
  process.env.NODE_ENV = 'development';
  try {
    const response = await request('/admin', { headers: { 'x-admin-email': 'admin@example.com' } });
    assert.equal(response.status, 302);
    assert.match(response.headers.get('location') || '', /\/admin\/login/);
  } finally {
    resetData();
  }
});

test('non-admin email is rejected by admin guard', async () => {
  const adapter = createSupabaseAuthAdapter(
    {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
      ADMIN_EMAILS: 'admin@example.com',
    },
    {
      createClient: () => ({
        auth: {
          getUser: async () => ({ data: { user: { email: 'notadmin@example.com', id: 'user-1' } }, error: null }),
        },
      }),
    },
  );
  const req = { headers: { cookie: 'sbAccessToken=fake-token' } };
  const headers = {};
  const res = {
    writeHead(status, responseHeaders) { this.statusCode = status; Object.assign(headers, responseHeaders); },
    end() {},
  };
  const allowed = await adapter.requireAdmin(req, res);
  assert.equal(allowed, false);
  assert.equal(res.statusCode, 403);
});

test('customer-protected routes redirect to login in Supabase mode when unauthenticated', async () => {
  resetData();
  process.env.AUTH_BACKEND = 'supabase';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  resetAuthAdapter();
  try {
    const response = await request('/dashboard');
    assert.equal(response.status, 302);
    assert.match(response.headers.get('location') || '', /\/login/);
  } finally {
    resetData();
  }
});

test('account and payment routes redirect to login in Supabase mode when unauthenticated', async () => {
  resetData();
  process.env.AUTH_BACKEND = 'supabase';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  resetAuthAdapter();
  try {
    for (const route of ['/account', '/account/payment-consent']) {
      const response = await request(route);
      assert.equal(response.status, 302);
      assert.match(response.headers.get('location') || '', /\/login/);
    }
  } finally {
    resetData();
  }
});

test('/ready returns JSON', async () => {
  resetData();
  const response = await request('/ready');
  assert.ok(response.status === 200 || response.status === 503);
  const payload = JSON.parse(response.text);
  assert.equal(typeof payload.ready, 'boolean');
  assert.ok(payload.checks);
  assert.doesNotMatch(response.text, /test-secret|service-role|anon-key|sbAccessToken|sbRefreshToken/i);
  assert.equal(payload.checks.storageBackend.backend, 'json');
  assert.equal(payload.checks.authBackend.backend, 'pilot');
  assert.equal(payload.checks.internalApiSecret.present, true);
  assert.equal(payload.checks.adminEmails.present, true);
});

test('readiness check reflects invalid backends', () => {
  const readiness = buildReadiness({ STORAGE_BACKEND: 'redis', AUTH_BACKEND: 'firebase' });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.checks.storageBackend.ok, false);
  assert.equal(readiness.checks.authBackend.ok, false);
});

test('production mode rejects missing required env vars', () => {
  const result = validateProductionEnvironment({ NODE_ENV: 'production' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test('production mode accepts valid required env var shape', () => {
  const result = validateProductionEnvironment({
    NODE_ENV: 'production',
    STORAGE_BACKEND: 'json',
    AUTH_BACKEND: 'pilot',
    INTERNAL_API_SECRET: 'secret',
    ADMIN_EMAILS: 'admin@example.com',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('production mode requires supabase env vars when selected', () => {
  const result = validateProductionEnvironment({
    NODE_ENV: 'production',
    STORAGE_BACKEND: 'supabase',
    AUTH_BACKEND: 'supabase',
    INTERNAL_API_SECRET: 'secret',
    ADMIN_EMAILS: 'admin@example.com',
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => /SUPABASE_URL/.test(message)));
});

test('cookies are marked secure in production', async () => {
  resetData();
  process.env.NODE_ENV = 'production';
  try {
    const response = await request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=mina@example.com',
    });
    const cookies = getSetCookies(response.headers).join('; ');
    assert.match(cookies, /Secure/);
  } finally {
    process.env.NODE_ENV = 'test';
  }
});

test('Supabase auth cookies use safe flags and do not store service credentials', () => {
  resetData();
  process.env.NODE_ENV = 'production';
  const headers = {};
  const res = { setHeader(name, value) { headers[name] = value; } };
  setAuthAdapter({
    createSessionCookies: require('../lib/auth/supabaseAuth').createSupabaseAuthAdapter({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
    }).createSessionCookies,
  });
  const adapter = require('../lib/auth').getAuthAdapter();
  adapter.createSessionCookies(res, {
    access_token: 'access-token-value',
    refresh_token: 'refresh-token-value',
    expires_in: 3600,
  });
  const cookies = headers['Set-Cookie'].join('; ');
  assert.match(cookies, /sbAccessToken=access-token-value/);
  assert.match(cookies, /sbRefreshToken=refresh-token-value/);
  assert.match(cookies, /HttpOnly/);
  assert.match(cookies, /SameSite=Lax/);
  assert.match(cookies, /Secure/);
  assert.doesNotMatch(cookies, /service-role|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|INTERNAL_API_SECRET/i);
  resetData();
});

test('committed docs and examples do not contain obvious real secrets', () => {
  resetData();
  const trackedFiles = execFileSync('git', ['ls-files'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((filePath) => !filePath.endsWith('package-lock.json'));
  const secretPatterns = [
    /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
    /sb_secret_[A-Za-z0-9_-]{20,}/,
    /sb_publishable_[A-Za-z0-9_-]{20,}/,
    /sk_live_[A-Za-z0-9_-]+/,
    /whsec_[A-Za-z0-9_-]+/,
    /https:\/\/[a-z0-9]{20}\.supabase\.co/i,
  ];
  const offenders = [];
  for (const filePath of trackedFiles) {
    const absolutePath = path.join(__dirname, '..', filePath);
    const content = fs.readFileSync(absolutePath, 'utf8');
    for (const pattern of secretPatterns) {
      if (pattern.test(content)) {
        offenders.push(filePath);
        break;
      }
    }
  }
  assert.deepEqual(offenders, []);
});
