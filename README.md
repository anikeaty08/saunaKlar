# saunaKlar

A multi-tenant sauna configurator. One manufacturer publishes a catalog of saunas, options and
room scenes. Each reseller gets their own branded storefront on a subdomain
(`{slug}.<platform-domain>`), with their own prices (within the manufacturer's discount caps),
currency and logo. Customers configure saunas in 3D, place them in a room, view them in AR, save
configurations and send a request. The reseller then reviews it, quotes and closes it.

- **Manufacturer admin** (own host, `ADMIN_HOST`): resellers, sauna and room assignment, list
  prices and maximum discounts per currency.
- **Reseller admin** (`/admin` on the reseller's host): branding (logo, favicon, colour), sauna
  visibility and order, discounts, customers, requests and quotes, share links, analytics.
- **Customers** (the storefront): sign-up with e-mail verification, configurator with live
  pricing, saved configurations, requests, data export and account deletion.

## Architecture in short

| Part | What it is |
|---|---|
| `apps/web` | React 19 + Vite SPA for all four surfaces (storefront, account, reseller admin, manufacturer admin). React Three Fiber for 3D, `<model-viewer>` for AR, GSAP for motion. |
| `services/api` | Hono API in TypeScript. In AWS: one Lambda per function (`public-catalog`, `customer`, `reseller-admin`, `manufacturer-admin`, `asset-signer`, `worker`). Locally: one Node server that also emulates CloudFront and S3. |
| `packages/db` | PostgreSQL 16 schema. Business rules, tenant isolation (row-level security) and audit live in the database. Also the migration runner, the dev seed and a typed `pg` client. |
| `packages/pricing`, `packages/rules` | Integer pricing engine and option rules (SINGLE/MULTI groups, requires, excludes). They are shared by the API, the web app and the importer. |
| `packages/shared` | The API contract: Zod schemas for every request and response, error codes and host parsing. |
| `tools/catalog-import` | YAML manifests → validate → optimise → upload → database, one transaction per sauna. |
| `infra/` | Terraform: network, Aurora/RDS, Cognito, SES, S3, CloudFront with KeyValueStore, WAF, Lambdas, SQS, backups, observability. |

How the pieces fit together:

- **Tenancy.** The tenant comes from the `Host` header. The API sets
  `app.reseller_id` in every transaction, and RLS policies on the tenant tables enforce it.
- **Accounts.** Identity runs on Cognito with two user pools, customers and staff. Staff
  must use TOTP MFA. The browser never sees an identity token: the API acts as a
  backend-for-frontend with `__Host-` cookies and a CSRF header.
- **Protected 3D files.** They are served through CloudFront signed cookies. The cookie's
  policy is bound to the reseller's host, and there are two tiers: `/assets/lo/*` for
  anonymous visitors and `/assets/*` once signed in or holding a share link.
- **E-mail.** Mails go through a transactional outbox, SQS and SES. Templates are branded
  per reseller and translated into en, de, fr, it and rm.

The full design is in [docs/design.md](docs/design.md). [docs/review-fixes.md](docs/review-fixes.md)
lists fixes that take precedence over the design. [docs/implementation-plan.md](docs/implementation-plan.md)
is the contract the code follows.

## Repository layout

```
apps/web/                 SPA (storefront, account, reseller admin, manufacturer admin)
services/api/             Hono API, Lambda entries (src/functions), worker, local server (src/local.ts)
  src/adapters/           Identity, mail, signed assets, object storage, edge store, queue
                          (each with a local and an AWS implementation)
packages/db/              migrations/ (+ migrations/local for the local IdP and dev mailbox), seed, client
packages/pricing/         pricing engine
packages/rules/           option rules
packages/shared/          API contract (Zod)
tools/catalog-import/     catalog import CLI (see its README)
infra/                    Terraform: bootstrap/, envs/{dev,staging,prod}, modules/
scripts/dev.mjs           `npm run dev`
docker-compose.yml        local PostgreSQL 16
.github/workflows/        CI (ci.yml) and deployment (deploy.yml, deploy-env.yml)
```

## Prerequisites

- Node.js **22.18 or newer** (see `.nvmrc`)
- **Docker** (for `docker compose`) or your own **PostgreSQL 16** with a superuser
- Terraform ≥ 1.10 and AWS credentials, but only for deployment

## Quick start

```sh
npm ci
docker compose up -d postgres
npm run dev
```

`npm run dev` checks that Postgres is reachable. It then applies the migrations, including the
local identity provider schema, and seeds demo data if the database is empty. Last, it starts
the API (port 8787) and Vite (port 5173) together, with prefixed output. Ctrl+C stops both.

| URL | What |
|---|---|
| http://alpha.localhost:5173 | Storefront of reseller **alpha** (EUR) |
| http://beta.localhost:5173 | Storefront of reseller **beta** (CHF) |
| http://alpha.localhost:5173/admin | Reseller admin of alpha |
| http://admin.localhost:5173 | Manufacturer admin |
| http://localhost:8787/dev/mail | Dev mailbox: every mail the platform sends locally (sign-up codes, resets, invites) |

Reseller **gamma** exists but is suspended, so its storefront answers "not found". The seed also
prints the URL of a shared configuration (`/s/<token>` on alpha).

The database URL defaults to `postgres://sauna:sauna@127.0.0.1:5432/sauna` (the compose
database). Override it with `DATABASE_URL`. `npm run dev -- --no-seed` skips seeding, and
`npm run dev -- --skip-db` skips the database steps entirely. To start over:
`LOCAL_IDP=1 npm run db:reset`, which drops, migrates and seeds.

### Seeded logins

Every seeded account uses the password **`Sauna!2026`**.

| Where | E-mail | Role |
|---|---|---|
| http://admin.localhost:5173 | `admin@nordlicht.test` | Manufacturer admin (Nordlicht Saunabau) |
| http://alpha.localhost:5173/admin | `owner@alpha.test` | Reseller owner, alpha |
| http://beta.localhost:5173/admin | `owner@beta.test` | Reseller owner, beta |
| http://alpha.localhost:5173 | `anna@example.test`, `ben@example.test` | Customers of alpha |
| http://beta.localhost:5173 | `anna@example.test` | Customer of beta: the same e-mail, a separate account |

Staff MFA is required by default. On the first staff sign-in you set up an authenticator app
(TOTP). Set `STAFF_MFA=OPTIONAL` in the API environment to skip this locally.

### How subdomains work locally

Browsers resolve every `*.localhost` name to 127.0.0.1, so no `/etc/hosts` entries are needed.
Vite proxies `/api`, `/assets`, `/media`, `/branding`, `/favicon.ico` and `/dev` to the API and
keeps the original `Host` header, so the API knows which tenant is meant. The local server plays
the role of CloudFront and S3:

- it checks the signed asset cookies (same names and policy format as CloudFront, HMAC-signed);
- it accepts presigned uploads at `/dev/uploads/<token>`;
- it stores objects under `var/objects/`.

Local mail goes to the dev mailbox table instead of SES.

Environment variables for the API are documented in
[services/api/.env.example](services/api/.env.example). The defaults work locally without any of them.

## Tests

| Command | What runs |
|---|---|
| `npm run test:unit` | Pricing, rules, shared schemas, API adapters, web helpers. No database needed. |
| `npm run test:db` | Schema, database-enforced rules and RLS isolation. Needs Postgres; each test file creates and drops its own database. |
| `npm run test:api` | API integration tests against a real database. Needs Postgres. |
| `npm test` | All of the above. |
| `npm run typecheck` | `tsc` in every workspace. |

The database tests connect with `TEST_DATABASE_URL`, falling back to `DATABASE_URL` and then to
the compose default. `npm run test:e2e` runs Playwright. CI skips that step until a
`playwright.config.*` exists in the repository root.

## Catalog import

Saunas, options, prices and 3D files are not edited in a UI. They are YAML manifests, imported
with [`tools/catalog-import`](tools/catalog-import/README.md):

```sh
npx catalog-import tools/catalog-import/examples --dry-run   # validate and print the plan
npx catalog-import tools/catalog-import/examples             # import into $DATABASE_URL, files to var/objects/
npx catalog-import catalog --target s3://<assets-bucket> --media-bucket <media-bucket> --database-url "$DATABASE_URL"
```

The tool's README describes the manifest format, the validation rules and the exit codes.

## Deployment

Infrastructure lives in `infra/` (Terraform, `eu-central-1`). There is one root module per
environment in `infra/envs/{dev,staging,prod}`, built from `infra/modules/*`.

1. **Bootstrap each AWS account once.** This creates the state bucket and the GitHub OIDC
   deploy role:
   ```sh
   cd infra/bootstrap
   terraform init && terraform apply -var environment=staging -var github_repository=anikeaty08/saunaKlar
   ```
2. **Configure the environment.** Copy `infra/envs/<env>/terraform.tfvars.example` and fill it
   in. It holds the domains, hosted zone, mail domain, CloudFront public signing key, alarm and
   budget e-mails. The CloudFront **private** key never goes into tfvars. Store it as the value
   of the `…/edge/cloudfront-signing-key` secret in Secrets Manager.
3. **Deploy through GitHub Actions.** A push to `main` runs CI, builds once and deploys to
   staging automatically. Production needs manual approval from the `production` environment's
   required reviewers. `workflow_dispatch` lets you pick the target and a canary percentage. Each
   GitHub environment needs these variables:
   - `AWS_DEPLOY_ROLE_ARN`
   - `TF_STATE_BUCKET`
   - `TFVARS` (the full tfvars file)
   - `PLATFORM_DOMAIN`
   - `SMOKE_HOSTS`

   A deployment runs `terraform plan` and `apply`, then publishes the Lambda versions. Next it
   runs the database migrations (the worker's `migrate` task) and shifts the `live` alias
   (optionally as a canary with alarm rollback). Finally it uploads the web build and runs a
   smoke test (`.github/scripts/`).

To work with an environment by hand:

```sh
terraform -chdir=infra/envs/dev init -backend-config="bucket=<state-bucket>"
terraform -chdir=infra/envs/dev plan
```
