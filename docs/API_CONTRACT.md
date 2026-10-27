# SleeknShine API Contract

Base URL: `http://localhost:5000/api`

## Response envelope

All endpoints return this shape:

**Success**
```json
{ "success": true, "message": "string", "data": {}, "meta": {} }
```

**Error**
```json
{ "success": false, "message": "string", "errors": [] }
```

`meta` carries pagination (`page`, `limit`, `total`, `totalPages`) on list
endpoints. Validation errors populate `errors` as
`[{ "path": "field.name", "message": "..." }]`.

## Auth model

- Access token: short-lived JWT (15 min). Returned in the JSON body on
  register/login/refresh, **and** set as an HttpOnly cookie `access_token`.
  Can also be sent as `Authorization: Bearer <token>`.
- Refresh token: HttpOnly cookie `refresh_token`, scoped to `/api/auth`,
  rotated on every `/api/auth/refresh` call.
- All requests that rely on cookies must be sent with `credentials: 'include'`.
- Roles: `customer`, `admin`, `manager`, `inventory_staff`, `order_manager`,
  `super_admin`. All `/api/admin/*` routes require one of the admin-tier
  roles; `/api/admin/audit-logs` further restricts to `admin`, `manager`,
  `super_admin`.

---

## Auth

### POST /api/auth/register
Public. Body:
```json
{ "name": "Jane Doe", "email": "jane@example.com", "password": "min8chars", "phone": "+1..." }
```
201 → `{ user, accessToken }`

### POST /api/auth/login
Public. Body: `{ "email": "...", "password": "..." }`
200 → `{ user, accessToken }`

### POST /api/auth/logout
Public (reads refresh cookie if present). 200 → `{}`

### POST /api/auth/refresh
Public (reads `refresh_token` cookie). 200 → `{ accessToken }`

### GET /api/auth/me
Auth required. 200 → `{ user }`

---

## Users

All require auth.

### GET /api/users/me → `{ user }`
### PATCH /api/users/me
Body: `{ "name"?, "phone"? }` → `{ user }`

### GET /api/users/me/addresses → `{ addresses: [] }`
### POST /api/users/me/addresses
Body:
```json
{
  "fullName": "Jane Doe", "phone": "+1...", "addressLine1": "123 Main St",
  "addressLine2": "Apt 4", "city": "Metropolis", "zone": "NY",
  "postalCode": "10001", "country": "USA", "isDefault": true
}
```
201 → `{ address }`

### PATCH /api/users/me/addresses/:id — partial body of the same shape → `{ address }`
### DELETE /api/users/me/addresses/:id → `{}`

---

## Products (public)

### GET /api/products
Query: `page, limit, search, category, brand, minPrice, maxPrice, sort
(newest|price_asc|price_desc|name_asc|best_selling|discount),
isNewArrival, isOffer, isFeatured, attributes (JSON string)`
200 → `{ products: [] }` with pagination `meta`. Only `visible` attributes
are included per product; `published` status only.

### GET /api/products/:slug → `{ product }` (includes `variants[]`)
### GET /api/products/:slug/related → `{ products: [] }`

## Categories (public)

### GET /api/categories → `{ categories: [] }` (flat, active only)
### GET /api/categories/tree → `{ categories: [] }` (nested by `parentId`)
### GET /api/categories/:slug/products → `{ category, products: [] }` + meta

## Brands (public)

### GET /api/brands → `{ brands: [] }`
### GET /api/brands/:slug/products → `{ brand, products: [] }` + meta

## Cart

All require auth (guest cart lives client-side; this is the synced backend cart).

### GET /api/cart → `{ cart: { items, itemCount, subtotal, hasIssues } }`
Each item includes `isAvailable` and `warning` reflecting live stock/status.

### POST /api/cart/sync
Body: `{ "items": [{ "productId", "variantId"?, "quantity" }] }` → `{ cart }`
Quantities are merged additively into the existing backend cart.

### POST /api/cart/items
Body: `{ "productId", "variantId"?, "quantity" }` → 201 `{ cart }`

### PATCH /api/cart/items/:itemId
Body: `{ "quantity" }` → `{ cart }`

### DELETE /api/cart/items/:itemId → `{ cart }`
### DELETE /api/cart → `{ cart }` (empties it)

## Checkout

### POST /api/checkout/quote
Auth required. Body: `{ "couponCode"?: "SAVE10" }` →
`{ quote: { subtotal, discountTotal, deliveryFee, total, currency, couponCode, couponError, freeDeliveryThreshold, paymentProviders } }`.
Server-authoritative breakdown; nothing is reserved.

### POST /api/checkout
Auth required. Body:
```json
{
  "addressId": "uuid",
  "couponCode": "SAVE10",
  "paymentProvider": "cod",
  "customerNote": "Leave at door"
}
```
`deliveryFee` is **not** accepted: shipping is computed by the server. Only
payment providers enabled in `ENABLED_PAYMENT_PROVIDERS` (default `cod`) are accepted.
201 → `{ order: { id, orderNumber, status, paymentStatus, subtotal, discountTotal, deliveryFee, total, currency, createdAt } }`

