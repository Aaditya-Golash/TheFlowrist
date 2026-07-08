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
  getServiceZoneForPostalCode,
  isPostalCodeInZone,
  calculateEstimatedPrice,
  validateStatusTransition,
  normalizePostalCode,
  PRICING_TIERS,
} = require('./logic');
const { validateRecipient, validateMilestone } = require('./validation');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatCents(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(0)}`;
}

function formatStatusLabel(status) {
  return String(status || '').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusBadge(status) {
  return `<span class="status status-${escapeHtml(status)}">${escapeHtml(formatStatusLabel(status))}</span>`;
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function writeText(res, statusCode, text) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
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

function tooManyAttemptsResponse(res, title) {
  const body = `<section class="card"><h1>${escapeHtml(title)}</h1><p class="muted">Too many attempts. Please wait a few minutes and try again.</p></section>`;
  res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(renderHtml('Too many attempts', body));
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
      const orders = await getStorageAdapter().listScheduledOrders();
      const filtered = orders.filter((order) => order.status === 'scheduled');
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

    if (req.method === 'GET' && pathname === '/') {
      const state = await getState();
      const body = `
        <section class="card hero">
          <div>
            <div class="pill">Milestone flower concierge · Toronto private pilot</div>
            <h1>Set important dates once. We handle the flowers.</h1>
            <p class="muted">TheFlowrist isn't a flower shop and it isn't a weekly subscription. Tell us the dates that matter — birthdays, anniversaries, thank-yous — and our concierge team quietly takes care of the rest, with a reminder before anything is ever charged.</p>
            <a class="btn" href="/dashboard">Add your first important date</a>
            <a class="btn secondary" href="#how-it-works">View how it works</a>
          </div>
          <div class="card">
            <h3>What you get</h3>
            <ul>
              <li>One place to protect every important date</li>
              <li>A reminder before any charge — never a surprise</li>
              <li>Designer's-choice seasonal arrangements, never a rigid catalog</li>
              <li>A real concierge team handling florist coordination</li>
            </ul>
          </div>
        </section>

        <section class="card" id="how-it-works">
          <h2 class="section-title">How it works</h2>
          <p class="section-lead">Five minutes now protects a date all year.</p>
          <ol class="steps">
            <li><div><strong>Tell us who and when</strong><span>Add a recipient and the date you want to protect — a birthday, anniversary, or any occasion that matters.</span></div></li>
            <li><div><strong>Choose a budget tier</strong><span>Classic, Premium, or Signature — no need to pick a specific bouquet.</span></div></li>
            <li><div><strong>We remind you first</strong><span>A few days before anything is charged, we let you know it's coming.</span></div></li>
            <li><div><strong>Our florist partner curates it</strong><span>Designer's Choice means the best seasonal stems available, matched to your style preferences.</span></div></li>
            <li><div><strong>Pause or cancel anytime</strong><span>Change your mind before the cutoff and nothing happens — no questions asked.</span></div></li>
          </ol>
        </section>

        <section class="card">
          <h2 class="section-title">Why this feels different</h2>
          <p class="section-lead">Not a shop. Not a subscription. A concierge that remembers for you.</p>
          <div class="trust-grid">
            <div class="trust-item"><h4>No weekly subscription</h4><p>You only get flowers on the dates you choose to protect — nothing recurring, nothing you didn't ask for.</p></div>
            <div class="trust-item"><h4>Reminder before every charge</h4><p>We always tell you before a scheduled charge, with plenty of time to make changes.</p></div>
            <div class="trust-item"><h4>Pause or cancel before the cutoff</h4><p>Life changes. You can pause or cancel any upcoming order right up until the cutoff, no penalty.</p></div>
            <div class="trust-item"><h4>Designer's-choice seasonal flowers</h4><p>Our florist partners choose the best seasonal stems for the moment — this keeps quality high and never overpromises an exact bouquet.</p></div>
            <div class="trust-item"><h4>Toronto private pilot</h4><p>We're intentionally starting small — a private concierge pilot for Toronto and nearby service zones.</p></div>
          </div>
        </section>

        <section class="card">
          <h2 class="section-title">Budget tiers</h2>
          <p class="section-lead">Choose a tier, not a specific arrangement — our florist partner handles the rest.</p>
          <div class="tier-grid">
            <div class="tier-card"><h3>Classic</h3><p class="price">From ${formatCents(PRICING_TIERS.classic)}</p><p>A thoughtful seasonal arrangement for everyday milestones.</p></div>
            <div class="tier-card"><h3>Premium</h3><p class="price">From ${formatCents(PRICING_TIERS.premium)}</p><p>A fuller, more elevated seasonal arrangement for bigger moments.</p></div>
            <div class="tier-card"><h3>Signature</h3><p class="price">From ${formatCents(PRICING_TIERS.signature)}</p><p>Our most generous designer's-choice arrangement, reserved for milestones that deserve it.</p></div>
          </div>
        </section>

        <section class="card faq">
          <h2 class="section-title">Frequently asked questions</h2>
          <details>
            <summary>Will I be charged today?</summary>
            <p>No. You're never charged the day you add a date. We send a reminder first, then only charge close to the delivery date — and you can pause or cancel before that.</p>
          </details>
          <details>
            <summary>Can I pause or cancel?</summary>
            <p>Yes, anytime before the charge cutoff. Pause a date temporarily or cancel it entirely from your dashboard — no phone calls needed.</p>
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
            <p>Our concierge team steps in personally — rescheduling, substituting a comparable seasonal arrangement, or refunding, whichever makes sense for the moment.</p>
          </details>
        </section>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml('TheFlowrist — Milestone flower concierge', body, state));
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
      const milestoneRows = protectedMilestones.map((milestone) => {
        const recipient = ownRecipients.find((entry) => entry.id === milestone.recipientId);
        const order = ownOrders.find((entry) => entry.milestoneId === milestone.id);
        const reminderDate = milestone.eventDate ? calculateReminderDate(milestone.eventDate, milestone.reminderDaysBefore || 7) : '';
        const displayStatus = order ? order.status : milestone.status;
        const pauseAction = milestone.status === 'paused'
          ? `<form action="/milestones/${milestone.id}" method="post"><input type="hidden" name="action" value="reactivate" /><button class="btn secondary" type="submit">Reactivate</button></form>`
          : `<form action="/milestones/${milestone.id}" method="post"><input type="hidden" name="action" value="pause" /><button class="btn secondary" type="submit">Pause</button></form>`;
        const cancelAction = `<form action="/milestones/${milestone.id}" method="post" onsubmit="return confirm('Cancel this protected date? This cannot be undone.');"><input type="hidden" name="action" value="cancel" /><button class="btn secondary" type="submit">Cancel</button></form>`;
        return `
          <div class="milestone-row">
            <div class="milestone-meta">
              <p><strong>${escapeHtml(milestone.occasionLabel || formatStatusLabel(milestone.occasionType))}</strong> for ${escapeHtml(recipient?.name || 'a recipient')} ${statusBadge(displayStatus)}</p>
              <p>Protected date: ${escapeHtml(milestone.eventDate)} · Budget tier: ${escapeHtml(formatStatusLabel(milestone.budgetTier))}</p>
              ${reminderDate ? `<p>We'll remind you on ${escapeHtml(reminderDate)}${order ? `, before the planned charge on ${escapeHtml(order.plannedChargeDate)}` : ''}.</p>` : ''}
            </div>
            <div class="milestone-actions">
              ${pauseAction}
              ${cancelAction}
            </div>
          </div>`;
      }).join('');
      const body = `
        <section class="card">
          <h1>Your protected dates</h1>
          <p class="section-lead">Every date here is reviewed by our concierge team before anything is prepared, and you'll always get a reminder before a charge.</p>
          <a class="btn" href="/recipients/new">Add recipient</a>
          <a class="btn secondary" href="/milestones/new">Add another important date</a>
        </section>
        <section class="card">
          <h2 class="section-title">Upcoming</h2>
          ${protectedMilestones.length ? milestoneRows : `
            <p class="muted"><strong>No dates protected yet.</strong></p>
            <p class="muted">Start with one birthday or anniversary — it takes about a minute.</p>
            <a class="btn" href="/milestones/new">Add your first important date</a>
          `}
        </section>
        <section class="card">
          <h2 class="section-title">Recipients</h2>
          ${ownRecipients.length ? ownRecipients.map((recipient) => `<p><strong>${escapeHtml(recipient.name)}</strong> · ${escapeHtml(recipient.relationship)}<br/>${escapeHtml(recipient.city)} · ${escapeHtml(recipient.postalCode)}</p>`).join('') : '<p class="muted">Add your first recipient to start gifting thoughtfully.</p>'}
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
        <section class="card">
          <h1>Who do you want to remember?</h1>
          <p class="section-lead">Save their details once — you'll reuse this recipient for every future milestone. <span class="helper" style="margin-top:0;">You can edit this later.</span></p>
          <form action="/recipients" method="post">
            <label>Name<input name="name" required /></label>
            <label>Relationship<input name="relationship" placeholder="Sister, mom, best friend…" required /><span class="helper">However you'd describe them — this just helps our concierge team personalize things.</span></label>
            <label>Phone<input name="phone" /></label>
            <label>Delivery address<input name="addressLine1" required /></label>
            <label>City<input name="city" required /></label>
            <label>Province<input name="province" required /></label>
            <label>Postal code<input name="postalCode" placeholder="M5V 2T6" required /></label>
            <label>Delivery instructions<textarea name="deliveryInstructions" placeholder="Buzzer code, gate code, or anything that helps our florist partner find the door"></textarea><span class="helper">Optional, but it helps deliveries go smoothly.</span></label>
            <button class="btn" type="submit">Save recipient</button>
          </form>
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
        <section class="card">
          <h1>What date should we protect?</h1>
          <p class="section-lead">Once saved, we'll remind you before anything is charged — you're never surprised. <span class="helper" style="margin-top:0;">You can edit this later.</span></p>
          <form action="/milestones" method="post">
            <label>Recipient<select name="recipientId" required>
              ${ownRecipients.map((recipient) => `<option value="${recipient.id}">${escapeHtml(recipient.name)}</option>`).join('')}
            </select></label>
            <label>Occasion type<select name="occasionType" required>
              <option value="birthday">Birthday</option>
              <option value="anniversary">Anniversary</option>
              <option value="mothers_day">Mother's Day</option>
              <option value="thank_you">Thank you</option>
              <option value="custom">Custom</option>
            </select><span class="helper">What are we celebrating? This helps us tailor the card message.</span></label>
            <label>Event date<input type="date" name="eventDate" required /><span class="helper">The date the flowers should arrive by.</span></label>
            <label><input type="checkbox" name="repeatsAnnually" checked /> Repeats annually<span class="helper">We'll protect this date again automatically next year.</span></label>
            <label>Budget tier<select name="budgetTier" required>
              <option value="classic">Classic</option>
              <option value="premium">Premium</option>
              <option value="signature">Signature</option>
            </select><span class="helper">A budget range, not a specific bouquet — our florist partner curates a Designer's Choice arrangement to fit it.</span></label>
            <label>Card message tone<select name="cardMessageTone">
              <option value="warm">Warm</option>
              <option value="romantic">Romantic</option>
              <option value="professional">Professional</option>
              <option value="playful">Playful</option>
              <option value="simple">Simple</option>
            </select><span class="helper">Sets the tone for the note we write on your behalf.</span></label>
            <label>Style preferences<textarea name="stylePreferences" placeholder="Soft pastels, bright colors, all-white…"></textarea><span class="helper">Optional. Designer's Choice lets the florist use the best seasonal stems available — this just points them in the right direction.</span></label>
            <label>Allergies / avoid<textarea name="allergiesOrAvoid" placeholder="e.g. no lilies"></textarea><span class="helper">Anything the recipient is sensitive to or dislikes.</span></label>
            <label>Hard no preferences<textarea name="hardNoPreferences"></textarea><span class="helper">Anything that's an absolute no for this recipient.</span></label>
            <label>Status<select name="status">
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select></label>
            <button class="btn" type="submit">Save milestone</button>
          </form>
          <p class="muted" style="margin-top:16px;">We'll remind you before anything is charged, and you can pause or cancel from your dashboard before the cutoff.</p>
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
        const errorHtml = `<section class="card"><h1>We need a few details before we can save this milestone.</h1>${validation.errors.map((error) => `<p class="muted">${escapeHtml(error)}</p>`).join('')}<p><a class="btn" href="/milestones/new">Try again</a></p></section>`;
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderHtml('Milestone error', errorHtml));
        return;
      }
      const adapter = getStorageAdapter();
      const ownsRecipient = await assertCustomerOwnsRecipient(adapter, customer.id, normalizedValues.recipientId);
      if (!ownsRecipient) {
        writeText(res, 403, 'You can only create milestones for your own recipients.');
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
        <section class="card">
          <h1>Customer login</h1>
          ${notice}
          <form action="/login" method="post">
            <label>Email<input type="email" name="email" required /></label>
            ${passwordField}
            <button class="btn" type="submit">Sign in</button>
          </form>
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
        ? '<p class="muted">Sign in with a Supabase Auth account whose email is listed in ADMIN_EMAILS.</p>'
        : '<p class="muted">This is a simple pilot-only admin login. No passwords are required yet; use the email configured in ADMIN_EMAILS.</p>';
      const body = `
        <section class="card">
          <h1>Temporary pilot admin access</h1>
          ${notice}
          <form action="/admin/login" method="post">
            <label>Admin email<input name="email" required /></label>
            ${passwordField}
            <button class="btn" type="submit">Enter admin area</button>
          </form>
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
          writeText(res, 403, 'That email is not authorized for pilot admin access.');
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
        writeText(res, 401, result.error || 'Invalid email or password.');
        return;
      }
      if (!isAdminEmail(email)) {
        writeText(res, 403, 'That account is not authorized for admin access.');
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
      const avgSupport = state.orders.reduce((sum, order) => sum + (order.supportMinutes || 0), 0) / Math.max(state.orders.length, 1);
      const body = `
        <section class="card">
          <h1>Admin operations</h1>
          <p class="muted">Manual concierge fulfillment for The Flowerist pilot.</p>
          <a class="btn" href="/admin/orders">View orders</a>
          <a class="btn secondary" href="/admin/florists">Manage florists</a>
          <a class="btn secondary" href="/admin/zones">Manage zones</a>
          <form action="/admin/logout" method="post" style="display:inline-block;margin-top:8px;"><button class="btn secondary" type="submit">Log out</button></form>
        </section>
        <section class="grid three">
          <div class="card stat-card"><h3>Needing florist assignment</h3><p class="stat-number">${needingAssignment}</p></div>
          <div class="card stat-card"><h3>Pending charge</h3><p class="stat-number">${pendingCharge}</p></div>
          <div class="card stat-card"><h3>Issues / refunds</h3><p class="stat-number">${issues}</p></div>
          <div class="card stat-card"><h3>Total orders</h3><p class="stat-number">${state.orders.length}</p></div>
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
        return `<tr><td>${escapeHtml(order.eventDate)}</td><td>${escapeHtml(recipient?.name || '')}</td><td>${escapeHtml(state.users.find((user) => user.id === order.userId)?.name || '')}</td><td>${escapeHtml(recipient?.city || '')}/${escapeHtml(recipient?.postalCode || '')}</td><td>${escapeHtml(order.budgetTier)}</td><td>${statusBadge(order.status)}</td><td>${escapeHtml(florist?.name || 'Unassigned')}</td><td>${escapeHtml(order.plannedChargeDate)}</td><td>${escapeHtml(String(order.supportMinutes))}</td><td><a href="/admin/orders/${order.id}">Inspect</a></td></tr>`;
      }).join('');
      const body = `
        <section class="card">
          <h1>Admin orders</h1>
          <p class="muted">Sorted by event date ascending so the concierge team can work the next handoffs first.</p>
          <table>
            <thead><tr><th>Event date</th><th>Recipient</th><th>Customer</th><th>City/postal</th><th>Tier</th><th>Status</th><th>Florist</th><th>Planned charge</th><th>Support min</th><th>Actions</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
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
        writeText(res, 404, 'Order not found');
        return;
      }
      const recipient = state.recipients.find((entry) => entry.id === order.recipientId);
      const customer = state.users.find((entry) => entry.id === order.userId);
      const florist = state.floristPartners.find((entry) => entry.id === order.floristPartnerId);
      const floristOptions = state.floristPartners.map((partner) => `<option value="${partner.id}" ${order.floristPartnerId === partner.id ? 'selected' : ''}>${escapeHtml(partner.name)}</option>`).join('');
      const timeline = (state.orderEvents || []).filter((entry) => entry.orderId === order.id).slice(-8).map((entry) => `<li><strong>${escapeHtml(entry.createdAt)}</strong> · ${escapeHtml(entry.actorType)} · ${escapeHtml(entry.type)} · ${escapeHtml(entry.message)}</li>`).join('');
      const body = `
        <section class="card">
          <h1>Order ${escapeHtml(order.id)}</h1>
          <div class="summary-list">
            <p><strong>Customer:</strong> ${escapeHtml(customer?.name || 'Unknown')} ${customer?.email ? `(${escapeHtml(customer.email)})` : ''}</p>
            <p><strong>Recipient:</strong> ${escapeHtml(recipient?.name || 'Unknown')}${recipient ? ` · ${escapeHtml(recipient.city)} ${escapeHtml(recipient.postalCode)}` : ''}</p>
            <p><strong>Event date:</strong> ${escapeHtml(order.eventDate)}</p>
            <p><strong>Planned charge date:</strong> ${escapeHtml(order.plannedChargeDate)}</p>
            <p><strong>Florist:</strong> ${escapeHtml(florist?.name || 'Unassigned')}</p>
            <p><strong>Status:</strong> ${statusBadge(order.status)}</p>
          </div>
          <form action="/admin/orders/${order.id}" method="post">
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
            <label>Photo proof URL<input name="photoProofUrl" value="${escapeHtml(order.photoProofUrl || '')}" /></label>
            <label>Support minutes<input type="number" name="supportMinutes" value="${escapeHtml(String(order.supportMinutes || 0))}" /></label>
            <label>Refund amount<input type="number" name="refundAmountCents" value="${escapeHtml(String(order.refundAmountCents || 0))}" /></label>
            <label>Cancellation reason<input name="cancellationReason" value="${escapeHtml(order.cancellationReason || '')}" /></label>
            <label>Issue notes<textarea name="issueNotes">${escapeHtml(order.issueNotes || '')}</textarea></label>
            <label>Event note<input name="eventMessage" /></label>
            <button class="btn" type="submit">Update order</button>
          </form>
          <h3>Timeline</h3>
          <ul>${timeline || '<li>No events yet.</li>'}</ul>
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
        writeText(res, 404, 'Order not found');
        return;
      }
      const nextStatus = values.get('status') || order.status;
      if (!validateStatusTransition(order.status, nextStatus)) {
        writeText(res, 400, 'Invalid status transition');
        return;
      }
      const eventMessage = values.get('eventMessage') || `Updated order fields; status ${nextStatus}`;
      await adapter.updateScheduledOrder(orderId, {
        status: nextStatus,
        floristPartnerId: values.get('floristPartnerId') || null,
        internalNotes: values.get('internalNotes') || '',
        customerNotes: values.get('customerNotes') || '',
        generatedCardMessage: values.get('generatedCardMessage') || '',
        photoProofUrl: values.get('photoProofUrl') || '',
        supportMinutes: Number(values.get('supportMinutes') || 0),
        refundAmountCents: values.get('refundAmountCents') ? Number(values.get('refundAmountCents')) : null,
        cancellationReason: values.get('cancellationReason') || '',
        issueNotes: values.get('issueNotes') || '',
      });
      await adapter.createOrderEventLog({
        id: `event-${Date.now()}`,
        orderId,
        type: 'status_change',
        message: eventMessage,
        actorType: 'admin',
        createdAt: new Date().toISOString(),
      });
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
        <section class="card">
          <h1>Florist partners</h1>
          <p class="muted">Manual partner management for the concierge pilot.</p>
          <table>
            <thead><tr><th>Name</th><th>City</th><th>Email</th><th>Active</th></tr></thead>
            <tbody>${floristRows}</tbody>
          </table>
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
        <section class="card">
          <h1>Service zones</h1>
          <p class="muted">Coverage is intentionally simple for the pilot. We only activate zones that have a florist partner and a delivery workflow.</p>
          <table>
            <thead><tr><th>Name</th><th>Prefixes</th><th>Delivery fee</th></tr></thead>
            <tbody>${zoneRows}</tbody>
          </table>
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
        <section class="card">
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
            <p><strong>Payment consent state:</strong> ${consent?.active ? 'Active and ready for concierge charging' : 'Not yet saved'}</p>
            <p><strong>Privacy reassurance:</strong> We only use your details to coordinate meaningful flowers and keep your recipient info safe and accessible.</p>
          </div>
          <p><a class="btn" href="/account/payment-consent">Manage payment consent</a></p>
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
      const body = `
        <section class="card">
          <h1>Payment consent</h1>
          <div class="reassurance">
            <h4>Your card is not charged today.</h4>
            <ul>
              <li>We remind you before scheduled charges.</li>
              <li>You can pause or cancel before the cutoff.</li>
            </ul>
          </div>
          <p class="muted">This step is not a real charge — it records your consent for our concierge team to charge your saved payment method later, only for milestone orders you've explicitly scheduled. Real card charging isn't wired up yet in this pilot.</p>
          <p class="muted">${escapeHtml(consent?.consentTextSnapshot || 'By saving your payment consent, you authorize The Flowerist to charge your payment method for flower orders you schedule, including delivery and applicable taxes, when those milestone orders are prepared. We will remind you before scheduled charges. You can pause or cancel future scheduled orders from your account before the cutoff.')}</p>
          <form action="/account/payment-consent" method="post">
            <label><input type="checkbox" name="consent" checked /> I consent to this pilot payment workflow</label>
            <button class="btn" type="submit">Save payment consent</button>
          </form>
          <form action="/account/payment-consent/revoke" method="post" style="margin-top:12px;">
            <button class="btn secondary" type="submit">Revoke consent</button>
          </form>
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
      const consent = {
        id: `consent-${Date.now()}`,
        userId: customer.id,
        stripeCustomerId: '',
        stripePaymentMethodId: '',
        consentTextVersion: 'v1',
        consentTextSnapshot: 'By saving your payment consent, you authorize The Flowerist to charge your payment method for flower orders you schedule, including delivery and applicable taxes, when those milestone orders are prepared. We will remind you before scheduled charges. You can pause or cancel future scheduled orders from your account before the cutoff.',
        consentedAt: new Date().toISOString(),
        ipAddress: '',
        userAgent: req.headers['user-agent'] || '',
        active: ['on', 'true', '1', 'yes'].includes(String(values.get('consent') || '').toLowerCase()),
      };
      await getStorageAdapter().createPaymentConsent(consent);
      res.writeHead(302, { Location: '/account' });
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
          writeText(res, 404, 'Consent record not found');
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
        writeText(res, 404, 'Milestone not found');
        return;
      }
      const body = await readRequestBody(req);
      const values = new URLSearchParams(body);
      const action = values.get('action') || 'pause';
      const nextStatus = action === 'reactivate' ? 'active' : action === 'cancel' ? 'cancelled' : 'paused';
      await adapter.updateMilestone(milestoneId, { status: nextStatus });
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
