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
| Current state     | Accepted clean TEST target; current `refactor` Preview is bound fail-closed to this project                |
| Current authority | Non-production integration/staging only; Firestore remains Production authority until the approved cutover |

Project `lxvsspniipcotimbsfqm` is retired from all current configuration after
a provider-side pooler failure prevented reliable protected runtime recovery.
Its dated migration, canary, Preview, and acceptance evidence remains historical
only in the append-only worklog and ADR; none of it transfers to the replacement
project.

The replacement project passed the guarded hosted checkpoint on 2026-07-21 at
commit `b3fe610` with exact-head CI run `29863407987`: two complete 63-migration
rebuild/acceptance cycles, 205 reference/config rows, 28 pgTAP files and 443
assertions per cycle, matching schema/reference fingerprints, hosted owner Auth,
and final zero operational/Auth/Storage residue. Phase 2 is complete. The later
`refactor` head `2a5bdc8` preserved that accepted state and is the source of the
current Preview deployment described below.

The first hosted checkpoint may initialize this replacement only through the
guarded empty-project path. Under the same exact target, pushed-SHA/green-CI
preflight, pinned migration-byte manifest, and serialized advisory lock used by
the two-cycle gate, the initializer accepts exactly two states: the complete
reviewed 63-migration clean state, or a pristine hosted Supabase baseline with
zero migration history, no Gioia roles/schema or public user objects, and zero
Auth/Storage rows. It refuses partial history or catalog/data drift. From the
pristine state it first requires the live-registered PG17 provider-catalog
SHA-256 plus exact aggregate bounds across database/role attributes and
memberships, schemas/ACLs/default ACLs, extensions, relations, columns,
constraints, indexes, routines, triggers, policies, standalone types, event
triggers, and publications. The pristine target intentionally has no
`supabase_migrations` schema; the same transaction creates the current
three-column CLI-compatible history table, applies all 63 migrations, verifies
every stored history statement against the reviewed bytes, reconciles exactly 205
reference/config rows and zero operational/Auth/Storage residue, and only then
provisions the direct runtime credential and enters cycles A and B.

A pinned-CA handshake and the completed hosted acceptance both chain the
replacement pooler to Supabase Root 2021 with SHA-256 fingerprint
`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.
Transport identity remains only one part of the separately recorded acceptance
evidence.

Safety rules:

- Prefer Local Docker Supabase for rapid iteration, destructive experiments, and CI. Apply only reviewed, committed migrations to this project.
- Classify project metadata/schema reads and authorized schema/Auth/synthetic-fixture changes as `[TEST]`. State the exact target and bounds before each remote operation.
- Only synthetic fixtures and fake/non-delivering email are allowed. Never copy real Firebase customer data, production Resend credentials, or production secrets into this project during development.
- The schema, migrations, test Auth users, functions, and synthetic data may be created, changed, reset, or deleted as required for the rebuild. Remote changes must remain reproducible from the repository.
- Vercel Preview may use this target only after fail-closed environment isolation is implemented and verified. Serialized Preview/E2E runs must lock and reset or namespace synthetic data.
- Preview application traffic uses the durable least-privilege `app_runtime`
  login directly through the transaction pooler (`:6543`) with prepared
  statements disabled. The role owns no database object and receives only the
  reviewed private-schema usage and function execution grants required by the
  application; browser roles and privileged `postgres` credentials remain
  invalid application principals.
- A destructive greenfield checkpoint receives the exact protected
  `app_runtime.<ref>` transaction-pooler DSN only through the TEST operator
  environment. It must freshly prove pinned-CA authentication before mutation,
  prove zero active `app_runtime` sessions and no active Preview traffic, and
  preserve the exact durable role and unchanged SCRAM verifier across both
  rebuild cycles. Before releasing the project lock it must freshly prove direct
  `app_runtime` authentication and the reviewed least-privilege boundary. The
  DSN and verifier are never accepted from dotenv, serialized config, subprocess
  arguments, logs, or artifacts.
- An interrupted checkpoint fails without disabling, dropping, rotating, or
  recovering the durable runtime identity. A later guarded run must re-establish
  the same zero-session/no-Preview precondition and unchanged SCRAM proof.
  Reset/rebuild tooling must also prove `app_runtime` has no object ownership or
  table/sequence ACL and only the reviewed runtime function boundary.
- The reserved session connection owns only the session-scoped global advisory
  lock and final boundary proof. Runtime credential state and the one
  provisioning transaction use the full operator worker pool because a
  postgres.js reserved client has no transaction API; the reserved connection
  continues holding the lock throughout provisioning, the unconditional quiet
  period, the one authentication probe, both cycles, and final reconciliation.
  After that probe succeeds, the operator waits a second unconditional 150
  seconds, including a 30-second margin beyond Supavisor's observed
  approximately 120-second idle backend timeout, then freshly proves zero
  application sessions before either rebuild. No backend termination
  is permitted: Supavisor rewrites the probe application name to `Supavisor`, so
  application-name targeting is neither exact nor safe.
- If the initial schema transaction fails, PostgreSQL rolls the entire
  bootstrap back to the pristine baseline. If interruption occurs after that
  commit but before runtime credential verification, a later approved run
  recognizes only the exact 63-migration clean state, does not replay the
  bootstrap, and resumes the one-time credential gate before either rebuild.
  Managed resume additionally requires the canonical private-schema SHA-256,
  including standalone enum/domain/range/type definitions and ACLs plus
  immutable sequence type/start/increment/min/max/cache/cycle settings; mutable
  sequence position is intentionally excluded. The same canonical fingerprint
  is re-asserted inside each rebuild transaction immediately before teardown, so
  a valid 63-row history cannot mask manual catalog drift.
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

After Phase 1 isolation, serialized DB-aware Preview/E2E work may use the greenfield Supabase target above with synthetic fixtures and fake/non-delivering email. Preview must never resolve Firebase Production, real Resend API/webhook credentials, or a Supabase environment containing customer data.

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
