# Environment registry

This file records environment identities and safety boundaries only. It must never contain passwords, access tokens, database connection strings, service-role/secret keys, or customer data.

## Production

### Supabase — Production target (empty; not authoritative yet)

| Field | Value |
|---|---|
| Project name | `gioia-beauty` |
| Project ref | `lxvsspniipcotimbsfqm` |
| Dashboard | <https://supabase.com/dashboard/project/lxvsspniipcotimbsfqm> |
| Region | `eu-central-2` |
| PostgreSQL | 17 (`17.6.1.141` observed 2026-07-09) |
| Organization | `victorwp288's Org` (`qqjqzdcoapbztwnatils`) |
| Current organization plan | Free |
| Current authority | None; Firestore remains Production authority until the approved cutover |

Read-only inspection on 2026-07-09 found the project `ACTIVE_HEALTHY`, with zero `public` tables, zero migrations, and no security/performance advisor findings. This is the reserved Production target, not a development sandbox.

Safety rules:

- Never link Local, CI, Vercel Preview, or normal developer shells to this project.
- Never use it to prototype schema changes. Develop and reset locally; test in a separate staging target; deploy reviewed versioned migrations only through the protected Production operator workflow.
- Classify metadata/schema reads as `[PROD-READ]`, infrastructure/Auth/settings changes as `[PROD-CONFIG]`, and any inserted/updated/imported/deleted row as `[PROD-DATA]`, even while the project is empty.
- Do not create application tables, users, secrets, webhooks, or Production environment variables until their corresponding masterplan gate and explicit execution approval.
- The Free plan is not the approved launch posture. Before any customer write, approve the full environment cost and upgrade/configure the required backup tier; Supabase documents accessible automatic daily backups for Pro with seven-day retention, while Free projects should maintain their own logical exports.

### Current Firestore source

| Field | Value |
|---|---|
| Firebase project | `gioia-beauty-b95e0` |
| Current authority | Live Production booking/customer source until cutover |

The current repository can reach this project from local/Preview code. Follow the red-alert rules in `docs/PRODUCTION-SAFETY.md` until isolation is complete.

## Staging / Preview

No remote Supabase staging project is registered yet. Do not use the Production target as a substitute. Phase 1 starts with local Docker Supabase and synthetic fixtures; a separate serialized staging project or paid branch is created only after the full cost and target are approved.

## Local and CI

- Local: Docker Supabase, synthetic seed data, fake/Mailpit email.
- CI: ephemeral local Supabase, deterministic fixtures, fake email adapter.
- Neither environment may resolve the Production Supabase ref, Production Firebase project, or real Resend credentials.
