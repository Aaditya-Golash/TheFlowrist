const { URL } = require('url');
const { renderHtml } = require('./template');
const { getState, getStorageAdapter } = require('./store');
const { getAdminCookieValue, getAdminClearCookieValue, isAdminEmail } = require('./admin');
const { getAuthAdapter } = require('./auth');
const { buildReadiness } = require('./env-check');
const { assertCustomerOwnsRecipient, assertCustomerOwnsMilestone } = require('./ownership');
const { loginRateLimiter, adminLoginRateLimiter } = require('./rate-limiter');
const {
  calculatePlannedChargeDate,
  calculateReminderDate,
  createScheduledOrderFromMilestone,
  createOneTimeScheduledOrder,
  createSurpriseScheduledOrder,
  getServiceZoneForPostalCode,
  isPostalCodeInZone,
  calculateEstimatedPrice,
  getOrdersNeedingReminder,
  validateStatusTransition,
  normalizePostalCode,
  isAtLeastDaysOut,
} = require('./logic');
const { validateRecipient, validateMilestone } = require('./validation');
const { getPricingTiers, formatMoney } = require('./pricing');
const {
  getRelationshipPlans,
  getRelationshipPlan,
  getSurpriseMonthlyTiers,
  getSurpriseMonthlyTier,
  isSignaturePlan,
} = require('./plans');
const { getStripeClient } = require('./stripe-client');
const {
  escapeHtml,
  formatStatusLabel,
  statusBadge,
  trustNote,
  tierCard,
  emptyState,
  notice,
} = require('./ui');

function getBaseUrl(req) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = forwardedProto || (process.env.NODE_ENV === 'production' ? 'https' : 'http');
  const host = req.headers.host || 'localhost';
  return `${protocol}://${host}`;
}

const CONSENT_TEXT_VERSION = 'v1';
const CONSENT_TEXT_SNAPSHOT = 'By saving payment consent, you authorize TheFlowerist to charge scheduled flower orders, delivery, and applicable taxes. We remind you before scheduled charges. You can pause or cancel before the cutoff.';
const HOLIDAY_OCCASIONS = new Set(['valentines_day', 'mothers_day', 'fathers_day']);

function getActiveMembership(memberships, customerId) {
  return (memberships || []).filter((entry) => entry.userId === customerId && entry.status === 'active').pop() || null;
}

function addOneYear(date = new Date()) {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + 1);
  return next.toISOString().slice(0, 10);
}

function currentMonthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function firstDateForMonth(monthKey, day = 15) {
  const safeDay = Math.max(1, Math.min(28, Number(day || 15)));
  return `${monthKey}-${String(safeDay).padStart(2, '0')}`;
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function renderNoticePage(res, statusCode, { title, message, kind = 'error' }) {
  const body = `<section class="panel"><h1>${escapeHtml(title)}</h1>${notice(kind, message)}</section>`;
  res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(renderHtml(title, body));
}

function isInternalRequestAuthorized(req, env = process.env) {
  const configuredSecret = String(env.INTERNAL_API_SECRET || '');
  const requestSecret = String(req.headers['x-internal-api-secret'] || '');
  return Boolean(configuredSecret && requestSecret && requestSecret === configuredSecret);
}

function rejectInternalRequest(res) {
  writeJson(res, 401, { error: 'unauthorized' });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function logOrderEvent(adapter, orderId, { type, message, actorType }) {
  return adapter.createOrderEventLog({
    id: `event-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    orderId,
    type,
    message,
    actorType,
    createdAt: new Date().toISOString(),
  });
}

function tooManyAttemptsResponse(res, title) {
  renderNoticePage(res, 429, {
    title,
    message: 'Too many attempts. Please wait a few minutes and try again. Your progress remains safe.',
  });
}

function createRouter(server) {
  return async (req, res) => {
    try {
      await handleRequest(req, res);
    } catch (error) {
      if (!res.headersSent) {
        writeJson(res, 500, { error: 'internal_error' });
      }
    }
  };
}

async function handleRequest(req, res) {
  {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = requestUrl.pathname;

    if (req.method === 'GET' && pathname === '/health') {
      writeJson(res, 200, { status: 'ok' });
      return;
    }

    if (req.method === 'GET' && pathname === '/ready') {
      const readiness = buildReadiness(process.env);
      writeJson(res, readiness.ready ? 200 : 503, readiness);
      return;
    }

    if (req.method === 'GET' && pathname === '/internal/orders/upcoming') {
      if (!isInternalRequestAuthorized(req)) {
        rejectInternalRequest(res);
        return;
      }
      const orders = await getStorageAdapter().listScheduledOrders();
      const filtered = orders.filter((order) => order.status === 'scheduled' || order.status === 'pending_charge');
      writeJson(res, 200, { orders: filtered });
      return;
    }

    if (req.method === 'GET' && pathname === '/internal/orders/needing-reminder') {
      if (!isInternalRequestAuthorized(req)) {
        rejectInternalRequest(res);
        return;
      }
      const adapter = getStorageAdapter();
      const [orders, milestones] = await Promise.all([adapter.listScheduledOrders(), adapter.listMilestones()]);
      const filtered = getOrdersNeedingReminder(orders, milestones);
      writeJson(res, 200, { orders: filtered });
      return;
    }

    if (req.method === 'GET' && pathname === '/internal/orders/needing-florist') {
      if (!isInternalRequestAuthorized(req)) {
        rejectInternalRequest(res);
        return;
      }
      const orders = await getStorageAdapter().listScheduledOrders();
      const filtered = orders.filter((order) => !order.floristPartnerId && order.status !== 'cancelled');
      writeJson(res, 200, { orders: filtered });
      return;
    }

    if (req.method === 'GET' && pathname === '/internal/orders/issues') {
      if (!isInternalRequestAuthorized(req)) {
        rejectInternalRequest(res);
        return;
      }
      const orders = await getStorageAdapter().listScheduledOrders();
      const filtered = orders.filter((order) => order.status === 'issue_reported' || order.status === 'refunded');
      writeJson(res, 200, { orders: filtered });
      return;
    }

    if (req.method === 'POST' && pathname === '/internal/surprise/generate') {
      if (!isInternalRequestAuthorized(req)) {
        rejectInternalRequest(res);
        return;
      }
      const adapter = getStorageAdapter();
      const [settings, memberships, customers, recipients, serviceZones, existingOrders] = await Promise.all([
        adapter.listSurpriseDelightSettings(),
        adapter.listRelationshipMemberships(),
        adapter.listCustomers(),
        adapter.listRecipients(),
        adapter.listServiceZones(),
        adapter.listScheduledOrders(),
      ]);
      const targetMonth = requestUrl.searchParams.get('month') || currentMonthKey();
      const created = [];
      for (const setting of settings.filter((entry) => entry.status === 'active')) {
        if (setting.skippedMonth === targetMonth || setting.lastGeneratedMonth === targetMonth) {
          continue;
        }
        const membership = getActiveMembership(memberships, setting.userId);
        if (!isSignaturePlan(membership)) {
          continue;
        }
        const user = customers.find((entry) => entry.id === setting.userId);
        const recipient = recipients.find((entry) => entry.id === setting.recipientId);
        if (!user || !recipient) {
          continue;
        }
        const duplicate = existingOrders.some((order) => order.surpriseSettingId === setting.id && String(order.eventDate || '').startsWith(targetMonth));
        if (duplicate) {
          await adapter.updateSurpriseDelightSetting(setting.id, { lastGeneratedMonth: targetMonth });
          continue;
        }
        const serviceZone = getServiceZoneForPostalCode(serviceZones, recipient.postalCode);
        const order = createSurpriseScheduledOrder({
          ...setting,
          preferredDeliveryDate: firstDateForMonth(targetMonth, setting.preferredDeliveryDay),
        }, user, recipient, targetMonth, serviceZone);
        await adapter.createScheduledOrder(order);
        await adapter.updateSurpriseDelightSetting(setting.id, { lastGeneratedMonth: targetMonth });
        created.push(order);
      }
      writeJson(res, 200, { ok: true, month: targetMonth, createdCount: created.length, orders: created });
      return;
    }

    if (req.method === 'POST' && pathname.startsWith('/internal/orders/') && pathname.endsWith('/event')) {
      if (!isInternalRequestAuthorized(req)) {
        rejectInternalRequest(res);
        return;
      }
      const orderId = pathname.split('/')[3];
      const body = await readRequestBody(req);
      const values = new URLSearchParams(body);
      const adapter = getStorageAdapter();
      const order = await adapter.getScheduledOrderById(orderId);
      if (!order) {
        writeJson(res, 404, { error: 'order_not_found' });
        return;
      }
      const message = values.get('message') || 'Internal event logged';
      await adapter.createOrderEventLog({
        id: `event-${Date.now()}`,
        orderId,
        type: 'internal_event',
        message,
        actorType: 'n8n',
        createdAt: new Date().toISOString(),
      });
      writeJson(res, 200, { ok: true, orderId, message });
      return;
    }

    if (req.method === 'POST' && pathname.startsWith('/internal/orders/') && pathname.endsWith('/status')) {
      if (!isInternalRequestAuthorized(req)) {
        rejectInternalRequest(res);
        return;
      }
      const orderId = pathname.split('/')[3];
      const body = await readRequestBody(req);
      const values = new URLSearchParams(body);
      const adapter = getStorageAdapter();
      const order = await adapter.getScheduledOrderById(orderId);
      if (!order) {
        writeJson(res, 404, { error: 'order_not_found' });
        return;
      }
      const nextStatus = values.get('status') || order.status;
      await adapter.updateScheduledOrder(orderId, { status: nextStatus });
      await adapter.createOrderEventLog({
        id: `event-${Date.now()}`,
        orderId,
        type: 'status_change',
        message: `Internal status update to ${nextStatus}`,
        actorType: 'n8n',
        createdAt: new Date().toISOString(),
      });
      writeJson(res, 200, { ok: true, orderId, status: nextStatus });
      return;
    }

    if (req.method === 'POST' && pathname.startsWith('/internal/orders/') && pathname.endsWith('/charge')) {
      if (!isInternalRequestAuthorized(req)) {
        rejectInternalRequest(res);
        return;
      }
      const orderId = pathname.split('/')[3];
      const adapter = getStorageAdapter();
      const order = await adapter.getScheduledOrderById(orderId);
      if (!order) {
        writeJson(res, 404, { error: 'order_not_found' });
        return;
      }

      if (order.status === 'charged') {
        writeJson(res, 200, { ok: true, orderId, charged: true, alreadyCharged: true });
        return;
      }

      const chargeableStatuses = ['scheduled', 'pre_charge_reminder_sent', 'pending_charge'];
      if (!chargeableStatuses.includes(order.status)) {
        writeJson(res, 200, { ok: true, orderId, charged: false, skipped: true, reason: 'not_chargeable', status: order.status });
        return;
      }

      const milestone = order.milestoneId ? await adapter.getMilestoneById(order.milestoneId) : null;
      if (order.milestoneId && (!milestone || milestone.status !== 'active')) {
        if (validateStatusTransition(order.status, 'cancelled')) {
          await adapter.updateScheduledOrder(orderId, { status: 'cancelled' });
          await logOrderEvent(adapter, orderId, {
            type: 'status_change',
            message: 'Charge skipped and order cancelled: the protected date is no longer active.',
            actorType: 'system',
          });
        }
        writeJson(res, 200, { ok: true, orderId, charged: false, skipped: true, reason: 'milestone_inactive' });
        return;
      }

      const allConsents = await adapter.listPaymentConsents();
      const consent = allConsents
        .filter((entry) => entry.userId === order.userId && entry.active && entry.stripeCustomerId && entry.stripePaymentMethodId)
        .pop();

      if (!consent) {
        if (validateStatusTransition(order.status, 'issue_reported')) {
          await adapter.updateScheduledOrder(orderId, { status: 'issue_reported' });
        }
        await logOrderEvent(adapter, orderId, {
          type: 'issue',
          message: 'Charge failed: no active payment method on file for this customer.',
          actorType: 'system',
        });
        writeJson(res, 200, { ok: true, orderId, charged: false, reason: 'no_payment_method' });
        return;
      }

      if (order.status !== 'pending_charge' && validateStatusTransition(order.status, 'pending_charge')) {
        await adapter.updateScheduledOrder(orderId, { status: 'pending_charge' });
        await logOrderEvent(adapter, orderId, {
          type: 'status_change',
          message: 'Order moved to pending charge ahead of Stripe charge attempt.',
          actorType: 'system',
        });
      }

      let stripe;
      try {
        stripe = getStripeClient();
      } catch (error) {
        await adapter.updateScheduledOrder(orderId, { status: 'issue_reported' });
        await logOrderEvent(adapter, orderId, {
          type: 'issue',
          message: 'Charge failed: Stripe is not configured on the server.',
          actorType: 'system',
        });
        writeJson(res, 200, { ok: true, orderId, charged: false, reason: 'stripe_not_configured' });
        return;
      }

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: order.estimatedCustomerPriceCents,
          currency: 'cad',
          customer: consent.stripeCustomerId,
          payment_method: consent.stripePaymentMethodId,
          off_session: true,
          confirm: true,
          metadata: { orderId: order.id, milestoneId: order.milestoneId || '' },
        });

        if (paymentIntent.status !== 'succeeded') {
          await adapter.updateScheduledOrder(orderId, { status: 'issue_reported' });
          await logOrderEvent(adapter, orderId, {
            type: 'issue',
            message: `Charge did not complete: payment intent status was "${paymentIntent.status}".`,
            actorType: 'system',
          });
          writeJson(res, 200, { ok: true, orderId, charged: false, reason: paymentIntent.status });
          return;
        }

        await adapter.updateScheduledOrder(orderId, { status: 'charged', stripePaymentIntentId: paymentIntent.id });
        await logOrderEvent(adapter, orderId, {
          type: 'status_change',
          message: `Charge succeeded for ${formatMoney(order.estimatedCustomerPriceCents)}.`,
          actorType: 'system',
        });
        writeJson(res, 200, { ok: true, orderId, charged: true, paymentIntentId: paymentIntent.id });
      } catch (error) {
        await adapter.updateScheduledOrder(orderId, { status: 'issue_reported' });
        await logOrderEvent(adapter, orderId, {
          type: 'issue',
          message: `Charge failed: ${error.message || 'unknown Stripe error'}.`,
          actorType: 'system',
        });
        writeJson(res, 200, { ok: true, orderId, charged: false, reason: error.code || 'stripe_error' });
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/') {
      const state = await getState();
      const body = `
        <section class="hero">
          <div>
            <div class="pill">Milestone flower concierge. Toronto private pilot.</div>
            <h1 class="hero-title">Never forget flowers for the dates that matter.</h1>
            <p class="muted">TheFlowerist is not a flower subscription. Arrange one delivery today, or save future dates for free. We remind you before any charge, then coordinate seasonal flowers with a trusted local florist.</p>
            <a class="btn" href="/orders/new">Arrange one delivery</a>
            <a class="btn secondary" href="/milestones/new">Protect future dates</a>
          </div>
          <div class="panel">
            <h3>What you get</h3>
            <ul>
              <li>One place to protect every important date</li>
              <li>A reminder before any charge</li>
              <li>Designer's-choice seasonal arrangements, never a rigid catalog</li>
              <li>A real concierge team handling florist coordination</li>
            </ul>
          </div>
        </section>

        <section class="section panel">
          <h2 class="section-title">Choose how you want to be thoughtful</h2>
          <div class="trust-grid">
            <div class="trust-item"><h4>One-time concierge order</h4><p>For birthdays, anniversaries, apologies, thank-yous, or just because.</p><p><a href="/orders/new">Arrange one delivery</a></p></div>
            <div class="trust-item"><h4>Free Datekeeper</h4><p>Save important dates. We remind you before anything is charged.</p><p><a href="/milestones/new">Protect future dates</a></p></div>
            <div class="trust-item"><h4>Relationship plans</h4><p>Annual memory and concierge plans. Flowers are still charged per delivery.</p><p><a href="/plans">View plans</a></p></div>
            <div class="trust-item"><h4>Surprise & Delight Monthly</h4><p>Optional monthly gestures for Signature Concierge members. Reminder first, skip before cutoff.</p><p><a href="/surprise">Manage add-on</a></p></div>
          </div>
        </section>

        <section class="section panel" id="how-it-works">
          <h2 class="section-title">How it works</h2>
          <p class="section-lead">Five minutes now protects a date all year.</p>
          <ol class="steps">
            <li><div><strong>Tell us who and when</strong><span>Add a recipient and the date you want remembered.</span></div></li>
            <li><div><strong>Choose a budget tier</strong><span>Classic, Premium, or Signature. No bouquet browsing required.</span></div></li>
            <li><div><strong>We remind you first</strong><span>A few days before anything is charged, we let you know it's coming.</span></div></li>
            <li><div><strong>Our florist partner curates it</strong><span>Designer's Choice means the best seasonal stems available, matched to your style preferences.</span></div></li>
            <li><div><strong>Pause or cancel anytime</strong><span>Change your mind before the cutoff. Nothing is prepared until then.</span></div></li>
          </ol>
        </section>

        <section class="section">
          <h2 class="section-title">Why this feels different</h2>
          <p class="section-lead">Not a shop. Not a subscription. A concierge that remembers for you.</p>
          <div class="trust-grid">
            <div class="trust-item"><h4>No weekly subscription</h4><p>Flowers are arranged only for the dates you choose.</p></div>
            <div class="trust-item"><h4>Reminder before every charge</h4><p>You hear from us first, with time to make changes.</p></div>
            <div class="trust-item"><h4>Pause or cancel before the cutoff</h4><p>Life changes. You can pause or cancel any upcoming order right up until the cutoff, no penalty.</p></div>
            <div class="trust-item"><h4>Designer's-choice seasonal flowers</h4><p>Our florist partners choose the strongest seasonal stems available that week.</p></div>
            <div class="trust-item"><h4>Toronto private pilot</h4><p>A small concierge pilot for Toronto and nearby service zones.</p></div>
          </div>
        </section>

        <section class="section">
          <h2 class="section-title">Budget tiers</h2>
          <p class="section-lead">Choose a tier, not a specific arrangement. Our florist partner handles the rest.</p>
          <div class="tier-grid">
            ${getPricingTiers().map((tier) => tierCard({
              name: tier.name,
              price: formatMoney(tier.customerPriceCents),
              description: tier.description,
              meta: `Arrangement value ${formatMoney(tier.arrangementValueCents)} with delivery allowance included.`,
            })).join('')}
          </div>
        </section>

        <section class="section faq panel">
          <h2 class="section-title">Frequently asked questions</h2>
          <details>
            <summary>Will I be charged today?</summary>
            <p>No. You are not charged when you add a date. We send a reminder before the scheduled charge.</p>
          </details>
          <details>
            <summary>Can I pause or cancel?</summary>
            <p>Yes. Pause a date or cancel it from your dashboard before the cutoff.</p>
          </details>
          <details>
            <summary>What does Designer's Choice mean?</summary>
            <p>Instead of picking from a fixed catalog, our florist partner selects the best seasonal stems available for your budget tier and style preferences. It keeps quality and freshness high.</p>
          </details>
          <details>
            <summary>What areas do you serve?</summary>
            <p>We're running a private pilot in Toronto and nearby service zones. We'll let you know if your recipient's address is outside our current coverage.</p>
          </details>
          <details>
            <summary>What happens if a florist cannot fulfill an order?</summary>
            <p>Our concierge team steps in. We reschedule, substitute thoughtfully, or refund when needed.</p>
          </details>
        </section>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml('TheFlowerist. Milestone flower concierge', body, state));
      return;
    }

    if (req.method === 'GET' && pathname === '/orders/new') {
      const customer = await getAuthAdapter().requireUser(req, res);
      if (!customer) {
        return;
      }
      const state = await getState();
      const ownRecipients = state.recipients.filter((recipient) => recipient.userId === customer.id);
      const recipientOptions = ownRecipients.map((recipient) => `<option value="${recipient.id}">${escapeHtml(recipient.name)}. ${escapeHtml(recipient.city)} ${escapeHtml(recipient.postalCode)}</option>`).join('');
      const body = `
        <section class="section form-shell">
          <div class="form-card">
            <div class="hero-kicker">One-time concierge order</div>
            <h1>Arrange one delivery</h1>
            <p class="section-lead">For birthdays, anniversaries, apologies, exams, thank-yous, or just because. We remind you before the scheduled charge.</p>
            <form action="/orders" method="post">
              <label>Use saved recipient<select name="recipientId"><option value="">Create a new recipient below</option>${recipientOptions}</select></label>
              <h3>New recipient details</h3>
              <label>Name<input name="recipientName" /></label>
              <label>Relationship<input name="relationship" /></label>
              <label>Phone<input name="phone" /></label>
              <label>Address line 1<input name="addressLine1" /></label>
              <label>City<input name="city" value="Toronto" /></label>
              <label>Province<input name="province" value="ON" /></label>
              <label>Postal code<input name="postalCode" /></label>
              <label>Delivery instructions<textarea name="deliveryInstructions"></textarea></label>
              <h3>Delivery details</h3>
              <label>Occasion type<select name="occasionType" required>
                <option value="birthday">Birthday</option>
                <option value="anniversary">Anniversary</option>
                <option value="valentines_day">Valentine's Day</option>
                <option value="mothers_day">Mother's Day</option>
                <option value="fathers_day">Father's Day</option>
                <option value="graduation">Graduation</option>
                <option value="thank_you">Thank-you</option>
                <option value="apology">Apology</option>
                <option value="just_because">Just because</option>
                <option value="custom">Custom</option>
              </select></label>
              <label>Occasion label<input name="occasionLabel" placeholder="Alicia's birthday, thank-you for Sam..." /></label>
              <label>Delivery date<input type="date" name="eventDate" required /><span class="helper">Self-serve orders need at least 7 days of lead time.</span></label>
              <label>Budget tier<select name="budgetTier" required>${getPricingTiers().map((tier) => `<option value="${tier.key}">${escapeHtml(tier.name)}. ${escapeHtml(formatMoney(tier.customerPriceCents))}</option>`).join('')}</select></label>
              <label>Card message tone<select name="cardMessageTone"><option value="warm">Warm</option><option value="romantic">Romantic</option><option value="professional">Professional</option><option value="playful">Playful</option><option value="simple">Simple</option></select></label>
              <label>Style notes<textarea name="stylePreferences" required></textarea></label>
              <label>Customer notes<textarea name="customerNotes"></textarea></label>
              <button class="btn btn-primary" type="submit">Arrange one delivery</button>
            </form>
            <p class="muted form-footnote">Want us to protect this date next year? You can save it to Free Datekeeper after this order.</p>
          </div>
        </section>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml('Arrange one delivery', body));
      return;
    }

    if (req.method === 'POST' && pathname === '/orders') {
      const customer = await getAuthAdapter().requireUser(req, res);
      if (!customer) {
        return;
      }
      const body = await readRequestBody(req);
      const values = new URLSearchParams(body);
      const normalizedValues = Object.fromEntries(values.entries());
      if (!isAtLeastDaysOut(normalizedValues.eventDate, 7)) {
        renderNoticePage(res, 400, {
          title: 'Delivery date needs more lead time',
          message: 'Please choose a delivery date at least 7 days from today.',
        });
        return;
      }
      const adapter = getStorageAdapter();
      const [recipients, serviceZones] = await Promise.all([adapter.listRecipients(), adapter.listServiceZones()]);
      let recipient = recipients.find((entry) => entry.id === normalizedValues.recipientId && entry.userId === customer.id);
      if (!recipient) {
        const recipientValues = {
          name: normalizedValues.recipientName || '',
          relationship: normalizedValues.relationship || '',
          phone: normalizedValues.phone || '',
          addressLine1: normalizedValues.addressLine1 || '',
          city: normalizedValues.city || '',
          province: normalizedValues.province || '',
          postalCode: normalizedValues.postalCode || '',
        };
        const validation = validateRecipient(recipientValues);
        if (validation.errors.length) {
          renderNoticePage(res, 400, {
            title: 'Recipient details needed',
            message: validation.errors.join(' '),
          });
          return;
        }
        recipient = {
          id: `recipient-${Date.now()}`,
          userId: customer.id,
          name: recipientValues.name,
          relationship: recipientValues.relationship,
          phone: recipientValues.phone,
          addressLine1: recipientValues.addressLine1,
          addressLine2: '',
          city: recipientValues.city,
          province: recipientValues.province,
          postalCode: normalizePostalCode(recipientValues.postalCode),
          deliveryInstructions: normalizedValues.deliveryInstructions || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await adapter.createRecipient(recipient);
      }
      if (!normalizedValues.stylePreferences || !normalizedValues.budgetTier || !normalizedValues.occasionType) {
        renderNoticePage(res, 400, {
          title: 'Order details needed',
          message: 'Please add an occasion, budget tier, and style notes before arranging the delivery.',
        });
        return;
      }
      const serviceZone = getServiceZoneForPostalCode(serviceZones, recipient.postalCode);
      const order = createOneTimeScheduledOrder(normalizedValues, customer, recipient, serviceZone);
      if (HOLIDAY_OCCASIONS.has(order.occasionType)) {
        order.internalNotes = 'Holiday order: earlier cutoff, possible holiday pricing, limited slots, no exact delivery time, no same-day guarantee.';
      }
      await adapter.createScheduledOrder(order);
      await logOrderEvent(adapter, order.id, {
        type: 'status_change',
        message: 'One-time concierge order created. Want us to protect this date next year?',
        actorType: 'customer',
      });
      res.writeHead(302, { Location: '/dashboard?order=created' });
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname === '/plans') {
      const customer = await getAuthAdapter().requireUser(req, res);
      if (!customer) {
        return;
      }
      const memberships = await getStorageAdapter().listRelationshipMemberships();
      const activeMembership = getActiveMembership(memberships, customer.id);
      const planCards = getRelationshipPlans().map((plan) => `
        <div class="tier-card">
          <h3>${escapeHtml(plan.name)}</h3>
          <p class="price">${plan.annualFeeCents ? `${formatMoney(plan.annualFeeCents)}/year` : 'Free'}</p>
          <p>${escapeHtml(plan.description)}</p>
          <ul>${plan.benefits.map((benefit) => `<li>${escapeHtml(benefit)}</li>`).join('')}</ul>
          <form action="/plans/select" method="post">
            <input type="hidden" name="planKey" value="${escapeHtml(plan.key)}" />
            <button class="btn btn-primary" type="submit">${activeMembership?.planKey === plan.key ? 'Current plan' : 'Select plan'}</button>
          </form>
        </div>`).join('');
      const body = `
        <section class="section panel">
          <div class="hero-kicker">Relationship plans</div>
          <h1>Membership buys reliability. Orders buy flowers.</h1>
          <p class="section-lead">Annual plans protect more dates and concierge priority. Every arrangement is still charged separately before fulfillment.</p>
          ${activeMembership ? `<p class="muted">Current plan: ${escapeHtml(getRelationshipPlan(activeMembership.planKey).name)}</p>` : ''}
          <div class="tier-grid">${planCards}</div>
        </section>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml('Relationship plans', body));
      return;
    }

    if (req.method === 'POST' && pathname === '/plans/select') {
      const customer = await getAuthAdapter().requireUser(req, res);
      if (!customer) {
        return;
      }
      const body = await readRequestBody(req);
      const values = new URLSearchParams(body);
      const plan = getRelationshipPlan(values.get('planKey'));
      const adapter = getStorageAdapter();
      const now = new Date();
      if (plan.annualFeeCents === 0) {
        await adapter.createRelationshipMembership({
          id: `membership-${Date.now()}`,
          userId: customer.id,
          planKey: plan.key,
          status: 'active',
          annualFeeCents: 0,
          protectedDateLimit: plan.protectedDateLimit,
          currentPeriodStart: now.toISOString().slice(0, 10),
          currentPeriodEnd: addOneYear(now),
          stripeCheckoutSessionId: '',
          stripePaymentIntentId: '',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        res.writeHead(302, { Location: '/plans?plan=active' });
        res.end();
        return;
      }
      let stripe;
      try {
        stripe = getStripeClient();
      } catch (error) {
        renderNoticePage(res, 503, {
          title: 'Plan checkout is unavailable',
          message: 'Stripe test-mode checkout is not configured in this environment.',
        });
        return;
      }
      const baseUrl = getBaseUrl(req);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        success_url: `${baseUrl}/plans/complete?session_id={CHECKOUT_SESSION_ID}&plan=${plan.key}`,
        cancel_url: `${baseUrl}/plans?checkout=cancelled`,
        customer_email: customer.email || undefined,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'cad',
            unit_amount: plan.annualFeeCents,
            product_data: { name: `${plan.name} annual membership` },
          },
        }],
        metadata: { appCustomerId: customer.id, planKey: plan.key },
      });
      res.writeHead(302, { Location: session.url });
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname === '/plans/complete') {
      const customer = await getAuthAdapter().requireUser(req, res);
      if (!customer) {
        return;
      }
      const sessionId = requestUrl.searchParams.get('session_id');
      const plan = getRelationshipPlan(requestUrl.searchParams.get('plan'));
      if (!sessionId || plan.annualFeeCents === 0) {
        res.writeHead(302, { Location: '/plans?checkout=cancelled' });
        res.end();
        return;
      }
      let stripe;
      try {
        stripe = getStripeClient();
      } catch (error) {
        renderNoticePage(res, 503, {
          title: 'Plan checkout is unavailable',
          message: 'Stripe test-mode checkout is not configured in this environment.',
        });
        return;
      }
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status !== 'paid') {
        res.writeHead(302, { Location: '/plans?checkout=cancelled' });
        res.end();
        return;
      }
      const now = new Date();
      await getStorageAdapter().createRelationshipMembership({
        id: `membership-${Date.now()}`,
        userId: customer.id,
        planKey: plan.key,
        status: 'active',
        annualFeeCents: plan.annualFeeCents,
        protectedDateLimit: plan.protectedDateLimit,
        currentPeriodStart: now.toISOString().slice(0, 10),
        currentPeriodEnd: addOneYear(now),
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId: session.payment_intent || '',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      res.writeHead(302, { Location: '/plans?plan=active' });
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname === '/surprise') {
      const customer = await getAuthAdapter().requireUser(req, res);
      if (!customer) {
        return;
      }
      const adapter = getStorageAdapter();
      const [memberships, recipients, settings] = await Promise.all([
        adapter.listRelationshipMemberships(),
        adapter.listRecipients(),
        adapter.listSurpriseDelightSettings(),
      ]);
      const activeMembership = getActiveMembership(memberships, customer.id);
      const ownRecipients = recipients.filter((recipient) => recipient.userId === customer.id);
      const ownSettings = settings.filter((setting) => setting.userId === customer.id);
      if (!isSignaturePlan(activeMembership)) {
        const body = `
          <section class="section panel">
            <div class="hero-kicker">Surprise & Delight Monthly</div>
            <h1>Reserved for Signature Concierge</h1>
            <p class="section-lead">Monthly gestures are optional. You choose the monthly budget, we suggest a delivery window, and you can skip before the cutoff.</p>
            <p><a class="btn btn-primary" href="/plans">View relationship plans</a></p>
          </section>`;
        res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderHtml('Surprise & Delight', body));
        return;
      }
      const recipientOptions = ownRecipients.map((recipient) => `<option value="${recipient.id}">${escapeHtml(recipient.name)}</option>`).join('');
      const settingRows = ownSettings.map((setting) => `<p><strong>${escapeHtml(setting.status)}</strong>. ${escapeHtml(setting.budgetTier)}. ${formatMoney(setting.monthlyPriceCents)} monthly. Last generated: ${escapeHtml(setting.lastGeneratedMonth || 'never')}. Skipped month: ${escapeHtml(setting.skippedMonth || 'none')}.</p>`).join('');
      const body = `
        <section class="section form-shell">
          <div class="form-card">
            <div class="hero-kicker">Surprise & Delight Monthly</div>
            <h1>Set a monthly gesture</h1>
            <p class="section-lead">No weekly flowers. No random charges. You choose the monthly budget, get a reminder first, and can skip before the cutoff.</p>
            ${settingRows || '<p class="muted">No monthly gestures are active yet.</p>'}
            <form action="/surprise/settings" method="post">
              <label>Recipient<select name="recipientId" required>${recipientOptions}</select></label>
              <label>Monthly tier<select name="budgetTier" required>${getSurpriseMonthlyTiers().map((tier) => `<option value="${tier.key}">${escapeHtml(tier.name)}. ${formatMoney(tier.monthlyPriceCents)}/month</option>`).join('')}</select></label>
              <label>Preferred delivery day<input type="number" min="1" max="28" name="preferredDeliveryDay" value="15" /></label>
              <label>Notes<textarea name="notes" placeholder="Any tone or style notes for spontaneous gestures"></textarea></label>
              <button class="btn btn-primary" type="submit">Save monthly gesture</button>
            </form>
            ${ownSettings.length ? `<form action="/surprise/skip" method="post" class="inline-form-spaced"><input type="hidden" name="settingId" value="${escapeHtml(ownSettings[ownSettings.length - 1].id)}" /><button class="btn btn-secondary" type="submit">Skip this month</button></form>` : ''}
          </div>
        </section>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml('Surprise & Delight', body));
      return;
    }

    if (req.method === 'POST' && pathname === '/surprise/settings') {
      const customer = await getAuthAdapter().requireUser(req, res);
      if (!customer) {
        return;
      }
      const adapter = getStorageAdapter();
      const [memberships, recipients] = await Promise.all([adapter.listRelationshipMemberships(), adapter.listRecipients()]);
      if (!isSignaturePlan(getActiveMembership(memberships, customer.id))) {
        renderNoticePage(res, 403, {
          title: 'Signature Concierge required',
          message: 'Surprise & Delight Monthly is available only for Signature Concierge members.',
        });
        return;
      }
      const body = await readRequestBody(req);
      const values = new URLSearchParams(body);
      const recipient = recipients.find((entry) => entry.id === values.get('recipientId') && entry.userId === customer.id);
      if (!recipient) {
        renderNoticePage(res, 400, { title: 'Recipient required', message: 'Please choose one of your saved recipients.' });
        return;
      }
      const tier = getSurpriseMonthlyTier(values.get('budgetTier'));
      await adapter.createSurpriseDelightSetting({
        id: `surprise-${Date.now()}`,
        userId: customer.id,
        recipientId: recipient.id,
        budgetTier: tier.key,
        monthlyPriceCents: tier.monthlyPriceCents,
        preferredDeliveryDay: Number(values.get('preferredDeliveryDay') || 15),
        preferredDeliveryDate: '',
        reminderDaysBefore: 7,
        chargeDaysBefore: 5,
        status: 'active',
        skippedMonth: '',
        lastGeneratedMonth: '',
        notes: values.get('notes') || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      res.writeHead(302, { Location: '/surprise?settings=saved' });
      res.end();
      return;
    }

    if (req.method === 'POST' && pathname === '/surprise/skip') {
      const customer = await getAuthAdapter().requireUser(req, res);
      if (!customer) {
        return;
      }
      const body = await readRequestBody(req);
      const values = new URLSearchParams(body);
      const adapter = getStorageAdapter();
      const settings = await adapter.listSurpriseDelightSettings();
      const setting = settings.find((entry) => entry.id === values.get('settingId') && entry.userId === customer.id);
      if (!setting) {
        renderNoticePage(res, 404, { title: 'Monthly gesture not found', message: "We couldn't find that Surprise & Delight setting." });
        return;
      }
      await adapter.updateSurpriseDelightSetting(setting.id, { skippedMonth: currentMonthKey() });
      res.writeHead(302, { Location: '/surprise?skip=saved' });
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname === '/dashboard') {
      const customer = await getAuthAdapter().requireUser(req, res);
      if (!customer) {
        return;
      }
      const state = await getState();
      const ownRecipients = state.recipients.filter((recipient) => recipient.userId === customer.id);
      const ownMilestones = state.milestones.filter((milestone) => milestone.userId === customer.id);
      const ownOrders = state.orders.filter((order) => order.userId === customer.id);
      const protectedMilestones = ownMilestones.filter((milestone) => milestone.status !== 'cancelled');
      const upcomingOrderRows = ownOrders
        .filter((order) => order.status !== 'cancelled')
        .sort((a, b) => String(a.eventDate).localeCompare(String(b.eventDate)))
        .map((order) => {
          const recipient = ownRecipients.find((entry) => entry.id === order.recipientId);
          const source = order.orderSource === 'one_time'
            ? 'One-time delivery'
            : order.orderSource === 'surprise_monthly'
              ? 'Surprise & Delight'
              : 'Protected date';
          return `
            <div class="milestone-row">
              <div class="milestone-meta">
                <p><strong>${escapeHtml(order.occasionLabel || formatStatusLabel(order.occasionType || source))}</strong> for ${escapeHtml(recipient?.name || 'a recipient')} ${statusBadge(order.status)}</p>
                <p>${escapeHtml(source)}. Delivery date: ${escapeHtml(order.eventDate)}. Planned charge: ${escapeHtml(order.plannedChargeDate || 'not set')}.</p>
                ${order.reminderDate ? `<p>Reminder date: ${escapeHtml(order.reminderDate)}.</p>` : ''}
              </div>
            </div>`;
        }).join('');
      const milestoneRows = protectedMilestones.map((milestone) => {
        const recipient = ownRecipients.find((entry) => entry.id === milestone.recipientId);
        const order = ownOrders.find((entry) => entry.milestoneId === milestone.id);
        const reminderDate = milestone.eventDate ? calculateReminderDate(milestone.eventDate, milestone.reminderDaysBefore || 7) : '';
        const displayStatus = order ? order.status : milestone.status;
        const pauseAction = milestone.status === 'paused'
          ? `<form action="/milestones/${milestone.id}" method="post"><input type="hidden" name="action" value="reactivate" /><button class="btn btn-secondary" type="submit">Reactivate</button></form>`
          : `<form action="/milestones/${milestone.id}" method="post"><input type="hidden" name="action" value="pause" /><button class="btn btn-secondary" type="submit">Pause</button></form>`;
        const cancelAction = `<form action="/milestones/${milestone.id}" method="post" onsubmit="return confirm('Cancel this protected date? This cannot be undone.');"><input type="hidden" name="action" value="cancel" /><button class="btn btn-secondary" type="submit">Cancel</button></form>`;
        return `
          <div class="milestone-row">
            <div class="milestone-meta">
              <p><strong>${escapeHtml(milestone.occasionLabel || formatStatusLabel(milestone.occasionType))}</strong> for ${escapeHtml(recipient?.name || 'a recipient')} ${statusBadge(displayStatus)}</p>
              <p>Protected date: ${escapeHtml(milestone.eventDate)}. Budget tier: ${escapeHtml(formatStatusLabel(milestone.budgetTier))}</p>
              ${reminderDate ? `<p>We'll remind you on ${escapeHtml(reminderDate)}${order ? `, before the planned charge on ${escapeHtml(order.plannedChargeDate)}` : ''}.</p>` : ''}
            </div>
            <div class="milestone-actions">
              ${pauseAction}
              ${cancelAction}
            </div>
          </div>`;
      }).join('');
      const body = `
        <section class="section panel">
          <h1>Your protected dates</h1>
          <p class="section-lead">Every date is reviewed before anything is prepared. You always receive a reminder before a charge.</p>
          <div class="hero-actions">
            <a class="btn btn-primary" href="/recipients/new">Add someone important</a>
            <a class="btn btn-secondary" href="/milestones/new">Add another important date</a>
          </div>
        </section>
        <section class="section card">
          <h2 class="section-title">Upcoming</h2>
          ${protectedMilestones.length ? milestoneRows : `
            <p class="muted"><strong>No dates protected yet.</strong></p>
            <p class="muted">Start with one birthday or anniversary. It takes about a minute.</p>
            <a class="btn" href="/milestones/new">Add your first important date</a>
          `}
        </section>
        <section class="section card">
          <h2 class="section-title">Scheduled orders</h2>
          ${upcomingOrderRows || '<p class="muted">No deliveries are scheduled yet.</p>'}
        </section>
        <section class="section card">
          <h2 class="section-title">Recipients</h2>
          ${ownRecipients.length ? ownRecipients.map((recipient) => `<p><strong>${escapeHtml(recipient.name)}</strong>. ${escapeHtml(recipient.relationship)}<br/>${escapeHtml(recipient.city)}. ${escapeHtml(recipient.postalCode)}</p>`).join('') : '<p class="muted">Add your first recipient to start gifting thoughtfully.</p>'}
        </section>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml('Dashboard', body));
      return;
    }

    if (req.method === 'GET' && pathname === '/recipients/new') {
      const customer = await getAuthAdapter().requireUser(req, res);
      if (!customer) {
        return;
      }
      const body = `
        <section class="section form-shell">
          <div class="form-card">
          <div class="hero-kicker">Recipient</div>
          <h1>Who should we help you remember?</h1>
          <p class="section-lead">Save their details once. Use them for every future milestone. <span class="helper helper-inline">You can edit this later.</span></p>
          <form action="/recipients" method="post">
            <label>Name<input name="name" required /></label>
            <label>Relationship<input name="relationship" placeholder="Sister, mom, best friend..." required /><span class="helper">Use the words you would use with us in person.</span></label>
            <label>Phone<input name="phone" /></label>
            <label>Delivery address<input name="addressLine1" required /></label>
            <label>City<input name="city" required /></label>
            <label>Province<input name="province" required /></label>
            <label>Postal code<input name="postalCode" placeholder="M5V 2T6" required /></label>
            <label>Delivery instructions<textarea name="deliveryInstructions" placeholder="Buzzer code, gate code, or anything that helps our florist partner find the door"></textarea><span class="helper">Optional, but it helps deliveries go smoothly.</span></label>
            <button class="btn btn-primary" type="submit">Save recipient</button>
          </form>
          </div>
        </section>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml('Add recipient', body));
      return;
    }

    if (req.method === 'POST' && pathname === '/recipients') {
      const customer = await getAuthAdapter().requireUser(req, res);
      if (!customer) {
        return;
      }
      const body = await readRequestBody(req);
      const values = new URLSearchParams(body);
      const normalizedValues = Object.fromEntries(values.entries());
      const validation = validateRecipient(normalizedValues);
      if (validation.errors.length) {
        const errorHtml = `<section class="card"><h1>We need a few details before we can save this recipient.</h1>${validation.errors.map((error) => `<p class="muted">${escapeHtml(error)}</p>`).join('')}<p><a class="btn" href="/recipients/new">Try again</a></p></section>`;
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderHtml('Recipient error', errorHtml));
        return;
      }
      const recipient = {
        id: `recipient-${Date.now()}`,
        userId: customer.id,
        name: normalizedValues.name || '',
        relationship: normalizedValues.relationship || '',
        phone: normalizedValues.phone || '',
        addressLine1: normalizedValues.addressLine1 || '',
        addressLine2: '',
        city: normalizedValues.city || '',
        province: normalizedValues.province || '',
        postalCode: normalizePostalCode(normalizedValues.postalCode),
        deliveryInstructions: normalizedValues.deliveryInstructions || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await getStorageAdapter().createRecipient(recipient);
      res.writeHead(302, { Location: '/dashboard' });
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname === '/milestones/new') {
      const customer = await getAuthAdapter().requireUser(req, res);
      if (!customer) {
        return;
      }
      const state = await getState();
      const ownRecipients = state.recipients.filter((recipient) => recipient.userId === customer.id);
      const body = `
        <section class="section form-shell">
          <div class="form-card">
          <h1>What date should we protect?</h1>
          <p class="section-lead">Once saved, we remind you before anything is charged. <span class="helper helper-inline">You can edit this later.</span></p>
          <form action="/milestones" method="post">
            <label>Recipient<select name="recipientId" required>
              ${ownRecipients.map((recipient) => `<option value="${recipient.id}">${escapeHtml(recipient.name)}</option>`).join('')}
            </select></label>
            <label>Occasion type<select name="occasionType" required>
              <option value="birthday">Birthday</option>
              <option value="anniversary">Anniversary</option>
              <option value="valentines_day">Valentine's Day</option>
              <option value="mothers_day">Mother's Day</option>
              <option value="fathers_day">Father's Day</option>
              <option value="graduation">Graduation</option>
              <option value="thank_you">Thank you</option>
              <option value="apology">Apology</option>
              <option value="just_because">Just because</option>
              <option value="custom">Custom</option>
            </select><span class="helper">What are we celebrating? This helps us tailor the card message.</span></label>
            <label>Event date<input type="date" name="eventDate" required /><span class="helper">The date the flowers should arrive by.</span></label>
            <label><input type="checkbox" name="repeatsAnnually" checked /> Repeats annually<span class="helper">We'll protect this date again automatically next year.</span></label>
            <label>Budget tier<select name="budgetTier" required>
              ${getPricingTiers().map((tier) => `<option value="${tier.key}">${escapeHtml(tier.name)}. ${escapeHtml(formatMoney(tier.customerPriceCents))}</option>`).join('')}
            </select><span class="helper">A budget tier, not a fixed bouquet. The florist chooses what is best that week.</span></label>
            <label>Card message tone<select name="cardMessageTone">
              <option value="warm">Warm</option>
              <option value="romantic">Romantic</option>
              <option value="professional">Professional</option>
              <option value="playful">Playful</option>
              <option value="simple">Simple</option>
            </select><span class="helper">Sets the tone for the note we write on your behalf.</span></label>
            <label>Style preferences<textarea name="stylePreferences" placeholder="Soft pastels, bright colors, all-white..."></textarea><span class="helper">Optional. Designer's Choice gives the florist room to work with the best seasonal stems.</span></label>
            <div class="mood-grid" aria-label="Aesthetic mood examples">
              <label class="mood-card"><input type="radio" name="stylePreferences" value="Pastel & Eucalyptus" /><span class="mood-card-body"><h4>Pastel & Eucalyptus</h4><p>Muted rose tones, cream stems, soft greenery.</p></span></label>
              <label class="mood-card"><input type="radio" name="stylePreferences" value="Sculptural & Clean" /><span class="mood-card-body"><h4>Sculptural & Clean</h4><p>Structural lines, high-contrast foliage, restrained palette.</p></span></label>
              <label class="mood-card"><input type="radio" name="stylePreferences" value="Rich & Botanical" /><span class="mood-card-body"><h4>Rich & Botanical</h4><p>Deep seasonal tones, textural greenery, dramatic shape.</p></span></label>
            </div>
            <label>Allergies / avoid<textarea name="allergiesOrAvoid" placeholder="e.g. no lilies"></textarea><span class="helper">Anything the recipient is sensitive to or dislikes.</span></label>
            <label>Hard no preferences<textarea name="hardNoPreferences"></textarea><span class="helper">Anything that's an absolute no for this recipient.</span></label>
            <label>Status<select name="status">
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select></label>
            <button class="btn btn-primary" type="submit">Save protected date</button>
          </form>
          <p class="muted form-footnote">We remind you before anything is charged. You can pause or cancel before the cutoff.</p>
          </div>
        </section>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml('Add milestone', body));
      return;
    }

    if (req.method === 'POST' && pathname === '/milestones') {
      const customer = await getAuthAdapter().requireUser(req, res);
      if (!customer) {
        return;
      }
      const body = await readRequestBody(req);
      const values = new URLSearchParams(body);
      const normalizedValues = Object.fromEntries(values.entries());
      const validation = validateMilestone(normalizedValues);
      if (validation.errors.length) {
        const errorHtml = `<section class="card"><h1>We need a few details before we can save this protected date.</h1>${validation.errors.map((error) => `<p class="muted">${escapeHtml(error)}</p>`).join('')}<p><a class="btn" href="/milestones/new">Try again</a></p></section>`;
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderHtml('Milestone error', errorHtml));
        return;
      }
      const adapter = getStorageAdapter();
      const ownsRecipient = await assertCustomerOwnsRecipient(adapter, customer.id, normalizedValues.recipientId);
      if (!ownsRecipient) {
        renderNoticePage(res, 403, {
          title: "That recipient isn't yours",
          message: 'You can only create protected dates for recipients you added yourself.',
        });
        return;
      }
      const memberships = await adapter.listRelationshipMemberships();
      const activeMembership = getActiveMembership(memberships, customer.id);
      const activePlan = getRelationshipPlan(activeMembership?.planKey || 'datekeeper');
      const ownActiveMilestones = (await adapter.listMilestones()).filter((entry) => entry.userId === customer.id && entry.status !== 'cancelled');
      if (ownActiveMilestones.length >= activePlan.protectedDateLimit) {
        renderNoticePage(res, 403, {
          title: 'Plan limit reached',
          message: `${activePlan.name} protects up to ${activePlan.protectedDateLimit} dates each year. Choose a relationship plan before adding another protected date.`,
        });
        return;
      }
      const milestone = {
        id: `milestone-${Date.now()}`,
        userId: customer.id,
        recipientId: normalizedValues.recipientId || '',
        occasionType: normalizedValues.occasionType || 'custom',
        occasionLabel: normalizedValues.occasionLabel || '',
        eventDate: normalizedValues.eventDate || '',
        repeatsAnnually: normalizedValues.repeatsAnnually === 'on',
        budgetTier: normalizedValues.budgetTier || 'classic',
        status: normalizedValues.status || 'active',
        cardMessageTone: normalizedValues.cardMessageTone || 'warm',
        stylePreferences: normalizedValues.stylePreferences || '',
        allergiesOrAvoid: normalizedValues.allergiesOrAvoid || '',
        hardNoPreferences: normalizedValues.hardNoPreferences || '',
        reminderDaysBefore: 7,
        chargeDaysBefore: 5,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const recipient = await adapter.getRecipientById(milestone.recipientId);
      const serviceZones = await adapter.listServiceZones();
      const serviceZone = getServiceZoneForPostalCode(serviceZones, recipient?.postalCode || '');
      await adapter.createMilestone(milestone);
      if (milestone.eventDate) {
        const order = createScheduledOrderFromMilestone(milestone, customer, serviceZone || { deliveryFeeCents: 0 });
        await adapter.createScheduledOrder(order);
      }
      res.writeHead(302, { Location: '/dashboard' });
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname === '/login') {
      const authBackend = String(process.env.AUTH_BACKEND || 'pilot').toLowerCase();
      const passwordField = authBackend === 'supabase' ? '<label>Password<input type="password" name="password" required /></label>' : '';
      const notice = authBackend === 'supabase'
        ? '<p class="muted">Sign in with your Supabase Auth account. Private pilot accounts are created manually; there is no public sign-up yet.</p>'
        : '<p class="muted">This is a temporary local pilot login. Enter any email; no password is required yet.</p>';
      const body = `
        <section class="section form-shell">
          <div class="form-card">
          <div class="hero-kicker">Private pilot</div>
          <h1>Customer login</h1>
          ${notice}
          <form action="/login" method="post">
            <label>Email<input type="email" name="email" required /></label>
            ${passwordField}
            <button class="btn btn-primary" type="submit">Sign in</button>
          </form>
          </div>
        </section>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml('Login', body));
      return;
    }

    if (req.method === 'POST' && pathname === '/login') {
      const body = await readRequestBody(req);
      const values = new URLSearchParams(body);
      const email = values.get('email') || '';
      const password = values.get('password') || '';
      const rateLimit = loginRateLimiter.check(req, email);
      if (!rateLimit.allowed) {
        tooManyAttemptsResponse(res, "We couldn't sign you in.");
        return;
      }
      const authAdapter = getAuthAdapter();
      const result = await authAdapter.signInWithEmailPassword(email, password);
      if (!result.ok) {
        const errorHtml = `<section class="card"><h1>We couldn't sign you in.</h1><p class="muted">${escapeHtml(result.error || 'Invalid email or password.')}</p><p><a class="btn" href="/login">Try again</a></p></section>`;
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderHtml('Login error', errorHtml));
        return;
      }
      loginRateLimiter.reset(req, email);
      authAdapter.createSessionCookies(res, result.session);
      res.writeHead(302, { Location: '/dashboard' });
      res.end();
      return;
    }

    if (req.method === 'POST' && pathname === '/logout') {
      const authAdapter = getAuthAdapter();
      await authAdapter.signOut(req, res);
      res.writeHead(302, { Location: '/login' });
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname === '/admin/login') {
      const authBackend = String(process.env.AUTH_BACKEND || 'pilot').toLowerCase();
      const passwordField = authBackend === 'supabase' ? '<label>Password<input type="password" name="password" required /></label>' : '';
      const notice = authBackend === 'supabase'
        ? '<p class="muted">Sign in with a Supabase Auth account listed in ADMIN_EMAILS.</p>'
        : '<p class="muted">Pilot admin access. Use an email listed in ADMIN_EMAILS.</p>';
      const body = `
        <section class="section form-shell">
          <div class="form-card">
          <div class="hero-kicker">Admin</div>
          <h1>Temporary pilot admin access</h1>
          ${notice}
          <form action="/admin/login" method="post">
            <label>Admin email<input name="email" required /></label>
            ${passwordField}
            <button class="btn btn-primary" type="submit">Enter admin area</button>
          </form>
          </div>
        </section>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml('Admin login', body));
      return;
    }

    if (req.method === 'POST' && pathname === '/admin/login') {
      const body = await readRequestBody(req);
      const values = new URLSearchParams(body);
      const email = values.get('email') || '';
      const password = values.get('password') || '';
      const authBackend = String(process.env.AUTH_BACKEND || 'pilot').toLowerCase();

      const rateLimit = adminLoginRateLimiter.check(req, email);
      if (!rateLimit.allowed) {
        tooManyAttemptsResponse(res, 'Admin sign-in unavailable');
        return;
      }

      if (authBackend !== 'supabase') {
        if (!isAdminEmail(email)) {
          renderNoticePage(res, 403, {
            title: 'Not an authorized admin email',
            message: 'That email is not authorized for pilot admin access.',
          });
          return;
        }
        adminLoginRateLimiter.reset(req, email);
        res.writeHead(302, { Location: '/admin', 'Set-Cookie': getAdminCookieValue(email) });
        res.end();
        return;
      }

      const authAdapter = getAuthAdapter();
      const result = await authAdapter.signInWithEmailPassword(email, password);
      if (!result.ok) {
        renderNoticePage(res, 401, {
          title: "We couldn't sign you in",
          message: result.error || 'Invalid email or password.',
        });
        return;
      }
      if (!isAdminEmail(email)) {
        renderNoticePage(res, 403, {
          title: 'Not an authorized admin account',
          message: 'That account is not authorized for admin access.',
        });
        return;
      }
      adminLoginRateLimiter.reset(req, email);
      authAdapter.createSessionCookies(res, result.session);
      res.writeHead(302, { Location: '/admin' });
      res.end();
      return;
    }

    if (req.method === 'POST' && pathname === '/admin/logout') {
      const authBackend = String(process.env.AUTH_BACKEND || 'pilot').toLowerCase();
      if (authBackend === 'supabase') {
        getAuthAdapter().clearSessionCookies(res);
        res.writeHead(302, { Location: '/admin/login' });
        res.end();
        return;
      }
      res.writeHead(302, { Location: '/admin/login', 'Set-Cookie': getAdminClearCookieValue() });
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname === '/admin') {
      const allowed = await getAuthAdapter().requireAdmin(req, res);
      if (!allowed) {
        return;
      }
      const state = await getState();
      const pendingCharge = state.orders.filter((order) => order.status === 'pending_charge').length;
      const needingAssignment = state.orders.filter((order) => !order.floristPartnerId).length;
      const delivered = state.orders.filter((order) => order.status === 'delivered').length;
      const issues = state.orders.filter((order) => order.status === 'issue_reported' || order.status === 'refunded').length;
      const oneTimeOrders = state.orders.filter((order) => order.orderSource === 'one_time').length;
      const protectedDateOrders = state.orders.filter((order) => (order.orderSource || 'milestone') === 'milestone').length;
      const surpriseOrders = state.orders.filter((order) => order.orderSource === 'surprise_monthly').length;
      const activeMemberships = (state.relationshipMemberships || []).filter((membership) => membership.status === 'active').length;
      const skippedSurpriseMonths = (state.surpriseDelightSettings || []).filter((setting) => setting.skippedMonth).length;
      const avgSupport = state.orders.reduce((sum, order) => sum + (order.supportMinutes || 0), 0) / Math.max(state.orders.length, 1);
      const body = `
        <section class="section panel">
          <div class="hero-kicker">Operations</div>
          <h1>Admin operations</h1>
          <p class="muted">Manual concierge fulfillment for TheFlowerist pilot.</p>
          <div class="hero-actions">
            <a class="btn btn-primary" href="/admin/orders">View orders</a>
            <a class="btn btn-secondary" href="/admin/florists">Manage florists</a>
            <a class="btn btn-secondary" href="/admin/zones">Manage zones</a>
            <form action="/admin/logout" method="post" class="inline-form"><button class="btn btn-secondary" type="submit">Log out</button></form>
          </div>
        </section>
        <section class="section admin-grid">
          <div class="card stat-card"><h3>Needing florist assignment</h3><p class="stat-number">${needingAssignment}</p></div>
          <div class="card stat-card"><h3>Pending charge</h3><p class="stat-number">${pendingCharge}</p></div>
          <div class="card stat-card"><h3>Issues / refunds</h3><p class="stat-number">${issues}</p></div>
          <div class="card stat-card"><h3>Total orders</h3><p class="stat-number">${state.orders.length}</p></div>
          <div class="card stat-card"><h3>One-time orders</h3><p class="stat-number">${oneTimeOrders}</p></div>
          <div class="card stat-card"><h3>Protected-date orders</h3><p class="stat-number">${protectedDateOrders}</p></div>
          <div class="card stat-card"><h3>Surprise monthly orders</h3><p class="stat-number">${surpriseOrders}</p></div>
          <div class="card stat-card"><h3>Active memberships</h3><p class="stat-number">${activeMemberships}</p></div>
          <div class="card stat-card"><h3>Skipped surprise months</h3><p class="stat-number">${skippedSurpriseMonths}</p></div>
          <div class="card stat-card"><h3>Delivered</h3><p class="stat-number">${delivered}</p></div>
          <div class="card stat-card"><h3>Avg support minutes</h3><p class="stat-number">${avgSupport.toFixed(1)}</p></div>
        </section>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml('Admin', body));
      return;
    }

    if (req.method === 'GET' && pathname === '/admin/orders') {
      const allowed = await getAuthAdapter().requireAdmin(req, res);
      if (!allowed) {
        return;
      }
      const state = await getState();
      const rows = state.orders.map((order) => {
        const recipient = state.recipients.find((item) => item.id === order.recipientId);
        const florist = state.floristPartners.find((item) => item.id === order.floristPartnerId);
        return `<tr><td>${escapeHtml(order.eventDate)}</td><td>${escapeHtml(formatStatusLabel(order.orderSource || 'milestone'))}</td><td>${escapeHtml(recipient?.name || '')}</td><td>${escapeHtml(state.users.find((user) => user.id === order.userId)?.name || '')}</td><td>${escapeHtml(recipient?.city || '')}/${escapeHtml(recipient?.postalCode || '')}</td><td>${escapeHtml(order.budgetTier)}</td><td>${escapeHtml(formatMoney(order.estimatedCustomerPriceCents))}</td><td>${statusBadge(order.status)}</td><td>${escapeHtml(florist?.name || 'Unassigned')}</td><td>${escapeHtml(order.plannedChargeDate)}</td><td>${escapeHtml(String(order.supportMinutes))}</td><td><a href="/admin/orders/${order.id}">Inspect</a></td></tr>`;
      }).join('');
      const body = `
        <section class="section card">
          <h1>Admin orders</h1>
          <p class="muted">Sorted by event date ascending so the concierge team can work the next handoffs first.</p>
          <div class="data-table"><table>
            <thead><tr><th>Event date</th><th>Source</th><th>Recipient</th><th>Customer</th><th>City/postal</th><th>Tier</th><th>Est. price</th><th>Status</th><th>Florist</th><th>Planned charge</th><th>Support min</th><th>Actions</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
        </section>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml('Admin orders', body));
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/admin/orders/')) {
      const allowed = await getAuthAdapter().requireAdmin(req, res);
      if (!allowed) {
        return;
      }
      const orderId = pathname.split('/').pop();
      const state = await getState();
      const order = state.orders.find((entry) => entry.id === orderId);
      if (!order) {
        renderNoticePage(res, 404, { title: 'Order not found', message: "We couldn't find that order." });
        return;
      }
      const recipient = state.recipients.find((entry) => entry.id === order.recipientId);
      const customer = state.users.find((entry) => entry.id === order.userId);
      const florist = state.floristPartners.find((entry) => entry.id === order.floristPartnerId);
      const membership = getActiveMembership(state.relationshipMemberships || [], order.userId);
      const surpriseSetting = (state.surpriseDelightSettings || []).find((entry) => entry.id === order.surpriseSettingId);
      const floristOptions = state.floristPartners.map((partner) => `<option value="${partner.id}" ${order.floristPartnerId === partner.id ? 'selected' : ''}>${escapeHtml(partner.name)}</option>`).join('');
      const timeline = (state.orderEvents || []).filter((entry) => entry.orderId === order.id).slice(-8).map((entry) => `<li><strong>${escapeHtml(entry.createdAt)}</strong>. ${escapeHtml(entry.actorType)}. ${escapeHtml(entry.type)}. ${escapeHtml(entry.message)}</li>`).join('');
      const body = `
        <section class="section panel">
          <h1>Order ${escapeHtml(order.id)}</h1>
          <div class="summary-list">
            <p><strong>Customer:</strong> ${escapeHtml(customer?.name || 'Unknown')} ${customer?.email ? `(${escapeHtml(customer.email)})` : ''}</p>
            <p><strong>Recipient:</strong> ${escapeHtml(recipient?.name || 'Unknown')}${recipient ? `. ${escapeHtml(recipient.city)} ${escapeHtml(recipient.postalCode)}` : ''}</p>
            <p><strong>Source:</strong> ${escapeHtml(formatStatusLabel(order.orderSource || 'milestone'))}</p>
            <p><strong>Occasion:</strong> ${escapeHtml(order.occasionLabel || formatStatusLabel(order.occasionType || ''))}</p>
            <p><strong>Event date:</strong> ${escapeHtml(order.eventDate)}</p>
            <p><strong>Reminder date:</strong> ${escapeHtml(order.reminderDate || '')}</p>
            <p><strong>Planned charge date:</strong> ${escapeHtml(order.plannedChargeDate)}</p>
            <p><strong>Estimated customer price:</strong> ${escapeHtml(formatMoney(order.estimatedCustomerPriceCents))}</p>
            <p><strong>Membership:</strong> ${escapeHtml(membership ? getRelationshipPlan(membership.planKey).name : 'None')}</p>
            ${surpriseSetting ? `<p><strong>Surprise context:</strong> ${escapeHtml(formatMoney(surpriseSetting.monthlyPriceCents))} monthly. Skip month: ${escapeHtml(surpriseSetting.skippedMonth || 'none')}.</p>` : ''}
            <p><strong>Florist:</strong> ${escapeHtml(florist?.name || 'Unassigned')}</p>
            <p><strong>Status:</strong> ${statusBadge(order.status)}</p>
          </div>
          <form class="form-card" action="/admin/orders/${order.id}" method="post">
            <label>Status<select name="status">
              <option value="scheduled" ${order.status === 'scheduled' ? 'selected' : ''}>Scheduled</option>
              <option value="pending_charge" ${order.status === 'pending_charge' ? 'selected' : ''}>Pending charge</option>
              <option value="charged" ${order.status === 'charged' ? 'selected' : ''}>Charged</option>
              <option value="sent_to_florist" ${order.status === 'sent_to_florist' ? 'selected' : ''}>Sent to florist</option>
              <option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>Delivered</option>
              <option value="issue_reported" ${order.status === 'issue_reported' ? 'selected' : ''}>Issue reported</option>
              <option value="refunded" ${order.status === 'refunded' ? 'selected' : ''}>Refunded</option>
              <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
            </select></label>
            <label>Florist<select name="floristPartnerId">${floristOptions}<option value="">Unassigned</option></select></label>
            <label>Internal notes<textarea name="internalNotes">${escapeHtml(order.internalNotes || '')}</textarea></label>
            <label>Customer notes<textarea name="customerNotes">${escapeHtml(order.customerNotes || '')}</textarea></label>
            <label>Card message<textarea name="generatedCardMessage">${escapeHtml(order.generatedCardMessage || '')}</textarea></label>
            <label>Photo proof URL<input name="photoProofUrl" value="${escapeHtml(order.photoProofUrl || '')}" /><span class="field-hint">Required before marking an order Delivered.</span></label>
            <label>Support minutes<input type="number" name="supportMinutes" value="${escapeHtml(String(order.supportMinutes || 0))}" /></label>
            <label>Refund amount<input type="number" name="refundAmountCents" value="${escapeHtml(String(order.refundAmountCents || 0))}" /></label>
            <label>Cancellation reason<input name="cancellationReason" value="${escapeHtml(order.cancellationReason || '')}" /></label>
            <label>Issue notes<textarea name="issueNotes">${escapeHtml(order.issueNotes || '')}</textarea></label>
            <label>Manual price override (dollars, optional)<input type="number" step="0.01" name="priceOverrideDollars" placeholder="${(order.estimatedCustomerPriceCents / 100).toFixed(2)}" /><span class="field-hint">Leave blank to keep the current price. Requires a reason below.</span></label>
            <label>Override reason<input name="priceOverrideReason" value="${escapeHtml(order.priceOverrideReason || '')}" /></label>
            <label>Event note<input name="eventMessage" /></label>
            <button class="btn btn-primary" type="submit">Update order</button>
          </form>
          <h3>Timeline</h3>
          <ul class="timeline">${timeline || '<li>No events yet.</li>'}</ul>
        </section>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml('Order detail', body));
      return;
    }

    if (req.method === 'POST' && pathname.startsWith('/admin/orders/')) {
      const allowed = await getAuthAdapter().requireAdmin(req, res);
      if (!allowed) {
        return;
      }
      const orderId = pathname.split('/').pop();
      const body = await readRequestBody(req);
      const values = new URLSearchParams(body);
      const adapter = getStorageAdapter();
      const order = await adapter.getScheduledOrderById(orderId);
      if (!order) {
        renderNoticePage(res, 404, { title: 'Order not found', message: "We couldn't find that order." });
        return;
      }
      const nextStatus = values.get('status') || order.status;
      if (!validateStatusTransition(order.status, nextStatus)) {
        renderNoticePage(res, 400, { title: 'Invalid status change', message: 'That status change is not allowed from the order current status.' });
        return;
      }
      const photoProofUrl = values.get('photoProofUrl') || '';
      if (nextStatus === 'delivered' && !photoProofUrl && !order.photoProofUrl) {
        renderNoticePage(res, 400, {
          title: 'Photo proof required',
          message: 'Add a photo proof URL before marking an order Delivered, per the delivery-confirmation workflow.',
        });
        return;
      }

      const priceOverrideDollarsRaw = (values.get('priceOverrideDollars') || '').trim();
      const priceOverrideReasonInput = (values.get('priceOverrideReason') || '').trim();
      let nextPriceCents = order.estimatedCustomerPriceCents;
      let priceOverrideApplied = false;
      if (priceOverrideDollarsRaw) {
        if (!priceOverrideReasonInput) {
          renderNoticePage(res, 400, {
            title: 'Override reason required',
            message: 'A reason is required whenever the price is manually overridden.',
          });
          return;
        }
        nextPriceCents = Math.round(Number(priceOverrideDollarsRaw) * 100);
        priceOverrideApplied = true;
      }

      const eventMessage = values.get('eventMessage') || `Updated order fields; status ${nextStatus}`;
      await adapter.updateScheduledOrder(orderId, {
        status: nextStatus,
        floristPartnerId: values.get('floristPartnerId') || null,
        internalNotes: values.get('internalNotes') || '',
        customerNotes: values.get('customerNotes') || '',
        generatedCardMessage: values.get('generatedCardMessage') || '',
        photoProofUrl,
        supportMinutes: Number(values.get('supportMinutes') || 0),
        refundAmountCents: values.get('refundAmountCents') ? Number(values.get('refundAmountCents')) : null,
        cancellationReason: values.get('cancellationReason') || '',
        issueNotes: values.get('issueNotes') || '',
        estimatedCustomerPriceCents: nextPriceCents,
        priceOverrideReason: priceOverrideApplied ? priceOverrideReasonInput : (order.priceOverrideReason || ''),
      });
      await logOrderEvent(adapter, orderId, {
        type: 'status_change',
        message: eventMessage,
        actorType: 'admin',
      });
      if (priceOverrideApplied) {
        await logOrderEvent(adapter, orderId, {
          type: 'price_override',
          message: `Price manually overridden to ${formatMoney(nextPriceCents)}: ${priceOverrideReasonInput}`,
          actorType: 'admin',
        });
      }
      res.writeHead(302, { Location: `/admin/orders/${orderId}` });
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname === '/admin/florists') {
      const allowed = await getAuthAdapter().requireAdmin(req, res);
      if (!allowed) {
        return;
      }
      const state = await getState();
      const floristRows = state.floristPartners.map((florist) => `<tr><td>${escapeHtml(florist.name)}</td><td>${escapeHtml(florist.city)}</td><td>${escapeHtml(florist.email)}</td><td>${escapeHtml(String(florist.active))}</td></tr>`).join('');
      const body = `
        <section class="section card">
          <h1>Florist partners</h1>
          <p class="muted">Manual partner management for the concierge pilot.</p>
          <div class="data-table"><table>
            <thead><tr><th>Name</th><th>City</th><th>Email</th><th>Active</th></tr></thead>
            <tbody>${floristRows}</tbody>
          </table></div>
        </section>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml('Florist partners', body));
      return;
    }

    if (req.method === 'GET' && pathname === '/admin/zones') {
      const allowed = await getAuthAdapter().requireAdmin(req, res);
      if (!allowed) {
        return;
      }
      const state = await getState();
      const zoneRows = state.serviceZones.map((zone) => `<tr><td>${escapeHtml(zone.name)}</td><td>${escapeHtml(zone.prefixes.join(', '))}</td><td>${escapeHtml(String(zone.deliveryFeeCents))}</td></tr>`).join('');
      const body = `
        <section class="section card">
          <h1>Service zones</h1>
          <p class="muted">Coverage stays narrow for the pilot. Each active zone needs a florist partner and a delivery workflow.</p>
          <div class="data-table"><table>
            <thead><tr><th>Name</th><th>Prefixes</th><th>Delivery fee</th></tr></thead>
            <tbody>${zoneRows}</tbody>
          </table></div>
        </section>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml('Service zones', body));
      return;
    }

    if (req.method === 'GET' && pathname === '/account') {
      const customer = await getAuthAdapter().requireUser(req, res);
      if (!customer) {
        return;
      }
      const state = await getState();
      const ownConsents = state.paymentConsents.filter((entry) => entry.userId === customer.id);
      const consent = ownConsents[ownConsents.length - 1];
      const body = `
        <section class="section vault-panel">
          <div class="vault-kicker">Concierge Vault</div>
          <h1>Account and preferences</h1>
          <p class="section-lead">Your important dates stay in your control. Nothing here is a recurring subscription.</p>
          <div class="reassurance">
            <h4>How charging works</h4>
            <ul>
              <li>Your card is not charged today.</li>
              <li>We remind you before every scheduled charge.</li>
              <li>You can pause or cancel before the cutoff, any time.</li>
            </ul>
          </div>
          <div class="summary-list">
            <p><strong>Communication preferences:</strong> email ${customer.marketingEmailConsent ? 'on' : 'off'}, SMS ${customer.marketingSmsConsent ? 'on' : 'off'}</p>
            <p><strong>Payment consent state:</strong> ${consent?.active ? 'Active for future concierge charges' : 'Not yet saved'}</p>
            <p><strong>Privacy reassurance:</strong> Your details are used only to coordinate flowers and protect recipient information.</p>
          </div>
          <p><a class="btn btn-primary" href="/account/payment-consent">Manage payment consent</a></p>
        </section>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml('Account', body));
      return;
    }

    if (req.method === 'GET' && pathname === '/account/payment-consent') {
      const customer = await getAuthAdapter().requireUser(req, res);
      if (!customer) {
        return;
      }
      const state = await getState();
      const ownConsents = state.paymentConsents.filter((entry) => entry.userId === customer.id);
      const consent = ownConsents[ownConsents.length - 1];
      const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);
      const hasPaymentMethodOnFile = Boolean(consent?.active && consent?.stripePaymentMethodId);
      const setupNotice = requestUrl.searchParams.get('setup') === 'complete'
        ? notice('success', 'Your card is saved. We will remind you before any scheduled charge.')
        : requestUrl.searchParams.get('setup') === 'cancelled'
          ? notice('error', 'Card setup was cancelled. No payment method was saved.')
          : '';
      const actionArea = !stripeConfigured
        ? `<p class="muted">Card capture is not configured in this environment (missing STRIPE_SECRET_KEY). No form is shown.</p>`
        : hasPaymentMethodOnFile
          ? `
            <p class="muted">A payment method is on file and ready for future scheduled charges.</p>
            <form action="/account/payment-consent/revoke" method="post" class="inline-form-spaced">
              <button class="btn btn-secondary" type="submit">Revoke consent</button>
            </form>`
          : `
            <form action="/account/payment-consent" method="post">
              <label><input type="checkbox" name="consent" checked /> I consent to this pilot payment workflow</label>
              <button class="btn btn-primary" type="submit">Save payment method</button>
            </form>`;
      const body = `
        <section class="section vault-panel">
          <div class="vault-kicker">Concierge Vault</div>
          <h1>Payment consent</h1>
          ${setupNotice}
          <div class="reassurance">
            <h4>Your card is not charged today.</h4>
            <ul>
              <li>We remind you before scheduled charges.</li>
              <li>You can pause or cancel before the cutoff.</li>
              <li>Card details are collected and stored by Stripe in test mode. This app never handles raw card numbers.</li>
            </ul>
          </div>
          <p class="muted">Saving a payment method is not a charge. It authorizes future concierge charges for orders you've scheduled.</p>
          <p class="muted">Payment details remain server-side and are never shown in this interface.</p>
          <p class="muted">${escapeHtml(consent?.consentTextSnapshot || CONSENT_TEXT_SNAPSHOT)}</p>
          ${actionArea}
        </section>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml('Payment consent', body));
      return;
    }

    if (req.method === 'POST' && pathname === '/account/payment-consent') {
      const customer = await getAuthAdapter().requireUser(req, res);
      if (!customer) {
        return;
      }
      const body = await readRequestBody(req);
      const values = new URLSearchParams(body);
      const consented = ['on', 'true', '1', 'yes'].includes(String(values.get('consent') || '').toLowerCase());
      const adapter = getStorageAdapter();

      if (!consented) {
        await adapter.createPaymentConsent({
          id: `consent-${Date.now()}`,
          userId: customer.id,
          stripeCustomerId: '',
          stripePaymentMethodId: '',
          consentTextVersion: CONSENT_TEXT_VERSION,
          consentTextSnapshot: CONSENT_TEXT_SNAPSHOT,
          consentedAt: new Date().toISOString(),
          ipAddress: '',
          userAgent: req.headers['user-agent'] || '',
          active: false,
        });
        res.writeHead(302, { Location: '/account' });
        res.end();
        return;
      }

      let stripe;
      try {
        stripe = getStripeClient();
      } catch (error) {
        renderNoticePage(res, 503, {
          title: 'Card setup is unavailable',
          message: 'Payment capture is not configured in this environment yet.',
        });
        return;
      }

      const existingConsents = await adapter.listPaymentConsents();
      const priorStripeCustomerId = existingConsents
        .filter((entry) => entry.userId === customer.id && entry.stripeCustomerId)
        .map((entry) => entry.stripeCustomerId)
        .pop();
      const stripeCustomerId = priorStripeCustomerId
        || (await stripe.customers.create({ email: customer.email || undefined, name: customer.name || undefined, metadata: { appCustomerId: customer.id } })).id;

      const baseUrl = getBaseUrl(req);
      const session = await stripe.checkout.sessions.create({
        mode: 'setup',
        customer: stripeCustomerId,
        success_url: `${baseUrl}/account/payment-consent/complete?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/account/payment-consent?setup=cancelled`,
        metadata: { appCustomerId: customer.id },
      });
      res.writeHead(302, { Location: session.url });
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname === '/account/payment-consent/complete') {
      const customer = await getAuthAdapter().requireUser(req, res);
      if (!customer) {
        return;
      }
      const sessionId = requestUrl.searchParams.get('session_id');
      if (!sessionId) {
        res.writeHead(302, { Location: '/account/payment-consent?setup=cancelled' });
        res.end();
        return;
      }
      let stripe;
      try {
        stripe = getStripeClient();
      } catch (error) {
        renderNoticePage(res, 503, {
          title: 'Card setup is unavailable',
          message: 'Payment capture is not configured in this environment yet.',
        });
        return;
      }
      const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['setup_intent'] });
      const setupIntent = session.setup_intent;
      if (!setupIntent || setupIntent.status !== 'succeeded') {
        res.writeHead(302, { Location: '/account/payment-consent?setup=cancelled' });
        res.end();
        return;
      }
      const paymentMethodId = typeof setupIntent.payment_method === 'string' ? setupIntent.payment_method : setupIntent.payment_method?.id;
      await getStorageAdapter().createPaymentConsent({
        id: `consent-${Date.now()}`,
        userId: customer.id,
        stripeCustomerId: session.customer,
        stripePaymentMethodId: paymentMethodId,
        consentTextVersion: CONSENT_TEXT_VERSION,
        consentTextSnapshot: CONSENT_TEXT_SNAPSHOT,
        consentedAt: new Date().toISOString(),
        ipAddress: '',
        userAgent: req.headers['user-agent'] || '',
        active: true,
      });
      res.writeHead(302, { Location: '/account/payment-consent?setup=complete' });
      res.end();
      return;
    }

    if (req.method === 'POST' && pathname === '/account/payment-consent/revoke') {
      const customer = await getAuthAdapter().requireUser(req, res);
      if (!customer) {
        return;
      }
      const body = await readRequestBody(req);
      const values = new URLSearchParams(body);
      const adapter = getStorageAdapter();
      const requestedConsentId = values.get('consentId');
      const allConsents = await adapter.listPaymentConsents();
      const ownConsents = allConsents.filter((entry) => entry.userId === customer.id);
      let targetConsentId = null;
      if (requestedConsentId) {
        const owned = ownConsents.find((entry) => entry.id === requestedConsentId);
        if (!owned) {
          renderNoticePage(res, 404, { title: 'Consent record not found', message: "We couldn't find that payment consent." });
          return;
        }
        targetConsentId = owned.id;
      } else {
        targetConsentId = ownConsents[ownConsents.length - 1]?.id || null;
      }
      if (targetConsentId) {
        await adapter.revokePaymentConsent(targetConsentId);
      }
      res.writeHead(302, { Location: '/account' });
      res.end();
      return;
    }

    if (req.method === 'POST' && pathname.startsWith('/milestones/')) {
      const customer = await getAuthAdapter().requireUser(req, res);
      if (!customer) {
        return;
      }
      const milestoneId = pathname.split('/').pop();
      const adapter = getStorageAdapter();
      const owns = await assertCustomerOwnsMilestone(adapter, customer.id, milestoneId);
      if (!owns) {
        renderNoticePage(res, 404, { title: 'Milestone not found', message: "We couldn't find that protected date." });
        return;
      }
      const body = await readRequestBody(req);
      const values = new URLSearchParams(body);
      const action = values.get('action') || 'pause';
      const nextStatus = action === 'reactivate' ? 'active' : action === 'cancel' ? 'cancelled' : 'paused';
      await adapter.updateMilestone(milestoneId, { status: nextStatus });
      if (action === 'cancel') {
        // A cancelled protected date must never still fire a charge. Cascade
        // the cancellation to any not-yet-charged order tied to this milestone
        // rather than relying solely on the charge step to notice later.
        const orders = await adapter.listScheduledOrders();
        const relatedOrders = orders.filter((order) => order.milestoneId === milestoneId);
        for (const order of relatedOrders) {
          if (validateStatusTransition(order.status, 'cancelled')) {
            await adapter.updateScheduledOrder(order.id, { status: 'cancelled' });
            await logOrderEvent(adapter, order.id, {
              type: 'status_change',
              message: 'Order cancelled automatically because the protected date was cancelled.',
              actorType: 'customer',
            });
          }
        }
      }
      res.writeHead(302, { Location: '/dashboard' });
      res.end();
      return;
    }

    writeJson(res, 404, { error: 'not_found' });
  }
}

module.exports = {
  createRouter,
};
