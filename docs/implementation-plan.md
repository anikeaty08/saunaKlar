# Implementation plan and conventions

This is the contract every part of the codebase follows. Read `docs/design.md` (the system
design) and `docs/review-fixes.md` (fixes that override the design) first.

## Monorepo

npm workspaces, Node >= 22.18, TypeScript everywhere, ES modules. Workspace packages export
their TypeScript source directly (`"exports": { ".": "./src/index.ts" }`), so Vite, Vitest and
`tsx` consume them without a build step. Imports between files use explicit `.ts` extensions.

| Path | Package | Purpose |
|---|---|---|
| `packages/pricing` | `@saunaklar/pricing` | Integer pricing engine (done) |
| `packages/rules` | `@saunaklar/rules` | Option rules: SINGLE/MULTI, requires, excludes (done) |
| `packages/shared` | `@saunaklar/shared` | Zod schemas for every API request/response, error codes, constants, host parsing |
| `packages/db` | `@saunaklar/db` | SQL migrations, seed, migration runner, typed `pg` client with `withTx` |
| `services/api` | `@saunaklar/api` | Hono API. One entry per Lambda function + a local server that emulates CloudFront |
| `apps/web` | `@saunaklar/web` | React 19 + Vite SPA: storefront, customer account, reseller admin, manufacturer admin |
| `tools/catalog-import` | `@saunaklar/catalog-import` | Manifest (YAML) → validated → DB import CLI |
| `infra/` | — | Terraform modules + envs |

Tests: Vitest projects `unit`, `db`, `api` (see `vitest.config.ts`); Playwright for E2E in `e2e/`.

## Local environment

- Postgres 16 at `postgres://sauna:sauna@127.0.0.1:5432/sauna` (superuser `sauna`, used only by
  migrations and tests). Test databases are created per test file from the migrations
  (`sauna_test_<random>`), then dropped.
- `DATABASE_URL` is the migration/owner URL. The API connects as login role `sauna_api`
  (password `sauna_api` locally), which is a NOINHERIT member of `app_tenant`, `app_platform`,
  `app_worker`; every transaction does `SET LOCAL ROLE <role>` first. In production each Lambda
  uses its own IAM-authenticated login user that is a member of only its role.
- Hosts (local): platform domain `localhost`. Reseller storefronts `http://{slug}.localhost:5173`,
  manufacturer admin `http://admin.localhost:5173`. Browsers resolve `*.localhost` to 127.0.0.1.
  Production: `{slug}.<PLATFORM_DOMAIN>` and `ADMIN_HOST` (may be another registrable domain).
- API port 8787 locally. Vite (5173) proxies `/api`, `/assets`, `/branding`, `/favicon.ico`,
  `/dev` to it and preserves the `Host` header.

## Database contract (packages/db)

Migrations in `packages/db/migrations/NNNN_name.sql`, applied in order, tracked in
`schema_migrations`. `packages/db/migrations/local/` holds local-only SQL (the local identity
provider schema `idp` and the dev mailbox `devtools`), applied only when `LOCAL_IDP=1`.

Conventions: UUID PKs `gen_random_uuid()`; `bigint generated always as identity` for append-only
logs; money `bigint` minor units with `CHECK (>= 0)`; percentages integer basis points
`CHECK (0..10000)`; `timestamptz` everywhere; text enums as `CHECK` for closed sets, lookup tables
for workflow sets; `created_at`/`updated_at` with an `updated_at` trigger.

### Roles

| Role | Purpose |
|---|---|
| `app_tenant` | storefront, customer, reseller-admin, asset-signer functions. Tenant rows only (RLS on `app.reseller_id`). |
| `app_platform` | manufacturer-admin function. Resellers, assignment, prices, staff. No customer PII (RLS returns zero rows; no grants on PII tables). |
| `app_worker` | worker function. Outbox, suppressions, KVS sync, retention jobs; column-level SELECT on customers (id, reseller_id, email, first_name, locale, status) for e-mail only. |
| `catalog_admin` | import pipeline: catalog + asset tables, `bump_all_catalog_versions()`. No tenant data. |
| `sauna_api` | LOGIN, NOINHERIT, member of the three app roles. |

Session settings (always transaction-local via `set_config(name, value, true)`):
`app.reseller_id` (uuid), `app.actor_staff_id`, `app.actor_customer_id` (uuid, for audit and
request history triggers). Function `app_reseller_id()` returns the uuid or NULL (fail closed).

