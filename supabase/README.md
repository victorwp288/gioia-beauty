# Supabase development boundary

This directory is unlinked local/CI infrastructure. It must remain reproducible from committed migrations and synthetic seeds.

## Safety

- Local commands always use explicit `--local` flags where supported.
- Do not run `supabase link`, `db push`, `db reset --linked`, or any remote command from normal development/CI.
- Never add a project ref, database password, access token, production credential, or customer data here.
- The Data API exposes its required empty `public` schema only. Business tables live in the private `gioia_private` schema and browser roles receive no table access.
- The authorized remote project `lxvsspniipcotimbsfqm` is `[TEST]` and may receive only reviewed migrations plus synthetic fixtures through a separately declared operation.

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
