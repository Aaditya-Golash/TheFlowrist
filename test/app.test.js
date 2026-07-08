const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const app = require('../server');
const { writeSeedData } = require('../lib/seed');
const { resolveStorageAdapter, setStorageAdapter, getStorageAdapter } = require('../lib/store');
const { createSupabaseStore } = require('../lib/supabaseStore');
const { resolveAuthBackend, resetAuthAdapter, setAuthAdapter } = require('../lib/auth');
const { createSupabaseAuthAdapter } = require('../lib/auth/supabaseAuth');
const { buildReadiness, validateProductionEnvironment } = require('../lib/env-check');
const { resetAllRateLimiters } = require('../lib/rate-limiter');
const { assertCustomerOwnsRecipient, assertCustomerOwnsMilestone, assertCustomerOwnsOrder } = require('../lib/ownership');
const { estimatePlatformProfitCents } = require('../lib/pricing');
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
  setStorageAdapter(null);
  resetAllRateLimiters();
  writeSeedData();
};

function createFakeAsyncStore(seed) {
  const state = JSON.parse(JSON.stringify(seed));
  const tick = (value) => new Promise((resolve) => setTimeout(() => resolve(value), 0));
  const findAndUpdate = (list, id, changes) => {
    const record = list.find((entry) => entry.id === id);
    if (!record) {
      return null;
    }
    Object.assign(record, changes, { updatedAt: new Date().toISOString() });
    return record;
  };
  return {
    async getState() { return tick(JSON.parse(JSON.stringify(state))); },
    async saveState() { throw new Error('saveState is not implemented for the fake async backend'); },
    async listCustomers() { return tick(state.users); },
    async getCustomerById(id) { return tick(state.users.find((entry) => entry.id === id) || null); },
    async createCustomer(customer) { state.users.push(customer); return tick(customer); },
    async updateCustomer(id, changes) { return tick(findAndUpdate(state.users, id, changes)); },
    async listRecipients() { return tick(state.recipients); },
    async getRecipientById(id) { return tick(state.recipients.find((entry) => entry.id === id) || null); },
    async createRecipient(recipient) { state.recipients.push(recipient); return tick(recipient); },
    async updateRecipient(id, changes) { return tick(findAndUpdate(state.recipients, id, changes)); },
    async listMilestones() { return tick(state.milestones); },
    async getMilestoneById(id) { return tick(state.milestones.find((entry) => entry.id === id) || null); },
    async createMilestone(milestone) { state.milestones.push(milestone); return tick(milestone); },
    async updateMilestone(id, changes) { return tick(findAndUpdate(state.milestones, id, changes)); },
    async listScheduledOrders() { return tick(state.orders); },
    async getScheduledOrderById(id) { return tick(state.orders.find((entry) => entry.id === id) || null); },
    async createScheduledOrder(order) { state.orders.push(order); return tick(order); },
    async updateScheduledOrder(id, changes) { return tick(findAndUpdate(state.orders, id, changes)); },
    async createOrderEventLog(event) { state.orderEvents.push(event); return tick(event); },
    async listOrderEventLogs(orderId) { return tick(state.orderEvents.filter((entry) => entry.orderId === orderId)); },
    async listPaymentConsents() { return tick(state.paymentConsents); },
    async createPaymentConsent(consent) { state.paymentConsents.push(consent); return tick(consent); },
    async revokePaymentConsent(id) { return tick(findAndUpdate(state.paymentConsents, id, { active: false })); },
    async listFloristPartners() { return tick(state.floristPartners); },
    async createFloristPartner(floristPartner) { state.floristPartners.push(floristPartner); return tick(floristPartner); },
    async updateFloristPartner(id, changes) { return tick(findAndUpdate(state.floristPartners, id, changes)); },
    async listServiceZones() { return tick(state.serviceZones); },
    _debugState: state,
  };
}

