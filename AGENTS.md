# AGENTS.md — Gioia Beauty

Guidance for AI agents (and humans) working in this repo. Read this before writing code.

## What this is

Production website + booking system for **Gioia Beauty**, a real beauty salon in Roveleto di Cadeo, Italy (live at https://www.gioiabeauty.net). Public site (services, gallery, contacts, booking) + admin dashboard (`/dashboard`) used daily by the owner. Content and UI copy are in **Italian**.

This is a real business, not a demo: bugs lose bookings, and Firestore reads cost real money. **Current authority matters:** Firestore is the protected live Production system. Supabase remains a non-authoritative greenfield rebuild with no live users, but TEST currently retains an explicitly approved, PII-bearing rehearsal copy until handover cleanup.

## Two-lane operating model

Choose the lane from what the change can reach. If a task mixes lanes, split it and guard only the risky action.

**Current TEST exception (2026-07-29):** Supabase `hzibzwhrwmljgjjdzspi` is no longer synthetic-only while the retained representative rehearsal data exists. Repository, Local/CI, UI, copy, and isolated synthetic work remain Fast Lane. Any action that can read, write, export, reset, expose, or authenticate against the retained TEST data is Guarded. Do not run broad mutation/cleanup fixtures against it; use Local or a separately isolated synthetic target for writable testing.

### Fast Lane — the current default

Use Fast Lane when the work stays inside repository code, Local/CI, or the registered non-production Supabase/Preview target with synthetic data and fake/non-delivering providers. It includes UI and copy, non-sensitive workflows, isolated bug fixes, ordinary features, app integration, versioned greenfield schema iteration, synthetic seeds/test users, and Preview/staging deployments.

Fast Lane workflow:

1. Run `git status --short --branch`; preserve user-owned changes and never auto-checkout, pull, reset, or clean over them.
2. Confirm the target is Local/CI or the registered synthetic-only TEST/Preview target. Use no Firestore access, real/restorable customer data, Production credentials, or real provider side effects.
3. Implement one coherent vertical change. Keep schema changes committed, reproducible, observable, and reversible or safely forward-fixable.
4. Run the smallest focused checks that cover the changed boundary. Run typecheck/lint/build when the affected code or release boundary warrants it. For a Preview deploy, verify the resolved TEST target and perform one simple health/static-route plus changed-flow smoke check.
5. Update `docs/WORKLOG.md` only for a durable milestone, decision, blocker, or handoff; update a masterplan checkbox only when that listed outcome is actually complete. Commit or push only when requested.

Fast Lane does **not** require a production backup/restore ceremony, a recovery drill, broad hosted proof, database-role credential choreography, exact-head multi-environment replay, repetitive full-suite runs, an exact row ledger, or a formal production preflight. Existing full harnesses remain useful at release/risk boundaries; they are not the entry price for routine development.

### Guarded Lane — protect the actual boundary

Use Guarded Lane for any Firebase/Firestore access; real, restorable, identifying, or linkable personal data; real-data import; authentication/authorization or access-control changes; real secrets or credential/provider activation; payments; live external integrations; enabling live users; Production deploys, writes, configuration, or routing; backup/restore; shared-target destructive resets; irreversible/destructive actions; or cutover.

Before the guarded action, read `docs/PRODUCTION-SAFETY.md` and the relevant environment/runbook docs. State the exact target, authority, data impact, expected bounds, stop conditions, verification, and rollback/forward-recovery path. Obtain the explicit approval required there. Apply backup, restore, reconciliation, freeze, and protected-operator controls only where the real-data/Production/destructive boundary requires them.

When uncertain, ask: **Can this reach Firestore, real people or their data, live users or money, Production configuration, or cause irreversible loss?** If no and isolation is verified, use Fast Lane. If yes, use Guarded Lane.

## Lightweight session workflow

- Read this file and run `git status` first. Read only the masterplan/worklog/domain docs relevant to the task; Guarded work must also read the safety and environment guidance.
- Prefer complete vertical batches over sessions split by schema/contract/repository/handler/client layer. Do not repeat the full verification matrix after each layer.
- The masterplan is the migration/security/release roadmap, not a blocker for isolated Fast Lane product work. Historical worklog entries and completed checkpoint evidence stay valid but do not create new default ceremony.
- Never commit directly to `main`. Do not commit, push, deploy, or mutate a remote target unless the task authorizes that action.

## Stack

- Next.js 15.5 (App Router) with React 18; legacy UI is still mostly JavaScript, while new core/server code is strict TypeScript. The masterplan later targets the current supported Next 16.x line.
- Tailwind 3 + shadcn/ui (`components/ui/`)
- Firebase Auth + Firestore client SDK today. The planned target is Supabase Postgres/Auth via one rehearsed migration, conditional on cost approval and staging proof; Firestore remains authoritative until the controlled cutover.
- Resend for email (`/api/send`, `/api/cancel`), deployed on Vercel (project `gioia-beauty`)

## Commands

```bash
npm run dev      # dev server on :3000
npm run build    # production build — use for affected runtime/release boundaries
npm run lint     # ESLint
```

The `refactor` branch fails closed from Production Firebase in Local/Test/Preview and has a complete local Supabase/test foundation. Interactive tests must use named synthetic fixtures and the registered non-production target. The live `main` deployment still uses Production Firebase and is unchanged by refactor-branch work.

## Hard rules

1. **Make visual intent explicit.** Internal refactors preserve current output. Intentional UI/copy/product changes are Fast Lane in code/Preview and get focused visual/interaction checks; their Production deployment is still Guarded.
2. **Be stingy with database operations.** Never add unbounded queries/listeners/prefetches. Every query has a date range, cursor, aggregate, or hard limit. Exact expected/observed read-write counts are mandatory for Firestore, real-data, production, migration, and cost-sensitive work; focused bounds assertions are enough for ordinary synthetic Supabase development.
3. **Keep logic out of components.** The UI will be redesigned soon. Business logic (slot math, date handling, validation) belongs in `lib/` as pure functions; components render state and call actions. A change to booking rules should never require touching JSX.
4. **Boring, simple code.** Small files (≤ ~300 lines), one canonical path per operation, no clever abstractions, no new hand-rolled caches — ever. Prefer deleting code to adding it.
5. **Don't commit secrets.** No API keys in source (there's history here too). Env vars only; update `.env.example` when adding one.
6. **Match planning to risk.** A brief intent is enough for ordinary cross-cutting Fast Lane work. Formal preflight and recovery planning belongs at Guarded boundaries.

