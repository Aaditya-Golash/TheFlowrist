# Authentication

TheFlowerist supports two auth backends behind a shared adapter interface, selected with `AUTH_BACKEND`.

```env
AUTH_BACKEND=pilot
```

Allowed values: `pilot` (default), `supabase`. An unset or unrecognized value other than these two fails clearly at startup/first use.

## Adapter interface

Both backends implement the same shape (`lib/auth/pilotAuth.js`, `lib/auth/supabaseAuth.js`, resolved by `lib/auth/index.js`):

- `getCurrentUser(req)` - returns `{ email }` for the current session, or `null`.
- `requireUser(req, res)` - resolves the current customer record, or redirects to `/login` and returns `null`.
- `requireAdmin(req, res)` - checks admin access, or writes a redirect/403 and returns `false`.
- `signInWithEmailPassword(email, password)` - returns `{ ok: true, session }` or `{ ok: false, error }`.
- `signOut(req, res)` / `clearSessionCookies(res)` - clears the session cookie(s).
- `createSessionCookies(res, session)` - sets the session cookie(s) on a response.

Route handlers in `lib/routes.js` call the adapter returned by `getAuthAdapter()` and never branch on backend name directly, so route code stays the same regardless of which backend is active.

## Pilot mode (`AUTH_BACKEND=pilot`, default)

This is the existing temporary local behavior, unchanged:

- **Admin**: `/admin/login` accepts just an email. If it's in `ADMIN_EMAILS`, an `adminEmail` cookie is set. `x-admin-email` header is also accepted, but only when `NODE_ENV=test` (used by the test suite; never trust this header outside tests).
- **Customer**: `/login` accepts just an email (no password) and sets a `pilotCustomerEmail` cookie labelled clearly as a local pilot login. If no customer session cookie is present, customer-protected routes fall back to the first seeded demo customer - this preserves existing behavior for anyone hitting the app without logging in first (including the test suite).

Nothing here is secure enough for real users. It exists only so the pilot experience can be clicked through locally without standing up Supabase.

## Supabase Auth mode (`AUTH_BACKEND=supabase`)

Required env vars:

```env
AUTH_BACKEND=supabase
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

- The **anon key** is used client-side-equivalent, server-side, purely for Supabase Auth sign-in and session/token verification (`supabase.auth.signInWithPassword`, `supabase.auth.getUser`). It is never used for database reads/writes.
- The **service role key** is only used by the storage adapter (`STORAGE_BACKEND=supabase`) for database operations. It is never sent to the browser and never logged.
- Both admin and customer sign-in use the same underlying Supabase Auth session - a signed-in user is treated as a customer everywhere, and additionally as an admin on `/admin/*` routes if their email is listed in `ADMIN_EMAILS`.

### Customer flow

1. `GET /login` renders an email + password form.
2. `POST /login` calls `supabase.auth.signInWithPassword`. On success, the session's access/refresh tokens are stored in secure, HttpOnly cookies (`sbAccessToken`, `sbRefreshToken`); on failure, a friendly "invalid email or password" message is shown.
3. Protected customer routes (`/dashboard`, `/recipients/new`, `POST /recipients`, `/milestones/new`, `POST /milestones`, `POST /milestones/:id`, `/account`, `/account/payment-consent*`) call `requireUser`, which validates the access token against Supabase Auth and redirects unauthenticated requests to `/login`.
4. If the authenticated email has no matching customer record yet, a minimal customer profile is created automatically (name derived from the email, no marketing consent, empty phone) so the pilot experience keeps working without a separate signup step.

### Admin flow

1. `GET /admin/login` renders an email + password form.
2. `POST /admin/login` signs in via Supabase Auth, then checks the email against `ADMIN_EMAILS` (case-insensitive). Non-admin accounts are rejected with a 403 and no session cookie is set from this path failing that check.
3. Protected admin routes call `requireAdmin`, which validates the session and re-checks `ADMIN_EMAILS` on every request.

### Why there is no public sign-up

This is a private pilot. Adding public sign-up means handling account verification, abuse, and password-reset flows that are out of scope for a small invite-only pilot. Instead:

**To create a private pilot user:** in the Supabase dashboard, go to Authentication → Users → Add user, set an email and password directly (or send a magic invite if you've configured an email provider). No corresponding `customers` row is needed ahead of time - one is created automatically on first login.

**To make a user an admin:** add their email to the `ADMIN_EMAILS` env var (comma-separated). No separate Supabase-side role is required - admin status is just membership in that list, checked against the authenticated email.

## Testing

All tests run offline. Supabase-mode tests either:
- test env validation only (no client is created without valid `SUPABASE_URL`/`SUPABASE_ANON_KEY`), or
- inject a fake Supabase client (matching the pattern already used for the migration script) so `auth.getUser`/`signInWithPassword` never hit the network, or
- exercise the "no session cookie present" path, which redirects before any client is created at all.

## Limitations

- No password reset / magic link flow is wired into the app UI yet (use the Supabase dashboard or your own email provider setup for that).
- No public sign-up.
- Session cookies are opaque Supabase JWTs; the app does not perform local JWT/JWKS verification - every check goes through `supabase.auth.getUser`, which is simpler but means each authenticated request makes a call to Supabase Auth.
- Dashboard/account pages still render all seeded data rather than filtering strictly by the authenticated customer - this matches the existing single-tenant pilot behavior and was not changed as part of this work.
