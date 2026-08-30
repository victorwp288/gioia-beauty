# Environment registry

This file records environment identities and safety boundaries only. It must never contain passwords, access tokens, database connection strings, service-role/secret keys, or customer data.

The data lifecycle and provider gates for every environment are defined in
[PRIVACY-OPERATIONS.md](./PRIVACY-OPERATIONS.md) and
[PROCESSORS.md](./PROCESSORS.md). Any target containing raw or restorable
customer data is Production-classified even when it is temporary or not serving
traffic.

## Greenfield integration / staging

### Supabase — authorized rebuild target

| Field             | Value                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| Project ref       | `hzibzwhrwmljgjjdzspi`                                                                                     |
| Dashboard         | <https://supabase.com/dashboard/project/hzibzwhrwmljgjjdzspi>                                              |
| API URL           | <https://hzibzwhrwmljgjjdzspi.supabase.co>                                                                 |
| Region            | `eu-central-2`                                                                                             |
| Shared pooler     | `aws-1-eu-central-2.pooler.supabase.com`                                                                   |
| Current state     | PII-bearing retained rehearsal TEST; current protected `refactor` Preview is bound fail-closed to it       |
| Current authority | Non-production integration/staging only; Firestore remains Production authority until the approved cutover |

Project `lxvsspniipcotimbsfqm` is retired from all current configuration after
a provider-side pooler failure prevented reliable protected runtime recovery.
Its dated migration, canary, Preview, and acceptance evidence remains historical
only in the append-only worklog and ADR; none of it transfers to the replacement
project.

The replacement project passed the guarded hosted checkpoint on 2026-07-21 at
commit `b3fe610` with exact-head CI run `29863407987`, including two clean
migration/acceptance cycles, schema/reference fingerprints, hosted owner Auth,
and final zero operational/Auth/Storage residue. Phase 2 is complete. This is
durable historical evidence, not a requirement to repeat the full checkpoint
for ordinary schema, seed, application, or Preview work.

**Current operating rule:** the project remains non-authoritative, but the
owner-approved 2026-07-29 representative rehearsal left a PII-bearing copy in
place until handover cleanup. Repository, Local/CI, UI/copy, application
development, and separately isolated synthetic tests remain Fast Lane. Any
action that can access, mutate, export, reset, expose, or authenticate against
this retained target is Guarded. Keep providers fake, do not enable live users,
and do not run broad mutation/cleanup fixtures against the retained rows.

The outbox route may be invoked manually in a future Preview only when the
complete environment validates as `APP_ENV=preview`, `VERCEL_ENV=preview`, this
exact registered TEST ref/pooler/runtime role, fake email transport, disabled
email webhook, canonical Cron secret, and valid newsletter token keyring. This
does not authorize a Vercel schedule, Resend, a real alert receiver, provider
webhook registration, customer data, or any Production action.

The exact-set migration manifest and `npm run db:test:greenfield` preserve the
reviewed checkpoint as immutable historical evidence. They apply only to that
frozen schema and are expected to refuse after an additive migration. Ordinary
work uses the living versioned migration sequence and focused checks. If a
future full destructive/release/cutover checkpoint is needed, create a new
versioned candidate manifest/harness with the same exact-target, advisory-lock,
zero-session/no-active-Preview, credential non-disclosure, schema fingerprint,
least-privilege, interruption, and final-reconciliation controls; do not rewrite
the historical manifest.

Safety rules:

