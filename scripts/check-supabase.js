#!/usr/bin/env node
const path = require('node:path');
const { config } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { validateSupabaseEnvironment } = require('../lib/supabase-env');
const { ensureWebSocketShim } = require('../lib/ws-shim');

config({ path: path.join(__dirname, '..', '.env') });

function formatCount(count) {
  return Number.isFinite(count) ? count : 'n/a';
}

async function main() {
  const env = process.env;
  const { supabaseUrl, serviceRoleKey } = validateSupabaseEnvironment(env);
  ensureWebSocketShim();
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const requiredTables = [
    'customers',
    'recipients',
    'milestones',
    'scheduled_orders',
    'florist_partners',
    'service_zones',
    'payment_consents',
    'relationship_memberships',
    'surprise_delight_settings',
    'order_event_logs',
    'feedback',
  ];

  const summaries = [];
  for (const table of requiredTables) {
    const { error, count } = await supabase.from(table).select('*', { count: 'exact', head: true });
    if (error) {
      summaries.push({ table, ok: false, error: error.message });
      continue;
    }
    summaries.push({ table, ok: true, count: formatCount(count ?? 0) });
  }

  const failures = summaries.filter((entry) => !entry.ok);
  if (failures.length > 0) {
    console.error('Supabase check failed.');
    failures.forEach((entry) => {
      console.error(`- ${entry.table}: ${entry.error}`);
    });
    process.exitCode = 1;
    return;
  }

  console.log('Supabase check passed.');
  summaries.forEach((entry) => {
    console.log(`- ${entry.table}: ${entry.count} rows`);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  validateSupabaseEnvironment,
};