### Tables

Reference: `currencies(code char(3) pk, minor_units smallint, name)`, `countries(code char(2) pk, name)`,
`request_statuses(code pk, label, is_terminal, sort_order)`,
`request_status_transitions(from_code, to_code, actor_kind CHECK IN ('CUSTOMER','STAFF','SYSTEM'), pk(from,to,actor_kind))`,
`asset_roles(code pk, applies_to CHECK IN ('SAUNA_MODEL','OPTION','ROOM_SCENE','BRANDING'), tier CHECK IN ('PUBLIC','LOW','FULL','AR'), is_protected bool generated from tier <> 'PUBLIC', unique(code, applies_to))`,
`reserved_slugs(slug pk)`.

Tenancy: `manufacturers(id, name)`;
`resellers(id, manufacturer_id, slug unique CHECK ~ '^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$', name, currency_code, status CHECK IN ('ACTIVE','SUSPENDED'), default_share_expiry_days smallint default 30 CHECK 1..90, catalog_version bigint default 1, unique(id, currency_code))`;
`reseller_branding(reseller_id pk, display_name, tagline, primary_color char(7) CHECK ~ '^#[0-9a-f]{6}$', logo_asset_id, favicon_asset_id, support_email, support_phone, legal_name, legal_address, vat_display CHECK IN ('INCLUDED','EXCLUDED','NONE') default 'INCLUDED')`;
`assets(id, owner_reseller_id NULL = catalog asset, storage_key unique, content_type, byte_size bigint, sha256 char(64), width, height, created_at)`.

Identity: `staff_users(id, email unique on lower(email), display_name, idp_subject unique, status CHECK IN ('INVITED','ACTIVE','DISABLED'))`;
`manufacturer_admins(staff_user_id pk, manufacturer_id)`;
`reseller_admins(reseller_id, staff_user_id, role CHECK IN ('OWNER','ADMIN'), pk(reseller_id, staff_user_id))`;
`customers(id, reseller_id, email, first_name, last_name, phone, locale default 'en', status CHECK IN ('PENDING','ACTIVE','ANONYMISED'), email_verified_at, created_at, updated_at, unique(id, reseller_id), unique index (reseller_id, lower(email)) WHERE status <> 'ANONYMISED')`;
`customer_addresses(id, customer_id, reseller_id, address_type CHECK IN ('BILLING','SHIPPING','SITE'), recipient, line1, line2, postal_code, city, region, country_code, is_default; FK (customer_id, reseller_id) → customers; partial unique (customer_id, address_type) WHERE is_default)`;
`customer_consents(customer_id, reseller_id, consent_type CHECK IN ('TERMS','PRIVACY','MARKETING'), version, granted_at, withdrawn_at, pk(customer_id, consent_type, granted_at))`.

Catalog: `sauna_models(id, manufacturer_id, sku unique, slug unique, status CHECK IN ('DRAFT','ACTIVE','RETIRED'), name, description, sort_order)`;
`sauna_model_translations(sauna_model_id, locale, name, description, pk)`;
`attribute_definitions(code pk, label, unit, value_type CHECK IN ('NUMBER','TEXT','BOOLEAN'), sort_order)`;
`sauna_model_attributes(sauna_model_id, attribute_code, value_number numeric, value_text, value_bool, pk, CHECK exactly one non-null)`;
`sauna_model_prices(sauna_model_id, currency_code, list_price_minor, max_discount_bps, pk(model, currency))`;
`option_groups(id, code unique, name, selection_type CHECK IN ('SINGLE','MULTI'), sort_order)`; `option_group_translations`;
`options(id, option_group_id, code, name, description, swatch_color char(7) NULL, sort_order, unique(option_group_id, code), unique(id, option_group_id))`; `option_translations`;
`sauna_model_option_groups(sauna_model_id, option_group_id, is_required, sort_order, pk)`;
`sauna_model_options(sauna_model_id, option_id, option_group_id, is_default, pk(model, option); FK (model, group) → sauna_model_option_groups; FK (option_id, option_group_id) → options(id, option_group_id))`;
`sauna_model_option_prices(sauna_model_id, option_id, currency_code, price_delta_minor, pk; FK (model, option) → sauna_model_options)`;
`option_requires(sauna_model_id, option_id, required_option_id, pk, CHECK differ, both FK → sauna_model_options)`;
`option_excludes(sauna_model_id, option_a_id, option_b_id, pk, CHECK a < b, both FK)`;
`room_scenes(id, manufacturer_id, code unique, name, description, status, preset jsonb NULL — parametric room parameters for scenes without a GLB)`;
`sauna_model_assets(sauna_model_id, asset_role, applies_to text CHECK = 'SAUNA_MODEL' default, asset_id, pk(model, role); FK (asset_role, applies_to) → asset_roles(code, applies_to))`; `option_assets`, `room_scene_assets` likewise.

