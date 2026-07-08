# Security model

This document covers who can see what, how admin access works, and what's still missing before a wider launch. It complements [docs/auth.md](auth.md) (auth backends) and [docs/deployment.md](deployment.md) (deployment checklist).

## Customer data scoping

Every customer-facing route (`/dashboard`, `/recipients/new`, `/milestones/new`, `/account`, `/account/payment-consent`) resolves the current customer via the active auth adapter (`getAuthAdapter().requireUser(req, res)`), then scopes what it reads and writes to that customer's own records:

- The dashboard filters recipients, milestones, and orders to `record.userId === customer.id`.
- The account/payment-consent pages filter payment consents the same way.
- Creating a recipient attaches `userId: customer.id` directly.
- Creating a milestone requires the chosen recipient to belong to the current customer (`assertCustomerOwnsRecipient`) — rejected with `403` otherwise.
- Pausing/cancelling/reactivating a milestone requires the milestone to belong to the current customer (`assertCustomerOwnsMilestone`) — a mismatched ID returns `404` (not `403`), so we don't confirm to an attacker that another customer's record exists.
- Revoking a payment consent by ID requires it to belong to the current customer, same `404` treatment.

These checks live in [lib/ownership.js](../lib/ownership.js) and are backend-agnostic — they work the same way whether the record came from the JSON adapter or Supabase, and are exercised in tests via a fake in-memory two-customer dataset (no live Supabase credentials required).

**In pilot mode**, this scoping is technically still enforced, but is a no-op in practice for the single seeded demo customer, since all seed data belongs to it — this preserves prior pilot-mode behavior without special-casing the auth backend in the scoping logic itself.

**What's not yet scoped**: there is no customer-facing "view order" or "view feedback" page today, so `assertCustomerOwnsOrder` exists (for the same reasons as the recipient/milestone helpers) but has no current call site — it's there for the next customer-facing order view, not decorative.

## Admin access model

Admin routes (`/admin`, `/admin/orders`, `/admin/orders/:id`, `/admin/florists`, `/admin/zones`) require `getAuthAdapter().requireAdmin(req, res)` to pass:

- **Pilot mode**: an `adminEmail` cookie (set via `/admin/login`) whose value is listed in `ADMIN_EMAILS`. The `x-admin-email` header is only honored when `NODE_ENV=test`, so it can't be used to bypass admin auth in a real deployment.
- **Supabase mode**: a valid Supabase Auth session whose email is listed in `ADMIN_EMAILS`. Signing in with valid credentials but a non-admin email gets a `403`, not access.

Admin routes intentionally see **all** customers' orders — that's the point of the admin surface — but only after passing this gate.

## Rate limiting

`POST /login` and `POST /admin/login` are both rate-limited by [lib/rate-limiter.js](../lib/rate-limiter.js): a simple in-memory fixed-window counter keyed by `IP + email`, default 5 attempts per 15 minutes. Exceeding the limit returns `429` with a generic "too many attempts" message — no indication of whether the email/password was actually correct.

**This is basic, single-process, in-memory rate limiting — not distributed, production-grade protection.** It resets on process restart, doesn't share state across multiple app instances, and a determined attacker rotating source IPs isn't meaningfully slowed down. It's enough to blunt casual credential-stuffing against a small private pilot, not a real defense at scale. A real deployment behind a load balancer with more than one instance needs a shared store (Redis, etc.) for this to mean anything.

Passwords and tokens are never logged, including in rate-limit-rejected requests.

## Async storage correctness

`lib/store.js`'s `getState()`/`setState()` delegate to whichever storage adapter is active. The JSON adapter's methods are synchronous; the Supabase adapter's are asynchronous (real network calls). Every route handler that reads or writes store data now `await`s those calls, so:

