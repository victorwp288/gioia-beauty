# Gioia Beauty — Refactor Masterplan

> From CS-student side project to a serious small-business website (and portfolio piece).
> Written 2026-07-08. No code has been changed yet — this document is the plan.
>
> **Progress tracking:** the `- [ ]` checkboxes below are the single source of truth for progress — tick them (`- [x]`) only when an item is done *and verified*. Session-by-session detail lives in `docs/WORKLOG.md`; workflow rules live in `AGENTS.md`. All work happens on the `refactor` branch (sole exception: items marked 🚨 HOTFIX ship via `hotfix/*` branches off `main`).

---

## 1. Where we are today

**Stack:** Next.js 14 (App Router) · JavaScript (no TS) · Tailwind 3 + shadcn/radix · Firebase (Auth + Firestore, client SDK) · Resend (email) · Vercel (hosting, Analytics, Speed Insights).

**Scale:** ~21k lines across ~103 JS/JSX files. One public site (services, gallery, contacts, booking) + an admin dashboard (appointments, vacations, newsletter subscribers).

### What's actually good already
- SEO foundations are surprisingly solid: rich `metadata` in `app/layout.js`, JSON-LD `BeautySalon` schema, `sitemap.js`, `robots.js`, Google/Bing verification.
- shadcn/ui component structure in `components/ui/` is the right pattern.
- Zod is already a dependency (barely used, but the right tool is in the house).
- Cookie banner exists; Vercel Analytics is cookieless — decent GDPR starting point.

### The damage report (found during audit)

**🚨 ACTIVE PRODUCTION INCIDENT (found via Vercel runtime logs, 2026-07-08)**
`/api/send` has failed **31 times since February** (3 affected users, most recent occurrence *today*) with Resend 422: *"Invalid `to` field"*. Real customers have booked and silently received no confirmation email — every failure was swallowed by a `console.warn`. Confirmed facts: three different client components (`useBookingForm.js:176`, `BookAppointment.jsx:296`, `Dashy.jsx:629`) each build their own email payload, and the API route validates nothing before calling Resend. Most likely entry point (to confirm while fixing): admin-created appointments in Dashy, whose email field can be empty/malformed and is posted unguarded. **This gets a hotfix before any refactor — see Phase 0.**

**🔴 Security / correctness**
1. **All Firestore reads/writes happen client-side** (`hooks/`, `lib/firebase/`, even `components/NewsletterSignup.jsx` calls `addDoc` directly). The entire security model rests on Firestore rules — which, since guests can create appointments, are almost certainly wide open on the `customers` collection. Anyone can read/modify/delete bookings from the browser console.
2. **Booking has no real conflict enforcement — the "transaction" is an illusion.** `dataManager.createAppointmentSafe()` wraps the write in `runTransaction`, but the conflict check inside it (`checkTimeConflicts` → `getAppointmentsByDate`) is a regular query **outside the transaction's read set** — Firestore client transactions only protect documents read via `transaction.get()`, and this query can even be served from the local cache with stale data. Classic TOCTOU: two users booking simultaneously can still double-book. A second submission path, `useBookingForm.submitBooking()`, has a `runTransaction` containing a single `set()` and **no conflict check at all**.
3. **`/api/send` and `/api/cancel` are unauthenticated and unvalidated.** Anyone can POST and send arbitrary-ish emails from `noreply@gioiabeauty.net` — a spam/reputation risk for the domain.
4. **`/dashboard` is protected only client-side** (`onAuthStateChanged` redirect in `app/dashboard/page.jsx`). No middleware, no server check. Data protection again falls back to (likely open) Firestore rules.
5. **`repomix-output.txt` (2.1 MB, full codebase dump) is committed** to a public GitHub repo. `scripts/` contains hardcoded API keys for *three different* Firebase projects. Firebase web keys are public-by-design, but this is sloppy and the scripts' keys/projects need review.
6. **PII is logged** (names, emails) via `console.log` in API routes; test route `/api/test` echoes arbitrary input in production.

