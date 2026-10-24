# Infrastructure

Terraform for the saunaklar platform on AWS (design: `docs/design.md` sections 4, 5, 10, 12, 14-19;
overrides in `docs/review-fixes.md`). Primary region **eu-central-1**; replicas and backup copies in
**eu-west-1**. CloudFront's certificate, WAF and edge metrics live in **us-east-1** (no personal data).

```
infra/
├── bootstrap/            one-time per account: state bucket, GitHub OIDC provider, deploy role
├── envs/{dev,staging,prod}/
│   ├── backend.tf        S3 backend, native lock file (use_lockfile = true)
│   ├── versions.tf       providers: default (eu-central-1), us_east_1, replica (eu-west-1); default tags
│   ├── main.tf           calls modules/platform with the environment's sizing
│   └── terraform.tfvars.example
└── modules/
    ├── platform/         composition of everything below (+ tests/plan.tftest.hcl, offline plan)
    ├── network/          VPC (3 AZ), public/private/isolated-DB subnets, NAT (single_nat_gateway), endpoints
    ├── database/         RDS PostgreSQL 16 Multi-AZ, gp3 autoscaling, KMS, force_ssl, RDS Proxy (IAM auth)
    ├── auth/             Cognito: customers (UUID usernames) + staff (TOTP MFA), CustomMessage trigger
    ├── api/              6 Lambdas + roles, HTTP API routes, SQS + DLQ, EventBridge rules, app secrets
    ├── edge/             CloudFront, tenant-router function + KeyValueStore, WAF, ACM, Route 53
    ├── storage/          web, public (media/branding/uploads), assets (SSE-KMS, CRR to eu-west-1)
    ├── messaging/        SES identity (DKIM, MAIL FROM, DMARC), configuration set → SNS
    ├── observability/    log groups, alarms (design 17), dashboard, budgets
    └── backup/           AWS Backup daily, copy to eu-west-1
```

Requires **Terraform >= 1.10** (S3 `use_lockfile`); CI uses 1.16.7. AWS provider `~> 5.80`.
Provider lock files are committed with hashes for linux and macOS (amd64 and arm64).

## Request routing (one distribution, every host)

| Path | Origin | Cache key | Notes |
|---|---|---|---|
| `/api/*` | API Gateway | `x-tenant-host` + all query strings | cached only when the API sends `Cache-Control`; adds `x-origin-secret` |
| `/assets/*` | assets bucket | path only (**no Host**, G1) | trusted key group: LOW cookie `https://{host}/assets/lo/*`, FULL `https://{host}/assets/*`, AR signed URLs |
| `/static/*` | web bucket | path only | hashed SPA bundles, forced 1 year, immutable |
| `/media/*` | public bucket | path only | catalog thumbnails and galleries |
| `/branding/*`, `/favicon.ico` | public bucket | path only | favicon rewritten to `/branding/{slug}/favicon.ico` |
| default | web bucket | not cached | `index.html` with `Cache-Control: no-cache`; SPA routes rewritten to `/index.html` |

The S3 key is always the URL path without the leading slash. The viewer-request function
`modules/edge/functions/tenant-router.js` takes the tenant from the Host header only: a
`{slug}.<platform_domain>` host must exist as `ACTIVE` in the KeyValueStore (the worker writes
`slug → ACTIVE|SUSPENDED`), otherwise the edge answers 404 (problem+json under `/api/`). The admin
host skips the lookup. The function also sets `x-tenant-host`, overwriting anything the client sent.

## 1. Bootstrap (once per AWS account)

Use one AWS account per environment. As an administrator:

```sh
cd infra/bootstrap
terraform init
terraform apply -var environment=staging -var github_repository=anikeaty08/saunaKlar
```

This creates `saunaklar-tfstate-<env>` (versioned, KMS-encrypted, TLS-only) and the
`saunaklar-github-deploy` role, which only GitHub runs in the matching GitHub environment can
assume (`staging`, `production`; dev also accepts `main`). Keep the bootstrap state file somewhere
safe, or import the resources into a remote state afterwards.

Before the first apply:

1. **Route 53 hosted zone** for the platform domain (A13), delegated from the registrar.
   If `admin_host` is on another registrable domain (C6), that zone must exist too (`admin_zone_id`).
2. **CloudFront signing key pair** for signed cookies and URLs:
   ```sh
   openssl genrsa -out signing-k1.pem 2048
   openssl rsa -in signing-k1.pem -pubout -out signing-k1.pub.pem
   ```
   Put the **public** key in tfvars (`signing_public_keys = { k1 = "<pem>" }`, `active_signing_key = "k1"`).
   The private key goes to Secrets Manager after the first apply (see below). Never commit it.
3. Copy `envs/<env>/terraform.tfvars.example` to `terraform.tfvars` (git-ignored) and fill it in.

## 2. Deploy order

```sh
cd infra/envs/staging
terraform init -backend-config="bucket=saunaklar-tfstate-staging"
terraform apply
```

