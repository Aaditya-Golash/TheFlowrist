# TheFlowrist

This is a concierge MVP.
No real payments yet.
No Shopify automation yet.
No Playwright automation yet.
JSON storage is temporary.
Admin login is temporary pilot access unless AUTH_BACKEND=supabase is configured.

TheFlowrist is a concierge-first MVP for milestone flower gifting. The current implementation uses a lightweight Node.js HTTP server and a JSON-backed store so the experience can be tested locally without adding a full database stack.

## What is included
- landing page and customer dashboard
- recipient and milestone creation
- scheduled order generation from milestones
- admin dashboard and manual order management
- basic service zone and florist partner data
- payment-consent placeholder flow with Stripe integration TODOs
- a storage adapter boundary for future Supabase migration
- internal JSON endpoints for future n8n automation prep

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

- `pilot` (default) — the existing temporary local login. Customers sign in with just an email at `/login`; admins sign in with just an email at `/admin/login`. No passwords, no real sessions beyond a demo cookie.
- `supabase` — real Supabase Auth. Customers and admins sign in with email + password at `/login` and `/admin/login`. Sessions are stored in secure, HttpOnly cookies. Admin access still requires the signed-in email to be listed in `ADMIN_EMAILS`.

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

For Supabase-backed runs, put these in a local `.env` file:
```env
STORAGE_BACKEND=supabase
AUTH_BACKEND=supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=
INTERNAL_API_SECRET=
ADMIN_EMAILS=
```

## Supabase commands
```bash
npm test
npm run check:supabase
npm run migrate:supabase -- --dry-run
npm run migrate:supabase
npm run smoke:supabase
```

## Health and readiness
- `GET /health` confirms the process is alive.
- `GET /ready` returns JSON describing whether the selected storage/auth backends and their required env vars are valid for the current environment.

## Private pilot deployment
JSON storage and pilot auth are local/dev conveniences only. A real private pilot requires `STORAGE_BACKEND=supabase` and `AUTH_BACKEND=supabase`. n8n, MCP, Shopify, and real Stripe charging are intentionally not enabled. See [docs/deployment.md](docs/deployment.md) for the full checklist, required env vars, and rollback steps.

## Internal automation endpoints
These are protected by `INTERNAL_API_SECRET` and return JSON only for trusted automation workflows.

- GET /internal/orders/upcoming
- GET /internal/orders/needing-reminder
- GET /internal/orders/needing-florist
- GET /internal/orders/issues
- POST /internal/orders/:id/event
- POST /internal/orders/:id/status

## Test
```bash
npm test
```

## Docker
```bash
docker build -t theflowrist .
docker run -p 3000:3000 theflowrist
```

## Notes
- Stripe integration is intentionally scaffolded as a placeholder because the repo does not currently include Stripe infrastructure.
- The default data layer is JSON-backed and suitable for a concierge MVP beta.
- Supabase is server-side persistence only for now and is not yet wired to public client access.
- Supabase Auth is available as an optional backend (`AUTH_BACKEND=supabase`); see [docs/auth.md](docs/auth.md). Public sign-up is not enabled — pilot users are created manually in the Supabase dashboard.
- RLS work remains future work.
- n8n endpoints are available for future automation.
- MCP is intentionally not enabled.
- External repos are references only for future planning.
