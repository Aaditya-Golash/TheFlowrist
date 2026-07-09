-- Hybrid offer model: one-time orders, relationship memberships, and
-- Signature-only Surprise & Delight Monthly settings.

alter table scheduled_orders add column if not exists reminder_date date;
alter table scheduled_orders add column if not exists order_source text not null default 'milestone';
alter table scheduled_orders add column if not exists occasion_type text;
alter table scheduled_orders add column if not exists occasion_label text;
alter table scheduled_orders add column if not exists surprise_setting_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'scheduled_orders_order_source_check'
  ) then
    alter table scheduled_orders
      add constraint scheduled_orders_order_source_check
      check (order_source in ('milestone', 'one_time', 'surprise_monthly'));
  end if;
end $$;

create table if not exists relationship_memberships (
  id text primary key,
  customer_id text not null references customers(id) on delete cascade,
  plan_key text not null check (plan_key in ('datekeeper', 'thoughtful', 'signature')),
  status text not null default 'active' check (status in ('active', 'cancelled', 'expired')),
  annual_fee_cents integer not null default 0,
  protected_date_limit integer not null default 3,
  current_period_start date,
  current_period_end date,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists surprise_delight_settings (
  id text primary key,
  customer_id text not null references customers(id) on delete cascade,
  recipient_id text references recipients(id) on delete set null,
  budget_tier text not null check (budget_tier in ('classic', 'premium', 'signature')),
  monthly_price_cents integer not null,
  preferred_delivery_day integer check (preferred_delivery_day between 1 and 28),
  preferred_delivery_date date,
  reminder_days_before integer not null default 7,
  charge_days_before integer not null default 5,
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  skipped_month text,
  last_generated_month text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_scheduled_orders_reminder_date on scheduled_orders(reminder_date);
create index if not exists idx_scheduled_orders_order_source on scheduled_orders(order_source);
create index if not exists idx_scheduled_orders_surprise_setting_id on scheduled_orders(surprise_setting_id);
create index if not exists idx_relationship_memberships_customer_id on relationship_memberships(customer_id);
create index if not exists idx_relationship_memberships_status on relationship_memberships(status);
create index if not exists idx_surprise_delight_settings_customer_id on surprise_delight_settings(customer_id);
create index if not exists idx_surprise_delight_settings_recipient_id on surprise_delight_settings(recipient_id);
create index if not exists idx_surprise_delight_settings_status on surprise_delight_settings(status);

alter table relationship_memberships enable row level security;
alter table surprise_delight_settings enable row level security;

grant select, insert, update, delete on relationship_memberships to authenticated;
grant select, insert, update, delete on surprise_delight_settings to authenticated;

drop policy if exists relationship_memberships_owner_access on relationship_memberships;
create policy relationship_memberships_owner_access on relationship_memberships
  for all to authenticated
  using (
    customer_id in (select id from customers where auth_user_id = (select auth.uid()))
  )
  with check (
    customer_id in (select id from customers where auth_user_id = (select auth.uid()))
  );

drop policy if exists surprise_delight_settings_owner_access on surprise_delight_settings;
create policy surprise_delight_settings_owner_access on surprise_delight_settings
  for all to authenticated
  using (
    customer_id in (select id from customers where auth_user_id = (select auth.uid()))
  )
  with check (
    customer_id in (select id from customers where auth_user_id = (select auth.uid()))
  );
