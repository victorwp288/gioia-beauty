# Supabase development boundary

This directory is unlinked local/CI infrastructure. It must remain reproducible from committed migrations and synthetic seeds.

## Safety

- Local commands always use explicit `--local` flags where supported.
- Do not run `supabase link`, `db push`, `db reset --linked`, or any remote command from normal development/CI.
- Never add a project ref, database password, access token, production credential, or customer data here.
- The Data API exposes its required empty `public` schema only. Business tables live in the private `gioia_private` schema and browser roles receive no table access.
- Replacement project `hzibzwhrwmljgjjdzspi` is the only authorized remote `[TEST]` target and may receive only reviewed migrations plus synthetic fixtures through a separately declared operation. Project `lxvsspniipcotimbsfqm` is retired after its provider-side pooler failure and must not be targeted.
- Preview/runtime database access uses the durable least-privilege `app_runtime` login directly through the exact shared transaction pooler; the role owns no objects and receives only reviewed runtime function access.
- The hosted TEST operator can bootstrap the registered replacement only when it proves the live-pinned PG17 provider-catalog hash and exact privilege/object aggregate bounds under the global advisory lock. The pristine project has no migration-history schema, so the same transaction creates the current three-column CLI-compatible history table, atomically applies and byte-verifies the pinned 63-migration manifest, then requires the canonical private-schema hash, exactly 205 reference/config rows, and zero operational/Auth/Storage residue before runtime provisioning and the existing two-cycle gate. Partial or foreign hosted state—including standalone enum/type drift or altered immutable sequence structure—is rejected; mutable sequence positions are intentionally excluded. The canonical fingerprint is checked again inside each rebuild transaction immediately before teardown; normal `db push`/linked reset remains forbidden.
- The reserved session client holds the global advisory lock but is never used as a transaction-capable client: postgres.js `reserve()` does not expose `begin`. The full operator worker pool performs the single runtime credential transaction while that reserved session keeps the lock through the unconditional 125-second wait, one auth probe, both cycles, and final boundary verification.
- Immediately after the one successful credential probe, the operator waits a separate unconditional 150 seconds, including a 30-second margin beyond Supavisor's observed approximately 120-second idle backend timeout, then requires zero application sessions before rebuild. No backend termination SQL exists because Supavisor rewrites the probe's `PGAPPNAME` to `application_name=Supavisor`; authentication is still never retried.
- The reviewed hosted pgTAP transport keeps each file in one rollback-only transaction but sends `080_subscriber_commands.test.sql` in two explicit query messages at its committed marker. This gives its re-subscription scenario a fresh PostgreSQL `statement_timestamp()` like the local CLI runner; the split is filename-pinned, digest-pinned, and rejected if missing, duplicated, or added to another file.

## Local commands

The pinned CLI requires a Docker-compatible runtime. The current workstation has Supabase CLI 2.109.1 but no container runtime, so these commands are scaffolded and CI-ready but not yet locally executable.

```bash
npm run db:start
npm run db:reset
npm run db:test
npm run db:lint
npm run db:stop
```

`db:reset` rebuilds from migrations and `supabase/seeds/*.sql`. Database tests are pgTAP files under `supabase/tests/`. Application integration tests use only the local URLs emitted by `supabase status`.

Remote TEST application, reset, Auth-user changes, and synthetic data writes must name the exact project, expected rows, verification, and recovery before execution. Production remains disabled until the environment registry is formally reclassified and the full preflight is approved.