## Production-change safety (mandatory)

Read `docs/PRODUCTION-SAFETY.md` before Guarded work. Ordinary synthetic Local/TEST schema and application iteration follows the Fast Lane rules above.

- Classify every action as `[LOCAL]`, `[TEST]`, `[REMOTE-CONFIG]`, `[PROD-READ]`, `[PROD-APP]`, `[PROD-CONFIG]`, `[PROD-DATA]`, or `[DESTRUCTIVE]` based on what it can reach—not where it runs.
- Routine `[TEST]` schema/application work and Preview deploys are Fast Lane after the target and synthetic-data boundary are verified. Do not execute `[REMOTE-CONFIG]` or any production-labelled action without Victor's explicit approval for that exact action after showing target, data impact, expected reads/writes/rows, verification, and rollback.
- Production migrations require a current backup, proven restore, staging rehearsal, dry-run reconciliation, idempotent tooling, stop conditions, and a written recovery path.
- Local/normal-CI/Preview must fail closed if they resolve production credentials or project IDs. Production credentials never belong in `.env.local`, Preview, source, scripts, or client bundles; the only exception is the dedicated manually approved, short-lived production-operator environment defined in the safety policy.
- Migration scripts default to dry-run and refuse ambiguous/inferred production targets. No production schema edit is made ad hoc in a provider dashboard.

## Architecture map (current, warts included)

