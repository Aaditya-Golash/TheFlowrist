const { URL } = require('url');
const { renderHtml } = require('./template');
const { getState, setState } = require('./store');
const {
  calculatePlannedChargeDate,
  createScheduledOrderFromMilestone,
  getServiceZoneForPostalCode,
  isPostalCodeInZone,
  calculateEstimatedPrice,
  validateStatusTransition,
} = require('./logic');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isAdminRequest(req) {
  const adminEmails = (process.env.ADMIN_EMAILS || 'admin@example.com').split(',').map((email) => email.trim()).filter(Boolean);
  const headerValue = req.headers['x-admin-email'] || '';
  return adminEmails.includes(String(headerValue));
}

function createRouter(server) {
  return (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = requestUrl.pathname;

    if (req.method === 'GET' && pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', environment: process.env.NODE_ENV || 'development' }));
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
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const values = new URLSearchParams(body);
        const state = getState();
        const recipient = {
          id: `recipient-${Date.now()}`,
          userId: state.users[0].id,
          name: values.get('name') || '',
          relationship: values.get('relationship') || '',
          phone: values.get('phone') || '',
          addressLine1: values.get('addressLine1') || '',
          addressLine2: '',
          city: values.get('city') || '',
          province: values.get('province') || '',
          postalCode: values.get('postalCode') || '',
          deliveryInstructions: values.get('deliveryInstructions') || '',
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
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const values = new URLSearchParams(body);
        const state = getState();
        const milestone = {
          id: `milestone-${Date.now()}`,
          userId: state.users[0].id,
          recipientId: values.get('recipientId') || '',
          occasionType: values.get('occasionType') || 'custom',
          occasionLabel: values.get('occasionLabel') || '',
          eventDate: values.get('eventDate') || '',
          repeatsAnnually: values.get('repeatsAnnually') === 'on',
          budgetTier: values.get('budgetTier') || 'classic',
          status: values.get('status') || 'active',
          cardMessageTone: values.get('cardMessageTone') || 'warm',
          stylePreferences: values.get('stylePreferences') || '',
          allergiesOrAvoid: values.get('allergiesOrAvoid') || '',
          hardNoPreferences: values.get('hardNoPreferences') || '',
          reminderDaysBefore: 7,
          chargeDaysBefore: 5,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const serviceZone = getServiceZoneForPostalCode(state.serviceZones, state.recipients.find((recipient) => recipient.id === milestone.recipientId)?.postalCode || '');
        state.milestones.push(milestone);
        if (milestone.eventDate) {
          const order = createScheduledOrderFromMilestone(milestone, state.users[0], serviceZone || { deliveryFeeCents: 0 });
          state.orders.push(order);
        }
        setState(state);
        res.writeHead(302, { Location: '/dashboard' });
        res.end();
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/admin') {
      if (!isAdminRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Admin access requires x-admin-email matching ADMIN_EMAILS');
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
      if (!isAdminRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Admin access requires x-admin-email matching ADMIN_EMAILS');
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
      if (!isAdminRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Admin access requires x-admin-email matching ADMIN_EMAILS');
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
            <button class="btn" type="submit">Update order</button>
          </form>
        </section>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml('Order detail', body));
      return;
    }

    if (req.method === 'POST' && pathname.startsWith('/admin/orders/')) {
      if (!isAdminRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Admin access requires x-admin-email matching ADMIN_EMAILS');
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
        order.updatedAt = new Date().toISOString();
        state.orderEvents.push({ id: `event-${Date.now()}`, orderId, type: 'status_change', message: `Status updated to ${nextStatus}`, actorType: 'admin', createdAt: new Date().toISOString() });
        setState(state);
        res.writeHead(302, { Location: `/admin/orders/${order.id}` });
        res.end();
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/admin/florists') {
      if (!isAdminRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Admin access requires x-admin-email matching ADMIN_EMAILS');
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
      if (!isAdminRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Admin access requires x-admin-email matching ADMIN_EMAILS');
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
      const state = getState();
      const consent = state.paymentConsents[0];
      const body = `
        <section class="card">
          <h1>Account and preferences</h1>
          <p class="muted">You can pause, cancel, or update upcoming orders at any time. We will remind you before any charge is requested.</p>
          <p><strong>Communication preferences:</strong> email ${state.users[0].marketingEmailConsent ? 'on' : 'off'}, SMS ${state.users[0].marketingSmsConsent ? 'on' : 'off'}</p>
          <p><strong>Payment consent state:</strong> ${consent?.active ? 'Ready for concierge charging' : 'Not yet saved'}</p>
          <p><strong>Pause / cancel guidance:</strong> You can pause or cancel upcoming milestone deliveries from your dashboard before the order is prepared.</p>
          <p><strong>Privacy reassurance:</strong> We only use your details to coordinate meaningful flowers and keep your recipient info safe and accessible.</p>
        </section>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml('Account', body));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  };
}

module.exports = {
  createRouter,
};
