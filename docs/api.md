# Saunaklar API

The full reference is [`openapi.json`](openapi.json) (OpenAPI 3.1). It is generated from the route
table in `packages/shared/src/routes.ts` with `npm run openapi`, and a unit test fails when it is
out of date. Do not edit it by hand. The API, the web client and this document all use that one
route table and its Zod schemas.

## Hosts

| Host | Serves | Tenant |
|---|---|---|
| `{slug}.{PLATFORM_DOMAIN}` (locally `http://{slug}.localhost:5173`) | storefront, customer account, reseller admin (`/api/admin/*`) | resolved from the subdomain on every request |
| `ADMIN_HOST` (locally `http://admin.localhost:5173`) | manufacturer admin (`/api/manufacturer/*`) | none |

Each operation has an `x-host` field and its own `servers` entry. A route called on the wrong host
returns `404`. An unknown subdomain returns `TENANT_NOT_FOUND`, and a suspended reseller returns
`TENANT_SUSPENDED`. `GET /api/tenant` returns the reseller's branding, currency and current
`catalogVersion` (`Cache-Control: max-age=60`). The branding includes `storefrontLayout`, one of
`atelier` (default), `showroom`, `nordic`, `catalogue` or `journal`, which reseller staff set with
`PATCH /api/admin/branding`. `manufacturer` (`{ name, website }`) names the manufacturer the
reseller is an authorised reseller of; `website` is `null` until the manufacturer record has one.

## Sessions (BFF cookies)

The browser never sees a token. The API works as a backend-for-frontend:

- `POST /api/auth/login` (customers) and `POST /api/auth/staff/login` (+ `/mfa`,
  `/new-password`) set HttpOnly, `SameSite=Lax` cookies:
  - `__Host-sk_at`: access token;
  - `__Host-sk_rt`: refresh token;
  - `__Host-sk_pool`: CUSTOMER or STAFF.
- `POST /api/auth/refresh` rotates the tokens. `POST /api/auth/logout` clears them.
- The `__Host-` prefix binds each cookie to the exact host. A session made on `alpha.…` is not
  valid on `beta.…` or on `ADMIN_HOST`, and a sibling subdomain cannot plant one. A customer is a
  customer of one reseller only. Staff must be an active admin of the reseller whose host they
  are on, or manufacturer staff on `ADMIN_HOST`.
- `GET /api/auth/session` returns the current principal, or anonymous.

Without `COOKIE_SECURE` (plain-http tests) the names drop the `__Host-` prefix: `sk_at`, `sk_rt`, ….

## CSRF

Every non-GET request must send `X-CSRF-Token`. The token comes from the `csrfToken` field of
`GET /api/auth/session` on the same host. It is an HMAC of the host and a host-bound browser-id
cookie (`__Host-sk_anon`), so other sites cannot read or forge it. A missing or wrong token
returns `403 CSRF_FAILED`. Fetch `/api/auth/session` once at startup, and again after you log in
or out.

## Errors

Errors use `application/problem+json` (RFC 9457):

```json
{ "type": "https://saunaklar.dev/problems/validation-failed", "title": "The request is not valid.",
  "status": 422, "code": "VALIDATION_FAILED", "requestId": "…",
  "errors": { "primaryColor": ["A colour like #1c1c1a."] } }
```

- **`code`**: the stable, machine-readable error code. Clients branch on `code`, never on
  `title` or `detail`. All codes and their HTTP statuses are in `x-error-codes` in
  `openapi.json` (source: `ERROR_STATUS` in `packages/shared/src/errors.ts`).
- **`errors`**: field-level messages, sent with `VALIDATION_FAILED`.
- **`meta`**: extra machine-readable context, such as `currentVersion` (see catalog versioning).
- **Database rules:** rules the database enforces come back with their own codes, for example
  `DISCOUNT_EXCEEDS_CAP`, `SAUNA_NOT_ASSIGNABLE`, `CONFIGURATION_LOCKED`, `QUOTE_EXPIRED`,
  `SLUG_RESERVED` and `SLUG_TAKEN`.
- **`x-request-id`:** every response has this header, and the same id is in `requestId`.
  Include it in bug reports.

## Pagination

List endpoints return `{ "items": [...], "nextCursor": "…" | null }` and take `?limit=` (default 25,
50 for the audit log; maximum 100) and `?cursor=`. To get the next page, pass `nextCursor` back unchanged. The cursor is
signed and opaque (keyset pagination on sort value + id). An edited cursor returns `400 BAD_REQUEST`.

## Catalog versioning (review C1)

Catalog reads (`/api/catalog`, `/api/catalog/saunas/{slug}`, `/api/rooms`) take `?v=<catalogVersion>`:

- **Matching version:** `v` equals the reseller's current version, and the response is
  cacheable forever (`Cache-Control: public, max-age=31536000, immutable`). The URL changes
  whenever the catalog changes, so the CDN and browser caches never serve stale prices.
- **Other version:** `409 STALE_CATALOG_VERSION`, with `meta.currentVersion`. Retry with that
  version.
- **No `v`:** the response is `Cache-Control: no-store`.

`catalog_version` is bumped by database triggers whenever anything a reseller's storefront shows
changes:

- prices and option prices;
- assignments, visibility and order;
- discounts and branding;
- rooms;
- model or option names and status;
- catalog imports (`bump_all_catalog_versions()`).

Clients read `catalogVersion` from `GET /api/tenant`, which can be up to 60 s old, and build every
catalog URL from it.

The responses are also translated by `?lang=` or `Accept-Language`, with `Vary: Accept-Language`.
