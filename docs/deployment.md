# Private pilot deployment

This document covers deploying TheFlowerist for a small, invite-only private pilot. It intentionally does not cover public launch, autoscaling, or anything beyond what a handful of real customers and one or two admins need.

## What this pilot deployment is (and is not)

- **Is**: a single Node.js process, real Supabase persistence, real Supabase Auth, real Stripe payment capture and charging (test-mode keys only), manual concierge fulfillment by an admin.
- **Is not**: n8n installed as a service, MCP, Shopify, a redesigned frontend, a rewritten architecture, or live Stripe keys. None of that is enabled and none of it should be added as part of going live for the pilot. The internal endpoints that an n8n workflow would call already exist; see [docs/n8n-workflows.md](../docs/n8n-workflows.md). n8n itself is not required or installed.

## Recommended deployment targets

Any platform that can run a long-lived Node.js 20+ process and let you set environment variables works. Pick whichever is least new operational surface for you:

- **Fly.io / Render / Railway** - simplest for a single small Node process, minimal config.
- **A small VPS + Docker** - use the existing `Dockerfile` (`docker build -t theflowerist . && docker run -p 3000:3000 theflowerist`), put a reverse proxy (Caddy/nginx) in front for TLS.
- Avoid serverless/edge platforms with cold starts and no persistent process for now - the app assumes a normal long-running Node server.

Whatever you choose, terminate TLS in front of the app (so `Secure` cookies actually work) and set `NODE_ENV=production`.

## Required environment variables

```env
NODE_ENV=production
PORT=3000
STORAGE_BACKEND=supabase
AUTH_BACKEND=supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
INTERNAL_API_SECRET=
ADMIN_EMAILS=
STRIPE_SECRET_KEY=
```

Also set `ALLOWED_ORIGINS` to your real pilot domain(s) (comma-separated) - do not leave it defaulted to `http://localhost:3000`. Set `APP_BASE_URL` to your real pilot domain too. It is used to build Stripe Checkout redirect URLs and reminder-email links.

Optional but needed for reminders to actually go out: `RESEND_API_KEY` and `REMINDER_FROM_EMAIL` (see `npm run send:reminders` below).

At startup, if `NODE_ENV=production`, the server validates these and refuses to start with a clear list of what's missing (see `lib/env-check.js` / `server.js`) instead of silently falling back to an unsafe default. `STRIPE_SECRET_KEY` is included in that check. The server will not start in production without it.

**Use Stripe test-mode keys (`sk_test_...`) for this private pilot.** Do not put a live key (`sk_live_...`) in any environment until you've had a chance to review consent/refund copy and are ready to actually charge real customers. See "Remaining risks" below.

## Supabase setup checklist

1. Create a Supabase project (or use an existing one for the pilot).
2. Run the schema: apply [supabase/schema.sql](../supabase/schema.sql) in the Supabase SQL editor. This creates every table, enables Row Level Security with ownership policies on the customer-owned tables, and adds the `customers.auth_user_id` column used by those policies - see [docs/security.md](security.md) for what it does and why. Every statement is idempotent, so it's safe to re-run against a project that already has an older version of this schema.
3. Copy `SUPABASE_URL`, the **anon** key, and the **service role** key into your deployment's environment variables. Never commit these - `.env` and `.env.example` stay placeholder-only (see `.gitignore`).
4. Create private pilot users in Authentication -> Users (see [docs/auth.md](auth.md) - there is no public sign-up). `auth_user_id` is backfilled automatically on each customer's first Supabase Auth login.
5. Add each admin's email to `ADMIN_EMAILS`.

## Running the migration

If you have existing local JSON data (`data/app-data.json`) to bring into Supabase:

```bash
npm run migrate:supabase -- --dry-run   # preview only, no Supabase credentials required
npm run migrate:supabase                # writes to Supabase; requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
```

## Running the smoke test

```bash
npm run smoke:supabase
```

This writes and reads back a dedicated set of `smoke-*` prefixed records against your real Supabase project. It requires live credentials and mutates real data (in a clearly-labelled, throwaway way) - run it manually when you want to confirm write access works, not as part of every deploy.


## Pricing check

Active customer-facing pricing is centralized in [lib/pricing.js](../lib/pricing.js):

- Classic: $145
- Premium: $195
- Signature: $275

Do not use older $75 / $120 / $200 planning math in active UI, admin workflows, or launch copy. If historical pricing appears in planning notes, label it historical.
## Verifying `/health` and `/ready`

After deploying:

```bash
curl https://your-pilot-domain/health
# {"status":"ok"}

curl https://your-pilot-domain/ready
# {"ready":true,"environment":"production","checks":{...}}
```

`/health` only confirms the process is alive. `/ready` checks that the selected storage/auth backends are valid values and that their required env vars are present (and, in production, that `INTERNAL_API_SECRET`/`ADMIN_EMAILS` are set) - without ever returning secret values. If `ready` is `false`, check the `checks` object for which one failed.

## Predeploy check

```bash
npm run predeploy:check
```

This runs `npm test` (fully offline) followed by `npm run check:supabase` (requires real, live Supabase credentials configured in your environment - it will fail if you run it without them, which is expected outside a deploy). Run it right before deploying, with your production-like Supabase env vars loaded locally or in CI.

`npm run smoke:supabase` is intentionally **not** part of `predeploy:check` - it mutates real data and should be run manually, not automatically on every deploy.

## Creating your first admin user