- In JSON mode, `await` on an already-resolved value is a no-op — behavior is unchanged.
- In Supabase mode, the actual resolved data (not a pending `Promise`) reaches templates and downstream logic.
- All POST body reading goes through a single `readRequestBody(req)` promise-based helper, so the whole request handler is one straight-line `async` function covered by `createRouter`'s try/catch — a thrown or rejected error can no longer escape as an unhandled exception in a detached `req.on('end', ...)` callback and crash the process.
- Writes route through the storage adapter's per-entity CRUD methods (`createRecipient`, `updateMilestone`, `updateScheduledOrder`, etc.) rather than a "mutate the whole state object, then save the whole state back" pattern — `saveState()`/`setState()` is intentionally unimplemented for the Supabase adapter (there's no such thing as "save the whole database back" over a REST API), so routes never call it.
- The Supabase adapter also normalizes every row between the database's `snake_case` columns and the app's `camelCase` field names (both directions), so `STORAGE_BACKEND=supabase` and `STORAGE_BACKEND=json` produce identically-shaped objects to the rest of the app. Without this, Supabase mode would silently render blank/undefined fields (postal code, event date, budget tier, etc.) even though the underlying rows existed.

This is exercised by a test using a hand-written fake async storage adapter (`createFakeAsyncStore` in `test/app.test.js`) with artificial per-call delay, proving route handlers correctly `await` rather than assuming synchronous resolution — without requiring live Supabase credentials.

## Supabase Row Level Security (RLS)

[supabase/schema.sql](../supabase/schema.sql) enables RLS and adds ownership policies on `customers`, `recipients`, `milestones`, `scheduled_orders`, `payment_consents`, and `feedback`, keyed off a new `customers.auth_user_id` column mapped to the Supabase Auth user (`auth.uid()`).

**Why this matters even though the app only uses the service-role key today**: the service role key bypasses RLS entirely, so the app itself is unaffected either way. But `SUPABASE_ANON_KEY` is a public/client-safe key this app already ships (for Supabase Auth session handling), and with RLS off, anyone holding it could read or write every row in every table directly via PostgREST — completely bypassing the app's own route guards and ownership checks documented above. Enabling RLS closes that door regardless of what the app does today, and gives any future client-safe/direct-from-browser Supabase usage a correct policy set to build on instead of starting from "everything is open."

`florist_partners`, `service_zones`, and `order_event_logs` intentionally do **not** have RLS enabled — they're internal ops/audit data, not customer-owned rows, per the scope of this pass. Revisit before any future direct-from-browser access to those tables.

`auth_user_id` is populated automatically the first time a customer signs in via Supabase Auth (matched first by email, then backfilled if missing) — see `resolveCustomerForUser` in [lib/auth/supabaseAuth.js](../lib/auth/supabaseAuth.js). Existing customers created via `migrate-json-to-supabase.js` will have `auth_user_id = null` until their first real login.

**Applying this to an already-deployed project**: re-run `supabase/schema.sql` — every statement is idempotent (`create table if not exists`, `add column if not exists`, `drop policy if exists` before `create policy`), safe to run again against a project that already has the older schema.

## Why pilot mode is not for production

`AUTH_BACKEND=pilot` has no real password verification — a customer "login" is just typing an email, and admin login is an email checked against `ADMIN_EMAILS` with no password. It exists for local development and demos, not for handling real customer data. Anyone who knows (or guesses) a real customer's email can act as them in pilot mode. Never point `AUTH_BACKEND=pilot` at a deployment holding real customer data.

## Why the service role key must remain server-only

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely and grants full read/write access to every table. It must only ever be used server-side (`lib/supabaseStore.js`, the migration/check/smoke scripts) and must never be sent to a browser, committed to the repo, or logged. `SUPABASE_ANON_KEY` is the only Supabase key safe to expose client-side, and even that should only be used for Supabase Auth's own session handling, not for direct data access, until the RLS policies above have been reviewed and tested against real traffic.

## Remaining risks before a wider launch

- Rate limiting is in-memory/single-process only (see above).
- No password reset/magic-link UI — a locked-out customer needs manual help via the Supabase dashboard.
- No automated test coverage running against a *real* Supabase project (RLS policies are documented and written but not yet verified against a live database with real auth sessions — see the RLS section above for how to apply and the pre-launch checklist in [docs/deployment.md](deployment.md)).
- `assertCustomerOwnsOrder` has no current call site (see above) — add real enforcement when a customer-facing order view ships.
- No admin action audit trail beyond `order_event_logs` (order-specific), and no scoping/pagination on `/admin/orders` — fine at pilot scale, not at scale.
