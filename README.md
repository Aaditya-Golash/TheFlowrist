# TheFlowrist

TheFlowrist is a concierge-first MVP for milestone flower gifting. The current implementation uses a lightweight Node.js HTTP server with JSON file persistence so the experience can be tested locally without adding a full database stack.

## What is included
- landing page and customer dashboard
- recipient and milestone creation
- scheduled order generation from milestones
- admin dashboard and manual order management
- basic service zone and florist partner data
- payment-consent placeholder flow with Stripe integration TODOs

## Run locally
```bash
npm install
npm start
```

Open http://localhost:3000/ to view the public experience.

For admin routes, include an `x-admin-email` header that matches `ADMIN_EMAILS`.

## Environment variables
- PORT
- NODE_ENV
- ALLOWED_ORIGINS
- ADMIN_EMAILS

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
