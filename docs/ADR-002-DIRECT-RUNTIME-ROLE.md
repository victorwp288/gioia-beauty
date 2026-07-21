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
