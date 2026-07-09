#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { config } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { validateSupabaseEnvironment } = require('../lib/supabase-env');
const { ensureWebSocketShim } = require('../lib/ws-shim');

config({ path: path.join(__dirname, '..', '.env') });

function fail(message) {
  throw new Error(message);
}

function readJsonState(dataFilePath) {
  if (!fs.existsSync(dataFilePath)) {
    fail(`Missing local data file at ${dataFilePath}`);
  }
  return JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
}

function normalizeId(value) {
  return value && value !== '' ? value : null;
}

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
  };
}

function countRows(state) {
  return {
    customers: (state.users || []).length,
    recipients: (state.recipients || []).length,
    milestones: (state.milestones || []).length,
    scheduledOrders: (state.orders || []).length,
    florists: (state.floristPartners || []).length,
    zones: (state.serviceZones || []).length,
    consents: (state.paymentConsents || []).length,
    memberships: (state.relationshipMemberships || []).length,
    surpriseSettings: (state.surpriseDelightSettings || []).length,
    logs: (state.orderEvents || []).length,
    feedback: (state.feedback || []).length,
  };
}

async function runMigration({ env = process.env, dryRun = false, dataFilePath = path.join(__dirname, '..', 'data', 'app-data.json'), createClient: createClientImpl = createClient, logger = console.log } = {}) {
  const state = readJsonState(dataFilePath);

  if (dryRun) {
    const summary = countRows(state);
    logger(JSON.stringify(summary, null, 2));
    return { dryRun: true, summary, dataFilePath };
  }

  const { supabaseUrl, serviceRoleKey } = validateSupabaseEnvironment(env);
  ensureWebSocketShim();
  const supabase = createClientImpl(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const summary = { customers: 0, recipients: 0, milestones: 0, scheduledOrders: 0, florists: 0, zones: 0, consents: 0, memberships: 0, surpriseSettings: 0, logs: 0, feedback: 0 };
  const rowsByTable = [
    ['customers', (state.users || []).map((customer) => ({ id: normalizeId(customer.id), name: customer.name || '', email: customer.email || null, phone: customer.phone || null, marketing_email_consent: Boolean(customer.marketingEmailConsent), marketing_sms_consent: Boolean(customer.marketingSmsConsent), created_at: customer.createdAt || new Date().toISOString(), updated_at: customer.updatedAt || new Date().toISOString() }))],
    ['recipients', (state.recipients || []).map((recipient) => ({ id: normalizeId(recipient.id), customer_id: normalizeId(recipient.userId), name: recipient.name || '', relationship: recipient.relationship || null, phone: recipient.phone || null, address_line_1: recipient.addressLine1 || null, address_line_2: recipient.addressLine2 || null, city: recipient.city || null, province: recipient.province || null, postal_code: recipient.postalCode || null, delivery_instructions: recipient.deliveryInstructions || null, created_at: recipient.createdAt || new Date().toISOString(), updated_at: recipient.updatedAt || new Date().toISOString() }))],
    ['milestones', (state.milestones || []).map((milestone) => ({ id: normalizeId(milestone.id), customer_id: normalizeId(milestone.userId), recipient_id: normalizeId(milestone.recipientId), occasion_type: milestone.occasionType || 'custom', occasion_label: milestone.occasionLabel || null, event_date: milestone.eventDate || null, repeats_annually: Boolean(milestone.repeatsAnnually), budget_tier: milestone.budgetTier || 'classic', status: milestone.status || 'active', card_message_tone: milestone.cardMessageTone || null, style_preferences: milestone.stylePreferences || null, allergies_or_avoid: milestone.allergiesOrAvoid || null, hard_no_preferences: milestone.hardNoPreferences || null, reminder_days_before: milestone.reminderDaysBefore || 7, charge_days_before: milestone.chargeDaysBefore || 5, created_at: milestone.createdAt || new Date().toISOString(), updated_at: milestone.updatedAt || new Date().toISOString() }))],
    ['scheduled_orders', (state.orders || []).map((order) => ({ id: normalizeId(order.id), customer_id: normalizeId(order.userId), recipient_id: normalizeId(order.recipientId), milestone_id: normalizeId(order.milestoneId), event_date: order.eventDate || null, planned_charge_date: order.plannedChargeDate || null, reminder_date: order.reminderDate || null, order_source: order.orderSource || 'milestone', occasion_type: order.occasionType || null, occasion_label: order.occasionLabel || null, surprise_setting_id: normalizeId(order.surpriseSettingId), budget_tier: order.budgetTier || 'classic', estimated_customer_price_cents: order.estimatedCustomerPriceCents || 0, delivery_fee_cents: order.deliveryFeeCents || 0, status: order.status || 'scheduled', florist_partner_id: normalizeId(order.floristPartnerId), internal_notes: order.internalNotes || null, customer_notes: order.customerNotes || null, generated_card_message: order.generatedCardMessage || null, photo_proof_url: order.photoProofUrl || null, delivered_at: order.deliveredAt || null, support_minutes: order.supportMinutes || 0, refund_amount_cents: order.refundAmountCents || null, stripe_payment_intent_id: order.stripePaymentIntentId || null, price_override_reason: order.priceOverrideReason || null, created_at: order.createdAt || new Date().toISOString(), updated_at: order.updatedAt || new Date().toISOString() }))],
    ['florist_partners', (state.floristPartners || []).map((florist) => ({ id: normalizeId(florist.id), name: florist.name || '', contact_name: florist.contactName || null, email: florist.email || null, phone: florist.phone || null, address: florist.address || null, city: florist.city || null, postal_code: florist.postalCode || null, active: Boolean(florist.active), weekday_only: Boolean(florist.weekdayOnly), service_zones: florist.serviceZones || [], notes: florist.notes || null, created_at: florist.createdAt || new Date().toISOString(), updated_at: florist.updatedAt || new Date().toISOString() }))],
    ['service_zones', (state.serviceZones || []).map((zone) => ({ id: normalizeId(zone.id), name: zone.name || '', prefixes: zone.prefixes || [], active: Boolean(zone.active), delivery_fee_cents: zone.deliveryFeeCents || 0, notes: zone.notes || null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }))],
    ['payment_consents', (state.paymentConsents || []).map((consent) => ({ id: normalizeId(consent.id), customer_id: normalizeId(consent.userId), stripe_customer_id: consent.stripeCustomerId || null, stripe_payment_method_id: consent.stripePaymentMethodId || null, consent_text_version: consent.consentTextVersion || null, consent_text_snapshot: consent.consentTextSnapshot || null, consented_at: consent.consentedAt || new Date().toISOString(), ip_address: consent.ipAddress || null, user_agent: consent.userAgent || null, active: Boolean(consent.active), created_at: consent.consentedAt || new Date().toISOString(), updated_at: consent.consentedAt || new Date().toISOString() }))],
    ['relationship_memberships', (state.relationshipMemberships || []).map((membership) => ({ id: normalizeId(membership.id), customer_id: normalizeId(membership.userId), plan_key: membership.planKey || 'datekeeper', status: membership.status || 'active', annual_fee_cents: membership.annualFeeCents || 0, protected_date_limit: membership.protectedDateLimit || 3, current_period_start: membership.currentPeriodStart || null, current_period_end: membership.currentPeriodEnd || null, stripe_checkout_session_id: membership.stripeCheckoutSessionId || null, stripe_payment_intent_id: membership.stripePaymentIntentId || null, created_at: membership.createdAt || new Date().toISOString(), updated_at: membership.updatedAt || new Date().toISOString() }))],
    ['surprise_delight_settings', (state.surpriseDelightSettings || []).map((setting) => ({ id: normalizeId(setting.id), customer_id: normalizeId(setting.userId), recipient_id: normalizeId(setting.recipientId), budget_tier: setting.budgetTier || 'classic', monthly_price_cents: setting.monthlyPriceCents || 0, preferred_delivery_day: setting.preferredDeliveryDay || null, preferred_delivery_date: setting.preferredDeliveryDate || null, reminder_days_before: setting.reminderDaysBefore || 7, charge_days_before: setting.chargeDaysBefore || 5, status: setting.status || 'active', skipped_month: setting.skippedMonth || null, last_generated_month: setting.lastGeneratedMonth || null, notes: setting.notes || null, created_at: setting.createdAt || new Date().toISOString(), updated_at: setting.updatedAt || new Date().toISOString() }))],
    ['order_event_logs', (state.orderEvents || []).map((event) => ({ id: normalizeId(event.id), order_id: normalizeId(event.orderId), type: event.type || 'status_change', message: event.message || '', actor_type: event.actorType || 'system', created_at: event.createdAt || new Date().toISOString() }))],
    ['feedback', (state.feedback || []).map((entry) => ({ id: normalizeId(entry.id), order_id: normalizeId(entry.orderId), rating: entry.rating || null, comments: entry.comments || null, created_at: entry.createdAt || new Date().toISOString() }))],
  ];

  for (const [table, rows] of rowsByTable) {
    if (!rows.length) {
      continue;
    }
    const { data, error } = await supabase.from(table).upsert(rows, { onConflict: 'id' }).select('id');
    if (error) {
      throw error;
    }
    if (table === 'customers') summary.customers = data?.length || 0;
    if (table === 'recipients') summary.recipients = data?.length || 0;
    if (table === 'milestones') summary.milestones = data?.length || 0;
    if (table === 'scheduled_orders') summary.scheduledOrders = data?.length || 0;
    if (table === 'florist_partners') summary.florists = data?.length || 0;
    if (table === 'service_zones') summary.zones = data?.length || 0;
    if (table === 'payment_consents') summary.consents = data?.length || 0;
    if (table === 'relationship_memberships') summary.memberships = data?.length || 0;
    if (table === 'surprise_delight_settings') summary.surpriseSettings = data?.length || 0;
    if (table === 'order_event_logs') summary.logs = data?.length || 0;
    if (table === 'feedback') summary.feedback = data?.length || 0;
  }

  logger(JSON.stringify(summary, null, 2));
  return { dryRun: false, summary, dataFilePath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await runMigration({ env: process.env, dryRun: args.dryRun, logger: console.log });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  runMigration,
  parseArgs,
};