```
app/            routes; layout.js wraps EVERYTHING in AppointmentProvider (known problem)
  api/          send, cancel (email via Resend), test (delete-me)
  dashboard/    admin SPA — renders components/dashboard/Dashy.jsx (1,767-line god component)
components/     booking/, dashboard/, layout/, common/, ui/ (shadcn) + loose root-level strays
context/        AppointmentContext (1,019 lines), NotificationContext, ThemeContext
hooks/          TWO parallel families: useX (dead code — verified unimported) and useOptimizedX (canonical)
lib/firebase/   config, dataManager (926 lines, main data access), vacations, subscribers
lib/cache/      hand-rolled caches (queryCache, appointmentCache) — do NOT extend; slated for deletion
lib/utils/      timeUtils, dateUtils, constants, validationSchemas (zod — the canonical schemas)
data/           12 xxxData.js files = the services/price catalog
scripts/        one-off newsletter migration scripts (not part of the app)
```

Target architecture and relational tables are defined in `docs/MASTERPLAN.md` and `docs/DATA-MODEL.md`. Do not implement a canonical Firestore model first; the plan performs one Firestore → Supabase transition.

## Known landmines (verified, don't rediscover them the hard way)

- **`selectedDate` has 3 formats at rest** (date string, ISO string, Firestore Timestamp) plus JavaScript `Date` in memory/cache. Runtime normalization branches handle this in several places. **Exact formats and ETL rules: `docs/DATA-MODEL.md`** — read it before touching appointment data.
- **Three booking-submission implementations exist**: `hooks/useBookingForm.js` (`submitBooking` — believed dead), `components/booking/BookAppointment.jsx` (the real public path), `components/dashboard/Dashy.jsx` (admin path). Each has its own `calculateEndTime` copy. If you touch booking, check all three.
- **The "transaction" in `dataManager.createAppointmentSafe` does not prevent double-booking** — its conflict check queries outside the transaction's read set. Don't trust it; don't replicate the pattern.
- **Zod schemas are duplicated**: the canonical ones live in `lib/utils/validationSchemas.js`; `useBookingForm.js` has a divergent inline copy (no email trim/lowercase). This many-validators-none-authoritative pattern let real production email failures through — always prefer the canonical schemas.
- **Admin "time blocks" are stored as fake appointments** in the `customers` collection — code iterating appointments must expect entries without a real customer/email.
- **Email sending is fire-and-forget from the client** with failures swallowed by `console.warn`. `/api/send` and `/api/cancel` accept unvalidated input (hotfix planned in Phase 0).
- `enableRealTime` / `autoRefresh` flags are deliberately `false` to control Firestore reads. Don't switch them on.
- Timezone is implicit; the business runs on **Europe/Rome**. Be suspicious of any `toISOString().split("T")[0]` date math near midnight/DST.

## Domain glossary

- **Appointment** = a booking, stored in the Firestore `customers` collection (yes, the collection is misnamed).
- **Appointment type / variant** = a service (e.g. Manicure) and its booking option; defined in `data/*Data.js`, aggregated by `lib/utils/constants.js` into `APPOINTMENT_TYPES`.
- **Vacation** = salon closure period (`vacations` collection); booking must be impossible inside one.
- **Extra time** = buffer minutes appended after a service; included in the stored end time.
- Business hours live in `lib/utils/constants.js` (`BUSINESS_HOURS`); open Mon–Fri (varying hours), closed Sat + Sun.

## Risk-proportionate verification before "done"

**Fast Lane:** run focused tests for the changed behavior; add typecheck/lint/build only when affected; verify a versioned migration with a clean local rebuild or focused database assertion; and use one simple smoke check after a Preview deploy. Confirm no production target, secret, personal data, or real provider side effect was reachable.

**Guarded Lane:** verify the actual security/privacy/production boundary with the applicable negative tests, exact bounds, reconciliation, backup/restore evidence, deployment smoke, and recovery path from `docs/PRODUCTION-SAFETY.md`. Do not substitute a broad unrelated test matrix for boundary proof.

For both lanes: no new unbounded query/listener, no logs containing personal data, and no claim of completion without the relevant checks. Existing CI, migrations, fail-closed environment checks, least-privilege roles, database constraints, and completed milestone evidence remain valid; this policy changes default ceremony, not technical protections or history.
