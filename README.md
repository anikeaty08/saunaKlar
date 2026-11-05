# saunaKlar

A white-label sauna shop with a 3D configurator. One manufacturer publishes a catalogue of
saunas, options and room scenes. Each authorised reseller gets a branded storefront on its own
subdomain (`{slug}.<platform-domain>`): their logo, brand colour and one of five storefront
layouts, with their own prices (within the manufacturer's discount caps), their own option
settings and currency. Customers configure a sauna in 3D, place it in a room, view it in AR,
save configurations and request a quote. The reseller reviews the request, sends a quote and
closes it.

## Who can do what

| Role | Where | What they do |
|---|---|---|
| **Customer** | the storefront | Browse saunas, open the 3D configurator after logging in, save configurations, send a request, accept a quote, export or delete their data. |
| **Reseller owner** | `/admin` on the reseller's host | Everything an admin can do, plus branding and storefront layout, shop settings, discounts, and per-sauna option settings (enable or disable an option, set its price and description). |
| **Reseller admin** | `/admin` | Work requests (status, notes, quotes), view customers, create configurations on behalf of a customer, read-only view of saunas, options and branding. |
| **Manufacturer admin** | its own host (`ADMIN_HOST`) | Resellers, sauna and room assignment, list prices and maximum discounts. Sees no customer personal data. |

## The catalogue

Seven demo saunas are seeded, each with exterior and interior photos and a 3D model built from
one shared kit (`apps/web/src/three/kit`): Espoo Compact, Kelo Barrel, Fjord Panorama, Lappi
Corner, Aurora Hex, Saimaa Garden House and Kide Glass Corner (a glass-corner cabin).
Every option a reseller offers must change the 3D model; `options-visual.test.ts` enforces this.
A parametric six-sided glass-front renderer (`apps/web/src/three/reference`) exists but is not
in the catalogue yet.

## Architecture in short

| Part | What it is |
|---|---|
| `apps/web` | React 19 + Vite SPA for all four surfaces. React Three Fiber for 3D, `<model-viewer>` for AR. Token-based CSS: colours derive from each reseller's brand colour (`design/theme.ts`). |
| `services/api` | Hono API in TypeScript. In AWS: one Lambda per function. Locally: one Node server that also emulates CloudFront and S3. |
| `packages/db` | PostgreSQL 16 schema, migrations, dev seed. Business rules, tenant isolation (row-level security) and audit live in the database. |
| `packages/pricing`, `packages/rules` | Integer pricing engine and option rules (single/multi groups, requires, excludes), shared by the API and the web app. |
| `packages/shared` | The API contract: Zod schemas, error codes and host parsing. |
| `tools/catalog-import` | YAML manifests to validated, optimised, imported catalogue data. |
| `tools/blender` | Blender scripts for the kit parts, catalogue renders and the reference sauna. |
| `infra/` | Terraform: network, database, Cognito, SES, S3, CloudFront, WAF, Lambdas, queues, observability. |

How the pieces fit together:

- **Tenancy.** The tenant comes from the `Host` header. The API sets `app.reseller_id` in every
  transaction, and row-level security enforces it.
- **Pricing.** Always computed on the server in integer minor units. The list price is the
  manufacturer's ceiling; a reseller's option price overrides and discounts are applied on top
  and capped. Disabled options are rejected when a configuration is saved or sent.
- **Accounts.** Cognito with two pools (customers, staff). Staff use TOTP MFA. The browser never
  sees an identity token: the API is a backend-for-frontend with `__Host-` cookies and CSRF.
- **Protected 3D files** are served through CloudFront signed cookies, with an anonymous low tier
  and a signed-in tier.
- **E-mail** goes through an outbox, SQS and SES, branded per reseller.
- **Languages:** English, German, French and Italian.

Design documents: [docs/design.md](docs/design.md), [docs/review-fixes.md](docs/review-fixes.md),
[docs/implementation-plan.md](docs/implementation-plan.md), [docs/customization.md](docs/customization.md)
(per-reseller option settings), [docs/api.md](docs/api.md) and the generated
[docs/openapi.json](docs/openapi.json) (`npm run openapi`).

## Prerequisites

- Node.js **22.18 or newer** (see `.nvmrc`)
- **Docker** for `docker compose`, or your own PostgreSQL 16 with a superuser
- Terraform 1.10 or newer and AWS credentials, only for deployment

## Quick start

```sh
npm ci
docker compose up -d postgres
npm run dev
```

`npm run dev` checks that Postgres is reachable, applies the migrations (including the local
identity provider schema), seeds demo data if the database is empty, and starts the API
(port 8787) and Vite (port 5173). Ctrl+C stops both. On Windows, start Docker Desktop first.

| URL | What |
|---|---|
| http://alpha.localhost:5173 | Storefront of reseller **alpha** (EUR) |
| http://beta.localhost:5173 | Storefront of reseller **beta** (CHF) |
| http://alpha.localhost:5173/saunas/kide-glass-corner | Product page of the glass-corner sauna (swap the slug for any model) |
| http://alpha.localhost:5173/saunas/kelo-barrel/configure | The 3D configurator (needs a customer login) |
| http://alpha.localhost:5173/admin | Reseller admin of alpha |
| http://admin.localhost:5173 | Manufacturer admin |
| http://localhost:5173 | Platform page |
| http://localhost:8787/dev/mail | Dev mailbox: every mail sent locally (sign-up codes, resets, invites) |

Reseller **gamma** exists but is suspended, so its storefront answers "not found".

The database URL defaults to `postgres://sauna:sauna@127.0.0.1:5432/sauna`. Override it with
`DATABASE_URL`. `npm run dev -- --no-seed` skips seeding and `npm run dev -- --skip-db` skips the
database steps. To start over run `LOCAL_IDP=1 npm run db:reset`; it drops, migrates and seeds,
and the `LOCAL_IDP` flag creates the login users.

### Seeded logins

Every seeded account uses the password **`Sauna!2026`**.

| Where | E-mail | Role |
|---|---|---|
| http://admin.localhost:5173 | `admin@nordlicht.test` | Manufacturer admin |
| http://alpha.localhost:5173/admin | `owner@alpha.test` | Reseller owner, alpha |
| http://alpha.localhost:5173/admin | `admin@alpha.test` | Reseller admin, alpha |
| http://beta.localhost:5173/admin | `owner@beta.test` | Reseller owner, beta |
| http://alpha.localhost:5173 | `anna@example.test`, `ben@example.test` | Customers of alpha |
| http://beta.localhost:5173 | `anna@example.test` | Customer of beta (a separate account) |

Staff MFA is required by default. Set `STAFF_MFA=OPTIONAL` in the API environment to skip the
authenticator app locally, for example `STAFF_MFA=OPTIONAL npm run dev`.

### How subdomains work locally

Browsers resolve every `*.localhost` name to 127.0.0.1, so no hosts-file entries are needed.
Vite proxies `/api`, `/assets`, `/media`, `/branding`, `/favicon.ico` and `/dev` to the API and
keeps the original `Host` header. The local server plays the role of CloudFront and S3: it checks
signed asset cookies, accepts presigned uploads and stores objects under `var/objects/`.

### Configuration

- API variables: [services/api/.env.example](services/api/.env.example). The defaults work locally.
- Web host config precedence: `window.__SK_CONFIG__` (from `/config.js`), then `VITE_PLATFORM_DOMAIN`
  and `VITE_ADMIN_HOST`, then `localhost`. In production the API refuses to start with a short
  `APP_SECRET`, a non-https scheme or the localhost domains.
- The platform page lists example shops from `exampleShops` in `/config.js` or `VITE_EXAMPLE_SHOPS`
  (comma separated). Locally it lists alpha, beta and gamma; in production it lists none unless set.
- `GET /api/ready` checks the database connection.

## Tests

| Command | What runs |
|---|---|
| `npm run test:unit` | Pricing, rules, shared schemas, API adapters, web helpers, 3D kit. No database needed. |
| `npm run test:db` | Schema, database-enforced rules and RLS isolation. Needs Postgres; each file creates and drops its own database. |
| `npm run test:api` | API integration tests against a real database. Needs Postgres. |
| `npm test` | All of the above. |
| `npm run typecheck` | `tsc` in every workspace. |
| `npm run test:e2e` | Playwright. |

## Assets

- `npm run assets:optimize` compresses the 3D kit (meshopt) and the wood normal maps, and writes
  responsive catalogue photos (`-480`, `-800` and `-1200` in avif, webp and jpg). The kit payload
  is about 1 MB.
- Catalogue photos live in `apps/web/public/catalogue/<slug>-exterior|interior.jpg`.
  `npm run db:seed` and `scripts/seed-media.mjs` write the matching files into `var/objects/`.

## Catalog import

Saunas, options, prices and 3D files can also be imported from YAML manifests with
[`tools/catalog-import`](tools/catalog-import/README.md):

```sh
npx catalog-import tools/catalog-import/examples --dry-run   # validate and print the plan
npx catalog-import tools/catalog-import/examples             # import into $DATABASE_URL
```

## Deployment

Infrastructure is Terraform in `infra/` (`eu-central-1`), one root module per environment in
`infra/envs/{dev,staging,prod}`. Bootstrap each AWS account once (`infra/bootstrap`), fill in
`terraform.tfvars` from the example, and deploy through GitHub Actions: a push to `main` runs CI
and deploys staging; production needs manual approval. Each GitHub environment needs
`AWS_DEPLOY_ROLE_ARN`, `TF_STATE_BUCKET`, `TFVARS`, `PLATFORM_DOMAIN` and `SMOKE_HOSTS`.
The runtime `/config.js` is not yet written by the deploy workflow; until it is, set
`VITE_PLATFORM_DOMAIN` and `VITE_ADMIN_HOST` at build time.
