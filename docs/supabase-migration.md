# Supabase migration plan

## Proposed tables

- customers
- recipients
- milestones
- scheduled_orders
- florist_partners
- service_zones
- payment_consents
- order_event_logs
- feedback

## Columns and relationships

- customers: id, name, email, phone, marketing_email_consent, marketing_sms_consent, created_at, updated_at
- recipients: id, customer_id, name, relationship, phone, address_line_1, address_line_2, city, province, postal_code, delivery_instructions, created_at, updated_at
- milestones: id, customer_id, recipient_id, occasion_type, occasion_label, event_date, repeats_annually, budget_tier, status, card_message_tone, style_preferences, allergies_or_avoid, hard_no_preferences, reminder_days_before, charge_days_before, created_at, updated_at
- scheduled_orders: id, customer_id, recipient_id, milestone_id, event_date, planned_charge_date, budget_tier, estimated_customer_price_cents, delivery_fee_cents, status, florist_partner_id, internal_notes, customer_notes, generated_card_message, photo_proof_url, delivered_at, support_minutes, refund_amount_cents, created_at, updated_at
- florist_partners: id, name, contact_name, email, phone, address, city, postal_code, active, weekday_only, service_zones, notes, created_at, updated_at
- service_zones: id, name, prefixes, active, delivery_fee_cents, notes
- payment_consents: id, customer_id, stripe_customer_id, stripe_payment_method_id, consent_text_version, consent_text_snapshot, consented_at, ip_address, user_agent, active
- order_event_logs: id, order_id, type, message, actor_type, created_at
- feedback: id, order_id, rating, comments, created_at

## Indexes

- recipients(customer_id)
- milestones(customer_id, recipient_id, event_date)
- scheduled_orders(customer_id, planned_charge_date, status)
- order_event_logs(order_id, created_at)

## Row-level security notes

- Start with service-role access for admin workflows.
- Add customer-facing read access later once auth is in place.
- Keep all mutation paths behind server-side logic and not directly from client code.

## Auth plan

- Introduce Supabase Auth for pilot staff first.
- Keep the current cookie-based admin flow as a temporary fallback.
- Add customer sign-in later when the concierge experience expands.

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

- RLS/auth is not complete yet.
- The app still uses server-side persistence only.
- The Supabase adapter is currently a server-side read/write bridge behind the existing interface.
