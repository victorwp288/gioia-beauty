# AGENTS.md — Gioia Beauty

Guidance for AI agents (and humans) working in this repo. Read this before writing code.

## What this is

Production website + booking system for **Gioia Beauty**, a real beauty salon in Roveleto di Cadeo, Italy (live at https://www.gioiabeauty.net). Public site (services, gallery, contacts, booking) + admin dashboard (`/dashboard`) used daily by the owner. Content and UI copy are in **Italian**.

This is a real business, not a demo: bugs lose bookings, and Firestore reads cost real money.

## Session workflow (mandatory)

**At session start:**
1. Read this file, then the newest entry in `docs/WORKLOG.md` — its "Next" line is usually your task.
2. Check `docs/MASTERPLAN.md` for the current phase (first phase with unchecked boxes).
3. `git checkout refactor && git pull` — **all work happens on the `refactor` branch.** Never commit to `main`; merging to `main` happens only via PR reviewed by Victor. *Sole exception:* urgent production fixes explicitly marked as hotfixes in the masterplan (e.g. the Phase 0 email hotfix) go on a `hotfix/<name>` branch cut from `main` and PR straight to `main`; afterwards merge `main` back into `refactor`.

**At session end (do not skip, even if the task is unfinished):**
1. Verify: `npm run build` passes; the affected flow works (see checklist at the bottom).
2. Tick completed `- [ ]` items in `docs/MASTERPLAN.md` (`- [x]`) — this is the at-a-glance progress tracker. Tick only what is actually done and verified; partial work stays unchecked and goes in the worklog instead.
3. Append an entry to `docs/WORKLOG.md` (template at the top of that file). The "Next" line must let a cold session start without archaeology.
4. Commit with a clear message (prefix with the phase, e.g. `phase-1: move booking writes server-side`) and **push to `origin/refactor`**.

Small, coherent commits over one mega-commit — Victor reviews the branch diff before merging. If you discover something out of scope, note it in the worklog's Gotchas rather than fixing it opportunistically.

## ⚠️ Read the masterplan first

**`docs/MASTERPLAN.md` governs all refactor work.** It contains the audited problem list, the target architecture, and 8 sequenced phases. Before making a change, find which phase it belongs to and follow that phase's checklist. Don't freelance improvements that skip the sequence (e.g. don't start renaming files before the security phase is done).

## Stack

- Next.js 14 (App Router), **JavaScript** today. From masterplan Phase 1 onward, *new* files are TypeScript (a minimal strict `tsconfig` lands at the start of Phase 1); *converting existing* `.js`/`.jsx` files is Phase 2 — don't convert ahead of that phase.
- Tailwind 3 + shadcn/ui (`components/ui/`)
- Firebase: Auth + Firestore, **client SDK** (server-side data layer is planned, Phase 1)
- Resend for email (`/api/send`, `/api/cancel`), deployed on Vercel (project `gioia-beauty`)

## Commands

```bash
npm run dev      # dev server on :3000
npm run build    # production build — run before considering any change done
npm run lint     # eslint (next lint)
```

There are no tests yet — Vitest arrives with masterplan Phase 3 (slot-logic extraction), CI with Phase 5. Until then, verification = `npm run build` + manually exercising the affected flow. Once `npm test` exists, run it too.

## Hard rules

1. **Public UI is pixel-frozen.** Do not change the visual appearance of any public page. Only the admin dashboard may change visually, and only as part of masterplan Phase 7. Internal refactors must render identically.
2. **Be stingy with Firestore reads/writes.** History: this project once had a runaway read-cost problem. Never add unbounded queries (every query gets a date range or limit), never add Firestore listeners on public pages, never "optimize" by prefetching extra days/collections, count with `getCountFromServer` — not by fetching docs. If your change alters how often or how much the app reads, say so explicitly.
3. **Keep logic out of components.** The UI will be redesigned soon. Business logic (slot math, date handling, validation) belongs in `lib/` as pure functions; components render state and call actions. A change to booking rules should never require touching JSX.
4. **Boring, simple code.** Small files (≤ ~300 lines), one canonical path per operation, no clever abstractions, no new hand-rolled caches — ever. Prefer deleting code to adding it.
5. **Don't commit secrets.** No API keys in source (there's history here too). Env vars only; update `.env.example` when adding one.
6. **Plan first for anything non-trivial.** The owner of this repo prefers a written plan/iteration before code changes.

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

## Known landmines (verified, don't rediscover them the hard way)

- **`selectedDate` exists in 4 formats in the DB** (date string, ISO string, Date, Firestore Timestamp). Runtime normalization branches handle this in several places. Don't add a fifth format; new writes should follow whatever the masterplan's canonical model says at the current phase.
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

1. `npm run build` passes.
2. The public booking flow still works end-to-end (pick service → date → slot → submit) and the site looks unchanged.
3. No new unbounded Firestore queries or listeners; state how many reads/writes your change adds per user action.
4. No console.log with personal data (names, emails, phone numbers).
5. If you touched anything in the masterplan's scope, tick the corresponding checklist item in `docs/MASTERPLAN.md`.