- Prefer Local Docker Supabase for rapid iteration, destructive experiments, and CI. Apply only reviewed, committed migrations to this project.
- Classify project metadata/schema reads and authorized schema/synthetic-fixture changes as `[TEST]`. Verify the exact target before the first remote operation in a coherent task; do not repeat a production-style preflight for each additive step.
- Add only synthetic fixtures and fake/non-delivering email during development. The retained 2026-07-29 customer-derived rehearsal is a bounded, owner-approved exception; do not add further real data or expose the retained copy to live users. Production Resend credentials and Production secrets remain forbidden.
- The schema, migrations, test Auth users, functions, and synthetic data may be created or changed as required for the rebuild. Remote changes must remain reproducible from the repository. A shared-target destructive reset is Guarded for coordination and target confirmation, but it does not need production-data backup/recovery ceremony.
- Vercel Preview may use this target because fail-closed isolation is implemented and verified. Ordinary non-destructive Preview work is Fast Lane; only shared destructive fixtures/resets need serialization or namespacing.
- Preview application traffic uses the durable least-privilege `app_runtime`
  login directly through the transaction pooler (`:6543`) with prepared
  statements disabled. The role owns no database object and receives only the
  reviewed private-schema usage and function execution grants required by the
  application; browser roles and privileged `postgres` credentials remain
  invalid application principals.
- Connection mode is fixed by workload. Trusted migration/operator work prefers the
  direct `db.<ref>.supabase.co:5432` endpoint when its runner has IPv6 (or the
  separately purchased IPv4 add-on); an explicitly pinned shared session pooler
  on `:5432` is the approved fallback for IPv4-only operator runners. Vercel
  Functions use `app_runtime.<ref>` through the exact shared transaction pooler
  on `:6543`, `prepare: false`, and the code-owned pool cap. Direct or privileged
  database URLs remain invalid in Preview.

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

After Phase 1 isolation, DB-aware Preview/E2E work normally uses synthetic fixtures and fake/non-delivering email. While the retained rehearsal copy exists, only explicitly approved internal read-only Preview checks may access this target; writable tests use Local or a separately isolated synthetic target. Preview must never resolve Firebase Production, real Resend API/webhook credentials, expose customer data publicly, or accept live users/bookings.

An ordinary internal/team Preview deploy and synthetic smoke test is Fast Lane. Enabling access for real users, attaching real providers, accepting real bookings, or routing Production traffic is Guarded and requires the applicable abuse, auth, privacy, provider, and deployment controls.

The committed public abuse guard intentionally code-disables Preview public
availability, booking, and newsletter operations before business-data work. A
validated Preview database target alone cannot activate those routes. Activation requires a reviewed
distributed rate-limit/challenge adapter plus its explicit environment and
provider configuration; no `disabled` flag or process-local cache is accepted
as a substitute.

On 2026-07-22, exact source `2a5bdc8` was deployed as Vercel Preview deployment
`dpl_bkH62gyhYYhdjvNSzHTcZ7bNr7eR` with branch-specific `refactor` overrides for
the accepted TEST project, fake email, console-only observability, the protected
`app_runtime` transaction-pooler DSN, and the pinned CA. `/api/health` passed
without a database read; `/api/maintenance` proved the one-row least-privilege
database boundary; the real hosted owner login/session/logout/revocation flow
passed with secure cookies, CSRF/origin enforcement, and final zero
operational/Auth/Storage residue. Public availability still returns controlled
`503 SERVICE_UNAVAILABLE` before business-data access because the distributed
abuse/challenge adapter is intentionally unconfigured. Vercel Production,
Firebase, Resend, and customer data were not changed.

## Local and CI

- Local: Docker Supabase, synthetic seed data, fake application email, and capture-only Auth mail.
- Local/Test public routes consume atomic fixed-window database buckets for
  network plus normalized account/authenticated-token scopes. The optional
  `PUBLIC_HUMAN_CHALLENGE_TEST_TOKEN` enables only a canonical synthetic
  header proof for deterministic tests; it makes no provider call and is
  rejected in Preview, Production, and operator environments.
- Local server tests use the disposable loopback `postgres` connection and
  immediately `SET LOCAL ROLE app_runtime` inside each transaction. Remote
  runtime traffic authenticates directly as `app_runtime`; the Local switch is
  only a Docker-harness mechanism for exercising the same function-only grants.
- CI: ephemeral local Supabase, deterministic fixtures, fake email adapter.
- Neither environment may resolve the Production Supabase ref, Production Firebase project, or real Resend API/webhook credentials.