One apply creates everything; Terraform orders it (ACM DNS validation takes a few minutes).
Then, once:

```sh
# CloudFront signing private key (asset-signer reads it at cold start)
aws secretsmanager put-secret-value \
  --secret-id saunaklar-staging/edge/cloudfront-signing-key \
  --secret-string file://signing-k1.pem
shred -u signing-k1.pem
```

After that, application deploys go through GitHub Actions (`.github/workflows/deploy.yml`):

1. `terraform plan` + `apply` for the environment
2. Lambda code: the native layer (sharp, aws-crt) is published only when it changes, each function
   gets a new version, and nothing takes traffic yet
3. **Migrations**: invoke the **new** worker version with `{"task":"migrate"}`. Migrations are
   forward-only and expand-only, so the old API versions keep working
4. Move the `live` aliases: the worker first, then the API functions. The canary weight comes from
   `canary_percent` and rolls back if `<function>-errors` or `<function>-throttles` alarms. With
   `enable_codedeploy = true` (prod), CodeDeploy runs the canary instead.
5. Web: `static/` is uploaded immutable, then `index.html` with `no-cache`, and only
   `/index.html` is invalidated
6. Smoke test through CloudFront: health, SPA, the 403 for unsigned assets, the 404 for unknown
   tenants, HSTS and CSP

Production runs after staging and waits for approval through the `production` GitHub environment.

### GitHub configuration

| Where | Name | Value |
|---|---|---|
| Environments `staging`, `production` | `AWS_DEPLOY_ROLE_ARN` | `deploy_role_arn` output of bootstrap |
| 〃 | `TF_STATE_BUCKET` | `state_bucket` output of bootstrap |
| 〃 | `TFVARS` | the full contents of that environment's `terraform.tfvars` (it holds no secrets) |
| 〃 | `PLATFORM_DOMAIN` | e.g. `saunas.example.com` |
| 〃 | `SMOKE_HOSTS` | e.g. `demo.saunas.example.com admin.saunas.example.com` (one active reseller + admin host) |
| Environment `production` | Required reviewers | the manual approval gate |

## 3. Secrets

| Secret (Secrets Manager) | Created by | Holds |
|---|---|---|
| `<name>/edge/cloudfront-signing-key` | Terraform (empty) | **you** store the PEM private key, see above |
| `<name>/edge/origin-secret` | Terraform (random) | value of `x-origin-secret`. CloudFront sends it and every function rejects requests without it. Rotate with `origin_secret_rotation` |
| `<name>/app/secret` | Terraform (random) | `APP_SECRET`: the CSRF and cursor HMAC key |
| `<name>/db/svc_*` | Terraform (random) | the password RDS Proxy uses to log in as each function's DB user |
| `rds!db-…` | RDS (managed, rotated) | the master user `sauna_owner`, used only by the migrate task |

Secrets are never put into Lambda environment variables. A function gets `<VAR>_SECRET_ARN`
(`APP_SECRET_ARN`, `ORIGIN_SECRET_ARN`, `CLOUDFRONT_PRIVATE_KEY_SECRET_ARN`). The Lambda entry
reads each one at cold start (the SecretString is the raw value) into `process.env.<VAR>` before
`loadConfig()`.

## 4. Lambda bundles

`npm run build -w @saunaklar/api` runs `services/api/build.mjs` and writes
`services/api/dist/lambda/<function>/index.mjs` (plus source maps) for `public-catalog`, `customer`,
`reseller-admin`, `manufacturer-admin`, `asset-signer` and `worker`. Handler: `index.handler`,
runtime `nodejs22.x`, `arm64`. `.github/scripts/build-lambda-artifacts.sh` zips each directory as is.
The worker bundle must therefore carry the SQL migrations next to `index.mjs`. A
`dist/lambda/cognito-custom-message/` bundle is deployed to the Cognito trigger if it exists.

`sharp`, `aws-crt` and `@aws-sdk/signature-v4-crt` stay outside the bundle. CI builds them for
linux-arm64 at the versions in `package-lock.json`, publishes them as the layer
`<name>-native-arm64`, and attaches it to every function. Terraform ignores `layers` and code.

Terraform creates each function with a stub that answers 503 until the first CI deploy.

Environment contract (set by `modules/api`): `NODE_ENV=production`, `ADAPTERS=aws`,
`API_DATABASE_URL` (`postgres://svc_<fn>@<proxy>:5432/sauna`, IAM token as password), `DB_IAM_AUTH=1`,
`PLATFORM_DOMAIN`, `ADMIN_HOST`, `PUBLIC_SCHEME=https`, `TRUST_X_TENANT_HOST=true`, `RATE_LIMIT=false`
(WAF does it), `COGNITO_{CUSTOMER,STAFF}_{POOL,CLIENT}_ID`, `SES_CONFIGURATION_SET`, `MAIL_FROM_DOMAIN`,
`MAIL_DEFAULT_FROM_NAME`, `S3_ASSETS_BUCKET` (public bucket), `SQS_QUEUE_URL`, `CLOUDFRONT_KEY_PAIR_ID`,
`EDGE_TENANT_KVS_ARN`. The worker also gets `MIGRATE_DB_HOST`, `MIGRATE_DB_NAME`,
`MIGRATE_DB_SECRET_ARN` and `DB_LOGIN_SECRET_ARNS`.

