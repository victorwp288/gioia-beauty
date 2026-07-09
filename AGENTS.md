# AGENTS.md — Gioia Beauty

Guidance for AI agents (and humans) working in this repo. Read this before writing code.

## What this is

Production website + booking system for **Gioia Beauty**, a real beauty salon in Roveleto di Cadeo, Italy (live at https://www.gioiabeauty.net). Public site (services, gallery, contacts, booking) + admin dashboard (`/dashboard`) used daily by the owner. Content and UI copy are in **Italian**.

This is a real business, not a demo: bugs lose bookings, and Firestore reads cost real money.

## Session workflow (mandatory)

**At session start:**
1. Read this file, then the newest entry in `docs/WORKLOG.md` — its "Next" line is usually your task.
2. Check `docs/MASTERPLAN.md` for the current phase (first phase with unchecked boxes).
3. Run `git status --short --branch` first. If the tree is dirty, preserve the user's work and do not checkout/pull over it. If clean, `git checkout refactor && git pull`. Never commit directly to `main`; reviewed hotfix PRs and phase PRs are the only path to production.
4. Declare the task's blast-radius label, environment/target, and data impact using `docs/PRODUCTION-SAFETY.md` before running DB/auth/deploy/provider commands.

**At session end (do not skip, even if the task is unfinished):**
1. Run the applicable verification checklist. App/runtime changes require a passing build; documentation-only work may record a pre-existing unchanged build failure. Before isolation, do not open the app merely to satisfy manual-flow verification.
2. Tick completed `- [ ]` items in `docs/MASTERPLAN.md` (`- [x]`) — this is the at-a-glance progress tracker. Tick only what is actually done and verified; partial work stays unchecked and goes in the worklog instead.
3. Insert the newest entry below the divider in `docs/WORKLOG.md` (template at the top). The "Next" line must let a cold session start without archaeology.
4. Commit with a clear phase-prefixed message. Push only coherent work. Until environment isolation is complete, DB-aware work must not create a Preview deployment that can reach production; documentation-only pushes are safe.

Small, coherent commits over one mega-commit — Victor reviews the branch diff before merging. If you discover something out of scope, note it in the worklog's Gotchas rather than fixing it opportunistically.

## ⚠️ Read the masterplan first

**`docs/MASTERPLAN.md` governs all refactor work.** It contains the audited problem list, target architecture, production labels, nine sequenced implementation phases, and optional future work. Before making a change, find which phase it belongs to and follow that phase's checklist. Don't freelance improvements that skip the sequence.

## Stack

- Next.js 14 (App Router), **JavaScript** today. The masterplan patches it immediately and later targets the current supported Next 16.x line. New core/server files are strict TypeScript after the Phase 1 compatibility gate; legacy code is deleted/consolidated before surviving files are converted.
- Tailwind 3 + shadcn/ui (`components/ui/`)
- Firebase Auth + Firestore client SDK today. The planned target is Supabase Postgres/Auth via one rehearsed migration, conditional on cost approval and staging proof; Firestore remains authoritative until the controlled cutover.
- Resend for email (`/api/send`, `/api/cancel`), deployed on Vercel (project `gioia-beauty`)

## Commands

```bash
npm run dev      # dev server on :3000
npm run build    # production build — run before considering any change done
npm run lint     # eslint (next lint)
```

**Current safety warning:** Phase 1's first fail-closed gate now forces the legacy Firebase client to loopback emulators in Local/Test/Preview and rejects production targets/credentials. Root hooks still auto-fetch, so do not open the app merely for smoke testing until the named local services and synthetic fixtures are running. The live `main` deployment remains on production Firebase and is unchanged by refactor-branch work.

Vitest route, client, and environment tests now exist; Testing Library, Playwright, local Supabase, and CI still land in Phase 1 before database/auth implementation. Until local backing services and fixtures exist, do not manually exercise the app; it will fail against missing loopback services. Static verification is lint/build/unit tests. After the full test foundation lands, run the affected unit/integration/E2E set.

## Hard rules

1. **Public UI is pixel-frozen.** Internal refactors must render identically. Owner-approved public SEO/content additions are isolated in Phase 7; the admin dashboard may change visually only in Phase 8.
2. **Be stingy with database operations.** Never add unbounded queries/listeners/prefetches. Every query has a date range, cursor, aggregate, or hard limit. State expected reads/writes/rows per user action and verify them. During the transition, Firestore rules still apply; after cutover, equivalent bounded-query discipline applies to Postgres.
3. **Keep logic out of components.** The UI will be redesigned soon. Business logic (slot math, date handling, validation) belongs in `lib/` as pure functions; components render state and call actions. A change to booking rules should never require touching JSX.
4. **Boring, simple code.** Small files (≤ ~300 lines), one canonical path per operation, no clever abstractions, no new hand-rolled caches — ever. Prefer deleting code to adding it.
5. **Don't commit secrets.** No API keys in source (there's history here too). Env vars only; update `.env.example` when adding one.
6. **Plan first for anything non-trivial.** The owner of this repo prefers a written plan/iteration before code changes.

## Production-change safety (mandatory)

Read `docs/PRODUCTION-SAFETY.md` before any database, auth, migration, deployment, DNS, email-provider, environment-variable, backup, or restore work.

- Classify every action as `[LOCAL]`, `[TEST]`, `[REMOTE-CONFIG]`, `[PROD-READ]`, `[PROD-APP]`, `[PROD-CONFIG]`, `[PROD-DATA]`, or `[DESTRUCTIVE]` based on what it can reach—not where it runs.
- Do not execute `[REMOTE-CONFIG]` or any production-labelled action without Victor's explicit approval for that exact action after showing target, data impact, expected reads/writes/rows, verification, and rollback.
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

## Verification checklist before "done"

1. `npm run build` passes for application/runtime changes. For documentation-only work, record any pre-existing unchanged failure explicitly.
2. After isolation, the affected public booking flow works end-to-end in the named Local/Test environment and the site looks unchanged. Before isolation, use static/build verification only unless a Production action was explicitly approved.
3. No new unbounded database queries/listeners; state expected and observed reads/writes/rows per user action.
4. No console.log with personal data (names, emails, phone numbers).
5. If you touched anything in the masterplan's scope, tick the corresponding checklist item in `docs/MASTERPLAN.md`.
6. State blast-radius labels, target environment/project, data impact, production actions (`none` if none), and rollback/next safe action in `docs/WORKLOG.md`.
