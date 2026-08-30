# ADR-001 — Migrate Firestore/Firebase Auth to Supabase Postgres/Auth

- **Status:** Accepted for greenfield implementation on 2026-07-09; Production cutover remains gated.
- **Date:** 2026-07-09
- **Decision owner:** Victor

## Context

The current application stores roughly 1,600 appointments/time blocks plus vacations and newsletter subscribers in Firestore. The refactor already requires:

- a canonical data migration from several legacy date/field shapes;
- a complete server-side data boundary;
- real concurrency protection;
- an authentication/session rewrite;
- local/staging environments and tests, plus backup/restore proof before real-data cutover;
- better dashboard filtering, reporting, and export.

Implementing all of that on Firestore first and moving to Postgres later would create two migrations and substantial disposable infrastructure: deterministic Firestore guard documents, canonical dual writes, Firebase session cookies, rules/emulator coverage, and a temporary server adapter.

## Decision

Migrate once—from Firestore and Firebase Auth to Supabase Postgres and Supabase Auth—after the emergency Firebase endpoint/email containment work.

The application continues to use validated Next.js server handlers for all public/admin business operations. Customer/business tables live in a private/non-exposed schema. Server business-data access uses a dedicated least-privilege Postgres role through Supavisor transaction pooling; `anon`/`authenticated` receive no business-table grants. A Supabase service secret is reserved for narrowly scoped Auth administration and is explicitly understood to bypass RLS.

The database is the final booking authority. Pure TypeScript computes candidate availability, while a Postgres constraint or one transactional database function prevents overlapping active appointments and blocks.

## Why this fits

- Booking intervals, services, variants, vacations, subscribers, outbox events, and audit state are relational.
- Postgres constraints can enforce uniqueness, idempotency, foreign keys, and active schedule overlap.
- Reporting/export and owner dashboard queries become straightforward and bounded.
- Local Supabase provides a resettable Docker stack, versioned migrations, synthetic seeds, and reproducible CI.
- The data volume and single-admin auth migration are small enough for a fully rehearsed cutover.

## Consequences

Positive:

- one canonical migration instead of two;
- database-enforced booking integrity;
- clearer environment/migration workflow;
- predictable relational queries and future reporting;
- removal of client Firestore access and read-cost anxiety.

Costs/risks:

- a controlled vendor/data/auth cutover;
- SQL migration and Postgres operational knowledge;
- recurring environment cost—Supabase Pro starts around $25/month, while a persistent staging project or Preview branches add compute/usage cost; approve the complete current quote rather than only the base plan;
- daily backups alone can still permit roughly a day of data loss; off-platform logical exports or separately approved PITR may be needed;
- the insecure direct-client Firestore app is not a safe writable rollback; after cutover, failures use maintenance plus Supabase restore/fix-forward, while reverse ETL preserves an emergency copy.

Supabase itself does not make development safe. During the synthetic greenfield phase, safety came from credential isolation, fail-closed targets, synthetic data, versioned observable migrations, focused tests, and fake providers. The retained owner-approved rehearsal copy now makes direct TEST-data access Guarded until handover cleanup; Production authority still has not moved. Backups, restore rehearsals, explicit Production approval, reconciliation, and cutover recovery apply when the corresponding real-data or Production boundary enters scope.

## Current development lane

The current registered Supabase project is non-authoritative and has no live users; `docs/ENVIRONMENTS.md` is authoritative for its exact ref and retained-data state. Ordinary repository, Local/CI, UI/copy, application, and separately isolated synthetic work remain Fast Lane. They do not require production-style recovery proof, the full hosted two-cycle checkpoint, runtime-role credential choreography, or repetitive broad E2E. Direct access, Auth, mutation, export, reset, or Preview testing against the retained PII-bearing target is Guarded until handover cleanup.

Firestore access, Production-derived data/import, auth or access-control changes, real provider/live-user activation, Production deployment/config/data, destructive action, and cutover remain Guarded. This narrows process, not the accepted architecture or its technical safeguards.

## Acceptance and Production gates

Victor accepted the one-migration architecture and authorized a resettable greenfield integration/staging target on 2026-07-09. The original project is retired; the current exact TEST target is recorded in `docs/ENVIRONMENTS.md`. The 2026-07-29 representative import was separately approved and remains a temporary retained-data exception; it does not grant Production authority, live-user access, or permission for additional real-data imports.

Acceptance of the architecture does not approve Production spend or cutover. Before Supabase becomes authoritative:

1. Victor approves the current total recurring Production cost and backup/recovery tier after pricing is rechecked.
2. Local migrations recreate the database from zero, and the authorized remote target is rebuilt from those migrations after synthetic data and test users are removed.
3. A representative Firestore export is handled in a restricted recovery environment, reaches staging only as an approved anonymized derivative, and reconciles source = imported + explicitly reviewed quarantine.
4. Concurrent overlap, auth/RLS, advisor, direct-access, backup/restore, and full booking/admin/email E2E tests pass.
5. The write-freeze, staged Production deployment, recovery, and reverse-ETL runbooks are reviewed and the exact target is reclassified as Production.

If cost or rehearsal conditions fail, stop before the production canonical migration and write a replacement Firestore ADR. Do not implement both paths.

## Cutover strategy

Avoid long-lived dual writes. Use a short maintenance/write freeze:

1. Build and test Supabase locally and in isolated staging.
2. Rehearse an idempotent full import keyed by preserved `legacy_firestore_id`.
3. Freeze booking/dashboard writes.
4. Take final Firestore backup/export and counts/checksums.
5. Import and reconcile every invariant.
6. Switch production configuration and smoke-test while frozen.
7. Reopen public and dashboard writes only after verification and canary cleanup.
8. Keep Firestore read-only as a recovery source for 30 days.
9. On failure, freeze writes and restore/fix forward in Supabase. Reverse-sync provides emergency data preservation; reactivating Firestore would require a separately built secure server adapter and explicit approval.

See `docs/MASTERPLAN.md`, `docs/DATA-MODEL.md`, and `docs/PRODUCTION-SAFETY.md` for executable gates.

## Current official references

Recheck these before implementation because platform behavior and pricing change:

- [Supabase local development and versioned migrations](https://supabase.com/docs/guides/local-development/overview)
- [Supabase environments and Preview branching](https://supabase.com/docs/guides/deployment)
- [Supabase branching usage and cost](https://supabase.com/docs/guides/platform/manage-your-usage/branching)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase service-role RLS bypass behavior](https://supabase.com/docs/guides/troubleshooting/why-is-my-service-role-key-client-getting-rls-errors-or-not-returning-data-7_1K9z)
- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase pricing](https://supabase.com/pricing)
- [2026 Data API grant/default-exposure change](https://supabase.com/changelog)