function createFakeAuthAdapter(customer) {
  return {
    backend: 'supabase',
    async getCurrentUser() { return { email: customer.email, id: customer.id }; },
    async requireUser() { return customer; },
    async requireAdmin(req, res) {
      res.writeHead(302, { Location: '/admin/login' });
      res.end();
      return false;
    },
    async signInWithEmailPassword() { return { ok: true, session: {} }; },
    async signOut() {},
    createSessionCookies() {},
    clearSessionCookies() {},
  };
}

const TWO_CUSTOMER_SEED = {
  users: [
    { id: 'cust-a', name: 'Ava', email: 'ava@example.com', phone: '', marketingEmailConsent: false, marketingSmsConsent: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'cust-b', name: 'Ben', email: 'ben@example.com', phone: '', marketingEmailConsent: false, marketingSmsConsent: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  ],
  recipients: [
    { id: 'rec-a', userId: 'cust-a', name: 'Recipient A', relationship: 'friend', phone: '', addressLine1: '1 A St', addressLine2: '', city: 'Toronto', province: 'ON', postalCode: 'M5V 2T6', deliveryInstructions: '', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
    { id: 'rec-b', userId: 'cust-b', name: 'Recipient B', relationship: 'friend', phone: '', addressLine1: '2 B St', addressLine2: '', city: 'Toronto', province: 'ON', postalCode: 'M5V 2T6', deliveryInstructions: '', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
  ],
  milestones: [
    { id: 'mile-a', userId: 'cust-a', recipientId: 'rec-a', occasionType: 'birthday', occasionLabel: 'A birthday', eventDate: '2026-12-01', repeatsAnnually: true, budgetTier: 'classic', status: 'active', cardMessageTone: 'warm', stylePreferences: '', allergiesOrAvoid: '', hardNoPreferences: '', reminderDaysBefore: 7, chargeDaysBefore: 5, createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z' },
    { id: 'mile-b', userId: 'cust-b', recipientId: 'rec-b', occasionType: 'birthday', occasionLabel: 'B birthday', eventDate: '2026-12-05', repeatsAnnually: true, budgetTier: 'classic', status: 'active', cardMessageTone: 'warm', stylePreferences: '', allergiesOrAvoid: '', hardNoPreferences: '', reminderDaysBefore: 7, chargeDaysBefore: 5, createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z' },
  ],
  orders: [],
  floristPartners: [],
  serviceZones: [{ id: 'zone-a', name: 'Downtown', prefixes: ['M5'], active: true, deliveryFeeCents: 1000, notes: '' }],
  paymentConsents: [
    { id: 'consent-a', userId: 'cust-a', stripeCustomerId: '', stripePaymentMethodId: '', consentTextVersion: 'v1', consentTextSnapshot: 'Consent A', consentedAt: '2026-01-04T00:00:00.000Z', ipAddress: '', userAgent: '', active: true },
    { id: 'consent-b', userId: 'cust-b', stripeCustomerId: '', stripePaymentMethodId: '', consentTextVersion: 'v1', consentTextSnapshot: 'Consent B', consentedAt: '2026-01-04T00:00:00.000Z', ipAddress: '', userAgent: '', active: true },
  ],
  orderEvents: [],
  feedback: [],
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
  assert.match(response.text, /TheFlowerist/i);
  assert.match(response.text, /\/public\/styles\.css/);
  assert.match(response.text, /fonts\.googleapis\.com/);
  assert.match(response.text, /Cormorant\+Garamond/);
});

test('landing page includes key trust copy', async () => {
  resetData();
  const response = await request('/');
  assert.equal(response.status, 200);
  assert.match(response.text, /Never forget flowers/i);
  assert.match(response.text, /no weekly subscription/i);
  assert.match(response.text, /pause or cancel/i);
  assert.match(response.text, /designer's[- ]choice/i);
  assert.match(response.text, /toronto/i);
  assert.match(response.text, /reminder/i);
});

test('landing page shows current pricing tiers', async () => {
  resetData();
  const response = await request('/');
  assert.equal(response.status, 200);
  assert.match(response.text, /\$145/);
  assert.match(response.text, /\$195/);
  assert.match(response.text, /\$275/);
  assert.doesNotMatch(response.text, /\$75|\$120|\$200/);
});

test('global CSS is served from public assets', async () => {
  resetData();
  const response = await request('/public/styles.css');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/css/);
  assert.match(response.text, /--font-display/);
  assert.match(response.text, /--font-body/);
  assert.match(response.text, /--fs-display: clamp\(3rem, calc\(2\.5rem \+ 3vw\), 4\.75rem\)/);
  assert.match(response.text, /--fs-h1: clamp\(2\.25rem, calc\(1\.8rem \+ 2\.25vw\), 3\.05rem\)/);
  assert.match(response.text, /--fs-h2: clamp\(1\.75rem, calc\(1\.45rem \+ 1\.5vw\), 2\.44rem\)/);
  assert.match(response.text, /--fs-h3: clamp\(1\.35rem, calc\(1\.15rem \+ 1vw\), 1\.95rem\)/);
  assert.match(response.text, /--fs-body: clamp\(1rem, calc\(0\.95rem \+ 0\.25vw\), 1\.125rem\)/);
  assert.match(response.text, /--fs-small: clamp\(0\.81rem, calc\(0\.78rem \+ 0\.15vw\), 0\.9rem\)/);
  assert.match(response.text, /--fs-caption: clamp\(0\.68rem, calc\(0\.65rem \+ 0\.1vw\), 0\.75rem\)/);
  assert.match(response.text, /--color-bg-primary: #F3E7DB/);
  assert.match(response.text, /--color-bg-secondary: #EDEAE0/);
  assert.match(response.text, /--color-border-parchment: #DCD7D3/);
  assert.match(response.text, /--color-primary-olive: #556B2F/);
  assert.match(response.text, /--color-primary-sage: #9CAF88/);
  assert.match(response.text, /--color-text-espresso: #261311/);
  assert.match(response.text, /--color-text-charcoal: #3C3A34/);
  assert.match(response.text, /--color-text-graphite: #333333/);
  assert.match(response.text, /--color-onyx: #0A0A0A/);
  assert.match(response.text, /--color-metal-brass: #CCBD77/);
  assert.match(response.text, /--color-danger: #8B3A3A/);
  assert.match(response.text, /--radius: 0px/);
  assert.match(response.text, /--duration-transition: 450ms/);
  assert.match(response.text, /--duration-morph: 550ms/);
  assert.match(response.text, /\.luxe-grid-container/);
  assert.match(response.text, /\.card-deck-wrapper/);
  assert.match(response.text, /max-width: 65ch/);
  assert.match(response.text, /prefers-reduced-motion/);
  assert.match(response.text, /\.vault-panel/);
  assert.doesNotMatch(response.text, /Ãƒ|Ã‚|Ã¢|Ã¯Â¿Â½|ï¿½/);
});

test('payment page includes no-charge-today copy', async () => {
  resetData();
  const response = await request('/account/payment-consent');
  assert.equal(response.status, 200);
  assert.match(response.text, /not charged today/i);
  assert.match(response.text, /remind you before/i);
  assert.match(response.text, /pause before the cutoff/i);
  assert.match(response.text, /Payment capture is not enabled in this local pilot build/i);
  assert.match(response.text, /vault-panel/);
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

test('pricing helper returns customer-facing tier price', () => {
  resetData();
  assert.equal(calculateEstimatedPrice('premium', 1200), 19500);
});

test('rendered core pages do not contain mojibake', async () => {
  resetData();
  const pages = ['/', '/login', '/dashboard', '/recipients/new', '/milestones/new', '/account', '/account/payment-consent', '/admin/login'];
  for (const page of pages) {
    const response = await request(page);
    assert.equal(response.status, 200);
    assert.doesNotMatch(response.text, /Ã|Â|â|ï¿½|�/);
  }
});

test('rendered active UI does not show historical pricing tiers', async () => {
  resetData();
  const pages = ['/', '/dashboard', '/recipients/new', '/milestones/new', '/account', '/account/payment-consent', '/admin/login'];
  for (const page of pages) {
    const response = await request(page);
    assert.equal(response.status, 200);
    assert.doesNotMatch(response.text, /\$75|\$120|\$200/);
  }
});

test('milestone form renders aesthetic mood cards', async () => {
  resetData();
  const response = await request('/milestones/new');
  assert.equal(response.status, 200);
  assert.match(response.text, /Pastel &amp; Eucalyptus|Pastel & Eucalyptus/);
  assert.match(response.text, /Sculptural &amp; Clean|Sculptural & Clean/);
  assert.match(response.text, /Rich &amp; Botanical|Rich & Botanical/);
});

test('pricing profit remains positive across florist rebate assumptions', () => {
  ['classic', 'premium', 'signature'].forEach((tierKey) => {
    [0.20, 0.25, 0.30].forEach((rebateRate) => {
      assert.ok(estimatePlatformProfitCents(tierKey, rebateRate) > 0);
    });
  });
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
  assert.equal(order.estimatedCustomerPriceCents, 27500);
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
    'createCustomer',
    'updateCustomer',
    'listRecipients',
    'getRecipientById',
    'createRecipient',
    'updateRecipient',
    'listMilestones',
    'getMilestoneById',
    'createMilestone',
    'updateMilestone',
    'listScheduledOrders',
    'getScheduledOrderById',
    'createScheduledOrder',
    'updateScheduledOrder',
    'createOrderEventLog',
    'listOrderEventLogs',
    'listPaymentConsents',
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

test('route handlers work correctly against a mock async storage adapter', async () => {
  resetData();
  const fakeStore = createFakeAsyncStore(TWO_CUSTOMER_SEED);
  setStorageAdapter(fakeStore);
  setAuthAdapter(createFakeAuthAdapter(TWO_CUSTOMER_SEED.users[0]));
  try {
    const dashboardResponse = await request('/dashboard');
    assert.equal(dashboardResponse.status, 200);
    assert.match(dashboardResponse.text, /Recipient A/);
    assert.doesNotMatch(dashboardResponse.text, /Recipient B/);

    const createResponse = await request('/recipients', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'name=New+Person&relationship=friend&addressLine1=1+St&city=Toronto&province=ON&postalCode=M5V2T6',
    });
    assert.equal(createResponse.status, 302);
    assert.ok(fakeStore._debugState.recipients.some((entry) => entry.name === 'New Person' && entry.userId === 'cust-a'));
  } finally {
    setStorageAdapter(null);
    resetAuthAdapter();
  }
});

test('assertCustomerOwns* helpers correctly gate cross-customer access', async () => {
  resetData();
  const fakeStore = createFakeAsyncStore(TWO_CUSTOMER_SEED);
  assert.equal(await assertCustomerOwnsRecipient(fakeStore, 'cust-a', 'rec-a'), true);
  assert.equal(await assertCustomerOwnsRecipient(fakeStore, 'cust-a', 'rec-b'), false);
  assert.equal(await assertCustomerOwnsMilestone(fakeStore, 'cust-b', 'mile-b'), true);
  assert.equal(await assertCustomerOwnsMilestone(fakeStore, 'cust-b', 'mile-a'), false);
  assert.equal(await assertCustomerOwnsOrder(fakeStore, 'cust-a', 'does-not-exist'), false);
});

test('customer cannot pause or cancel another customer milestone', async () => {
  resetData();
  const fakeStore = createFakeAsyncStore(TWO_CUSTOMER_SEED);
  setStorageAdapter(fakeStore);
  setAuthAdapter(createFakeAuthAdapter(TWO_CUSTOMER_SEED.users[0]));
  try {
    const response = await request('/milestones/mile-b', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'action=cancel',
    });
    assert.equal(response.status, 404);
    assert.equal(fakeStore._debugState.milestones.find((entry) => entry.id === 'mile-b').status, 'active');

    const ownResponse = await request('/milestones/mile-a', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'action=cancel',
    });
    assert.equal(ownResponse.status, 302);
    assert.equal(fakeStore._debugState.milestones.find((entry) => entry.id === 'mile-a').status, 'cancelled');
  } finally {
    setStorageAdapter(null);
    resetAuthAdapter();
  }
});

test('customer cannot create a milestone for another customer recipient', async () => {
  resetData();
  const fakeStore = createFakeAsyncStore(TWO_CUSTOMER_SEED);
  setStorageAdapter(fakeStore);
  setAuthAdapter(createFakeAuthAdapter(TWO_CUSTOMER_SEED.users[0]));
  try {
    const response = await request('/milestones', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'recipientId=rec-b&eventDate=2027-01-01&budgetTier=classic&occasionType=birthday',
    });
    assert.equal(response.status, 403);
    assert.equal(fakeStore._debugState.milestones.length, 2);
  } finally {
    setStorageAdapter(null);
    resetAuthAdapter();
  }
});

test('payment consent revoke is scoped to the current customer', async () => {
  resetData();
  const fakeStore = createFakeAsyncStore(TWO_CUSTOMER_SEED);
  setStorageAdapter(fakeStore);
  setAuthAdapter(createFakeAuthAdapter(TWO_CUSTOMER_SEED.users[0]));
  try {
    const response = await request('/account/payment-consent/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'consentId=consent-b',
    });
    assert.equal(response.status, 404);
    assert.equal(fakeStore._debugState.paymentConsents.find((entry) => entry.id === 'consent-b').active, true);

    const ownResponse = await request('/account/payment-consent/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'consentId=consent-a',
    });
    assert.equal(ownResponse.status, 302);
    assert.equal(fakeStore._debugState.paymentConsents.find((entry) => entry.id === 'consent-a').active, false);
  } finally {
    setStorageAdapter(null);
    resetAuthAdapter();
  }
});

test('account page only shows the current customer own payment consent', async () => {
  resetData();
  const fakeStore = createFakeAsyncStore(TWO_CUSTOMER_SEED);
  setStorageAdapter(fakeStore);
  setAuthAdapter(createFakeAuthAdapter(TWO_CUSTOMER_SEED.users[1]));
  try {
    const response = await request('/account');
    assert.equal(response.status, 200);
    assert.match(response.text, /Active for future concierge charges/);
  } finally {
    setStorageAdapter(null);
    resetAuthAdapter();
  }
});

test('admin email is accepted in Supabase auth mode', async () => {
  const adapter = createSupabaseAuthAdapter(
    {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
      ADMIN_EMAILS: 'admin@example.com',
    },
    {
      createClient: () => ({
        auth: {
          getUser: async () => ({ data: { user: { email: 'admin@example.com', id: 'admin-user-1' } }, error: null }),
        },
      }),
    },
  );
  const req = { headers: { cookie: 'sbAccessToken=fake-token' } };
  const res = {
    writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
    end() {},
  };
  const allowed = await adapter.requireAdmin(req, res);
  assert.equal(allowed, true);
});

test('rate limiting blocks repeated failed login attempts', async () => {
  resetData();
  let response;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    response = await request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=',
    });
  }
  assert.equal(response.status, 401);
  const blockedResponse = await request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'email=',
  });
  assert.equal(blockedResponse.status, 429);
  assert.doesNotMatch(blockedResponse.text, /password/i);
});

test('rate limiting blocks repeated failed admin login attempts', async () => {
  resetData();
  let response;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    response = await request('/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=not-an-admin@example.com',
    });
  }
  assert.equal(response.status, 403);
  const blockedResponse = await request('/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'email=not-an-admin@example.com',
  });
  assert.equal(blockedResponse.status, 429);
});