### Database users

Each function connects through RDS Proxy as its own login user with IAM auth
(`rds-db:connect` on exactly that user):

| Function | DB user | Member of |
|---|---|---|
| public-catalog, customer, reseller-admin, asset-signer | `svc_public_catalog`, `svc_customer`, `svc_reseller_admin`, `svc_asset_signer` | `app_tenant` |
| manufacturer-admin | `svc_manufacturer_admin` | `app_platform` |
| worker | `svc_worker` | `app_worker` |
| catalog import (CI) | `svc_catalog_import` | `catalog_admin` |

The migrate task connects straight to the instance as the master user. It creates these login roles
(or resets their passwords) from the `DB_LOGIN_SECRET_ARNS` secrets and grants each one its
membership, so the proxy's stored passwords always match. Use transaction-local settings only
(`set_config(…, true)`): session state pins proxy connections, and the alarm
`<name>-rds-proxy-session-pinning` fires.

## 5. DNS and certificates

- ACM (us-east-1) issues `*.<platform_domain>` plus `admin_host` and validates them through Route 53
  records that Terraform creates. Renewal is automatic as long as those records stay in place.
  `<name>-certificate-expiry` alarms at 30 days.
- `*.<platform_domain>` and `admin_host` are A/AAAA aliases to CloudFront. **A new reseller is a
  database row**: no DNS or certificate change. The worker writes the KeyValueStore entry, and the
  storefront goes live as soon as the tenant is `ACTIVE`.
- SES: the domain identity uses Easy DKIM (3 CNAMEs), MAIL FROM `bounce.<email_domain>` (MX + SPF)
  and DMARC `_dmarc.<email_domain>`. New accounts are in the **SES sandbox**: request production
  access for eu-central-1 before launch (launch checklist).
- Apex (`<platform_domain>`) and `www` are not served by this stack.

## 6. Cost drivers (check with the AWS pricing calculator)

| Driver | Why | Levers |
|---|---|---|
| CloudFront egress | 3D assets, about 7 TB/month in the design 16 illustration | Draco/KTX2, LOD, immutable caching, `price_class`, savings bundle |
| NAT gateways | hourly charge per AZ plus per-GB processing | `single_nat_gateway` outside prod; VPC endpoints for S3, SQS, Secrets Manager, KMS |
| RDS | `db.r6g.large` Multi-AZ, gp3, Performance Insights, RDS Proxy (billed per vCPU) | right-size after load tests |
| WAF | per web ACL, rule and million requests; **Bot Control** is billed per inspected request | scoped to `/api/assets/session` and `/api/auth/signup`; off in dev |
| Cognito | monthly active users (A14) | verify pricing tier before launch |
| Interface VPC endpoints | per endpoint, per AZ, per hour | three endpoints by default (`interface_endpoints`) |
| CloudWatch | log ingestion and alarms | log retention per environment; no request bodies logged |
| Backups and replication | cross-region copy and replication traffic, IA storage | `backup_retention_days`; replication off in dev |

`monthly_budget_usd` sends AWS Budgets alerts at 80% actual and 100% forecast spend.

## 7. Validating locally

```sh
terraform fmt -check -recursive infra
for d in infra/envs/dev infra/envs/staging infra/envs/prod; do terraform -chdir=$d init -backend=false && terraform -chdir=$d validate; done
terraform -chdir=infra/modules/platform init -backend=false && terraform -chdir=infra/modules/platform test
```

The platform test plans the whole stack with mocked providers, both prod-like and dev-like. It
catches dependency cycles, unknown `for_each` keys and validation errors without AWS credentials.

## Runbook pointers

- **Suspend a reseller**: set the status in the manufacturer admin. The outbox `TENANT_SYNC` makes
  the worker write `SUSPENDED` to the KeyValueStore, and the edge returns 404 within seconds.
- **Rotate the signing key**: add `k2` to `signing_public_keys`, apply, store the new private key,
  then set `active_signing_key = "k2"` and apply. Remove `k1` after 1 hour (longest cookie: 10 min).
- **Rotate the origin secret**: change `origin_secret_rotation` and apply in a quiet window, because
  warm Lambdas hold the old value until they recycle (or redeploy right after).
- **DLQ alarm**: inspect the messages, fix the cause, then redrive from the console (`jobs-dlq` → `jobs`).
- **Restore**: PITR for the instance (`backup_retention_days`), or use the AWS Backup copy in eu-west-1
  for region loss.