1. In Supabase, Authentication -> Users -> Add user. Set an email + password.
2. Add that email to `ADMIN_EMAILS` in your deployment environment.
3. Visit `/admin/login`, sign in with that email/password.

## Creating private pilot customer users

1. In Supabase, Authentication -> Users -> Add user (one per pilot customer).
2. That's it - the first time they sign in at `/login`, a minimal customer profile is created automatically for them.

## Rollback steps

- **App-level rollback**: redeploy the previous known-good build/image. No database migration is required to roll back the app code itself.
- **Auth rollback**: set `AUTH_BACKEND=pilot` and redeploy if Supabase Auth is misbehaving - this restores the temporary email-only login as a stopgap. Do this only briefly; it is not secure enough for real customer data exposure beyond a short incident window.
- **Storage rollback**: `STORAGE_BACKEND=json` is available but does **not** contain your Supabase data - treat it strictly as a local/dev fallback, not a production rollback path for real pilot data.
- **Data rollback**: use Supabase's point-in-time recovery / backups (project settings) if bad data was written; this app does not implement its own undo.

## What not to enable yet

- n8n (as an installed service), MCP, Playwright, Shopify - intentionally absent from this codebase. The internal HTTP endpoints an n8n workflow would call already exist, but n8n itself is not required.
- Live Stripe keys - only `sk_test_...` keys should be configured anywhere until consent/refund copy has had a non-engineering review (see "Remaining risks" below).
- Public customer sign-up - pilot users are created manually in Supabase.
- Row-level security policies - defined in `supabase/schema.sql`, see below.

## Hosting and cost (free-tier beta stack)

For a small private pilot, the whole stack can run at effectively $0 fixed cost:

| Component | Recommended free tier | Notes |
| --- | --- | --- |
| App hosting | Render or Fly.io free/hobby tier | Needs a long-lived Node process (see "Recommended deployment targets" above) |
| Database + Auth | Supabase free tier | Covers a small pilot's data volume comfortably |
| Payments | Stripe, pay-per-transaction, test mode | No fixed cost; test mode has zero cost at all since no card is ever really charged |
| Reminder email | Resend or Postmark free tier | Both offer enough free monthly sends for a handful of pilot customers |

Nothing above requires a paid plan to run this pilot. The only per-transaction cost (Stripe's processing fee) applies once you switch to a live key, which this codebase intentionally does not do.

## Applying RLS to an already-deployed project

If you deployed before RLS policies existed in `supabase/schema.sql` (e.g. the RLS-disabled state flagged in [issue #1](https://github.com/Aaditya-Golash/TheFlowerist/issues/1)), **re-run the full `supabase/schema.sql` file** against your project's SQL editor. Every statement is idempotent (`create table if not exists`, `add column if not exists`, `drop policy if exists` before `create policy`) - safe to run again on a project that already has tables and data. This enables RLS and adds ownership policies on `customers`, `recipients`, `milestones`, `scheduled_orders`, `payment_consents`, and `feedback`, and adds the `customers.auth_user_id` column those policies key off of. See [docs/security.md](security.md) for the full model, including which tables are intentionally left without RLS and why.

After re-running the schema, re-check the advisor scan to confirm it's actually resolved:
```
get_advisors(project_id, type="security")   # via the Supabase MCP connection
```

`auth_user_id` backfills automatically the next time each existing customer signs in via Supabase Auth - no manual data migration needed, but until a customer's first post-upgrade login, their row won't yet satisfy the new policies from an anon/authenticated-key perspective (irrelevant to the app itself, since it uses the service-role key, which bypasses RLS).

## Remaining risks before inviting real users

- **Consent and refund copy needs a non-engineering (even informal legal) review before any live charge is ever placed.** The consent text in `CONSENT_TEXT_SNAPSHOT` (`lib/routes.js`) and the reminder-email copy in `lib/notifications.js` were written by an engineer, not reviewed by counsel. Do this before flipping to a live Stripe key. Test mode never actually charges anyone.
- **Charge scheduling is not automated.** `POST /internal/orders/:id/charge` and `npm run send:reminders` both need something external to actually call them on a schedule (cron, a hosted scheduler, or n8n). Nothing in this repo triggers them on its own.
- **Refunds are manual.** There is no `POST /internal/orders/:id/refund` or admin refund action yet. A refund today means using the Stripe dashboard directly and then updating the order's status/`refundAmountCents` by hand in the admin UI.
- **The reminder script marks an order `pre_charge_reminder_sent` even if the email silently bounces** (Resend accepted it, but the recipient's inbox rejected it later) - there's no bounce-webhook handling yet.
- **Rate limiting is in-memory and single-process** ([lib/rate-limiter.js](../lib/rate-limiter.js)) - fine for one small pilot instance, resets on restart, and doesn't share state across multiple instances behind a load balancer. Not a substitute for a real distributed rate limiter at scale.
- No password reset/magic-link UI - a locked-out user needs manual help via the Supabase dashboard.
- No automated backups verification - confirm Supabase's backup settings match your risk tolerance before go-live.
- No customer-facing "view order" page yet, so the `assertCustomerOwnsOrder` ownership check has no current call site - add real enforcement when that view ships.
- RLS policies are written and covered by the schema file, but have not yet been verified against a live Supabase project with real Supabase Auth sessions (only unit-testable logic - the ownership checks in `lib/ownership.js` - has automated coverage). Manually verify by signing in as two different real pilot users and confirming neither can see the other's data, before broader rollout.
