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

The replacement project recorded in `docs/ENVIRONMENTS.md` is an empty,
resettable TEST target in `eu-central-2`. It has no customer data or Production
authority; current Preview status is recorded in the environment registry.

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
strong SCRAM credential after schema initialization. When the explicit full
destructive shared-TEST rebuild harness is invoked, it preserves the role and
credential, proves their fingerprint is unchanged, requires zero active runtime
sessions, and retains the serialized advisory lock and full two-cycle acceptance
gate.

The session-pooler connection reserved by postgres.js is deliberately limited
to acquiring/holding/releasing that advisory lock and the final boundary check;
reserved clients do not expose `begin`. Credential inspection and the single
password transaction therefore run on the full operator worker pool while the
reserved session continues to hold the global lock. The unconditional
125-second propagation wait and one transaction-pooler authentication probe
remain inside the same locked lifecycle. A successful probe is followed by a
separate unconditional 150-second drain wait, including a 30-second margin
beyond Supavisor's observed approximately 120-second idle backend timeout,
then a fresh zero-application-session proof
before either rebuild cycle. There is no termination path: live evidence shows
Supavisor rewrites `PGAPPNAME` to `application_name=Supavisor`, making a targeted
probe-backend kill impossible to distinguish safely.

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

The role topology, private-schema boundary, and credential non-disclosure remain
mandatory. The detailed lifecycle above is historical/full-reset acceptance for
`npm run db:test:greenfield`, not the default path for additive versioned schema
changes, synthetic seeds/test data, application development, or ordinary
Preview deployments. Those use the Fast Lane in `AGENTS.md`: exact TEST target,
synthetic data, focused migration/security assertions, and a simple deploy smoke.
The frozen command remains historical-only after additive schema evolution. If
the role/credential boundary changes or a future release/cutover needs full
acceptance, create a new versioned candidate manifest/harness that preserves the
same lifecycle controls instead of rewriting or reusing the old exact set.

- The obsolete carrier role, role switch, repeated password rotations, recovery
  callback, and per-cycle pooler propagation waits are removed. One quiet period
  remains before the checkpoint's single initial runtime authentication.
- A leaked runtime credential still reaches only the allowlisted function
  surface; it cannot read or mutate business tables directly.
- The zero-session rebuild gate applies only to the deliberate destructive
  shared-target harness. A served environment must be quiesced or use a fresh
  target before that reset; ordinary additive migrations do not enter this
  credential lifecycle.
- The broken prior project is retained only as incident evidence and is not a
  migration source or fallback environment.
- Bootstrap failure before commit leaves the empty provider baseline unchanged;
  interruption after commit is resumable only from the exact verified managed
  state and never causes a second migration application.
