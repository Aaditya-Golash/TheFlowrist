-- Supabase schema for TheFlowrist pilot persistence
-- RLS should be enabled before public client access is used.
-- IDs are `text`, not `uuid`: the app generates its own string ids
-- (e.g. `recipient-<timestamp>`) and the migration script writes those
-- ids as-is, so the columns must accept them rather than only UUIDs.

create table if not exists customers (
  id text primary key,
  name text not null,
  email text,
  phone text,
  marketing_email_consent boolean not null default false,
  marketing_sms_consent boolean not null default false,
  -- Maps this customer row to the Supabase Auth user (auth.users.id) that
  -- owns it. Nullable because pilot-mode/JSON-imported customers may not
  -- have a Supabase Auth account; the app backfills this on first Supabase
  -- Auth login (see lib/auth/supabaseAuth.js). Prefer this over email
  -- matching for RLS since email isn't guaranteed stable/unique long-term.
  auth_user_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Additive/idempotent: safe to run again against a table created before
-- this column existed.
alter table customers add column if not exists auth_user_id uuid unique;

create table if not exists recipients (
  id text primary key,
  customer_id text not null references customers(id) on delete cascade,
  name text not null,
  relationship text,
  phone text,
  address_line_1 text,
  address_line_2 text,
  city text,
  province text,
  postal_code text,
  delivery_instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists milestones (
  id text primary key,
  customer_id text not null references customers(id) on delete cascade,
  recipient_id text references recipients(id) on delete set null,
  occasion_type text not null,
  occasion_label text,
  event_date date not null,
  repeats_annually boolean not null default false,
  budget_tier text not null check (budget_tier in ('classic', 'premium', 'signature')),
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  card_message_tone text,
  style_preferences text,
  allergies_or_avoid text,
  hard_no_preferences text,
  reminder_days_before integer not null default 7,
  charge_days_before integer not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists scheduled_orders (
  id text primary key,
  customer_id text not null references customers(id) on delete cascade,
  recipient_id text references recipients(id) on delete set null,
  milestone_id text references milestones(id) on delete set null,
  event_date date not null,
  planned_charge_date date,
  budget_tier text not null check (budget_tier in ('classic', 'premium', 'signature')),
  estimated_customer_price_cents integer not null default 0,
  delivery_fee_cents integer not null default 0,
  status text not null default 'scheduled' check (status in ('scheduled', 'pre_charge_reminder_sent', 'pending_charge', 'charged', 'sent_to_florist', 'florist_accepted', 'preparing', 'out_for_delivery', 'delivered', 'issue_reported', 'refunded', 'cancelled')),
  florist_partner_id text,
  internal_notes text,
  customer_notes text,
  generated_card_message text,
  photo_proof_url text,
  delivered_at timestamptz,
  support_minutes integer not null default 0,
  refund_amount_cents integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists florist_partners (
  id text primary key,
  name text not null,
  contact_name text,
  email text,
  phone text,
  address text,
  city text,
  postal_code text,
  active boolean not null default true,
  weekday_only boolean not null default true,
  service_zones text[],
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists service_zones (
  id text primary key,
  name text not null,
  prefixes text[] not null default '{}',
  active boolean not null default true,
  delivery_fee_cents integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payment_consents (
  id text primary key,
  customer_id text not null references customers(id) on delete cascade,
  stripe_customer_id text,
  stripe_payment_method_id text,
  consent_text_version text,
  consent_text_snapshot text,
  consented_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists order_event_logs (
  id text primary key,
  order_id text not null references scheduled_orders(id) on delete cascade,
  type text not null,
  message text not null,
  actor_type text not null,
  created_at timestamptz not null default now()
);

create table if not exists feedback (
  id text primary key,
  order_id text references scheduled_orders(id) on delete set null,
  rating integer,
  comments text,
  created_at timestamptz not null default now()
);

create index if not exists idx_recipients_customer_id on recipients(customer_id);
create index if not exists idx_milestones_customer_id on milestones(customer_id);
create index if not exists idx_milestones_recipient_id on milestones(recipient_id);
create index if not exists idx_milestones_event_date on milestones(event_date);
create index if not exists idx_scheduled_orders_customer_id on scheduled_orders(customer_id);
create index if not exists idx_scheduled_orders_recipient_id on scheduled_orders(recipient_id);
create index if not exists idx_scheduled_orders_milestone_id on scheduled_orders(milestone_id);
create index if not exists idx_scheduled_orders_planned_charge_date on scheduled_orders(planned_charge_date);
create index if not exists idx_scheduled_orders_status on scheduled_orders(status);
create index if not exists idx_scheduled_orders_florist_partner_id on scheduled_orders(florist_partner_id);
create index if not exists idx_order_event_logs_order_id on order_event_logs(order_id);
create index if not exists idx_order_event_logs_created_at on order_event_logs(created_at);
create index if not exists idx_payment_consents_customer_id on payment_consents(customer_id);
create index if not exists idx_florist_partners_active on florist_partners(active);
create index if not exists idx_service_zones_active on service_zones(active);
create index if not exists idx_customers_auth_user_id on customers(auth_user_id);
create index if not exists idx_feedback_order_id on feedback(order_id);

-- =============================================================================
-- Row Level Security
-- =============================================================================
-- The app today talks to Supabase exclusively through the server-side
-- service role key (see lib/supabaseStore.js), which bypasses RLS entirely.
-- These policies exist so that:
--   1. the anon/authenticated keys (already shipped to the browser for
--      Supabase Auth session handling) cannot read or write this data
--      directly, bypassing the app's own route guards and ownership checks;
--   2. a future client-safe/direct-from-browser Supabase usage has a
--      correct, tested policy set to build on rather than starting from
--      "everything is open."
-- Nothing below changes how the app itself behaves — the service role key
-- is unaffected by RLS. See docs/security.md for the full model.

alter table customers enable row level security;
alter table recipients enable row level security;
alter table milestones enable row level security;
alter table scheduled_orders enable row level security;
alter table payment_consents enable row level security;
alter table feedback enable row level security;

-- NOTE: florist_partners, service_zones, and order_event_logs are
-- intentionally left without RLS here — they are internal
-- concierge/ops data (or, for order_event_logs, an audit trail tied to
-- scheduled_orders) rather than customer-owned rows. Review before any
-- future direct-from-browser access to those tables.

-- customers: a row is visible/editable only by the Supabase Auth user it
-- is mapped to via auth_user_id.
drop policy if exists customers_select_own on customers;
create policy customers_select_own on customers
  for select using (auth_user_id = auth.uid());

drop policy if exists customers_update_own on customers;
create policy customers_update_own on customers
  for update using (auth_user_id = auth.uid());

-- recipients/milestones/scheduled_orders/payment_consents: scoped to rows
-- whose customer_id maps to a customers row owned by the requesting user.
drop policy if exists recipients_owner_access on recipients;
create policy recipients_owner_access on recipients
  for all using (
    customer_id in (select id from customers where auth_user_id = auth.uid())
  );

drop policy if exists milestones_owner_access on milestones;
create policy milestones_owner_access on milestones
  for all using (
    customer_id in (select id from customers where auth_user_id = auth.uid())
  );

drop policy if exists scheduled_orders_owner_access on scheduled_orders;
create policy scheduled_orders_owner_access on scheduled_orders
  for all using (
    customer_id in (select id from customers where auth_user_id = auth.uid())
  );

drop policy if exists payment_consents_owner_access on payment_consents;
create policy payment_consents_owner_access on payment_consents
  for all using (
    customer_id in (select id from customers where auth_user_id = auth.uid())
  );

-- feedback: scoped via the order it belongs to (feedback has no customer_id
-- column of its own).
drop policy if exists feedback_owner_access on feedback;
create policy feedback_owner_access on feedback
  for all using (
    order_id in (
      select id from scheduled_orders
      where customer_id in (select id from customers where auth_user_id = auth.uid())
    )
  );
