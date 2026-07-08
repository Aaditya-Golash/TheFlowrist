#!/usr/bin/env node
const path = require('node:path');
const { config } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { validateSupabaseEnvironment } = require('../lib/supabase-env');
const { ensureWebSocketShim } = require('../lib/ws-shim');

config({ path: path.join(__dirname, '..', '.env') });

async function runSmoke({ env = process.env, createClient: createClientImpl = createClient, logger = console.log } = {}) {
  const { supabaseUrl, serviceRoleKey } = validateSupabaseEnvironment(env);
  ensureWebSocketShim();
  const supabase = createClientImpl(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const email = 'pilot-smoke-test@example.com';
  const customerId = `smoke-customer-${Date.now()}`;
  const recipientId = `smoke-recipient-${Date.now()}`;
  const milestoneId = `smoke-milestone-${Date.now()}`;
  const orderId = `smoke-order-${Date.now()}`;
  const consentId = `smoke-consent-${Date.now()}`;

  const customerInsert = { id: customerId, name: 'Smoke Test Customer', email, phone: '+1-555-0100', marketing_email_consent: true, marketing_sms_consent: false };
  const recipientInsert = { id: recipientId, customer_id: customerId, name: 'Smoke Test Recipient', relationship: 'friend', phone: '+1-555-0101', address_line_1: '1 Test Ave', city: 'Toronto', province: 'ON', postal_code: 'M5V 2T6' };
  const milestoneInsert = { id: milestoneId, customer_id: customerId, recipient_id: recipientId, occasion_type: 'birthday', occasion_label: 'Smoke Test', event_date: '2026-08-15', budget_tier: 'classic', status: 'active' };
  const orderInsert = { id: orderId, customer_id: customerId, recipient_id: recipientId, milestone_id: milestoneId, event_date: '2026-08-15', planned_charge_date: '2026-08-10', budget_tier: 'classic', status: 'scheduled', estimated_customer_price_cents: 15000, delivery_fee_cents: 1200 };
  const eventInsert = { id: `smoke-event-${Date.now()}`, order_id: orderId, type: 'status_change', message: 'Smoke test event', actor_type: 'system' };
  const consentInsert = { id: consentId, customer_id: customerId, consent_text_version: 'v1', active: true };

  const operations = [
    supabase.from('customers').upsert(customerInsert, { onConflict: 'id' }).select('*'),
    supabase.from('recipients').upsert(recipientInsert, { onConflict: 'id' }).select('*'),
    supabase.from('milestones').upsert(milestoneInsert, { onConflict: 'id' }).select('*'),
    supabase.from('scheduled_orders').upsert(orderInsert, { onConflict: 'id' }).select('*'),
    supabase.from('order_event_logs').upsert(eventInsert, { onConflict: 'id' }).select('*'),
    supabase.from('payment_consents').upsert(consentInsert, { onConflict: 'id' }).select('*'),
  ];

  const results = [];
  for (const operation of operations) {
    const { data, error } = await operation;
    if (error) {
      throw error;
    }
    results.push(data?.[0] || null);
  }

  const { data: updatedOrder, error: updateError } = await supabase.from('scheduled_orders').update({ status: 'pending_charge' }).eq('id', orderId).select('*');
  if (updateError) {
    throw updateError;
  }

  const { data: consentData, error: consentError } = await supabase.from('payment_consents').update({ active: false }).eq('id', consentId).select('*');
  if (consentError) {
    throw consentError;
  }

  const { data: readBack, error: readError } = await supabase.from('scheduled_orders').select('*').eq('id', orderId);
  if (readError) {
    throw readError;
  }

  const summary = {
    customerId,
    recipientId,
    milestoneId,
    orderId,
    consentId,
    updatedOrderStatus: updatedOrder?.[0]?.status || null,
    consentActive: consentData?.[0]?.active ?? null,
    readBackCount: readBack?.length || 0,
  };

  logger('Supabase smoke test passed.');
  logger(JSON.stringify(summary, null, 2));
  return summary;
}

async function main() {
  await runSmoke({ env: process.env, logger: console.log });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  validateSupabaseEnvironment,
  runSmoke,
};
