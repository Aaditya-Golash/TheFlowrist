# TheFlowerist

This is a concierge MVP.
Real Stripe payment capture and charging, in Stripe **test mode** only — no live keys are wired up.
No Shopify automation yet.
No Playwright automation yet.
JSON storage is temporary.
Admin login is temporary pilot access unless AUTH_BACKEND=supabase is configured.

TheFlowerist is a concierge-first MVP for milestone flower gifting. The current implementation uses a lightweight Node.js HTTP server and a JSON-backed store so the experience can be tested locally without adding a full database stack.

## What is included
- landing page and customer dashboard
- recipient and milestone creation
- scheduled order generation from milestones
- admin dashboard and manual order management
- basic service zone and florist partner data
- real payment method capture via Stripe Checkout (setup mode) and real off-session charging via Stripe PaymentIntents — test-mode keys only
- a storage adapter boundary for future Supabase migration
- internal JSON endpoints backing the documented n8n workflows in [docs/n8n-workflows.md](docs/n8n-workflows.md), including a real charge-execution endpoint

## Storage and architecture
- The app now uses a storage adapter boundary so the rest of the app does not depend directly on file-system details.
- The default adapter is JSON-backed and still powers the current pilot experience.
- An optional Supabase adapter is available when the server is started with `STORAGE_BACKEND=supabase`.
- The server-side adapter uses the official Supabase JavaScript client and expects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- The SQL schema lives in [supabase/schema.sql](supabase/schema.sql) and the migration helper is [scripts/migrate-json-to-supabase.js](scripts/migrate-json-to-supabase.js).

## Run locally
```bash
npm install
npm start
```

Open http://localhost:3000/ to view the public experience.

For admin routes in pilot mode, sign in at `/admin/login` with an email listed in `ADMIN_EMAILS`. The `x-admin-email` test header is only honored when `NODE_ENV=test`.

## Localhost readiness checklist

### JSON mode local testing

Use this mode for safe UI and route testing without live Supabase writes:

```bash
npm install
npm test
STORAGE_BACKEND=json AUTH_BACKEND=pilot npm start
```

Then check:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/ready
curl http://localhost:3000/internal/orders/upcoming
curl -H "x-internal-api-secret: wrong" http://localhost:3000/internal/orders/upcoming
```

The internal endpoint calls without the configured secret, or with the wrong secret, should return `401` JSON.

### Supabase mode local testing

Use this mode only with local `.env` values that are not committed:

```bash
npm test
npm run check:supabase
npm run migrate:supabase -- --dry-run
npm run smoke:supabase
STORAGE_BACKEND=supabase AUTH_BACKEND=supabase npm start
```

Then check:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/ready
```

`/ready` reports whether required env vars are present, but it never returns secret values. `npm run smoke:supabase` writes clearly named `smoke-*` rows to the configured Supabase project.

## Authentication
The app supports two auth backends, selected with `AUTH_BACKEND`:

- `pilot` (default) - the existing temporary local login. Customers sign in with just an email at `/login`; admins sign in with just an email at `/admin/login`. No passwords, no real sessions beyond a demo cookie.
- `supabase` - real Supabase Auth. Customers and admins sign in with email + password at `/login` and `/admin/login`. Sessions are stored in secure, HttpOnly cookies. Admin access still requires the signed-in email to be listed in `ADMIN_EMAILS`.

See [docs/auth.md](docs/auth.md) for full details, including how to create private pilot users in Supabase Auth (there is no public sign-up yet).

## Environment variables
- PORT
- NODE_ENV
- ALLOWED_ORIGINS
- ADMIN_EMAILS
- INTERNAL_API_SECRET
- STORAGE_BACKEND=json|supabase
- AUTH_BACKEND=pilot|supabase
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_ANON_KEY (required when AUTH_BACKEND=supabase)
- STRIPE_SECRET_KEY (test-mode key; required for payment consent / charging to work at all)
- STRIPE_PUBLISHABLE_KEY (not currently used server-side, kept for parity with a future client-side flow)
- RESEND_API_KEY (required for `npm run send:reminders` to actually email customers)
- REMINDER_FROM_EMAIL (defaults to a placeholder sender address)
- APP_BASE_URL (used to build links inside reminder emails and Stripe Checkout redirects; defaults to `http://localhost:3000`)

For Supabase-backed runs, put these in a local `.env` file:
```env
STORAGE_BACKEND=supabase
AUTH_BACKEND=supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=
INTERNAL_API_SECRET=
ADMIN_EMAILS=
STRIPE_SECRET_KEY=
```

