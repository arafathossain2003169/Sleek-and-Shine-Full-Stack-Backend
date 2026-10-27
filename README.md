# SleeknShine — Backend API

Production-oriented Express + TypeScript backend for the SleeknShine cosmetics
e-commerce platform. Uses **raw parameterized SQL only** (no ORM) via the `pg`
package, PostgreSQL, Cloudinary for media, and JWT access/refresh authentication.

## Tech stack

- Node.js (18+) / Express.js / TypeScript
- PostgreSQL with raw SQL migrations (no ORM/query builder)
- `pg` for database access
- Cloudinary for image storage
- JWT (access + refresh, refresh stored hashed in DB, HttpOnly cookie)
- zod for validation
- helmet, cors, express-rate-limit, multer, bcrypt

## Project structure

```
src/
  app.ts                Express app assembly
  server.ts              Process entry point
  config/                 env, db pool, cloudinary, cors
  middlewares/            auth, role, validate, error, rateLimit, upload
  modules/
    auth/                 register, login, logout, refresh, me
    users/                 profile + addresses
    products/              public catalog + admin CRUD service (shared)
    categories/             public + admin
    brands/                 public + admin
    cart/                   guest-sync-aware backend cart
    checkout/               transactional order placement
    orders/                 customer order history
    coupons/                validation + admin CRUD
    content/                homepage sections
    media/                  generic Cloudinary upload endpoint
    search/                 product search
    admin/                  dashboard stats, attributes, inventory,
                            admin orders/customers/content/coupons/
                            categories/brands, audit logs
  db/
    migrations/            .sql files, applied in filename order
    seeds/                  seed data + seed.ts runner
  utils/                  response helpers, errors, pagination, tokens, etc.
docs/
  API_CONTRACT.md          Full endpoint reference
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:
- `DATABASE_URL` — your PostgreSQL connection string
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `COOKIE_SECRET` — long random strings
- `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`
- `FRONTEND_URL` — e.g. `http://localhost:3000`

### 3. Create the database

```bash
createdb sleeknshine
# or via psql:
# psql -U postgres -c "CREATE DATABASE sleeknshine;"
```

### 4. Run migrations

```bash
npm run migrate
```

This applies every `.sql` file in `src/db/migrations/` in order, tracked in a
`schema_migrations` table so re-running is safe (idempotent).

### 5. Seed the database

```bash
npm run seed
```

Seeds:
- An admin user
- 5 categories, 4 brands
- 4 attribute definitions
- 8 sample products (each with a default variant)
- 4 homepage sections

**Seeded admin login:** `ah59642@gmail.com`. The password is taken from
`SEED_ADMIN_PASSWORD`; if that is not set a random one is generated and printed
**once** at the end of `npm run seed` (production seeding requires
`SEED_ADMIN_PASSWORD`). There is no well-known default password.

### 6. Run the dev server

```bash
npm run dev
```

API will be available at `http://localhost:5000/api`, with a health check at
`http://localhost:5000/health`.

## Scripts

| Script            | Purpose                                   |
|--------------------|--------------------------------------------|
| `npm run dev`      | Start with tsx watch (hot reload)          |
| `npm run build`    | Compile TypeScript to `dist/`              |
| `npm start`        | Run compiled JS (`dist/server.js`)         |
| `npm run migrate`  | Apply pending SQL migrations               |
| `npm run seed`     | Seed sample data (idempotent-ish)          |
| `npm run lint`     | ESLint                                     |

## Authentication flow

- `POST /api/auth/register` / `POST /api/auth/login` return an access token in
  the JSON body **and** set two HttpOnly cookies: `access_token` (15 min) and
  `refresh_token` (long-lived, scoped to `/api/auth`).
- The frontend should send `credentials: 'include'` on every request.
- `POST /api/auth/refresh` rotates the refresh token (old one is revoked,
  a new pair is issued) and reads the `refresh_token` cookie — no body needed.
