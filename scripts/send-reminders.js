#!/usr/bin/env node
const path = require('node:path');
const { config } = require('dotenv');

config({ path: path.join(__dirname, '..', '.env') });

const { resolveStorageAdapter } = require('../lib/store');
const { getOrdersNeedingReminder } = require('../lib/logic');
const { buildReminderEmail, sendReminderEmail } = require('../lib/notifications');

async function runSendReminders({ env = process.env, adapter, logger = console.log, fetchImpl } = {}) {
  if (!env.RESEND_API_KEY) {
    throw new Error('send-reminders requires RESEND_API_KEY');
  }
  if (!env.INTERNAL_API_SECRET) {
    throw new Error('send-reminders requires INTERNAL_API_SECRET (matches this server\'s own internal endpoints)');
  }
  const baseUrl = env.APP_BASE_URL || 'http://localhost:3000';
  const storageAdapter = adapter || resolveStorageAdapter(env);

  const [orders, milestones, recipients, customers] = await Promise.all([
    storageAdapter.listScheduledOrders(),
    storageAdapter.listMilestones(),
    storageAdapter.listRecipients(),
    storageAdapter.listCustomers(),
  ]);

  const dueOrders = getOrdersNeedingReminder(orders, milestones);
  const milestonesById = new Map(milestones.map((entry) => [entry.id, entry]));
  const recipientsById = new Map(recipients.map((entry) => [entry.id, entry]));
  const customersById = new Map(customers.map((entry) => [entry.id, entry]));

  const results = [];
  for (const order of dueOrders) {
    const milestone = milestonesById.get(order.milestoneId);
    const recipient = recipientsById.get(order.recipientId);
    const customer = customersById.get(order.userId);
    if (!customer?.email) {
      results.push({ orderId: order.id, sent: false, reason: 'missing_customer_email' });
      continue;
    }
    const email = buildReminderEmail({ order, milestone, recipient, customer, baseUrl });
    try {
      await sendReminderEmail({ to: customer.email, ...email }, env, fetchImpl ? { fetchImpl } : undefined);
      await storageAdapter.updateScheduledOrder(order.id, { status: 'pre_charge_reminder_sent' });
      await storageAdapter.createOrderEventLog({
        id: `event-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        orderId: order.id,
        type: 'status_change',
        message: `Pre-charge reminder emailed to ${customer.email}.`,
        actorType: 'system',
        createdAt: new Date().toISOString(),
      });
      results.push({ orderId: order.id, sent: true });
    } catch (error) {
      results.push({ orderId: order.id, sent: false, reason: error.message });
    }
  }

  logger(`Reminders: ${results.filter((entry) => entry.sent).length} sent, ${results.filter((entry) => !entry.sent).length} skipped/failed.`);
  logger(JSON.stringify(results, null, 2));
  return results;
}

if (require.main === module) {
  runSendReminders().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { runSendReminders };