Runs in a DB transaction: re-verifies price/stock from the DB (client-sent
prices are never trusted), applies + locks the coupon, decrements variant
stock, writes `inventory_movements`, creates the order/items/payment/status
history, and clears the cart.

## Orders (customer)

Auth required.

### GET /api/orders/my → `{ orders: [] }` + meta
### GET /api/orders/my/:orderNumber → `{ order }` (includes `items[]`)

## Coupons

### POST /api/coupons/validate
Auth required. Body: `{ "code": "SAVE10", "orderAmount": 120.5 }`
200 → `{ coupon: { code, type, value, discount, newTotal } }`

## Homepage content

### GET /api/content/homepage → `{ sections, newArrivals, offers, featured, categories }`

## Search

### GET /api/search?q=serum&page=1&limit=20 → `{ products: [], query }` + meta

## Media

### POST /api/media/upload
Admin auth required. `multipart/form-data`: `file`, `folder`
(`products|variants|categories|brands|homepage|misc`).
201 → `{ publicId, url, width, height }`

---

# Admin API

All routes below are prefixed `/api/admin` and require an admin-tier role
(`admin`, `manager`, `inventory_staff`, `order_manager`, `super_admin`)
unless noted otherwise.

## Dashboard

### GET /api/admin/dashboard/stats
→ `{ totalRevenue, orderCount, productCount, lowStockCount, recentOrders: [], lowStockItems: [] }`

## Products

### GET /api/admin/products
Query: `page, limit, search, category, brand, status, sort` → `{ products: [] }` + meta (all statuses, not just published)

### POST /api/admin/products
Body: name, slug?, shortDescription?, fullDescription?, brandId?, categoryId,
basePrice, salePrice?, currency?, sku?, barcode?, stockStatus?, status?,
isFeatured?, isNewArrival?, isOffer?, attributes?, seoTitle?, seoDescription?
→ 201 `{ product }`

### GET /api/admin/products/:id → `{ product }` (includes `variants[]`)
### PATCH /api/admin/products/:id — partial body of the same shape → `{ product }`
### DELETE /api/admin/products/:id → `{}`
### PATCH /api/admin/products/:id/status — `{ "status": "draft|published|hidden|archived" }` → `{ product }`
### POST /api/admin/products/:id/duplicate → 201 `{ product }`

### POST /api/admin/products/:id/images
`multipart/form-data`: `image` (file), `altText?`, `sortOrder?`, `isMain?`, `variantId?`
→ 201 `{ image }`
### PATCH /api/admin/products/:id/images/:imageId — `{ altText?, sortOrder?, isMain? }` → `{ image }`
### DELETE /api/admin/products/:id/images/:imageId → `{}`

### POST /api/admin/products/:id/variants
Body: name, sku?, barcode?, price?, salePrice?, stockQuantity, attributes?, imageUrl?, status?
→ 201 `{ variant }`
### PATCH /api/admin/products/:id/variants/:variantId → `{ variant }`
### DELETE /api/admin/products/:id/variants/:variantId → `{}`

## Attributes

### GET /api/admin/attributes → `{ attributes: [] }`
### POST /api/admin/attributes
Body: name, slug?, type (text|number|select|multiselect|boolean|richtext|date|color|measurement),
predefinedValues?, isRequired?, isFilterable?, isVisible?, appliesTo?, sortOrder?
→ 201 `{ attribute }`
### PATCH /api/admin/attributes/:id → `{ attribute }`
### DELETE /api/admin/attributes/:id → `{}`

## Categories

### GET /api/admin/categories → `{ categories: [] }` (all, including inactive)
### POST /api/admin/categories — name, slug?, parentId?, description?, imageUrl?, sortOrder?, isActive? → 201 `{ category }`
### PATCH /api/admin/categories/:id → `{ category }`
### DELETE /api/admin/categories/:id → `{}`

## Brands

### GET /api/admin/brands → `{ brands: [] }`
### POST /api/admin/brands — name, slug?, description?, logoUrl?, isActive? → 201 `{ brand }`
### PATCH /api/admin/brands/:id → `{ brand }`
### DELETE /api/admin/brands/:id → `{}`

## Inventory

### GET /api/admin/inventory → `{ inventory: [] }` + meta (all variants, lowest stock first)
### GET /api/admin/inventory/low-stock → `{ items: [] }` (stock ≤ 10)
### GET /api/admin/inventory/movements?productId= → `{ movements: [] }` + meta
### PATCH /api/admin/inventory/adjust
Body: `{ "productId", "variantId", "newQuantity", "reason", "note"? }` → `{ result: { previousQuantity, newQuantity } }`
Runs in a transaction and writes an `inventory_movements` row + audit log.

## Orders

### GET /api/admin/orders
Query: `page, limit, status, paymentStatus, search` → `{ orders: [] }` + meta
### GET /api/admin/orders/:id → `{ order }` (includes `items[]`, `statusHistory[]`)
### PATCH /api/admin/orders/:id/status — `{ "status", "note"? }` → `{ order }`
### PATCH /api/admin/orders/:id/admin-note — `{ "note" }` → `{ order }`

