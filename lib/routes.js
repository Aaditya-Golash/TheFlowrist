const { URL } = require('url');
const { renderHtml } = require('./template');
const { getState, setState } = require('./store');
const { getAdminCookieValue, getAdminClearCookieValue, isAdminEmail } = require('./admin');
const { getAuthAdapter } = require('./auth');
const { buildReadiness } = require('./env-check');
const {
  calculatePlannedChargeDate,
  createScheduledOrderFromMilestone,
  getServiceZoneForPostalCode,
  isPostalCodeInZone,
  calculateEstimatedPrice,
  validateStatusTransition,
  normalizePostalCode,
} = require('./logic');
const { validateRecipient, validateMilestone } = require('./validation');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function createRouter(server) {
  return async (req, res) => {
    try {
      await handleRequest(req, res);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal_error' }));
      }
    }
  };
}

async function handleRequest(req, res) {
  {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = requestUrl.pathname;

    if (req.method === 'GET' && pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', environment: process.env.NODE_ENV || 'development' }));
      return;
    }

    if (req.method === 'GET' && pathname === '/ready') {
      const readiness = buildReadiness(process.env);
      res.writeHead(readiness.ready ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(readiness));
      return;
    }

    if (req.method === 'GET' && pathname === '/internal/orders/upcoming') {
      const secret = req.headers['x-internal-api-secret'] || '';
      if (String(secret) !== String(process.env.INTERNAL_API_SECRET || '')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      const state = getState();
      const orders = state.orders.filter((order) => order.status === 'scheduled' || order.status === 'pending_charge');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ orders }));
      return;
    }

    if (req.method === 'GET' && pathname === '/internal/orders/needing-reminder') {
      const secret = req.headers['x-internal-api-secret'] || '';
      if (String(secret) !== String(process.env.INTERNAL_API_SECRET || '')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      const state = getState();
      const orders = state.orders.filter((order) => order.status === 'scheduled');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ orders }));
      return;
    }

    if (req.method === 'GET' && pathname === '/internal/orders/needing-florist') {
      const secret = req.headers['x-internal-api-secret'] || '';
      if (String(secret) !== String(process.env.INTERNAL_API_SECRET || '')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      const state = getState();
      const orders = state.orders.filter((order) => !order.floristPartnerId && order.status !== 'cancelled');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ orders }));
      return;
    }

    if (req.method === 'GET' && pathname === '/internal/orders/issues') {
      const secret = req.headers['x-internal-api-secret'] || '';
      if (String(secret) !== String(process.env.INTERNAL_API_SECRET || '')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      const state = getState();
      const orders = state.orders.filter((order) => order.status === 'issue_reported' || order.status === 'refunded');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ orders }));
      return;
    }

    if (req.method === 'POST' && pathname.startsWith('/internal/orders/') && pathname.endsWith('/event')) {
      const secret = req.headers['x-internal-api-secret'] || '';
      if (String(secret) !== String(process.env.INTERNAL_API_SECRET || '')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      const orderId = pathname.split('/')[3];
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const values = new URLSearchParams(body);
        const state = getState();
        const order = state.orders.find((entry) => entry.id === orderId);
        if (!order) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'order_not_found' }));
          return;
        }
        const message = values.get('message') || 'Internal event logged';
        state.orderEvents.push({
          id: `event-${Date.now()}`,
          orderId,
          type: 'internal_event',
          message,
          actorType: 'n8n',
          createdAt: new Date().toISOString(),
        });
        setState(state);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, orderId, message }));
      });
      return;
    }

    if (req.method === 'POST' && pathname.startsWith('/internal/orders/') && pathname.endsWith('/status')) {
      const secret = req.headers['x-internal-api-secret'] || '';
      if (String(secret) !== String(process.env.INTERNAL_API_SECRET || '')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      const orderId = pathname.split('/')[3];
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const values = new URLSearchParams(body);
        const state = getState();
        const order = state.orders.find((entry) => entry.id === orderId);
        if (!order) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'order_not_found' }));
          return;
        }
        const nextStatus = values.get('status') || order.status;
        order.status = nextStatus;
        order.updatedAt = new Date().toISOString();
        state.orderEvents.push({
          id: `event-${Date.now()}`,
          orderId,
          type: 'status_change',
          message: `Internal status update to ${nextStatus}`,
          actorType: 'n8n',
          createdAt: new Date().toISOString(),
        });
        setState(state);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, orderId, status: nextStatus }));
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/') {
      const state = getState();
      const body = `
        <section class="card hero">
          <div>
            <div class="pill">Concierge-first milestone gifting</div>
            <h1>Set important dates once. We handle the flowers.</h1>
            <p class="muted">TheFlowrist is a premium concierge MVP for milestone flower gifting in Toronto. We help you save dates, preferences, and payment consent while our team manually fulfills every order.</p>
            <a class="btn" href="/dashboard">Add your first important date</a>
            <a class="btn secondary" href="/admin">Open admin operations</a>
          </div>
          <div class="card">
            <h3>What this MVP includes</h3>
            <ul>
              <li>Recipient and milestone planning</li>
              <li>Friendly reminders before any charge</li>
              <li>Manual florist partner assignment</li>
              <li>Operational order tracking and service zones</li>
            </ul>
          </div>
        </section>
        <section class="grid three">
          <div class="card"><h3>Designer’s choice</h3><p class="muted">Seasonal arrangements curated for meaningful moments.</p></div>
          <div class="card"><h3>Reminder before charge</h3><p class="muted">No surprises. You can pause or edit before anything is prepared.</p></div>
          <div class="card"><h3>Toronto pilot</h3><p class="muted">We are starting with a concierge pilot for Toronto and nearby zones.</p></div>
        </section>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml('The Flowerist', body, state));
      return;
    }

    if (req.method === 'GET' && pathname === '/dashboard') {
      const customer = await getAuthAdapter().requireUser(req, res);
      if (!customer) {
        return;
      }
      const state = getState();
      const upcomingMilestones = state.milestones.filter((milestone) => milestone.status === 'active');
      const upcomingOrders = state.orders.slice(0, 4);
      const body = `
        <section class="card">
          <h1>Your concierge dashboard</h1>
          <p class="muted">Your important dates stay organized, and every order is reviewed by our team before anything is prepared.</p>
          <a class="btn" href="/recipients/new">Add recipient</a>
          <a class="btn secondary" href="/milestones/new">Add milestone</a>
        </section>
        <section class="grid two">
          <div class="card">
            <h3>Upcoming milestones</h3>
            ${upcomingMilestones.length ? upcomingMilestones.map((milestone) => `<p><strong>${escapeHtml(milestone.occasionLabel || milestone.occasionType)}</strong><br/>${escapeHtml(milestone.eventDate)} · ${escapeHtml(milestone.budgetTier)}</p>`).join('') : '<p class="muted">No milestones yet. Add one to begin.</p>'}
          </div>
          <div class="card">
            <h3>Upcoming scheduled orders</h3>
            ${upcomingOrders.length ? upcomingOrders.map((order) => `<p><strong>${escapeHtml(order.id)}</strong><br/>Planned charge ${escapeHtml(order.plannedChargeDate)} · ${escapeHtml(order.status)}</p>`).join('') : '<p class="muted">We will surface upcoming orders here once you have a milestone.</p>'}
          </div>
        </section>
        <section class="card">
          <h3>Recipients</h3>
          ${state.recipients.length ? state.recipients.map((recipient) => `<p><strong>${escapeHtml(recipient.name)}</strong> · ${escapeHtml(recipient.relationship)}<br/>${escapeHtml(recipient.city)} · ${escapeHtml(recipient.postalCode)}</p>`).join('') : '<p class="muted">Add your first recipient to start gifting thoughtfully.</p>'}
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
          <h1>Add recipient</h1>
          <p class="muted">Save your recipient details once and keep future milestones simple.</p>
          <form action="/recipients" method="post">
            <label>Name<input name="name" required /></label>
            <label>Relationship<input name="relationship" required /></label>
            <label>Phone<input name="phone" /></label>
            <label>Address<input name="addressLine1" required /></label>
            <label>City<input name="city" required /></label>
            <label>Province<input name="province" required /></label>
            <label>Postal code<input name="postalCode" required /></label>
            <label>Delivery instructions<textarea name="deliveryInstructions"></textarea></label>
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
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const values = new URLSearchParams(body);
        const state = getState();
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
        state.recipients.push(recipient);
        setState(state);
        res.writeHead(302, { Location: '/dashboard' });
        res.end();
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/milestones/new') {
      const customer = await getAuthAdapter().requireUser(req, res);
      if (!customer) {
        return;
      }
      const state = getState();
      const body = `
        <section class="card">
          <h1>Add milestone</h1>
          <p class="muted">We will turn this into a scheduled flower delivery with a reminder before charge.</p>
          <form action="/milestones" method="post">
            <label>Recipient<select name="recipientId" required>
              ${state.recipients.map((recipient) => `<option value="${recipient.id}">${escapeHtml(recipient.name)}</option>`).join('')}
            </select></label>
            <label>Occasion type<select name="occasionType" required>
              <option value="birthday">Birthday</option>
              <option value="anniversary">Anniversary</option>
              <option value="mothers_day">Mother's Day</option>
              <option value="thank_you">Thank you</option>
              <option value="custom">Custom</option>
            </select></label>
            <label>Event date<input type="date" name="eventDate" required /></label>
            <label><input type="checkbox" name="repeatsAnnually" checked /> Repeats annually</label>
            <label>Budget tier<select name="budgetTier" required>
              <option value="classic">Classic</option>
              <option value="premium">Premium</option>
              <option value="signature">Signature</option>
            </select></label>
            <label>Card message tone<select name="cardMessageTone">
              <option value="warm">Warm</option>
              <option value="romantic">Romantic</option>
              <option value="professional">Professional</option>
              <option value="playful">Playful</option>
              <option value="simple">Simple</option>
            </select></label>
            <label>Style preferences<textarea name="stylePreferences"></textarea></label>
            <label>Allergies / avoid<textarea name="allergiesOrAvoid"></textarea></label>
            <label>Hard no preferences<textarea name="hardNoPreferences"></textarea></label>
            <label>Status<select name="status">
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select></label>
            <button class="btn" type="submit">Save milestone</button>
          </form>
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
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const values = new URLSearchParams(body);
        const state = getState();
        const normalizedValues = Object.fromEntries(values.entries());
        const validation = validateMilestone(normalizedValues);
        if (validation.errors.length) {
          const errorHtml = `<section class="card"><h1>We need a few details before we can save this milestone.</h1>${validation.errors.map((error) => `<p class="muted">${escapeHtml(error)}</p>`).join('')}<p><a class="btn" href="/milestones/new">Try again</a></p></section>`;
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderHtml('Milestone error', errorHtml));
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

        const serviceZone = getServiceZoneForPostalCode(state.serviceZones, state.recipients.find((recipient) => recipient.id === milestone.recipientId)?.postalCode || '');
        state.milestones.push(milestone);
        if (milestone.eventDate) {
          const order = createScheduledOrderFromMilestone(milestone, customer, serviceZone || { deliveryFeeCents: 0 });
          state.orders.push(order);
        }
        setState(state);
        res.writeHead(302, { Location: '/dashboard' });
        res.end();
      });
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
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        const values = new URLSearchParams(body);
        const email = values.get('email') || '';
        const password = values.get('password') || '';
        const authAdapter = getAuthAdapter();
        const result = await authAdapter.signInWithEmailPassword(email, password);
        if (!result.ok) {
          const errorHtml = `<section class="card"><h1>We couldn't sign you in.</h1><p class="muted">${escapeHtml(result.error || 'Invalid email or password.')}</p><p><a class="btn" href="/login">Try again</a></p></section>`;
          res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderHtml('Login error', errorHtml));
          return;
        }
        authAdapter.createSessionCookies(res, result.session);
        res.writeHead(302, { Location: '/dashboard' });
        res.end();
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/logout') {
      const authAdapter = getAuthAdapter();
      authAdapter.signOut(req, res);
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
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        const values = new URLSearchParams(body);
        const email = values.get('email') || '';
        const password = values.get('password') || '';
        const authBackend = String(process.env.AUTH_BACKEND || 'pilot').toLowerCase();

        if (authBackend !== 'supabase') {
          if (!isAdminEmail(email)) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('That email is not authorized for pilot admin access.');
            return;
          }
          res.writeHead(302, { Location: '/admin', 'Set-Cookie': getAdminCookieValue(email) });
          res.end();
          return;
        }

        const authAdapter = getAuthAdapter();
        const result = await authAdapter.signInWithEmailPassword(email, password);
        if (!result.ok) {
          res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(result.error || 'Invalid email or password.');
          return;
        }
        if (!isAdminEmail(email)) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('That account is not authorized for admin access.');
          return;
        }
        authAdapter.createSessionCookies(res, result.session);
        res.writeHead(302, { Location: '/admin' });
        res.end();
      });
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
      const state = getState();
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
          <div class="card"><h3>Upcoming orders next 7 days</h3><p>${state.orders.length}</p></div>
          <div class="card"><h3>Needing florist assignment</h3><p>${needingAssignment}</p></div>
          <div class="card"><h3>Pending charge</h3><p>${pendingCharge}</p></div>
          <div class="card"><h3>Delivered</h3><p>${delivered}</p></div>
          <div class="card"><h3>Issues / refunds</h3><p>${issues}</p></div>
          <div class="card"><h3>Avg support minutes</h3><p>${avgSupport.toFixed(1)}</p></div>
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
      const state = getState();
      const rows = state.orders.map((order) => {
        const recipient = state.recipients.find((item) => item.id === order.recipientId);
        const florist = state.floristPartners.find((item) => item.id === order.floristPartnerId);
        return `<tr><td>${escapeHtml(order.eventDate)}</td><td>${escapeHtml(recipient?.name || '')}</td><td>${escapeHtml(state.users.find((user) => user.id === order.userId)?.name || '')}</td><td>${escapeHtml(recipient?.city || '')}/${escapeHtml(recipient?.postalCode || '')}</td><td>${escapeHtml(order.budgetTier)}</td><td><span class="status">${escapeHtml(order.status)}</span></td><td>${escapeHtml(florist?.name || 'Unassigned')}</td><td>${escapeHtml(order.plannedChargeDate)}</td><td>${escapeHtml(String(order.supportMinutes))}</td><td><a href="/admin/orders/${order.id}">Inspect</a></td></tr>`;
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
      const state = getState();
      const order = state.orders.find((entry) => entry.id === orderId);
      if (!order) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Order not found');
        return;
      }
      const recipient = state.recipients.find((entry) => entry.id === order.recipientId);
      const floristOptions = state.floristPartners.map((florist) => `<option value="${florist.id}" ${order.floristPartnerId === florist.id ? 'selected' : ''}>${escapeHtml(florist.name)}</option>`).join('');
      const timeline = (state.orderEvents || []).filter((entry) => entry.orderId === order.id).slice(-8).map((entry) => `<li><strong>${escapeHtml(entry.createdAt)}</strong> · ${escapeHtml(entry.actorType)} · ${escapeHtml(entry.type)} · ${escapeHtml(entry.message)}</li>`).join('');
      const body = `
        <section class="card">
          <h1>Order ${escapeHtml(order.id)}</h1>
          <p><strong>Recipient:</strong> ${escapeHtml(recipient?.name || '')}</p>
          <p><strong>Status:</strong> ${escapeHtml(order.status)}</p>
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
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const values = new URLSearchParams(body);
        const state = getState();
        const order = state.orders.find((entry) => entry.id === orderId);
        if (!order) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Order not found');
          return;
        }
        const nextStatus = values.get('status') || order.status;
        if (!validateStatusTransition(order.status, nextStatus)) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Invalid status transition');
          return;
        }
        order.status = nextStatus;
        order.floristPartnerId = values.get('floristPartnerId') || null;
        order.internalNotes = values.get('internalNotes') || '';
        order.customerNotes = values.get('customerNotes') || '';
        order.generatedCardMessage = values.get('generatedCardMessage') || '';
        order.photoProofUrl = values.get('photoProofUrl') || '';
        order.supportMinutes = Number(values.get('supportMinutes') || 0);
        order.refundAmountCents = values.get('refundAmountCents') ? Number(values.get('refundAmountCents')) : null;
        order.cancellationReason = values.get('cancellationReason') || '';
        order.issueNotes = values.get('issueNotes') || '';
        order.updatedAt = new Date().toISOString();
        const eventMessage = values.get('eventMessage') || `Updated order fields; status ${nextStatus}`;
        state.orderEvents.push({ id: `event-${Date.now()}`, orderId, type: 'status_change', message: eventMessage, actorType: 'admin', createdAt: new Date().toISOString() });
        setState(state);
        res.writeHead(302, { Location: `/admin/orders/${order.id}` });
        res.end();
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/admin/florists') {
      const allowed = await getAuthAdapter().requireAdmin(req, res);
      if (!allowed) {
        return;
      }
      const state = getState();
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
      const state = getState();
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
      const state = getState();
      const consent = state.paymentConsents[0];
      const body = `
        <section class="card">
          <h1>Account and preferences</h1>
          <p class="muted">You can pause, cancel, or update upcoming orders at any time. We remind you before any scheduled charge.</p>
          <p><strong>Communication preferences:</strong> email ${customer.marketingEmailConsent ? 'on' : 'off'}, SMS ${customer.marketingSmsConsent ? 'on' : 'off'}</p>
          <p><strong>Payment consent state:</strong> ${consent?.active ? 'Active and ready for concierge charging' : 'Not yet saved'}</p>
          <p><strong>Pause / cancel guidance:</strong> You can pause or cancel upcoming milestone deliveries from your dashboard before the cutoff.</p>
          <p><strong>Privacy reassurance:</strong> We only use your details to coordinate meaningful flowers and keep your recipient info safe and accessible.</p>
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
      const state = getState();
      const consent = state.paymentConsents[0];
      const body = `
        <section class="card">
          <h1>Payment consent</h1>
          <p class="muted">We are not charging cards yet. This records your consent and prepares the experience for a later Stripe SetupIntent integration.</p>
          <p>${escapeHtml(consent?.consentTextSnapshot || 'By saving your payment consent, you authorize The Flowerist to charge your payment method for flower orders you schedule, including delivery and applicable taxes, when those milestone orders are prepared. We will remind you before scheduled charges. You can pause or cancel future scheduled orders from your account before the cutoff.')}</p>
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
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const values = new URLSearchParams(body);
        const state = getState();
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
        state.paymentConsents.push(consent);
        setState(state);
        res.writeHead(302, { Location: '/account' });
        res.end();
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/account/payment-consent/revoke') {
      const customer = await getAuthAdapter().requireUser(req, res);
      if (!customer) {
        return;
      }
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const values = new URLSearchParams(body);
        const state = getState();
        const consentId = values.get('consentId');
        const consent = consentId
          ? state.paymentConsents.find((entry) => entry.id === consentId)
          : state.paymentConsents[state.paymentConsents.length - 1];
        if (consent) {
          consent.active = false;
          consent.consentedAt = new Date().toISOString();
          setState(state);
        }
        res.writeHead(302, { Location: '/account' });
        res.end();
      });
      return;
    }

    if (req.method === 'POST' && pathname.startsWith('/milestones/')) {
      const customer = await getAuthAdapter().requireUser(req, res);
      if (!customer) {
        return;
      }
      const milestoneId = pathname.split('/').pop();
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const values = new URLSearchParams(body);
        const state = getState();
        const milestone = state.milestones.find((entry) => entry.id === milestoneId);
        if (!milestone) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Milestone not found');
          return;
        }
        const action = values.get('action') || 'pause';
        milestone.status = action === 'reactivate' ? 'active' : action === 'cancel' ? 'cancelled' : 'paused';
        milestone.updatedAt = new Date().toISOString();
        setState(state);
        res.writeHead(302, { Location: '/dashboard' });
        res.end();
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  }
}

module.exports = {
  createRouter,
};
