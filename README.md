# TheFlowrist

This is a concierge MVP.
No real payments yet.
No Shopify automation yet.
No Playwright automation yet.
JSON storage is temporary.
Admin login is temporary pilot access.

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
- A placeholder Supabase adapter file exists for later implementation, but no Supabase dependency is installed yet.

## Run locally
```bash
npm install
npm start
```

Open http://localhost:3000/ to view the public experience.

For admin routes, include a cookie named `adminEmail` or an `x-admin-email` header that matches `ADMIN_EMAILS`.

## Environment variables
- PORT
- NODE_ENV
- ALLOWED_ORIGINS
- ADMIN_EMAILS
- INTERNAL_API_SECRET

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
- The data layer is file-based and suitable for a concierge MVP beta.
- Supabase migration is planned but not active.
- n8n endpoints are available for future automation.
- MCP is intentionally not enabled.
- External repos are references only for future planning.