Reseller catalog: `reseller_saunas(reseller_id, sauna_model_id, is_visible default true, sort_order, pk)`;
`reseller_sauna_discounts(reseller_id, sauna_model_id, discount_type CHECK IN ('PERCENT','FIXED'), discount_value bigint >= 0, pk; FK → reseller_saunas ON DELETE CASCADE)`;
`reseller_default_discounts(reseller_id pk, discount_type, discount_value)`;
`reseller_room_scenes(reseller_id, room_scene_id, sort_order, pk)`.

Configuration: `configurations(id, reseller_id, sauna_model_id, customer_id NULL, created_by_staff_id NULL, name, source_configuration_id NULL, locked_at NULL, created_at, updated_at; FK (reseller_id, sauna_model_id) → reseller_saunas; FK (customer_id, reseller_id) → customers(id, reseller_id); CHECK (customer_id IS NOT NULL OR created_by_staff_id IS NOT NULL); unique(id, reseller_id); unique(id, sauna_model_id))`;
`configuration_selections(configuration_id, sauna_model_id, option_id, pk(configuration_id, option_id); FK (configuration_id, sauna_model_id) → configurations(id, sauna_model_id) ON DELETE CASCADE; FK (sauna_model_id, option_id) → sauna_model_options)`;
`configuration_room_placements(configuration_id pk, reseller_id, room_scene_id, position_x_mm int, position_z_mm int, rotation_deg numeric(6,2), FK (reseller_id, room_scene_id) → reseller_room_scenes; FK (configuration_id, reseller_id) → configurations(id, reseller_id))`;
`configuration_price_snapshots(configuration_id pk, currency_code, list_price_minor, options_total_minor, discount_amount_minor, final_price_minor, discount_source, discount_type, discount_value, max_discount_bps, price_valid_until, computed_at; CHECK final = list + options - discount; CHECK discount <= list + options)`;
`configuration_price_snapshot_lines(configuration_id, option_id, price_delta_minor, pk)`;
`share_links(id, reseller_id, configuration_id, token_hash bytea unique CHECK octet_length = 32, created_by_staff_id, created_by_customer_id, expires_at, revoked_at, created_at; CHECK expires_at > created_at AND expires_at <= created_at + interval '90 days'; FK (configuration_id, reseller_id))`;
`share_link_views(id identity, share_link_id, reseller_id, viewed_at, device_class CHECK IN ('MOBILE','TABLET','DESKTOP','OTHER'))`.

Requests: `configuration_requests(id, reseller_id, customer_id, configuration_id unique, status_code, message, created_at, updated_at; FK (configuration_id, reseller_id, customer_id) → configurations(id, reseller_id, customer_id) [unique key on configurations]; FK (customer_id, reseller_id) → customers)`;
`request_status_history(id identity, request_id, reseller_id, from_status NULL, to_status, changed_by_staff_id, changed_by_customer_id, note, changed_at)`;
`request_notes(id, request_id, reseller_id, author_staff_id, body, created_at)`;
`request_quotes(id, request_id, reseller_id, amount_minor, currency_code, valid_until, note, created_by_staff_id, created_at, superseded_at NULL; partial unique (request_id) WHERE superseded_at IS NULL)`.

Platform: `notification_outbox(id identity, reseller_id NULL, event_type, payload jsonb (ids only, never PII), created_at, available_at, attempts int, locked_until, sent_at, failed_at, last_error)`;
`email_suppressions(email_lower pk, reason CHECK IN ('BOUNCE','COMPLAINT','MANUAL'), created_at)`;
`audit_events(id identity, occurred_at, reseller_id NULL, actor_staff_id NULL, actor_customer_id NULL, action, entity_type, entity_id, details jsonb)`.

