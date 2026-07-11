# Environment registry

This file records environment identities and safety boundaries only. It must never contain passwords, access tokens, database connection strings, service-role/secret keys, or customer data.

The data lifecycle and provider gates for every environment are defined in
[PRIVACY-OPERATIONS.md](./PRIVACY-OPERATIONS.md) and
[PROCESSORS.md](./PROCESSORS.md). Any target containing raw or restorable
customer data is Production-classified even when it is temporary or not serving
traffic.

## Greenfield integration / staging

### Supabase — authorized rebuild target

| Field                     | Value                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Project name              | `gioia-beauty`                                                                                             |
| Project ref               | `lxvsspniipcotimbsfqm`                                                                                     |
| Dashboard                 | <https://supabase.com/dashboard/project/lxvsspniipcotimbsfqm>                                              |
| Region                    | `eu-central-2`                                                                                             |
| PostgreSQL                | 17 (`17.6.1.141` observed 2026-07-09)                                                                      |
| Organization              | `victorwp288's Org` (`qqjqzdcoapbztwnatils`)                                                               |
| Current organization plan | Free                                                                                                       |
| Current authority         | Non-production integration/staging only; Firestore remains Production authority until the approved cutover |

Initial read-only inspection on 2026-07-09 found the project empty, and Victor
reclassified it as the authorized greenfield integration/staging target. The
2026-07-10 verification snapshot has 35 reviewed migrations, 17 forced-RLS
private tables, 194 catalog/policy rows, zero operational/Auth rows, no
security-advisor findings, and no exposed business table/function. The
rollback-only remote suite passed 266 pgTAP assertions; a 20-request same-slot
race produced exactly one booking and 19 conflicts, then reconciled and cleaned
to zero residue. The test-only `pgtap` extension remains installed in
`extensions`; performance-advisor notices are limited to expected unused-index
INFO on the empty integration database.

The committed greenfield operator fails closed unless it sees the exact clean
and pushed `refactor` SHA with a successful CI run, the allowlisted session
pooler identity with certificate verification, an explicit project-specific
confirmation, and the reviewed migration/pgTAP byte manifests. It holds one
project advisory lock, applies teardown, all 37 migrations, exact migration
history, and final reconciliation in one serializable transaction, then runs
two complete synthetic acceptance/cleanup cycles and requires matching schema
and reference-data fingerprints. As of 2026-07-10 this operator has not been
executed remotely; the target therefore remains at the 35-migration snapshot
described above.

Safety rules:

- Prefer Local Docker Supabase for rapid iteration, destructive experiments, and CI. Apply only reviewed, committed migrations to this project.
- Classify project metadata/schema reads and authorized schema/Auth/synthetic-fixture changes as `[TEST]`. State the exact target and bounds before each remote operation.
- Only synthetic fixtures and fake/non-delivering email are allowed. Never copy real Firebase customer data, production Resend credentials, or production secrets into this project during development.
- The schema, migrations, test Auth users, functions, and synthetic data may be created, changed, reset, or deleted as required for the rebuild. Remote changes must remain reproducible from the repository.
- Vercel Preview may use this target only after fail-closed environment isolation is implemented and verified. Serialized Preview/E2E runs must lock and reset or namespace synthetic data.
- Preview application traffic uses a separately provisioned `app_runtime` login over the transaction pooler (`:6543`) with prepared statements disabled. Environment validation rejects direct connections and the privileged `postgres` role.
- Connection mode is fixed by workload. Trusted migration/operator work prefers the
  direct `db.<ref>.supabase.co:5432` endpoint when its runner has IPv6 (or the
  separately purchased IPv4 add-on); an explicitly pinned shared session pooler
  on `:5432` is the approved fallback for IPv4-only operator runners. Vercel
  Functions always use the least-privilege `app_runtime.<ref>` login through the
  shared transaction pooler on `:6543`, `prepare: false`, and the code-owned pool
  cap. Direct or privileged database URLs remain invalid in Preview.
- The Free plan is acceptable for greenfield testing but is not the approved launch posture.

Before this project can become Production, it must be reclassified in this file and in the operator preflight. Remove synthetic data and test users, rebuild from committed migrations, run advisors and direct-access security tests, approve/upgrade the backup tier, prove restore into an isolated target, and complete Firestore import reconciliation. Once real customer data is imported or live traffic points here, it is immediately Production and every production control applies.

## Production

### Current Firestore source

| Field             | Value                                                 |
| ----------------- | ----------------------------------------------------- |
| Firebase project  | `gioia-beauty-b95e0`                                  |
| Current authority | Live Production booking/customer source until cutover |

The `refactor` branch rejects this project in Local/Test/Preview and sink-disables legacy server Auth outside the exact demo emulator. The live `main` deployment still uses it; any live read, configuration, data, or application action therefore remains separately protected.

### Future Supabase authority

No Supabase project is Production-authoritative yet, and `APP_ENV=production` startup is intentionally rejected until one is registered in reviewed environment code. The greenfield project above may be promoted only through the approved rebuild/reset, backup/restore, migration-reconciliation, Vercel cutover, and immediate reclassification gates; otherwise a separately approved clean Production project must be used.

Provider webhook signing material is Production-only. The replacement
application requires `EMAIL_WEBHOOK_ENABLED=true` plus a server-only
`RESEND_WEBHOOK_SECRET` only after a Production Supabase target is registered
and the exact Resend endpoint/configuration action is approved. Until then the
committed webhook route fails closed before reading its request body or opening
a database transaction.

## Preview

After Phase 1 isolation, serialized DB-aware Preview/E2E work may use the greenfield Supabase target above with synthetic fixtures and fake/non-delivering email. Preview must never resolve Firebase Production, real Resend API/webhook credentials, or a Supabase environment containing customer data.

The committed public abuse guard intentionally code-disables Preview
availability and booking before database work. A validated Preview database
target alone cannot activate those routes. Activation requires a reviewed
distributed rate-limit/challenge adapter plus its explicit environment and
provider configuration; no `disabled` flag or process-local cache is accepted
as a substitute.

As of 2026-07-11, Vercel Preview is bound to the greenfield project using the
transaction-pooler `app_runtime` principal, the pinned Supabase CA, unique
server-only booking/session HMAC material, and fake email with webhooks off.
Legacy Resend and Twilio variables are Production-only. Deployment
`dpl_Cc9ar52EEeT5kG5xTQSvNf5xeqN5` built commit `45b70f9a57280e3d80daca554eef7669b7ca66dc`
successfully and returned the expected private `200` health response. Public
booking remains code-disabled before database work, and no customer data is in
this target.

## Local and CI

- Local: Docker Supabase, synthetic seed data, fake application email, and capture-only Auth mail.
- The Local/Test public abuse guard is a deterministic stateless fake used to
  prove ordering, HMAC principal isolation, and zero-database rejection. It is
  not rate-limit evidence and makes no provider call.
- Local server tests may connect as the disposable local `postgres` user only to enter a transaction and immediately `SET LOCAL ROLE app_runtime`; application queries execute with the same function-only grants used remotely.
- CI: ephemeral local Supabase, deterministic fixtures, fake email adapter.
- Neither environment may resolve the Production Supabase ref, Production Firebase project, or real Resend API/webhook credentials.