- `POST /api/auth/logout` revokes the current refresh token and clears cookies.
- Refresh tokens are stored **hashed** (SHA-256) in `refresh_tokens`, never in
  plaintext, mirroring how passwords are hashed with bcrypt.

## Guest cart → backend cart sync

The frontend keeps a guest cart in localStorage. On login/register, it should
call:

```
POST /api/cart/sync
Body: { "items": [{ "productId": "...", "variantId": "... | null", "quantity": 2 }] }
```

Quantities are merged additively into the user's backend cart. From then on,
the backend cart (`GET /api/cart`) is the source of truth. Every cart item in
the response carries `isAvailable` / `warning` fields reflecting live stock
and product status, so the frontend can surface issues before checkout.

## Checkout & stock integrity

`POST /api/checkout` runs inside a single PostgreSQL transaction:
1. Locks the user's **cart row** (`SELECT ... FOR UPDATE`), so concurrent or
   double-submitted requests cannot both consume the same cart.
2. Re-reads every product/variant (items in a fixed order to avoid deadlocks;
   variants `FOR UPDATE`, products `FOR SHARE`) — **prices and stock are never
   trusted from the client.** The same `assessTarget()` rules are used by the
   cart and by checkout: published, visible category/brand, a variant must be
   chosen when the product has variants, no `out_of_stock`/`discontinued`.
3. Computes **shipping on the server** (`DELIVERY_FEE`, `FREE_DELIVERY_THRESHOLD`);
   any `deliveryFee` sent by a client is ignored. Only providers listed in
   `ENABLED_PAYMENT_PROVIDERS` (default `cod`) are accepted.
4. Applies + locks the coupon (validity window, usage limit, per-user limit).
5. Creates the order, items, `payments` row, status history and
   `inventory_movements`, decrements stock with a `stock_quantity >= qty` guard
   and re-derives `products.stock_status`.
6. Clears the cart.

`POST /api/checkout/quote` returns the authoritative subtotal / discount /
shipping / total for the checkout page without reserving anything.

Any failure rolls back the entire transaction.

## Order lifecycle

Allowed transitions are enforced (`pending → confirmed → processing → packed →
shipped → delivered → returned → refunded`, `cancelled` from any pre-shipment
state, `failed_payment ↔ pending`). Cancelling or returning restocks the items
(with an inventory movement) and cancelling releases the coupon use. Delivering a
COD order marks it **paid**; `refunded` marks the payment refunded. Admins can set
payment status via `PATCH /api/admin/orders/:id/payment-status`. Customers can
cancel `pending`/`confirmed` orders via `POST /api/orders/my/:orderNumber/cancel`.

## Roles & permissions

| Area | Read | Write |
|---|---|---|
| Catalogue (products, categories, brands, attributes), media | all staff | admin, manager, super_admin |
| Inventory | all staff | + inventory_staff |
| Orders | admin, manager, order_manager, super_admin | same |
| Customers | admin, manager, order_manager, super_admin | admin, manager, super_admin |
| Coupons, homepage content, audit logs | admin, manager, super_admin | same |
| Staff accounts (`/api/admin/staff`) | super_admin | super_admin |

Access tokens are checked against the database on every request, so blocking a
user or changing a role takes effect immediately.

## Admin accounts & roles

- **Owner account:** `npm run seed` creates the first super admin as **ah59642@gmail.com** (override with
  `SEED_ADMIN_EMAIL`). Password = `SEED_ADMIN_PASSWORD`, or a random one printed once. Logging in needs the emailed code.
- **Already have a database / already registered that email on the site?** Make it the owner with
  `npm run admin:grant -- ah59642@gmail.com` (register on the site first, or pass a password to create the account:
  `npm run admin:grant -- ah59642@gmail.com "YourPassw0rd"`).
