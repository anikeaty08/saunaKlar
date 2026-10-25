# Review fixes applied on top of docs/design.md

The design review found these issues. The implementation MUST follow the fix column.
Where this file and docs/design.md disagree, this file wins.

| # | Issue | Fix to implement |
|---|---|---|
| C1 | Catalog CDN cache poisoning: `/api/catalog?v=N` is cached 1 year; requesting a future `v` caches stale prices. | API answers `?v=` that is not the tenant's current `catalog_version` with HTTP 409 `{code:"STALE_CATALOG_VERSION", currentVersion}` and `Cache-Control: no-store`. Only an exact match gets `public, max-age=31536000, immutable`. Missing `v` → `no-store` response with current data. |
| C2 | No egress from private-subnet Lambdas (SES API, CloudFront KeyValueStore, Cognito). | Terraform adds NAT gateways (one per AZ, toggle `single_nat_gateway` for non-prod). |
| C3 | Worker ran as `app_platform`, which cannot read customer e-mail. | Separate DB role `app_worker`: SELECT on `customers(id, reseller_id, email, first_name, locale, status)` (column grants), branding, staff e-mail, outbox, suppressions. `app_platform` stays PII-free. Outbox payloads hold ids, never e-mail addresses. |
| C4 | Option prices per currency not checked at assignment. | Assignment trigger requires a price in the reseller's currency for the model AND every option of the model; a deferred constraint trigger re-checks when options/prices change for already-assigned models. Importer validates the same. |
| C5 | Reseller-prepared configurations (customer_id NULL) could never become a customer request. | `POST /api/shared/{token}/claim` (logged-in customer): clones the shared snapshot into a new configuration owned by the customer, locks it with a fresh price snapshot, returns its id; customer can then request it. |
| C6 | Sibling subdomains share cookie/CSRF scope. | `__Host-` prefixed cookies (Secure, Path=/, no Domain); CSRF token = HMAC(session id) checked via `X-CSRF-Token` header on every non-GET; manufacturer admin served on its own host (`ADMIN_HOST`, may be a different registrable domain). |
| G1 | Asset cache key included Host (500× fragmentation). | Asset cache key excludes Host; tenant binding happens in the signed-cookie policy Resource. |
| G2 | Host-scoped cookies only browser-enforced. | Signed policy Resource = `https://{host}/assets/*`; the edge/local verifier checks the request host matches the policy. |
| G3 | PENDING sign-ups squat an e-mail forever. | Sign-up with an e-mail that has a PENDING customer row older than 24 h replaces it; Cognito/IdP failure deletes the just-inserted row; worker cleanup job removes PENDING rows older than 7 days. |
| G4 | Locked price has no validity. | `configuration_price_snapshots.price_valid_until` (default lock time + 30 days); UI shows "price as of" and "valid until". |
| G5 | Cap clamping inconsistent. | Every discount is clamped to the cap at calculation time (pricing package does this). |
| G8 | Re-quotes overwrote the quote. | `request_quotes` is 1:N with `superseded_at`; partial unique index allows one active quote. |
| G10 | PII in backups/logs. | Documented in docs/privacy.md; logs never contain e-mail, names or tokens. |
| — | Quote acceptance after expiry. | Customer `accept` is refused when the active quote's `valid_until` has passed. |
