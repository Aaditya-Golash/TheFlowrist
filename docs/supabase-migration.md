# Supabase migration plan

## Proposed tables

- customers
- recipients
- milestones
- scheduled_orders
- florist_partners
- service_zones
- payment_consents
- relationship_memberships
- surprise_delight_settings
- order_event_logs
- feedback

## Columns and relationships

- customers: id, name, email, phone, marketing_email_consent, marketing_sms_consent, created_at, updated_at
- recipients: id, customer_id, name, relationship, phone, address_line_1, address_line_2, city, province, postal_code, delivery_instructions, created_at, updated_at
- milestones: id, customer_id, recipient_id, occasion_type, occasion_label, event_date, repeats_annually, budget_tier, status, card_message_tone, style_preferences, allergies_or_avoid, hard_no_preferences, reminder_days_before, charge_days_before, created_at, updated_at
- scheduled_orders: id, customer_id, recipient_id, milestone_id, event_date, planned_charge_date, reminder_date, order_source, occasion_type, occasion_label, surprise_setting_id, budget_tier, estimated_customer_price_cents, delivery_fee_cents, status, florist_partner_id, internal_notes, customer_notes, generated_card_message, photo_proof_url, delivered_at, support_minutes, refund_amount_cents, stripe_payment_intent_id, price_override_reason, created_at, updated_at
- florist_partners: id, name, contact_name, email, phone, address, city, postal_code, active, weekday_only, service_zones, notes, created_at, updated_at
- service_zones: id, name, prefixes, active, delivery_fee_cents, notes
- payment_consents: id, customer_id, stripe_customer_id, stripe_payment_method_id, consent_text_version, consent_text_snapshot, consented_at, ip_address, user_agent, active
- relationship_memberships: id, customer_id, plan_key, status, annual_fee_cents, protected_date_limit, current_period_start, current_period_end, stripe_checkout_session_id, stripe_payment_intent_id, created_at, updated_at
- surprise_delight_settings: id, customer_id, recipient_id, budget_tier, monthly_price_cents, preferred_delivery_day, preferred_delivery_date, reminder_days_before, charge_days_before, status, skipped_month, last_generated_month, notes, created_at, updated_at
- order_event_logs: id, order_id, type, message, actor_type, created_at
- feedback: id, order_id, rating, comments, created_at

## Indexes

- recipients(customer_id)
- milestones(customer_id, recipient_id, event_date)
- scheduled_orders(customer_id, planned_charge_date, reminder_date, status, order_source, surprise_setting_id)
- relationship_memberships(customer_id, status)
- surprise_delight_settings(customer_id, recipient_id, status)
- order_event_logs(order_id, created_at)

## Row-level security notes

Implemented. `supabase/schema.sql` enables RLS and adds ownership policies on `customers`, `recipients`, `milestones`, `scheduled_orders`, `payment_consents`, `relationship_memberships`, `surprise_delight_settings`, and `feedback`, keyed off a `customers.auth_user_id` column mapped to the Supabase Auth user. See [docs/security.md](security.md) for the full model.

- The app itself still talks to Supabase only via the service-role key (`lib/supabaseStore.js`), which bypasses RLS - these policies protect against direct anon/authenticated-key access (e.g. from a browser holding `SUPABASE_ANON_KEY`), not against the server.
- `florist_partners`, `service_zones`, and `order_event_logs` intentionally do not have RLS - internal ops/audit data, not customer-owned rows.
- All mutation paths remain behind server-side logic (`lib/routes.js` via the storage adapter), not directly from client code.

## Auth plan

Implemented. See [docs/auth.md](auth.md) for the full picture:

- `AUTH_BACKEND=pilot` (default) keeps the existing temporary cookie-based admin/customer flow.
- `AUTH_BACKEND=supabase` uses real Supabase Auth for both admin and customer sign-in, behind a shared auth adapter interface (`lib/auth/`).
- Admin access in Supabase mode still requires the signed-in email to be listed in `ADMIN_EMAILS`.
- Public sign-up is intentionally not implemented; private pilot users are created manually in the Supabase dashboard.

## Photo proof storage plan

- Store proof images in Supabase Storage.
- Keep a public or signed URL in scheduled_orders.photo_proof_url.
- Do not store raw files in the JSON app-data.json export.

## Migration path from app-data.json

1. Export the existing JSON file to a one-time import script.
2. Map array-based records into the new tables.
3. Preserve existing IDs to avoid breaking milestones and orders.
4. Keep the JSON adapter active while the migration is tested in staging.

## Required environment variables

- STORAGE_BACKEND=json|supabase
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- INTERNAL_API_SECRET
- ADMIN_EMAILS

Example local `.env` values:

```env
STORAGE_BACKEND=supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
INTERNAL_API_SECRET=
ADMIN_EMAILS=
```

## Local JSON mode

- Keep the default JSON backend by leaving `STORAGE_BACKEND=json` or not setting it.
- This is the safest current mode for local development and tests.

## Supabase mode

1. Set `STORAGE_BACKEND=supabase`.
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Apply [supabase/schema.sql](../supabase/schema.sql) in your Supabase project.
4. Run `npm run check:supabase` to verify connectivity and table access.
5. Run `npm run migrate:supabase -- --dry-run` to preview the import.
6. Run `npm run migrate:supabase` after ensuring [data/app-data.json](../data/app-data.json) exists locally.
7. Run `npm run smoke:supabase` for a safe write test against a dedicated smoke-test record set.

## Current limitations

- The app still uses server-side persistence only (service-role key); there is no direct-from-browser Supabase access.
- The Supabase adapter is a server-side read/write bridge behind the existing storage-adapter interface, normalizing every row between the database's `snake_case` columns and the app's `camelCase` field names.
- RLS policies are written and applied via schema, but not yet verified against a live project with real Supabase Auth sessions - see [docs/security.md](security.md) and the pre-launch checklist in [docs/deployment.md](deployment.md).
