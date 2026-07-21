# ADR-002 — One direct least-privilege runtime role

**Status:** accepted for Local and the resettable TEST project on 2026-07-21  
**Production:** not approved; Firebase remains authoritative

## Context

The first TEST project developed a provider-side Supavisor failure after custom
role credential changes. A separate `app_runtime_login` carrier was introduced
to isolate credential rotation from the stable `app_runtime` authorization
surface. The carrier could immediately `SET ROLE app_runtime`, so compromise of
its credential had the same callable-function blast radius as a direct runtime
credential. It also added a membership edge, repeated password rotation,
propagation waits, recovery logic, and a second pooler identity.

The replacement project `hzibzwhrwmljgjjdzspi` is an empty, resettable TEST
target in `eu-central-2`. It has no Preview deployment or customer data.

## Decision

Use `app_runtime` as the single credential-bearing application role. It connects
through the shared transaction pooler as `app_runtime.<project-ref>` and keeps
the existing strict attributes, zero ownership, zero table/sequence privileges,
and exact execute-only function allowlist.

Keep two non-login roles because they enforce distinct trust boundaries:

- `gioia_mutator` owns security-definer business functions and has only the
  table privileges those functions need.
- `gioia_migrator` is reserved for bounded import/cutover work and is retired
  after the recovery-retention window.

`postgres` remains a protected operator identity and is never deployed. Business
tables remain in the private schema and unavailable through the Data API.

Migrations never store a runtime password. The protected operator provisions one
strong SCRAM credential after schema initialization. Destructive TEST rebuilds
preserve the role and credential, prove their fingerprint is unchanged, require
zero active runtime sessions, and retain the serialized advisory lock and full
two-cycle acceptance gate.

The session-pooler connection reserved by postgres.js is deliberately limited
to acquiring/holding/releasing that advisory lock and the final boundary check;
reserved clients do not expose `begin`. Credential inspection and the single
password transaction therefore run on the full operator worker pool while the
reserved session continues to hold the global lock. The unconditional
125-second propagation wait and one transaction-pooler authentication probe
remain inside the same locked lifecycle. A successful probe is followed by one
bounded operator cleanup that accepts zero naturally closed backends or
terminates exactly one current-database `app_runtime` client backend with the
probe's exact application name. Multiple matches are never terminated, and
`gioia_public_api` or unknown sessions are never targeted. The operator then
re-proves zero application sessions before invoking either rebuild cycle.

The replacement starts from the provider's empty hosted baseline, before
`app_runtime` exists. The operator therefore initializes under its existing
exact target/CI/repository preflight and advisory lock, before credential
provisioning. It accepts only the pinned provider baseline or the already
complete reviewed state; partial migrations, unknown roles/schemas/public
objects, Auth rows, or Storage rows fail closed. The empty path applies the full
63-file reviewed manifest in one transaction, records and byte-verifies all 63
migration-history rows, and reconciles 205 reference/config rows plus zero
operational/Auth/Storage residue before the runtime login can be created.
The registered pristine manifest hashes the full known hosted PG17 provider
catalog and privilege surface without exporting definitions or credential
verifiers. Because a brand-new project has no `supabase_migrations` schema, the
atomic bootstrap creates the canonical `version`/`statements`/`name` history
table before replay. Resumed managed state must also match the canonical
private-schema fingerprint, including standalone custom types and immutable
sequence structure while excluding mutable sequence position. Each destructive
transaction re-asserts that fingerprint immediately before teardown; migration
history alone is insufficient evidence.

## Consequences

- The obsolete carrier role, role switch, repeated password rotations, recovery
  callback, and per-cycle pooler propagation waits are removed. One quiet period
  remains before the checkpoint's single initial runtime authentication.
- A leaked runtime credential still reaches only the allowlisted function
  surface; it cannot read or mutate business tables directly.
- The zero-session rebuild gate is valid only while TEST has no active Preview
  runtime. A served environment must be quiesced or adopt a shared/exclusive
  advisory-lock protocol before destructive reset.
- The broken prior project is retained only as incident evidence and is not a
  migration source or fallback environment.
- Bootstrap failure before commit leaves the empty provider baseline unchanged;
  interruption after commit is resumable only from the exact verified managed
  state and never causes a second migration application.
