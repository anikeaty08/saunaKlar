## What and why

<!-- One or two sentences: the change and the reason for it. Link the issue if there is one. -->

## How it was tested

- [ ] `npx tsc -b`
- [ ] Unit / DB / API tests (`npx vitest run --project unit|db|api`)
- [ ] E2E (`npx playwright test`) for user-facing flows
- [ ] Tried it locally on a tenant host (`http://<slug>.localhost:5173`) and/or the admin host

## Checklist

- [ ] **Tenant isolation**: new endpoints take the tenant from the host only, and have a cross-tenant test (tenant A cannot read or change tenant B's data)
- [ ] **Migrations** are forward-only and backward-compatible (expand now, contract in a later release); RLS and grants are set for new tables
- [ ] **No personal data or tokens** in logs, outbox payloads or error messages
- [ ] **Caching**: personalised responses are `no-store`; cacheable catalog responses are keyed by `catalog_version`
- [ ] **Infra**: `terraform fmt` + `terraform test` (infra/modules/platform) pass; new AWS permissions are least-privilege and justified in the PR
- [ ] **UI**: header and footer intact, keyboard accessible, `prefers-reduced-motion` respected
- [ ] Docs updated (`docs/`, `infra/README.md`) where behaviour or operations changed

## Deployment notes

<!-- Anything the deploy needs: new secrets, GitHub environment variables, manual steps, data backfills. "None" is fine. -->