## Customers

### GET /api/admin/customers?search= → `{ customers: [] }` + meta
### GET /api/admin/customers/:id → `{ customer }` (includes `recentOrders[]`, `addresses[]`)
### PATCH /api/admin/customers/:id/status — `{ "status": "active|blocked|deleted" }` → `{ customer }`

## Coupons

### GET /api/admin/coupons → `{ coupons: [] }`
### POST /api/admin/coupons
Body: code, type (percentage|fixed), value, minOrderAmount?, maxDiscount?,
startsAt?, endsAt?, usageLimit?, isActive? → 201 `{ coupon }`
### PATCH /api/admin/coupons/:id → `{ coupon }`
### DELETE /api/admin/coupons/:id → `{}`

## Homepage content

### GET /api/admin/content/homepage → `{ sections: [] }` (all, including inactive)
### POST /api/admin/content/homepage
Body: type (hero|banner|offer|new_arrival|featured_category|custom), title,
subtitle?, imageUrl?, buttonText?, buttonLink?, data?, sortOrder?, isActive?,
startsAt?, endsAt? → 201 `{ section }`
### PATCH /api/admin/content/homepage/:id → `{ section }`
### DELETE /api/admin/content/homepage/:id → `{}`

## Audit logs

Restricted to `admin`, `manager`, `super_admin`.

### GET /api/admin/audit-logs?entityType= → `{ auditLogs: [] }` + meta


## Changes in the QA hardening release

- `POST /api/auth/change-password` `{ currentPassword, newPassword }`.
- `POST /api/orders/my/:orderNumber/cancel`; customer orders no longer contain `admin_note`/`user_id`/`coupon_id`
  and money fields are numbers (`status_history` and `can_cancel` were added).
- `/api/search`, `/api/categories/:slug/products`, `/api/brands/:slug/products` return the **same camelCase product DTO as `/api/products`**
  and accept the same filters/sorting. Search needs `q` of at least 2 characters; `%`/`_` are matched literally.
- `PATCH /api/admin/orders/:id/payment-status` `{ paymentStatus, transactionId? }`.
- `/api/admin/staff` (super_admin): `GET`, `POST`, `PATCH /:id` (role/status).
- Admin PATCH endpoints: send `null` to clear an optional field; omit a key to leave it unchanged.
- `POST /api/admin/products/:id/variants` accepts the initial `stockQuantity`; afterwards stock changes only via `/api/admin/inventory/adjust`.
- `POST /api/cart/sync` returns `{ cart, skipped[] }` and skips unavailable items instead of failing.
- Errors: malformed JSON, invalid ids, FK/unique violations, overflow and CORS violations now return 4xx with a message instead of 500.
- Admin homepage content is available at both `/api/admin/content` and `/api/admin/content/homepage`.

## OTP login / sign-up (added)

- `POST /api/auth/register` and `POST /api/auth/login` now answer
  `{ otpRequired: true, email, purpose: "register"|"login", expiresInSeconds, resendAfterSeconds }` and set **no cookies**.
- `POST /api/auth/verify-otp` `{ email, purpose, code }` → `{ user, accessToken }` + session cookies.
- `POST /api/auth/resend-otp` `{ email, purpose }` → same challenge shape (429 inside the cooldown / over the hourly cap).
- `POST /api/auth/forgot-password` `{ email }` → always `200` with a challenge-shaped body (`purpose: "reset"`), whether or not the
  account exists; an e-mail with a 6-digit code is sent only for active accounts. Cooldown / hourly-cap / mail failures are also
  answered `200` so the endpoint cannot be used to discover accounts.
- `POST /api/auth/reset-password` `{ email, code, newPassword }` → `200 {}` and **no session**. Verifies the `reset` code (same
  expiry / attempt-lock rules as other codes), sets the password, and revokes every refresh token (signed out everywhere).
  `400` for a wrong/expired/used code or a password that breaks the rules.
- Errors: `400` wrong/expired/used code (message says how many attempts are left), `429` too many requests.

## Settings & role management (added)

- `GET /api/admin/settings` → `{ settings: [{ key, group, label, description, kind, min, max, step, value, defaultValue, isCustom, updatedAt }] }`
- `PATCH /api/admin/settings` `{ values: { "<key>": number | null } }` (number = override, `null` = reset to default; all-or-nothing). Roles: admin, super_admin.
- `GET /api/admin/staff` (staff list) · `GET /api/admin/staff/users?search=` (find ANY account, min 2 chars)
- `PATCH /api/admin/staff/:id` `{ role?, status? }` — promote a customer, change/remove a role (`customer` = no panel access), block/unblock. Roles: admin, super_admin. Only a super_admin may grant/change `super_admin`.
- `GET /api/admin/inventory` and `GET /api/admin/dashboard/stats` now include `lowStockThreshold`.
- `503` from `POST /api/auth/register|login|resend-otp` = the verification e-mail could not be sent (retry immediately).