Request statuses: SUBMITTED, IN_REVIEW, QUOTED, ACCEPTED, CLOSED (terminal), REJECTED (terminal),
CANCELLED (terminal). Transitions per design 9.4; actor kinds: STAFF does IN_REVIEW, QUOTED,
REJECTED, CLOSED, re-quote QUOTED→IN_REVIEW, CANCELLED; CUSTOMER does ACCEPTED (from QUOTED) and
CANCELLED (from SUBMITTED, IN_REVIEW, QUOTED).

### Database-enforced rules (each must have a DB test)

1. Discount within cap (percent ≤ cap; fixed ≤ floor(list × cap / 10000)) on per-sauna discounts;
   default discount checked against the lowest cap among the reseller's assigned saunas.
2. Assignment: same manufacturer; model ACTIVE; price for the model AND every model option in the
   reseller currency (C4), deferred re-check when options/prices change on assigned models.
3. Slug format + reserved slugs.
4. Configuration only for a model the reseller offers (composite FK), customer of same reseller.
5. Selections: option valid for the model (composite FK); at most one option per SINGLE group
   (trigger, serialised with `SELECT ... FOR UPDATE` on the configuration).
6. Lock: setting `locked_at` requires a price snapshot row and a complete, rule-valid selection
   (required groups filled, requires satisfied, no excluded pair). Once locked, the configuration,
   its selections, placement and snapshot are immutable (UPDATE/DELETE rejected). `locked_at` can't be cleared.
7. Request: configuration must be locked and owned by the requesting customer; one per configuration;
   initial status SUBMITTED; status changes only along `request_status_transitions` for the actor
   kind derived from `app.actor_staff_id` / `app.actor_customer_id`; every insert/status change writes
   `request_status_history` automatically (trigger) and a `notification_outbox` row.
8. Snapshot arithmetic CHECK; share-link expiry CHECKs; token hash length CHECK.
9. `catalog_version` bump triggers: prices, option prices, assignment, visibility/order, discounts,
   branding, room assignment, model/option status/name changes → affected resellers only.
   `bump_all_catalog_versions()` for imports.
10. Tenant status change (insert/update of resellers.status or slug) → outbox `TENANT_SYNC`.
11. Audit trigger on prices, option prices, discounts, assignments, reseller status, request status.
12. RLS: every tenant table `reseller_id = app_reseller_id()` for app_tenant; child tables through
    parent; fail closed without tenant; app_platform sees no PII rows; catalog tables visible to
    app_tenant only for models assigned to the current reseller (and their prices only in the
    reseller currency).

## API contract

Hono app, routes exactly as design section 13 plus `POST /api/shared/{token}/claim` (C5) and
`POST /api/auth/staff/*` for staff login with TOTP MFA. Request/response bodies are defined as Zod
schemas in `@saunaklar/shared` and validated on both ends. Errors: `application/problem+json`
`{type, title, status, code, detail?, errors?}`. Cursor pagination `{items, nextCursor}`.
Every response has `x-request-id`. Non-GET requests require `X-CSRF-Token`.

Adapters behind interfaces, with a local and an AWS implementation each:
`IdentityProvider` (local scrypt/JWT IdP in schema `idp` | Cognito), `Mailer` (dev mailbox table |
SES v2), `AssetSigner` (local HMAC policy cookies verified by the local edge | CloudFront signed
cookies/URLs), `ObjectStore` (local filesystem under `var/` | S3), `EdgeTenantStore` (no-op/in-memory |
CloudFront KeyValueStore), `Queue` (in-process | SQS).

## Frontend contract

React 19, Vite 7, TypeScript, React Router 7 (data router), TanStack Query 5 with
`persistQueryClient` to localStorage for catalog data (local caching), Zustand for configurator
state, React Three Fiber 9 + drei 10 for 3D, `<model-viewer>` for AR hand-off, GSAP 3 (with
ScrambleTextPlugin, SplitText, Flip, ScrollTrigger — all free since 3.13) for motion.

Design language: single-colour ("unary"). Every token is derived from ONE hue (the reseller's
`primary_color`, default near-black ink on paper): ink, paper, and lightness steps of the same hue
only. No second accent colour. Typography-led, generous whitespace, thin rules, large numerals.
Motion: scramble-text on headings and prices, vertical letter flip ("flip-flop") on hover for
links/buttons, staggered reveals with ScrollTrigger, Flip for layout changes. Respect
`prefers-reduced-motion`. Every page has the shared header and a complete footer.

## Git

Only the lead session commits. Subagents never run `git commit`, `git push`, `git checkout` or
`git stash`; they only edit files in the directories they own.