## Supabase commands
```bash
npm test
npm run check:supabase
npm run migrate:supabase -- --dry-run
npm run migrate:supabase
npm run smoke:supabase
```

## Pricing source of truth

Current customer-facing tiers live in [lib/pricing.js](lib/pricing.js) and should be treated as the only active pricing source:

- Classic: $145
- Premium: $195
- Signature: $275

Older $75 / $120 / $200 assumptions are historical only and should not appear in active UI or customer-facing copy.

## Health and readiness
- `GET /health` confirms the process is alive.
- `GET /ready` returns JSON describing whether the selected storage/auth backends and their required env vars are valid for the current environment.

## Private pilot deployment
JSON storage and pilot auth are local/dev conveniences only. A real private pilot requires `STORAGE_BACKEND=supabase`, `AUTH_BACKEND=supabase`, and a real (test-mode) `STRIPE_SECRET_KEY`. n8n, MCP, and Shopify are intentionally not enabled — only the internal endpoints those tools would call against are implemented server-side. See [docs/deployment.md](docs/deployment.md) for the full checklist, required env vars, and rollback steps.

## Security model
Customer data (recipients, milestones, orders, payment consent) is scoped to the authenticated customer, admin routes require an email in `ADMIN_EMAILS`, `/login` and `/admin/login` are rate-limited, and Supabase Row Level Security policies are defined in [supabase/schema.sql](supabase/schema.sql). See [docs/security.md](docs/security.md) for the full model and current limitations.

## Internal automation endpoints
These are protected by `INTERNAL_API_SECRET` and return JSON only for trusted automation workflows. See [docs/n8n-workflows.md](docs/n8n-workflows.md) for the workflow each one backs.

- GET /internal/orders/upcoming
- GET /internal/orders/needing-reminder (date-accurate: only returns orders whose reminder date has arrived)
- GET /internal/orders/needing-florist
- GET /internal/orders/issues
- POST /internal/orders/:id/event
- POST /internal/orders/:id/status
- POST /internal/orders/:id/charge — attempts a real (test-mode) off-session Stripe charge; idempotent, fails closed to `issue_reported` on any error or missing payment method, and refuses to charge an order whose milestone was paused/cancelled

## Payments and reminders

- **Payment capture**: `/account/payment-consent` starts a Stripe Checkout Session in `setup` mode. The customer enters their card on Stripe's hosted page (never on this app's servers); on return, `/account/payment-consent/complete` stores the real Stripe customer + payment method IDs. Test-mode keys only — see [Stripe's test card numbers](https://stripe.com/docs/testing) for `4242 4242 4242 4242` (success) and `4000 0000 0000 0002` (generic decline).
- **Charging**: `POST /internal/orders/:id/charge` is meant to be called by a scheduler (cron, or your own polling) once `plannedChargeDate` arrives. It is safe to call repeatedly — already-charged orders are a no-op, and orders whose milestone was paused/cancelled are skipped (and cancelled) instead of charged.
- **Reminders**: `npm run send:reminders` emails customers via [Resend](https://resend.com) for every order whose reminder date has arrived, then marks the order `pre_charge_reminder_sent`. Requires `RESEND_API_KEY`.
- Run both on a schedule (cron, a hosted scheduler, or n8n calling the same internal endpoints) — nothing in this repo runs them automatically on its own.

## Test
```bash
npm test
```

## Docker
```bash
docker build -t theflowerist .
docker run -p 3000:3000 theflowerist
```

## Notes
- Stripe integration is real (Checkout in setup mode + PaymentIntents for charging), restricted to **test-mode keys** — no live key has ever been wired up in this codebase.
- The default data layer is JSON-backed and suitable for a concierge MVP beta.
- Supabase is server-side persistence only for now and is not yet wired to public client access.
- Supabase Auth is available as an optional backend (`AUTH_BACKEND=supabase`); see [docs/auth.md](docs/auth.md). Public sign-up is not enabled - pilot users are created manually in the Supabase dashboard.
- RLS policies are defined in [supabase/schema.sql](supabase/schema.sql); the app itself still talks to Supabase only via the service-role key (which bypasses RLS) - see [docs/security.md](docs/security.md).
- Internal endpoints back the documented n8n workflows, but n8n itself is not installed or required — call them from any scheduler you like.
- MCP is intentionally not enabled.
- External repos are references only for future planning.