**🔴 Booking data model (the "wonk and glue")**
- `selectedDate` exists in **four formats** in the database — date-only string, ISO string, JS `Date`, and Firestore `Timestamp` — and `lib/firebase/dataManager.js:362-374` normalizes all four at runtime on every read. This is the root cause of most of the glue code.
- `startTime`/`endTime` are separate `"HH:mm"` strings, computed **client-side** in `useBookingForm.js` from duration + `extraTime`, then stored denormalized. Nothing recomputes them if a service duration changes.
- Timezone is implicit everywhere (`new Date(...)`, `toISOString().split("T")[0]`) — the salon runs on Europe/Rome, the code runs on UTC-ish. Off-by-one-day bugs around midnight/DST are latent, not hypothetical.
- The booking flow spans `useBookingForm` → `AppointmentContext` → `appointmentHook` → `dataManager` → Firestore, with caching layers interleaved — five hops for one insert.
- Past appointments: there's a `status` field and range queries, but no defined lifecycle (what marks an appointment completed?) and no retention policy. Old bookings must stay viewable/editable — today they just accumulate.
- **Three independent booking-submission implementations**: `useBookingForm.submitBooking` (apparently dead — `BookAppointment` imports the hook but ships its own `handleSubmit`), `BookAppointment.jsx`, and `Dashy.jsx` — each with its own copy of `calculateEndTime`, its own date-formatting IIFE handling the four `selectedDate` formats, and its own hand-built `/api/send` payload. The inline Zod schema in `useBookingForm` also duplicates (and diverges from — no trim/lowercase) the proper `emailSchema` in `lib/utils/validationSchemas.js`. This class of divergence — several validation paths, none authoritative — is what let the production 422s through.
- Admin "block time" entries are stored as fake appointments in the `customers` collection — the model needs a first-class `type: "block"` (or a separate concept) instead.
- The booking min-date rule (`new Date(new Date().setHours(0,0,0,0) + 86400000)`) is evaluated **once at module load** — a browser tab left open across midnight validates against yesterday's boundary. The "no same-day booking" business rule deserves to be an explicit named constant, not arithmetic in a schema.

