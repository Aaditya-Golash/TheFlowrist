# Private pilot deployment

This document covers deploying TheFlowrist for a small, invite-only private pilot. It intentionally does not cover public launch, autoscaling, or anything beyond what a handful of real customers and one or two admins need.

## What this pilot deployment is (and is not)

- **Is**: a single Node.js process, real Supabase persistence, real Supabase Auth, manual concierge fulfillment by an admin.
- **Is not**: n8n automation, MCP, Shopify, real Stripe charging, a redesigned frontend, or a rewritten architecture. None of that is enabled and none of it should be added as part of going live for the pilot.

## Recommended deployment targets

Any platform that can run a long-lived Node.js 20+ process and let you set environment variables works. Pick whichever is least new operational surface for you:

- **Fly.io / Render / Railway** — simplest for a single small Node process, minimal config.
- **A small VPS + Docker** — use the existing `Dockerfile` (`docker build -t theflowrist . && docker run -p 3000:3000 theflowrist`), put a reverse proxy (Caddy/nginx) in front for TLS.
- Avoid serverless/edge platforms with cold starts and no persistent process for now — the app assumes a normal long-running Node server.

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
```

Also set `ALLOWED_ORIGINS` to your real pilot domain(s) (comma-separated) — do not leave it defaulted to `http://localhost:3000`.

At startup, if `NODE_ENV=production`, the server validates these and refuses to start with a clear list of what's missing (see `lib/env-check.js` / `server.js`) instead of silently falling back to an unsafe default.

## Supabase setup checklist

1. Create a Supabase project (or use an existing one for the pilot).
2. Run the schema: apply [supabase/schema.sql](../supabase/schema.sql) in the Supabase SQL editor.
3. Copy `SUPABASE_URL`, the **anon** key, and the **service role** key into your deployment's environment variables. Never commit these — `.env` and `.env.example` stay placeholder-only (see `.gitignore`).
4. Create private pilot users in Authentication → Users (see [docs/auth.md](auth.md) — there is no public sign-up).
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

This writes and reads back a dedicated set of `smoke-*` prefixed records against your real Supabase project. It requires live credentials and mutates real data (in a clearly-labelled, throwaway way) — run it manually when you want to confirm write access works, not as part of every deploy.

## Verifying `/health` and `/ready`

After deploying:

```bash
curl https://your-pilot-domain/health
# {"status":"ok","environment":"production"}

curl https://your-pilot-domain/ready
# {"ready":true,"environment":"production","checks":{...}}
```

`/health` only confirms the process is alive. `/ready` checks that the selected storage/auth backends are valid values and that their required env vars are present (and, in production, that `INTERNAL_API_SECRET`/`ADMIN_EMAILS` are set) — without ever returning secret values. If `ready` is `false`, check the `checks` object for which one failed.

## Predeploy check

```bash
npm run predeploy:check
```

This runs `npm test` (fully offline) followed by `npm run check:supabase` (requires real, live Supabase credentials configured in your environment — it will fail if you run it without them, which is expected outside a deploy). Run it right before deploying, with your production-like Supabase env vars loaded locally or in CI.

`npm run smoke:supabase` is intentionally **not** part of `predeploy:check` — it mutates real data and should be run manually, not automatically on every deploy.

## Creating your first admin user

1. In Supabase, Authentication → Users → Add user. Set an email + password.
2. Add that email to `ADMIN_EMAILS` in your deployment environment.
3. Visit `/admin/login`, sign in with that email/password.

## Creating private pilot customer users

1. In Supabase, Authentication → Users → Add user (one per pilot customer).
2. That's it — the first time they sign in at `/login`, a minimal customer profile is created automatically for them.

## Rollback steps

- **App-level rollback**: redeploy the previous known-good build/image. No database migration is required to roll back the app code itself.
- **Auth rollback**: set `AUTH_BACKEND=pilot` and redeploy if Supabase Auth is misbehaving — this restores the temporary email-only login as a stopgap. Do this only briefly; it is not secure enough for real customer data exposure beyond a short incident window.
- **Storage rollback**: `STORAGE_BACKEND=json` is available but does **not** contain your Supabase data — treat it strictly as a local/dev fallback, not a production rollback path for real pilot data.
- **Data rollback**: use Supabase's point-in-time recovery / backups (project settings) if bad data was written; this app does not implement its own undo.

## What not to enable yet

- n8n, MCP, Playwright, Shopify — intentionally absent from this codebase.
- Real Stripe charging — payment consent is recorded, but no charge is ever placed.
- Public customer sign-up — pilot users are created manually in Supabase.
- Row-level security policies beyond service-role access — the app itself is the only thing talking to the database today; RLS hardening is future work (see [docs/supabase-migration.md](supabase-migration.md)).

## Remaining risks before inviting real users

- No RLS policies yet — the service role key has full table access; a compromised server process would have full database access. Acceptable for a small trusted pilot, not for scale.
- No password reset/magic-link UI — a locked-out user needs manual help via the Supabase dashboard.
- No rate limiting on `/login` or `/admin/login` — a small pilot is low-risk, but this should be addressed before any wider rollout.
- No automated backups verification — confirm Supabase's backup settings match your risk tolerance before go-live.
- Dashboard/account data is not strictly scoped per customer (a long-standing MVP simplification, unchanged by this work) — fine for a single-tenant-feeling pilot with a handful of trusted users, not fine at scale.
- **Storage adapter sync/async mismatch (pre-existing, high priority to verify)**: route handlers call `getState()`/`setState()` without `await`, which is correct for the JSON backend (synchronous) but not for the Supabase backend, whose `getState()` returns a Promise. If that Promise rejects (e.g. a missing table, a network blip) with nothing awaiting it, it surfaces as an **unhandled promise rejection that crashes the whole Node process**, not a contained per-request error. This predates the auth/deployment work in this document and was not introduced by it, but it means `STORAGE_BACKEND=supabase` has not been battle-tested against real traffic the way `STORAGE_BACKEND=json` has via the test suite (which only exercises the JSON backend end-to-end). Before inviting real users with `STORAGE_BACKEND=supabase`: apply `supabase/schema.sql` fully, manually click through every route once against the real project, and consider running the process under a supervisor that auto-restarts on crash (e.g. `pm2`, systemd) as a safety net while this gets fixed properly.