- **More admins:** in the panel, *Staff & roles → Add staff → Existing account* finds any registered account by
  email and gives it a role (admin, manager, order manager, inventory staff). It applies immediately. Admins can
  manage everyone except super admins; only a super admin can grant/revoke the super admin role; nobody can change
  their own role; the last active super admin can never be removed.

## Settings editable from the admin panel

*Admin → Settings* (admin / super admin) overrides these environment defaults at runtime, with reset-to-default and
an audit trail: delivery fee, free-delivery threshold, low-stock threshold, and the OTP limits (code validity,
wrong-code attempts, resend cooldown, codes per hour). Stored in the `app_settings` table; a change applies within
seconds on every instance. Anything not listed there (currency, secrets, SMTP, `OTP_REQUIRED`, enabled payment
providers) remains environment-only on purpose.

## One-time passcodes (OTP)

Sign-up and **every** login are two steps:

1. `POST /api/auth/register` or `POST /api/auth/login` checks the details and e-mails a 6-digit code.
   The response is `{ otpRequired: true, email, purpose, expiresInSeconds, resendAfterSeconds }` and **no session
   cookie is set**.
2. `POST /api/auth/verify-otp` `{ email, purpose, code }` completes it: the e-mail is marked verified and the
   session cookies are issued. `POST /api/auth/resend-otp` sends a new code.

**Forgot password** reuses the same code machinery (purpose `reset`, migration `008`): `POST /api/auth/forgot-password` `{ email }`
e-mails a code (same response for unknown e-mails), then `POST /api/auth/reset-password` `{ email, code, newPassword }` sets the
new password and signs the account out on every device. It does not log the user in; they sign in normally afterwards.

Safeguards: codes are stored only as HMAC hashes, expire after `OTP_TTL_MINUTES`, are single use, and are bound to
their purpose (a login code cannot complete a sign-up). `OTP_MAX_ATTEMPTS` wrong guesses invalidate the code.
Resends have a cooldown and an hourly cap per address, and the resend endpoint answers identically for unknown
e-mails (no account probing). A never-verified *customer* account can be re-registered; verified or staff accounts
cannot (no password overwrite).

**E-mail delivery:** configure `SMTP_*` (production refuses to start without it). The API checks the SMTP login at
startup and prints `SMTP ready` or `SMTP check FAILED` with a hint; `npm run mail:test -- you@example.com` sends a real
message and reports exactly what happened (see the Gmail steps in `.env.example`). If the mail server is down, sign-up/login
answer `503 "We could not send the verification email"` and the unsent code is discarded so the user can retry at once. In development with no SMTP the
code is printed to the backend console as `[DEV MAIL]`. The seeded admin logs in with a code too, so set
`SEED_ADMIN_EMAIL` to a real inbox (or read the code from the console in development).
`OTP_REQUIRED=false` switches the second step off (not recommended outside local development).

## Security notes

- Refresh tokens rotate on every use; replaying a used token revokes all of the user's sessions.
- Cookie-authenticated state-changing requests must come from an allowed `FRONTEND_URL` origin (CSRF guard).
- Failed logins are rate limited; refresh has its own budget.
- Production refuses to start with weak/duplicate JWT/cookie secrets.

## Tests, lint & type-check

```bash
npm run typecheck
npm run lint
npm test        # integration tests against a REAL, migrated PostgreSQL (use a dedicated DB)
```

## Known limitations / not implemented

- **OTP / magic-link login**, **password reset** and **email verification** need an
  e-mail/SMS provider and are not implemented (change-password exists).
- **Payments**: no gateway is integrated; only cash on delivery is enabled.
- **Reviews**: table exists, no endpoints.
- **Rate limiting** is in-memory — use a Redis store behind multiple instances.
- Product duplication copies variants (stock 0, no SKU) but not images.

## Postman / REST client

See `docs/API_CONTRACT.md` for the full endpoint list with request/response
shapes and auth requirements — every request there can be pasted directly
into Postman, Insomnia, or a `.http` REST client file.