**💸 Firestore read/write waste (the scar tissue is visible)**
The code is full of battle scars from the excessive-reads era: `enableRealTime: false // DISABLED: Reduce Firebase reads`, disabled auto-refresh, "smart date ranges", and a hardcoded `if (appointments.length < 1614)` sanity check. But structural read-bombs remain:
- **`AppointmentProvider` wraps the entire public site** in `app/layout.js` — every visitor to the gallery or contacts page mounts the whole appointment/vacation machinery, and the vacations hook auto-fetches on mount. Booking machinery should exist only on the booking page.
- **Dashboard's `fetchAllAppointments` loads the entire collection** (1,600+ docs = 1,600+ billed reads per invocation). (Credit where due: the total count already uses `getCountFromServer` aggregation, and `getAppointments` throws without a `dateRange` — the discipline exists, but the "load all" path bypasses it.)
- **Slot preloading fires up to 7 extra per-day appointment queries** every time a user picks a date (`useOptimizedTimeSlots` preload loop) — an "optimization" that multiplies reads.
- **`/export` reads every collection in full, client-side** — and is only client-side auth-gated like the dashboard.
- Availability requires shipping raw appointment documents (with other customers' PII!) to every booking visitor's browser, because slot math runs client-side.
- Newsletter signup is an unauthenticated client-side `addDoc` — anyone can script unlimited writes (cost attack + garbage data).

**🟣 Domain, email & headers (checked live, 2026-07-08)**
- **`_dmarc.gioiabeauty.net` has TWO DMARC records** — this makes DMARC invalid and receivers ignore it completely. One is a leftover from Brevo. Even once fixed, `p=none` means no enforcement against spoofing.
- Leftover `brevo-code` TXT record on the root domain (legacy newsletter setup — dead config to clean up).
- No SPF record visible on the root domain; Resend presumably authenticates via its own subdomain CNAMEs — needs verification in the Resend dashboard.
- HTTPS/SSL itself is fine (Vercel-managed cert, HSTS with 2-year max-age, HTTP/2). But no CSP, no `X-Frame-Options`, no `Referrer-Policy`, and `access-control-allow-origin: *` on responses — the headers hardening in Phase 6 is confirmed necessary.

**🔵 Platform (Vercel) — checked via API, 2026-07-08**
- Project `gioia-beauty` is healthy: Node 22, apex + www domains attached, latest production deploy READY. Verify apex→www redirect is configured one way (both are attached).
- The runtime error log surfaced the `/api/send` incident above — proof the monitoring gap is real: errors sat in Vercel logs for 5 months with nobody looking. Sentry (Phase 4) exists precisely for this.
- Account clutter: a stale `gioia-beauty-astro` project (old experiment, created 2024) still exists — archive/delete it so deploys and env vars can't be confused between the two.
- No `vercel.json` / project misconfig found; env vars (e.g. `RESEND_API_KEY`) should be re-audited when `.env.example` lands in Phase 0.

**🟠 Maintainability**
7. **Two parallel data layers.** `useAppointments` / `useTimeSlots` / `useVacations` AND `useOptimizedAppointments` / `useOptimizedTimeSlots` / `useOptimizedVacations`, plus `useFirestore`, plus `lib/firebase/dataManager.js` (926 lines). Nobody (including future-you) knows which one is canonical.
8. **Hand-rolled caching/perf infrastructure** — `lib/cache/queryCache.js` (667 lines), `lib/cache/appointmentCache.js` (549), `lib/utils/performance.js` (673). This is a home-made, buggier TanStack Query.
9. **God components:** `Dashy.jsx` (1,767 lines), `AppointmentContext.jsx` (1,019), `BookAppointment.jsx` (753), `NotificationContext.jsx` (754).
10. **Dependency bloat / duplication:** `twilio` (unused), `react-modal` + `vaul` + Radix Dialog (3 modal systems), `react-datepicker` + `react-day-picker` (2 date pickers), `react-icons` + `lucide-react` (2 icon sets), `firebase-admin` in prod deps but only used by scripts.
11. **`react-scan` (a dev profiling tool) is a production dependency and is rendered in the root layout** — shipping to every visitor.

**🟡 Hygiene**
12. No TypeScript, no tests, no CI, no Prettier config, empty `next.config.mjs`, README is the untouched create-next-app template, no `.env.example`.
13. 12 near-identical `data/*Data.js` service files with no schema validation — price-list updates (see commit "Nuovo listino") are manual and error-prone.
14. No database backups. If Firestore data is fat-fingered in the dashboard, it's gone.

---

## 2. Guiding decisions

These are the "re-evaluate frameworks/services" calls. Recommendation first, rationale after.

| Area | Decision | Rationale |
|---|---|---|
| Framework | **Keep Next.js**, upgrade 14 → 15 (React 19) mid-plan | App Router is fine; migration cost elsewhere would be pure waste. Upgrade after TS migration so types catch breakage. |
| Hosting | **Keep Vercel** | Free tier fits traffic; preview deploys become part of CI. |
| Database | **Keep Firestore for now**; move all access server-side | A Postgres/Supabase migration is *deferred* (Phase 8, optional). The real problem isn't Firestore — it's client-side access with open rules. Fix the architecture first; a DB swap later becomes a contained change behind the new data layer. |
| Auth | **Keep Firebase Auth**, add server-side session verification (middleware + session cookies) | One admin user; don't add Auth.js complexity for that. |
| Email | **Keep Resend** | Works, cheap, has EU sending. Just add auth + validation + idempotency around it. |
| SMS | **Drop Twilio** (unused) | If reminders are ever wanted, re-add deliberately. |
| Data fetching | **TanStack Query** replaces `lib/cache/*`, `lib/utils/performance.js`, and both hook families | Deletes ~2,500 lines of hand-rolled cache for a battle-tested library. Biggest single maintainability win in the repo. |
| Language | **TypeScript, strict, incremental** | `allowJs: true`, migrate leaf → core. |
| Error tracking | **Sentry** (EU data residency, free tier) | Purpose-built, generous free tier, first-class Next.js SDK. |
| Metrics/logs | **Vercel Analytics + Speed Insights (already in) + structured logs (pino) → Vercel log drain to Axiom free tier if needed.** **Skip Datadog** | Datadog is priced for companies with SREs; for a salon site it's cost + GDPR surface for zero benefit. |
| Uptime | **UptimeRobot / BetterStack free tier** pinging `/` and a `/api/health` endpoint | The owner should hear about downtime before her clients do. |
| UI kit | **Keep Tailwind + shadcn**; consolidate to Radix-only overlays, `react-day-picker`-only calendar, `lucide-react`-only icons | Public UI stays pixel-identical (constraint); we only swap internals where rendering is equivalent. |
| Testing | **Vitest + Testing Library** (unit) · **Playwright** (E2E booking flow) | Time-slot math is the highest-risk pure logic — perfect unit-test target. |
| CI | **GitHub Actions**: lint, typecheck, test, build on every PR | Repo already on GitHub. |

### Architecture principles (how we write the new code)

These apply to every phase. The goal: code a human can review in one sitting and an LLM can safely modify without archaeology.

1. **Headless core, replaceable shell.** The UI *will* change soon. All booking/availability/vacation/subscriber logic lives in `lib/` as pure functions and in typed hooks/server endpoints — components only render state and dispatch actions. The test of success: a full redesign should touch `components/` and `app/` only.
2. **One canonical path per operation.** One way to read appointments, one way to create them, one place where a rule (e.g. "slots are 15-min aligned") is encoded. Duplication is the current codebase's disease; the linter for it is code review + `knip`.
3. **Boundaries validate, interiors trust.** Zod at every I/O edge (API requests, Firestore reads, form submissions). Past the boundary, functions take typed domain objects and never re-check. This deletes the defensive normalization glue (the 4-format `selectedDate` dance) instead of centralizing it.
4. **Boring > clever.** No custom caches, no hand-rolled debounce/memo frameworks, no premature abstraction. Prefer a 20-line explicit function over a 5-line clever one. Small files (≤ ~300 lines), named exports, colocated tests.
5. **Self-describing for LLMs and humans:** consistent naming (`getX`/`createX`/`cancelX`), JSDoc only where a type can't express intent, `CLAUDE.md` describing the architecture and its invariants, ADRs for the non-obvious decisions. No dead code kept "just in case" — git remembers.
6. **Net-negative LOC is a feature.** Target ~21k → ≤ 14k lines. Every phase should delete more than it adds (Phase 3 alone removes ~2,500 lines of cache code).
7. **Treat Firestore reads/writes as billable events — because they are.** The excessive-reads trauma is legitimate; the cure is structural, not more client-side caching:
   - **No unbounded queries, ever.** Every query has a date range or a limit. `fetchAllAppointments`-style "load everything" disappears; the dashboard paginates per view (day/week/month).
   - **Availability is computed server-side and returns slots, not documents.** One request = one small response; visitors never receive (or pay reads proportional to) raw appointment docs. The server caches per-day availability briefly and invalidates on booking writes — one cache, server-side, instead of three client-side ones.
   - **Counts via `getCountFromServer` aggregation** (1 read per 1,000 docs), never by fetching documents to count them.
   - **No client-side Firestore listeners on the public site.** Real-time is opt-in, dashboard-only, and scoped to the visible date range if ever re-enabled.
   - **Guardrail, not vibes:** a GCP budget alert on the Firebase project + a documented expected-usage baseline in `OPERATIONS.md`, so a regression is a notification, not a surprise bill.

### The booking core (target design)

The current five-hop flow (`useBookingForm` → `AppointmentContext` → hook → `dataManager` → Firestore, caches interleaved) collapses to:

```
UI form (react-hook-form + zod)
  → POST /api/bookings                    (zod-validated)
    → lib/booking/availability.ts         (pure: computes free slots from appointments + vacations + business hours)
    → Firestore transaction               (re-check slot, write appointment)
    → email side-effect (Resend)          (after commit; failure logged, never blocks the booking)
```

**Canonical data model** (fixes the wonk at the source; reached via an *additive* migration in Phase 1 — canonical fields added alongside legacy ones, legacy fields dropped in Phase 3 once nothing reads them):

```ts
// Zod schema = single source of truth for type + validation
Appointment {
  id: string
  serviceId: string            // references the typed services catalog
  variantId?: string           // bookingOption within the service
  date: string                 // "YYYY-MM-DD" — calendar day in Europe/Rome, no Timestamp ambiguity
  startMinutes: number         // minutes since midnight local — 570 = 09:30; trivially sortable/comparable
  durationMinutes: number      // includes extraTime, denormalized from catalog AT BOOKING TIME (price-list history stays intact)
  status: "confirmed" | "completed" | "cancelled" | "no_show" | "block"  // "block" = admin time-block; no client, no lifecycle
  client: { name; email; phone; note? }   // absent for blocks; email validated-or-absent, never ""
  createdAt / updatedAt: Timestamp   // server timestamps
}
```

> Exact legacy formats (the four `selectedDate` shapes with examples), field-by-field gotchas, and the dual-field transition rules live in **`docs/DATA-MODEL.md`** — required reading before writing the migration or any transition-era reader.

Decisions encoded here:
- **Local calendar day + minutes-since-midnight** instead of `Timestamp` kills the timezone/DST/off-by-one class of bugs for a single-location business. All date math goes through one `lib/booking/time.ts` module pinned to `Europe/Rome`.
- **Status lifecycle, not deletion.** Cancelling sets `status: "cancelled"`; past appointments stay forever viewable and editable in the dashboard (a business record and a "regulars" history). "Completed" can be set lazily (any confirmed appointment in the past displays as completed) — no cron needed.
- **Availability is a pure function** — `computeFreeSlots(date, appointments, vacations, schedule)` — unit-testable exhaustively, reusable identically by the public booking page, the dashboard, and the server-side transaction check. One implementation, three consumers.
- **History-safe denormalization:** duration/price snapshot onto the appointment at booking time, so editing the price list never corrupts past records.

**GDPR note (site operates in Italy):** Vercel Analytics is cookieless (fine). Sentry must be configured with EU region, `sendDefaultPii: false`, and IP scrubbing. Any future analytics beyond that must be gated behind the existing cookie consent. Appointment data *is* personal data — a short data-retention statement should go in the privacy policy, and old appointments should be prunable.

---

## 3. The phases

Ordered so that each phase is independently shippable, security lands before refactors, and refactors land before the framework upgrade. **Public UI does not change until Phase 7, and even then only the admin dashboard.**

### Phase 0 — Hygiene & quick wins (½–1 day)
*Zero-risk deletions and setup. Do this in one PR — except the hotfix, which ships alone, first.*

- [ ] **🚨 HOTFIX (ship immediately, before everything else):** validate the request body in `/api/send` and `/api/cancel` with the existing `emailSchema` (trim/lowercase/format); skip the customer email cleanly when the address is absent (admin-created bookings legitimately may not have one) while still sending the admin copy; return a distinguishable status so callers stop warn-and-forgetting. Stops the 5-month stream of silently lost confirmation emails. **Branch flow exception:** this ships from a `hotfix/*` branch cut from `main`, PR'd directly to `main` so it reaches production immediately — then merge `main` back into `refactor`. Everything else in this plan rides the `refactor` branch.
- [ ] Archive/delete the stale `gioia-beauty-astro` Vercel project; confirm apex→www redirect direction.
- [ ] Delete `repomix-output.txt`; add it to `.gitignore`. (Consider `git filter-repo` to purge from history since the repo is public.)
- [ ] Remove `<ReactScan />` from `app/layout.js`; move `react-scan` to devDependencies (keep the `npm run scan` workflow).
- [ ] Uninstall `twilio`. Move `firebase-admin` usage audit to Phase 1 (it becomes a real dependency then).
- [ ] Delete `/api/test` route.
- [ ] Move Firebase web config from `lib/firebase/config.js` hardcode to `NEXT_PUBLIC_*` env vars; create `.env.example`; strip hardcoded keys from `scripts/*` (env vars there too).
- [ ] Add Prettier + config; add `lint-staged` + a pre-commit hook (husky or lefthook).
- [ ] Rewrite `README.md`: what the site is, architecture sketch, setup steps, env vars, deploy notes.
- [x] Add `CLAUDE.md` / `docs/` skeleton and this masterplan. *(Done 2026-07-08 in the planning session: AGENTS.md + CLAUDE.md symlink + docs/MASTERPLAN.md + docs/WORKLOG.md.)*
- [ ] Run `knip` (or `npx unimported`) to inventory dead files — *inventory only*, deletion happens in Phase 3 when we know which data layer survives.

**Done when:** repo is clean, documented, and installs from scratch with `.env.example` as the guide.

### Phase 1 — Security & reliability (2–4 days) ⚠️ *highest priority*
*The only phase that matters if the owner's business gets attacked or double-booked.*

- [ ] **Lay down a minimal `tsconfig.json` first** (`strict: true`, `allowJs: true`, replacing `jsconfig.json`) so every *new* file in this phase is born TypeScript — the server data layer, availability logic, and schemas below shouldn't be written in JS only to be migrated a week later. Converting *existing* files remains Phase 2's job.
- [ ] **Write and deploy strict Firestore security rules.** Target end-state: client SDK can read only what the public site genuinely needs (arguably nothing), and can write nothing. Admin dashboard + booking go through the server.
- [ ] **Introduce a server-side data layer**: Next.js route handlers (or server actions) using `firebase-admin`, validated with Zod at the boundary. Endpoints: `POST /api/bookings`, `DELETE /api/bookings/:id`, `GET /api/availability?date=`, newsletter subscribe/unsubscribe, admin CRUD.
- [ ] **Make booking creation transactional**: inside a Firestore transaction, re-check slot availability server-side, then write. Kills the double-booking race.
- [ ] **Migrate appointment documents to the canonical model — additively** (see "The booking core" above): a migration script (run against emulator first) that *adds* canonical `date` + `startMinutes` fields computed from `selectedDate`'s four formats and backfills `status`, while **keeping the legacy fields in place** — the existing client code still reads `selectedDate`/`startTime` until Phase 3 replaces it. New server-side writes populate both shapes during the transition. Legacy fields are dropped by a second, trivial migration at the end of Phase 3 once no reader remains. Old bookings stay fully viewable/editable throughout.
- [ ] **Fix the domain's email authentication**: delete the duplicate/legacy DMARC record (keep exactly one), remove the stale `brevo-code` TXT, verify Resend's SPF/DKIM records in the Resend dashboard, then move DMARC from `p=none` → `p=quarantine` once a couple weeks of reports look clean. (Booking confirmations landing in spam = lost business.)
- [ ] **Protect `/dashboard` server-side**: Firebase session cookies, with the authoritative verification in the server layer (route handlers / server components via `firebase-admin`). Note: `firebase-admin` does **not** run in Edge middleware — if `middleware.ts` is used at all, it does only an edge-compatible JWT check (e.g. `jose` against Google's public certs) or a cheap cookie-presence redirect; it must not be the only gate. Client-side redirect stays as UX sugar only.
- [ ] **Secure the email endpoints**: they become internal calls from the booking endpoints (never client-invoked with raw payloads); add rate limiting (Upstash Ratelimit or Vercel WAF rules) on all public POSTs.
- [ ] **`GET /api/availability` returns computed slots, never appointment documents.** This simultaneously fixes the current GDPR-relevant leak (raw customer docs shipped to every booking visitor's browser for client-side slot math) and caps the read cost of the busiest public query. Server caches per-day availability, invalidated on booking writes.
- [ ] **Dashboard reads go on a diet**: paginated/windowed queries per view instead of `fetchAllAppointments` (1,600+ reads per invocation today); keep totals on `getCountFromServer` aggregation (already the case — don't regress it); kill the 7-day slot-preload loop. Set a GCP budget alert on the Firebase project.
- [ ] Rebuild `/export` as an authenticated server endpoint (admin session required) instead of a client page that full-scans every collection.
- [ ] Stop logging PII; add a `/api/health` endpoint.
- [ ] **Set up backups**: scheduled Firestore export (Cloud Scheduler → GCS bucket), or minimally a documented + cron'd version of the existing export scripts.
- [ ] Rotate/review the three Firebase projects whose keys sat in `scripts/`; delete unused projects.

**Done when:** browser console can no longer touch Firestore; two simultaneous bookings of the same slot produce exactly one appointment; dashboard 401s without a valid session; nightly backup exists.

### Phase 2 — TypeScript migration (3–5 days)
- [ ] Harden the `tsconfig.json` introduced in Phase 1 as migration proceeds (it already exists — Phase 2 converts the *existing* `.js`/`.jsx` files).
- [ ] Define the **domain types first** in `types/`: `Appointment`, `Service`, `BookingOption`, `Vacation`, `Subscriber`, `TimeSlot` — derived from Zod schemas (`z.infer`) so runtime validation and types share one source of truth (some will already exist from Phase 1's server layer).
- [ ] Migrate in dependency order: `lib/utils/` → `lib/firebase/` + API routes → `hooks/` → `context/` → `components/` → `app/`.
- [ ] Convert `data/*Data.js` to a single typed, Zod-validated services catalog at `lib/services/` (its final Phase 3 home — no point moving it twice). This makes the next "nuovo listino" a safe edit.
- [ ] CI gate: `tsc --noEmit` must pass (added in Phase 5's CI, or add a minimal Action now).

**Done when:** zero `.js`/`.jsx` under `app/ components/ hooks/ lib/ context/ data/`; `strict` passes with no `any` escape hatches in the data layer.

### Phase 3 — Data-layer consolidation (3–5 days) 🔥 *biggest LOC reduction*
- [ ] Adopt **TanStack Query**. Delete `lib/cache/queryCache.js`, `lib/cache/appointmentCache.js`, `lib/utils/performance.js`.
- [ ] **Delete the dead legacy hook family outright** — `useAppointments`, `useTimeSlots`, `useVacations`, `useFirestore` are verified unimported (only a commented-out reference in `AppointmentContext.jsx:14`). Then rebuild the surviving `useOptimizedX` family as **one** TanStack Query hook family backed by the Phase 1 API endpoints.
- [ ] Dismantle `AppointmentContext.jsx` (1,019 lines) — most of it becomes queries/mutations; context keeps only genuinely global UI state, if any. (Today it also holds a *shadow copy* of appointment state in a reducer that the context value then overrides with hook state — two sources of truth where most reducer actions are invisible no-ops.)
- [ ] **Remove booking machinery from the root layout** — `AppointmentProvider` currently mounts (and the vacations hook auto-fetches) for every visitor on every page. Booking state lives on the booking page; the gallery page should cost zero Firestore reads.
- [ ] **One booking submission path.** Collapse the three implementations (`useBookingForm.submitBooking`, `BookAppointment.handleSubmit`, Dashy's) into a single `POST /api/bookings` client call; one `calculateEndTime`, one schema (from `lib/validation/`), email sending moved server-side into the endpoint (with the admin/no-email case handled explicitly).
- [ ] Simplify `NotificationContext.jsx` or replace with a small toast wrapper.
- [ ] Extract time-slot computation into pure functions in `lib/booking/` and **unit-test them first** (this is the safety net for the whole phase).
- [ ] Split `Dashy.jsx` into route-level pieces (`app/dashboard/appointments/`, `/vacations/`, `/newsletter/` or component modules) — *structure only, no visual changes yet*.
- [ ] Consolidate duplicate UI libs: one date picker (`react-day-picker`), one icon set (`lucide-react`), Radix-only dialogs/drawers. Only where visually identical; anything visible waits for Phase 7.
- [ ] Delete the dead files inventoried in Phase 0.
- [ ] **Drop the legacy appointment fields** (`selectedDate`, denormalized `startTime`/`endTime` string pair, etc.) with the second migration promised in Phase 1 — only after every reader has moved to the canonical `date` + `startMinutes` model. This closes the dual-field transition window.
- [ ] **File/folder reconsolidation** — end-state layout (moves happen here, when files are already being rewritten, so git history churn is paid once):

```
app/                  # routes only: thin pages, layouts, api/ handlers
  api/                # bookings, availability, newsletter, health
  dashboard/          # split routes: appointments/ vacations/ newsletter/
components/
  ui/                 # shadcn primitives (unchanged)
  booking/            # public booking UI (renders lib/booking state)
  dashboard/          # admin UI
  layout/  common/    # shells, shared bits
lib/
  booking/            # ← the headless core: availability.ts, time.ts, schedule.ts
  services/           # typed, zod-validated services catalog (replaces 12 data/*Data.js)
  db/                 # firebase-admin access, one module per collection
  email/              # resend wrappers + templates
  validation/         # zod schemas (types derive from these)
types/                # z.infer re-exports only
tests/  e2e/          # vitest colocated or here; playwright in e2e/
```

  Root-level strays get absorbed: `components/*.jsx` orphans (`Fields`, `SlimLayout`, `Technologies`, …) into the folders above; `context/` disappears (TanStack Query + a tiny theme provider); `hooks/` shrinks to the single query-hook family; `data/` becomes `lib/services/`.

**Done when:** exactly one way to fetch/mutate each entity; `lib/cache/` gone; no file over ~400 lines; slot logic covered by unit tests; the tree above is real; a component can be deleted without touching `lib/`.

### Phase 4 — Observability (1–2 days)
- [ ] **Sentry** (`@sentry/nextjs`): client + server, EU region, PII scrubbing on, source maps uploaded, release tagging tied to Vercel deploys. Alert rule → email on new issues.
- [ ] Wrap key flows with context: booking submission, email send, dashboard mutations (breadcrumbs, not PII).
- [ ] Structured server logging (pino) replacing stray `console.log`; optionally drain to Axiom.
- [ ] Uptime monitor on `/` + `/api/health`.
- [ ] Replace ad-hoc `ErrorBoundary` usage with Sentry-integrated boundaries; verify `not-found`/error pages report correctly.
- [ ] **Business + SEO monitoring dashboard** (the "can we follow it?" part):
  - **Google Search Console**: verify property (verification tag already exists), submit sitemap — this is where impressions/clicks/index-coverage/Core-Web-Vitals-from-real-users live. Check monthly.
  - **Real-user Web Vitals**: Vercel Speed Insights is already installed — actually look at it; add Sentry's performance/vitals view as the second opinion. Watch LCP/CLS/INP trends, not one-off lab runs.
  - **Booking funnel signal**: count booking-started vs booking-completed (a Vercel Analytics custom event — cookieless, consent-safe). One number that tells the owner the site is doing its job, and tells us if a deploy silently broke the funnel.
  - A `docs/OPERATIONS.md` runbook: where each dashboard lives, what "normal" looks like, what to do when an alert fires.

**Done when:** a thrown error in the booking flow appears in Sentry with a readable stack trace within a minute, downtime triggers an email, and there's one place to answer "how's the site doing this month?"

### Phase 5 — CI/CD & testing (2–3 days)
- [ ] **GitHub Actions**: `lint` + `tsc --noEmit` + `vitest` + `next build` on every PR **and every push to `refactor`** (agents push there without PRs); branch protection on `main`.
- [ ] **Vitest + Testing Library**: unit tests for slot computation (already started in Phase 3), Zod schemas, date/time utils (`timeUtils`, `dateUtils` — 980 combined lines of untested date math today).
- [ ] **Playwright** E2E: the golden path (open site → pick service → pick slot → book → confirmation) against a Firebase emulator or a seeded test project; run on PRs.
- [ ] Dependabot/Renovate for dependency updates.
- [ ] Then: **upgrade Next 14 → 15 / React 19** — now safe, because types + tests + CI catch the breakage.

**Done when:** a PR that breaks booking math or the build cannot merge.

### Phase 6 — SEO & performance polish (2–3 days)
*Foundations are good; this is refinement, not rescue.*

- [ ] Audit and refine per-page `metadata` (gallery, contacts, policy already export their own — *verified* — but review descriptions, per-page OG images, and canonical URLs rather than assuming the defaults are right).
- [ ] Consider `app/servizi/[category]/` static pages per service category — currently services live in one page, so "manicure roveleto di cadeo"-type queries have no dedicated landing page. (Renders existing content/UI; new routes are additive, not a UI change.)
- [ ] `next.config` hardening: security headers (CSP, HSTS, X-Frame-Options), image config, `@next/bundle-analyzer`.
- [ ] Bundle diet: dynamic-import Leaflet/map and gallery lightbox; verify tree-shaking after the Phase 3 dep consolidation; audit `Images.jsx`/`ImagesExports.jsx` for eager-loaded images.
- [ ] Verify JSON-LD against Google Rich Results test; add `Service` schema to new service pages; keep sitemap in sync.
- [ ] **Lighthouse CI in GitHub Actions** with enforced budgets (not a one-off audit): Performance/SEO/Best-Practices/A11y ≥ 90 mobile on `/`, booking page, and one service page; JS budget ≤ ~180 kB gzipped per route; regressions fail the PR. Lab numbers gate merges — the real-user vitals from Phase 4 confirm reality.
- [ ] Font/render pass: `next/font` is in use (good) — verify no CLS from the four loaded families, lazy-load below-the-fold sections, check the hero LCP image is `priority` + properly sized.
- [ ] Register/verify Google Business Profile linkage (biggest real-world SEO lever for a local salon — a task for the owner, document it).
- [ ] **AI/LLM discoverability (GEO — people increasingly ask ChatGPT/Claude/Perplexity "best beauty salon near Cadeo"):**
  - Add `llms.txt` at the root: a concise markdown summary of the business — services, prices, address, hours, booking URL — the emerging convention for LLM crawlers.
  - Explicitly allow reputable AI crawlers in `robots.js` (`GPTBot`, `ClaudeBot`, `PerplexityBot`, `Google-Extended`) — for a local business, being in AI answers is free marketing, not content theft.
  - Make key facts (address, hours, phone, price ranges) plain **server-rendered text**, not just JSON-LD or images — LLMs and answer engines quote what they can read.
  - Add an **FAQ section/page with real questions** ("Quanto costa una manicure?", "Come posso prenotare?", "Dove parcheggio?") + `FAQPage` schema — feeds both Google rich results and AI answers.
  - Keep NAP (name/address/phone) character-identical across the site, Google Business Profile, Instagram bio, and any directory listings — consistency is the #1 local-ranking and AI-citation signal.
  - Bing/IndexNow ping from the sitemap (Bing powers ChatGPT browsing and Copilot).
  - Consider Apple Business Connect (Apple Maps listing) — free, and Siri/Apple Maps pull from it.

**Done when:** Lighthouse ≥ 90 across the board on mobile for `/`, and each service category has an indexable URL.

### Phase 7 — Admin dashboard revamp (3–6 days, the only UI-visible phase)
- [ ] Redesign dashboard UX on the pieces split out in Phase 3: calendar view, appointment list w/ filters, vacation manager, newsletter manager.
- [ ] Add the quality-of-life features the owner actually needs (ask her!): e.g. day/week toggle, quick-cancel with automatic client email, CSV export, appointment notes.
- [ ] Mobile-friendly dashboard (she'll use it from her phone at the salon).
- [ ] Loading/empty/error states via shadcn patterns; delete `LoadingComponents.jsx` sprawl.

**Done when:** the owner says it's better. Genuinely — user-test it with her.

### Phase 8 — Optional / future
- **Supabase/Postgres migration** — only if Firestore starts hurting (relational queries, reporting, cost). After Phase 1+3 the swap is confined to the server data layer. Reassess then; don't pre-build for it.
- SMS/WhatsApp appointment reminders (this is where Twilio would come back).
- Owner-editable price list (simple CMS or dashboard-managed services collection).
- i18n (English) if tourist clientele warrants it.
- Booking modification (reschedule) links in confirmation emails.

---

## 4. Sequencing & effort summary

| Phase | Theme | Effort | Risk to prod | Depends on |
|---|---|---|---|---|
| 0 | Hygiene | 0.5–1 d | none | — |
| 1 | Security & reliability | 4–6 d | medium (rules lockdown must ship with server layer) | 0 |
| 2 | TypeScript | 3–5 d | low | 1 |
| 3 | Data-layer consolidation | 3–5 d | medium | 1, 2 |
| 4 | Observability | 1–2 d | none | 1 |
| 5 | CI/CD & testing (+ Next 15) | 2–3 d | low | 2, 3 |
| 6 | SEO & perf | 2–3 d | low | 3 |
| 7 | Dashboard revamp | 3–6 d | low (admin-only) | 3, 5 |

Total: roughly **4–5 weeks** of focused part-time work. Phases 4 and 6 can be shuffled freely; 0→1→2→3 is the load-bearing spine.

Note on Phase 1 sizing: it's deliberately the heaviest phase — security rules, the server data layer, and the additive data migration must land together (rule 4 below), so it doesn't split well. If it needs cutting, the DNS/email items and backups can trail as a fast follow; the rules+server-layer+transaction trio cannot.

**Rules of engagement**
1. All work accumulates on the **`refactor` branch**; Victor merges `refactor` → `main` via PR at phase boundaries (or whenever a coherent chunk is approved), so `main` stays deployable at every merge. Sole exception: urgent production fixes (the Phase 0 email hotfix) ship on a `hotfix/*` branch cut from `main`, then `main` is merged back into `refactor`.
2. Public UI is pixel-frozen through Phase 6 (screenshot-diff spot checks when touching shared components).
3. The booking flow gets manually smoke-tested on the production site after every deploy until Playwright covers it.
4. Firestore rules lockdown (Phase 1) deploys in the same release as the server data layer — never before, never after.
5. Anything involving the owner's live data (backups, rules, migrations) gets tested against the Firebase emulator or a scratch project first.

## 5. Success metrics
- **Security:** Firestore inaccessible from browser console; all public POSTs rate-limited; zero secrets in repo (verify with `gitleaks`); dashboard 401s server-side without a session.
- **Email/domain:** exactly one DMARC record, enforced at `p=quarantine`+; confirmation emails land in inbox, not spam.
- **Reliability:** double-booking impossible by construction (real transactional check, not the current TOCTOU illusion); one canonical appointment format in the DB (zero runtime normalization branches); confirmation-email failures alert within minutes instead of sitting in logs for 5 months; Sentry error rate ~0 in steady state; backups restorable (test one restore).
- **DB cost:** public pages cost zero Firestore reads; dashboard day-view costs reads proportional to that day's appointments (not 1,600+); a GCP budget alert guards the baseline; no unbounded query exists in the codebase.
- **Maintainability:** ~21k → target **≤ 14k** lines; largest file ≤ 400 lines (ideal ≤ 300); one data-access path; 100% TypeScript strict; a UI redesign would touch only `components/` + `app/`.
- **Quality gates:** CI green required to merge; slot logic exhaustively unit-tested; booking E2E covered; Lighthouse budgets enforced per-PR.
- **Performance/SEO:** Lighthouse ≥ 90 mobile on all key routes; real-user LCP < 2.5s / INP < 200ms / CLS < 0.1 in Search Console's CWV report; indexable service-category pages; booking funnel completion visible month-over-month.
- **Portfolio:** README with architecture diagram, this masterplan, and ADRs documenting the interesting decisions — the refactor story itself is the portfolio piece.
