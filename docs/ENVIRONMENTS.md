# Environment registry

This file records environment identities and safety boundaries only. It must never contain passwords, access tokens, database connection strings, service-role/secret keys, or customer data.

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

Read-only inspection on 2026-07-09 found the project `ACTIVE_HEALTHY`, with zero `public` tables, zero migrations, and no security/performance advisor findings. Victor reclassified it on 2026-07-09 as the authorized greenfield integration/staging target for the rebuild.

Safety rules:

- Prefer Local Docker Supabase for rapid iteration, destructive experiments, and CI. Apply only reviewed, committed migrations to this project.
- Classify project metadata/schema reads and authorized schema/Auth/synthetic-fixture changes as `[TEST]`. State the exact target and bounds before each remote operation.
- Only synthetic fixtures and fake/non-delivering email are allowed. Never copy real Firebase customer data, production Resend credentials, or production secrets into this project during development.
- The schema, migrations, test Auth users, functions, and synthetic data may be created, changed, reset, or deleted as required for the rebuild. Remote changes must remain reproducible from the repository.
- Vercel Preview may use this target only after fail-closed environment isolation is implemented and verified. Serialized Preview/E2E runs must lock and reset or namespace synthetic data.
- Preview application traffic uses a separately provisioned `app_runtime` login over the transaction pooler (`:6543`) with prepared statements disabled. Environment validation rejects direct connections and the privileged `postgres` role.
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

## Preview

After Phase 1 isolation, serialized DB-aware Preview/E2E work may use the greenfield Supabase target above with synthetic fixtures and fake/non-delivering email. Preview must never resolve Firebase Production, real Resend credentials, or a Supabase environment containing customer data.

## Local and CI

- Local: Docker Supabase, synthetic seed data, fake application email, and capture-only Auth mail.
- Local server tests may connect as the disposable local `postgres` user only to enter a transaction and immediately `SET LOCAL ROLE app_runtime`; application queries execute with the same function-only grants used remotely.
- CI: ephemeral local Supabase, deterministic fixtures, fake email adapter.
- Neither environment may resolve the Production Supabase ref, Production Firebase project, or real Resend credentials.
