# Gioia Beauty — Refactor and Supabase Migration Masterplan

> From a fragile client-side Firebase application to a production booking system with a tested domain core, server-only data access, a relational database, reproducible environments, and an owner-friendly dashboard.
>
> **Version 2:** rewritten 2026-07-09 after an independent security, booking, data-model, frontend, operations, SEO, and dependency cross-check.
>
> **Progress tracking:** checkboxes are the source of truth. Tick an item only when it is complete and verified in the environment named by its label. Session detail belongs in `docs/WORKLOG.md`; mandatory safety rules are in `docs/PRODUCTION-SAFETY.md` and `AGENTS.md`.

---

## 0. Blast-radius labels

Every checklist item carries at least one label. The label describes what the action can actually reach, not where the command happens to run.

- **`[LOCAL]`** — repository files, local commands, local Supabase, emulators, and synthetic data only. No remote service or production credential is reachable.
- **`[TEST]`** — changes a dedicated non-production Supabase/Firebase/Vercel/Resend environment containing synthetic or explicitly anonymized data.
- **`[REMOTE-CONFIG]`** — changes remote collaboration configuration such as GitHub branch protection, without touching the running application or customer data.
- **`[PROD-READ]`** — bounded, read-only access to live systems. It can expose PII and still requires care, but cannot mutate state.
- **`[PROD-APP]`** — changes the code customers or the owner run. It may change live behavior but is not intended to mutate existing records or infrastructure.
- **`[PROD-CONFIG]`** — changes live DNS, environment variables, auth, RLS/rules, provider settings, deployment routing, monitoring, or infrastructure.
- **`[PROD-DATA]`** — creates, updates, imports, deletes, migrates, restores, or otherwise affects live customer/business records.
- **`[DESTRUCTIVE]`** — irreversibly deletes or overwrites live data, projects, history, backups, or infrastructure.

A task can have multiple labels. A locally executed command with production credentials is **not** `[LOCAL]`; it is production work.

### Approval and safety gates

1. `[LOCAL]` work may proceed normally once the worktree is understood.
2. `[TEST]` work must name and verify the non-production target first.
3. `[REMOTE-CONFIG]` work names the remote target and requires explicit approval before mutation. Every discrete `[PROD-READ]`, `[PROD-APP]`, `[PROD-CONFIG]`, `[PROD-DATA]`, or `[DESTRUCTIVE]` action requires Victor's explicit approval **at execution time**. Approval of this plan is not blanket approval for later production actions.
4. `[PROD-DATA]` additionally requires a current named backup, a successful restore rehearsal, a dry-run report, invariant/count reconciliation, idempotent/checkpointed tooling, stop conditions, and a written rollback or forward-recovery path.
5. `[DESTRUCTIVE]` work is split from additive work and delayed until the recovery-retention window has passed. It is never described as “trivial.”
6. Production credentials never live in `.env.local`, developer shells, normal CI, or Vercel Preview. Preview deployments never point at production data. The only exception is the dedicated manually approved, short-lived production-operator environment.
7. Production schema changes use reviewed, versioned migrations only—never ad-hoc dashboard SQL.

The full operational policy and migration gate are in `docs/PRODUCTION-SAFETY.md`.

---

## 1. Verified starting point

### What is good already

- Next.js App Router, Vercel, Tailwind, shadcn/Radix, Zod, metadata, sitemap, JSON-LD, Analytics, and Speed Insights are reasonable foundations.
- The public site already has strong local-business content and must remain visually unchanged during the internal rewrite.
- The appointment volume is small enough for a rehearsed migration: roughly 1,600 appointment/block records plus vacations and newsletter subscribers.

### Live `main` / verified baseline risks

These describe the current Production deployment. Refactor-branch containment does not change live behavior until a separately approved deployment.

1. **Customer email failures:** `/api/send` has returned Resend `422 Invalid to` failures while callers swallowed the error. Customer failure currently prevents the admin email attempt.
2. **Public PII endpoint:** `/api/appointments/by-date` is deployed, unauthenticated, and returns complete appointment documents. A safe empty-date probe returned HTTP 200.
3. **Costly public endpoint:** `/api/appointments/counts` is unauthenticated and downloads a nine-month window with `getDocs`; its `getCountFromServer` import is unused.
4. **Exposed mail routes:** `/api/send` and `/api/cancel` accept attacker-controlled recipients/content without authentication, full validation, or rate limiting.
5. **Client-controlled production database:** public booking, dashboard, vacations, export, and newsletter code use the Firebase Web SDK. There are no versioned Firestore rules in this repository.
6. **No reliable conflict invariant:** the current “transaction” queries outside its transaction read set. A simple query-then-insert server transaction would still race on an empty day.
7. **Production-connected local development:** `lib/firebase/config.js` hardcodes the live project and emulator connections are commented out. Local or Preview interaction can therefore touch live customer data.
8. **Old vulnerable dependency graph:** the lockfile uses Next 14.2.16. The 2026-07-09 production-tree audit reported 44 advisories (4 critical, 13 high, 25 moderate, 2 low). Reachability must be triaged; do not blindly run `npm audit fix --force`.
9. **Clean build is not reproducible:** `npm run build` fails without a real `RESEND_API_KEY` because `Resend` is constructed during module evaluation.

### Corrected codebase facts

- There are **three date formats at rest** in Firestore plus a JavaScript `Date` representation created only in memory.
- `fetchAllAppointments` is exposed but has no caller and would currently be rejected for omitting a date range. The real read leak is the globally mounted current-month appointment fetch plus vacations on every route.
- The seven-day slot preloader exists but the active public caller passes `preloadDays: 0`; it is latent code, not a current seven-query user action.
- The active public submission path is `BookAppointment → AppointmentContext → useOptimizedAppointments → dataManager`; `useBookingForm.submitBooking` is dead, although the hook's form/schema are used.
- `app/layout.js` loads React Scan in production and mounts appointment machinery globally.
- Address/contact values conflict: structured/site content says Via Emilia 60, the privacy policy says Via Emilia 58, and `BUSINESS_INFO` contains placeholder Milan data.
- FAQ JSON-LD exists without equivalent visible FAQ content. Leaflet is already dynamically imported; the remaining gallery modal and image behavior should be measured before changing.

---

## 2. Architecture decisions

| Area | Decision | Reason |
|---|---|---|
| Framework | **Keep Next.js; patch immediately, then upgrade to the current supported release after safety tests.** | Replatforming the frontend adds no value. Next 15 is no longer the final target; current official guidance is Next 16.x. |
| Hosting | **Keep Vercel.** | Fits the traffic and integrates previews, but Preview and Production environment variables must be isolated. |
| Database | **Migrate once: Firestore → Supabase Postgres. Do not canonicalize Firestore first.** | The project already needs a canonical ETL, server data layer, auth rewrite, tests, and conflict redesign. Postgres can enforce schedule overlap at the database layer and is better for reporting/export. |
| Auth | **Move the single owner account to Supabase Auth during the controlled cutover.** | One account is cheap to recreate/invite. Avoid maintaining Firebase session-cookie infrastructure that would immediately become legacy. |
| Data access | **All public/admin CRUD goes through validated Next.js server boundaries and a least-privilege pooled Postgres application role.** | The business schema is not exposed through the Data API. RLS/grants still deny browser roles, but a privileged service key would bypass RLS and is not the business-data adapter. |
| Email | **Keep Resend, but use an outbox/delivery-state model with idempotency and webhooks.** | Booking commit is authoritative; email is a retryable post-commit side effect with independent customer/admin outcomes. |
| Booking concurrency | **Postgres is the final authority.** | Keep `computeFreeSlots` as pure presentation logic, but enforce active interval overlap with a database constraint or one transactional database function. |
| Data fetching | **TanStack Query for the interactive client shell after server APIs exist.** | Deletes the hand-rolled cache infrastructure without putting business rules in components. |
| Language | **Strict TypeScript for new code; delete before converting legacy code.** | TypeScript 7 is current but has tooling/API transition caveats. Verify Next/ESLint/Vitest compatibility; use the supported fallback if necessary. |
| Testing | **Vitest + Testing Library + Playwright + local Supabase.** | Tests precede the risky migration and security work rather than arriving afterwards. |
| Observability | **Sentry + structured server logs + uptime checks + runbooks.** | Start minimal error capture before the first risky release, expand after cutover. |
| UI | **Public routes remain pixel-frozen; dashboard redesign is last.** | Internal architecture should become replaceable before visual work begins. |

### Why Supabase now

This is the cheapest point to switch because no refactor implementation has landed and the database is small. Staying on Firestore first would require guard/version documents, canonical dual writes, Firebase session cookies, rules, emulator coverage, migrations, and server adapters that would later be discarded.

Postgres gives this domain:

- database-enforced non-overlapping appointments/blocks;
- relational services, variants, vacations, subscribers, and audit data;
- predictable queries for day/week/month views and exports;
- unique constraints for subscriber normalization and request idempotency;
- local Docker development, versioned SQL migrations, seeds, resettable CI databases, and a serialized non-production staging target.

Production cutover is conditional on:

- Victor approving the complete recurring Production and backup/recovery quote (verify current pricing before purchase); the existing empty project is authorized as a Free greenfield integration/staging target in the meantime;
- completing a representative staging import with zero silent loss;
- accepting ownership of reviewed SQL migrations;
- using a short controlled write freeze for cutover.

If the recurring cost is rejected, stop before Phase 2 and write a replacement ADR choosing server-only Firestore. Do **not** run both canonical migrations.

### Supabase-specific security posture

- Business tables live in a private/non-exposed schema and are accessed by a dedicated least-privilege `app_runtime` Postgres role through Supavisor transaction pooling. Connection limits and pooling mode are load-tested for Vercel.
- The Data API has no grants on business tables. RLS/default grants deny `anon` and `authenticated`, but this protects browser/Data API exposure—not bugs in a privileged server path. Supabase service secrets are used only for narrowly scoped Auth administration and never in a session-overwritable SSR client.
- Public and dashboard clients call Next.js handlers, not tables.
- The publishable key may be client-visible for Auth; database and service secrets never are.
- Admin authorization comes from owner-controlled `app_metadata` or an explicit server allowlist, never editable `user_metadata` and never “any authenticated user.”
- Sensitive admin mutations verify a fresh server-side user/session and current owner authorization; cached JWT claims or client session presence alone are insufficient because revocation/app-metadata changes can be stale.
- No schema mutation through the production Dashboard. Migrations are generated, reviewed, tested locally, then applied by a dedicated manually approved production-operator workflow with short-lived secrets and redacted logs.

---

## 3. Target booking core

```text
Public/admin UI
  → validated Next.js route handler
    → authorization + rate limit + idempotency
      → pure booking rules (Europe/Rome)
        → Postgres transaction / overlap invariant
          → booking committed
            → outbox entry committed
              → Resend attempt/retry/webhook state
```

Core rules:

- `computeFreeSlots(date, serviceVariant, scheduleEntries, vacations, hours)` is pure and exhaustively tested.
- The server derives duration and buffer from the authoritative stable-ID catalog. It never trusts client-supplied duration, end time, status, or price.
- Public booking, admin appointment, block, reschedule, cancellation, and vacation commands have separate boundary schemas but share one domain service.
- All occupancy-changing paths use the same database invariant. Rescheduling locks both old/new schedule scopes in deterministic order if application locks are needed.
- Cancellation is a status transition, not deletion.
- Blocks are an entity `kind`, not a lifecycle status.
- Email/customer/admin notifications never determine whether the booking transaction commits.
- Availability caching starts disabled. Add a shared/tagged cache only after measurement, and never use cached availability for final conflict enforcement.

Exact source and target fields, ETL rules, and reconciliation are in `docs/DATA-MODEL.md`.

---

## 4. Phases

### Phase 0 — Emergency production containment

Only items marked 🚨 ship as small focused hotfixes from `main`, then merge `main` back into `refactor`. The remaining Phase 0 hygiene stays on the reviewed `refactor` workflow.

- [x] **`[LOCAL]`** Add the smallest isolated Vitest route harness needed for email validation/outcomes and dead appointment endpoint regression tests; it must not start the app or resolve Firebase.
- [ ] **`[PROD-APP]` 🚨** Delete `/api/appointments/by-date` and `/api/appointments/counts` if final import search confirms no callers; otherwise require admin auth and return no raw PII. Verify production returns 404/401 and add `private, no-store` to every authenticated PII response.
- [x] **`[LOCAL]`** Implement and unit-test bounded bodies, normalized email, independent recipient outcomes, owner authorization, rate limiting, and redacted responses on the refactor branch. The temporary legacy mail boundary is owner-only until the atomic booking/outbox path replaces it.
- [ ] **`[PROD-APP]` 🚨** Prepare and separately approve the live containment hotfix for `/api/send` and `/api/cancel`; any provider/WAF configuration remains `[PROD-CONFIG]`.
- [ ] **`[PROD-APP]` 🚨** Update all current callers so invalid public email blocks booking before the write, admin no-email is intentional, and partial delivery failure is visible/retryable rather than warn-and-forget.
- [x] **`[LOCAL]`** Construct Resend lazily or behind runtime validation so `npm run build` succeeds without a production secret.
- [x] **`[LOCAL]`** Inventory every route with: public/admin/internal, input schema, output PII, auth, rate limit, cache policy, and maximum reads/writes.
- [x] **`[LOCAL]`** Triage `npm audit --omit=dev`, map findings to direct/runtime reachability, and record accepted versus fixed advisories.
- [x] **`[LOCAL]`** Patch Next to the supported 15.5.20 line, verify the isolated build/tests, and retain React 18 to avoid an unrelated public-UI migration. Schedule the tested Next 16 upgrade in Phase 7. Do not use `npm audit fix --force`.
- [ ] **`[TEST]` / `[PROD-APP]`** Verify the Next 15 compatibility patch in full isolated E2E/visual tests, then separately approve its Production deployment.
- [x] **`[LOCAL]`** Delete `/api/test` on the refactor branch and remove PII-bearing logs from the touched API and booking paths.
- [ ] **`[PROD-APP]`** Separately approve and verify deletion of `/api/test` plus the logging containment in Production.
- [x] **`[LOCAL]`** Remove React Scan, uninstall unused Twilio, delete and ignore repository dumps, inventory all four discovered Firebase project IDs, remove legacy data scripts, and add Gitleaks current-tree/history gates with only reviewed public Firebase browser-key fingerprints baselined.
- [ ] **`[PROD-READ]` / `[PROD-CONFIG]`** Inspect the four remote Firebase projects' ownership/API-key restrictions and separately approve any restriction, rotation, or retirement change.
- [x] **`[LOCAL]`** Add `.env.example`, environment validation, Node/npm pins, Prettier, lint-staged, a pre-commit hook, and a real README.
- [ ] **`[PROD-CONFIG]`** Confirm the already-observed apex→www redirect, remove the duplicate DMARC and stale Brevo record, verify Resend SPF/DKIM, observe reports, then separately approve `p=quarantine`.
- [ ] **`[DESTRUCTIVE]`** Archive the stale Vercel project only after its domains, env vars, deployments, and rollback value are reviewed.

**Done when:** public PII/mail abuse paths are contained, email outcomes are explicit, the build works without live secrets, and urgent dependency exposure is patched or consciously accepted.

### Phase 1 — Environment isolation, tests, backups, and ADR gate

No production data is mutated in this phase except explicitly approved backup/configuration actions.

- [x] **`[LOCAL]`** Write `docs/ADR-001-SUPABASE.md` and obtain explicit approval of the one-migration approach. Production spend and cutover remain separately gated.
- [x] **`[LOCAL]`** Add local Supabase CLI/Docker configuration, version-pinned tooling, synthetic seed data, and reset commands. Local email uses Mailpit/fake transport.
- [x] **`[TEST]`** Register the authorized serialized integration/staging Supabase project `lxvsspniipcotimbsfqm` in `eu-central-2` and record its reset ownership in `docs/ENVIRONMENTS.md`. DB-aware Preview/E2E runs take a lock and reset/namespace synthetic data. Never seed it with customer PII.
- [ ] **`[PROD-CONFIG]`** Before any real customer write or live traffic, approve/upgrade the full billing and backup tier, record DPA/processor status and ownership/recovery contacts, remove synthetic data/test users, rebuild from committed migrations, prove restore, and reclassify the exact Supabase target as Production.
- [x] **`[LOCAL]`** Make development/test/CI fail closed if any production Firebase/Supabase project ID or production credential is detected.
- [ ] **`[PROD-CONFIG]`** Audit Vercel Development/Preview/Production env scopes. Preview must use staging data and non-delivering/test-only email.
- [ ] **`[TEST]`** After isolation, capture desktop/mobile screenshots of `/`, gallery, contacts, booking states/modals/errors, login, and dashboard without touching production data.
- [x] **`[LOCAL]`** Add strict TypeScript for new files (`allowJs: true`) after a TypeScript 7 compatibility spike; keep the supported fallback documented.
- [x] **`[LOCAL]`** Add Vitest, Testing Library, Playwright, local Supabase, and GitHub Actions for lint, typecheck, unit/integration tests, and build on PRs and `refactor` pushes.
- [ ] **`[REMOTE-CONFIG]`** Protect `refactor` and `main`; agents use short branches/PRs instead of pushing unfinished DB-aware work directly to a shared deploy branch.
- [ ] **`[LOCAL]` / `[REMOTE-CONFIG]` / `[PROD-CONFIG]`** Define a dedicated production-operator workflow: protected GitHub Environment/manual approval, exact project allowlist, short-lived production secrets, no development startup, migration/import-only commands, redacted artifacts, and credential teardown. Normal CI never receives Production credentials.
- [x] **`[LOCAL]`** Add migration tooling that defaults to dry-run and refuses production unless exact environment, project ref, run ID, `--apply`, bounds, and confirmation are supplied.
- [x] **`[LOCAL]`** Extend `.gitignore` for service-account JSON, database exports, before-images, migration manifests, Supabase local data, and backup directories.
- [ ] **`[LOCAL]` / `[TEST]`** Capture/version current Firestore rules/indexes and prepare tested temporary deny-write plus final deny-all rules for the cutover. Do not deploy them yet.
- [ ] **`[PROD-READ]`** After explicit approval, take a bounded read-only Firestore inventory/export only after target/project verification; declare PII and read cost, redact reports, and store raw exports encrypted outside git.
- [ ] **`[PROD-CONFIG]`** Enable/verify a current Firestore backup/PITR strategy for the source until cutover is complete.
- [ ] **`[PROD-READ]` / `[TEST]`** With separate approval, restore the PII-bearing source export only into a restricted recovery environment with named access, no public app/email, and a destruction deadline. Prove counts/representative records, generate an anonymized derivative for staging tests, then securely destroy the recovery copy.
- [x] **`[LOCAL]`** Document RPO, RTO, restore cadence, migration stop conditions, and incident contacts in `docs/OPERATIONS.md`.

**Done when:** local/CI/Preview cannot reach production, a source backup has been restored successfully elsewhere, CI is mandatory, the Production Supabase cost/backup posture is approved, and production-write tooling fails closed.

### Phase 2 — Typed relational schema and booking kernel

Everything remains `[LOCAL]` or `[TEST]`.

- [x] **`[LOCAL]`** Define Zod schemas and inferred types for schedule entries, appointments, blocks, vacations, services, variants, subscribers, outbox events, public commands, and admin commands.
- [x] **`[LOCAL]`** Build a stable service/variant catalog with explicit IDs, display-name snapshots, service duration, buffer, active state, and optional price only when real price data exists.
- [x] **`[LOCAL]`** Build pure Europe/Rome date/time, business-hours, vacation, overlap, and availability modules.
- [x] **`[LOCAL]`** Create reviewed Supabase migrations for private/default-deny tables, explicit grants, RLS, indexes, uniqueness, audit fields, and generated/validated occupied intervals.
- [x] **`[LOCAL]`** Version required extensions and database privileges. If `btree_gist` backs the exclusion constraint, migrate it explicitly. Any `SECURITY DEFINER` function lives outside exposed schemas, pins a safe `search_path`, revokes `EXECUTE` from `PUBLIC`/`anon`/`authenticated`, and grants only `app_runtime`.
- [x] **`[LOCAL]`** Add a database-enforced active-overlap invariant for appointments and blocks. Vacation/reschedule paths must participate in the same locking/invariant story.
- [x] **`[LOCAL]`** Add operation/principal-scoped request idempotency with a request fingerprint, `legacy_firestore_id`, `schema_version`, source/timestamp provenance, soft cancellation, email/outbox state, and migration quarantine. Same-key/different-body replay returns 409.
- [x] **`[LOCAL]`** Add an append-only, PII-minimized domain change log/high-water sequence covering schedule entries, blocks, vacations, and subscribers so post-cutover mutations are discoverable for audit and rollback.
- [x] **`[LOCAL]`** Decide and document: same-day/lead time, maximum advance window, slot alignment, admin overrides, buffer meaning, statuses consuming availability, vacation-over-existing-booking behavior, and completed-status semantics.
- [x] **`[LOCAL]`** Exhaustively test adjacent/partial/exact overlap, variable durations, buffer/closing boundaries, blocks, cancelled records, vacations, leap dates, Rome midnight/DST, stale requests, reschedules, and parallel requests.
- [ ] **`[TEST]`** Run migrations from zero, seed, reset, rerun, advisors, RLS-negative tests, and concurrency tests in staging. Many parallel overlapping requests must yield exactly one accepted booking.

**Done when:** a clean local database can be recreated from version control; the database—not UI timing—prevents overlap; and every business rule has an executable test.

### Phase 3 — Server vertical slice, auth, and reliable side effects

- [ ] **`[LOCAL]` / `[TEST]`** Implement one server-only database adapter; no Supabase secret appears in a client bundle.
- [ ] **`[LOCAL]` / `[TEST]`** Implement `GET /api/availability?date=&serviceId=&variantId=` returning slots only, with bounded reads and no PII.
- [ ] **`[LOCAL]` / `[TEST]`** Implement idempotent `POST /api/bookings`; derive catalog data server-side and return 409 for occupied slots.
- [ ] **`[LOCAL]` / `[TEST]`** Implement authenticated appointment/block create, edit, reschedule, soft-cancel, vacation, subscriber, count, and bounded export operations.
- [ ] **`[LOCAL]` / `[TEST]`** Implement Supabase Auth for the owner with explicit admin authorization, secure SSR cookies, CSRF defenses, bounded session lifetime, refresh, logout/revocation, and correct 401/403 behavior. Sensitive mutations recheck fresh user/session state and current authorization rather than trusting cached claims alone.
- [ ] **`[LOCAL]` / `[TEST]`** Add public abuse defenses: IP/account limits plus CAPTCHA/App Check-equivalent verification where useful. Public GET cost must also be bounded.
- [ ] **`[LOCAL]` / `[TEST]`** Commit domain changes and immutable recipient/template snapshots atomically with the outbox. Drain it with a signed Vercel Cron worker using a database claim lease/`SKIP LOCKED`, stale-lease recovery, provider idempotency, dead-letter alerting, and signed/replay-deduplicated delivery webhooks; support customer, admin, and newsletter confirmation mail.
- [ ] **`[LOCAL]` / `[TEST]`** Implement newsletter normalized uniqueness, consent timestamp/source/policy version, non-enumerating responses, signed one-click unsubscribe, and preferably double opt-in.
- [ ] **`[LOCAL]` / `[TEST]`** Add minimal Sentry/error capture now, PII-safe structured logs, route metrics, and a shallow read-free `/api/health`.
- [ ] **`[LOCAL]` / `[TEST]`** Complete the pre-cutover privacy package: retention/anonymization by field/table/log/backup, executable deletion/access workflow, sensitive-note policy, consent evidence, privacy-policy update, processor/DPA inventory, and restore-retention interaction.
- [ ] **`[LOCAL]` / `[TEST]`** Run API contract, auth, rate-limit, email, idempotency, concurrency, and E2E tests against local/staging adapters.

**Done when:** staging proves the complete booking/admin/cancellation/email flow without Firebase writes or customer PII.

### Phase 4 — Staging application cutover and production release candidate

Firestore remains the untouched production authority. The new Supabase application is exercised only in Local/Preview/staging until Phase 5's approved migration window. This avoids building a disposable canonical Firestore server layer or performing two data transitions.

- [ ] **`[LOCAL]` / `[TEST]`** Move public availability and booking UI behind the Supabase-backed server API while preserving pixel output and explicit failure states.
- [ ] **`[LOCAL]` / `[TEST]`** Move dashboard appointments, blocks, vacations, newsletter, counts, and export behind authenticated server operations.
- [ ] **`[LOCAL]` / `[TEST]`** Remove `AppointmentProvider` from the root layout and prove non-booking public page loads make zero database calls.
- [ ] **`[LOCAL]` / `[TEST]`** Remove latent preloading, raw appointment responses, full-collection reads, client listeners, and client database mutations from the release candidate.
- [ ] **`[TEST]`** Import the rehearsed staging snapshot and run visual snapshots, keyboard/accessibility flows, booking golden path, admin no-email, cancellation, retry, session expiry, stale-tab, migration, and concurrency E2E suites.
- [ ] **`[TEST]`** Verify Preview browser traffic contains no direct Firestore/Supabase business-table access and no other customer's appointment document.
- [ ] **`[LOCAL]` / `[TEST]`** Implement and E2E-test maintenance/freeze behavior before cutover: public booking and every dashboard mutation disabled, owner/customer messaging, stale-client failure, emergency manual-booking procedure, audited operator-canary bypass, cleanup, and unfreeze.
- [ ] **`[LOCAL]`** Freeze the exact source commit and dependency lockfile for production and record its environment manifest, smoke tests, and forward-recovery commit. Production-scoped values may be baked at build time, so Preview is not treated as a promotable binary artifact.

**Done when:** the complete Supabase application and data import pass in staging, the public UI is unchanged, maintenance/canary behavior is rehearsed, and the exact source/lockfile are frozen. Production still runs the legacy Firestore application until the controlled Phase 5 window.

### Phase 5 — Rehearsed Firestore → Supabase production cutover

This phase is intentionally split into separately approved actions. There is no casual “run migration” step.

- [ ] **`[TEST]`** Transform a restored Firestore export into staging using preserved `legacy_firestore_id`; emit only redacted counts/anomalies.
- [ ] **`[TEST]`** Reconcile source IDs and totals: appointments, blocks, vacations, subscribers, status counts, future confirmed bookings, date/time conversions, duration/buffer, duplicates, and quarantine. Source must equal imported plus explicitly reviewed quarantine.
- [ ] **`[TEST]`** Build and test reverse ETL before cutover: imported rows update their original Firestore IDs; Supabase-created rows use deterministic Firestore IDs and retain `supabase_id`; service/variant values map back to the legacy shape; all creates/edits/reschedules/cancellations/blocks/vacations/subscriber mutations are selected by a reliable high-water mark; reruns are idempotent.
- [ ] **`[TEST]`** Repeat the exact import from a clean database, rerun it to prove idempotency, test overlap violations, restore a Supabase backup/logical dump, and rehearse pre-reopen and post-reopen failure recovery against isolated clones.
- [ ] **`[TEST]`** Rehearse the safe failure posture: once Firestore deny-write rules are active, do not reactivate the insecure direct-client legacy app. Keep maintenance active, preserve/reverse-sync data if needed, and repair or restore Supabase forward from the recorded source/backup.
- [ ] **`[PROD-CONFIG]`** Through the protected operator workflow, reset/rebuild the approved empty EU Production target from reviewed migrations, then verify extensions, functions, least-privilege roles, default privilege revocations, Data API denial, indexes, grants/RLS, webhook secrets, and backup settings. Run advisors and negative direct-access tests before import.
- [ ] **`[PROD-CONFIG]`** Configure Production Auth outside SQL migrations: site/redirect URLs, custom SMTP, session/JWT policy, MFA decision, owner invite/reset, explicit admin app metadata/allowlist, logout/revocation checks, and preserved Firebase Auth access for recovery evidence during the 30-day window.
- [ ] **`[PROD-CONFIG]`** Set Production-only Vercel variables to the allowlisted Supabase Production/Auth targets; keep Development/Preview pointed at Local/staging and verify scope resolution.
- [ ] **`[PROD-APP]`** Before the freeze, build a staged Production deployment from the exact frozen Phase 4 source/lockfile with Production env vars but no assigned public domain (`--prod --skip-domain` or equivalent). Record its deployment ID/resolved refs and verify read-free health/static routes privately.
- [ ] **`[PROD-DATA]`** Obtain explicit approval for a short booking/dashboard write freeze and display the final preflight: targets, commit, run ID, backup IDs, expected counts, writes, quarantine, stop conditions, and forward-recovery plan.
- [ ] **`[PROD-APP]` / `[PROD-CONFIG]`** Enable maintenance mode, disable current server writes, deploy the tested temporary Firestore deny-write rules so stale browser tabs cannot mutate, and run negative public/admin write probes. The freeze is not active until every write path fails except the audited cutover-operator bypass.
- [ ] **`[PROD-READ]` / `[PROD-CONFIG]`** Under the active freeze, take the final named Firestore backup/managed full export and production counts/checksums; the rules freeze and the export are separately approved and logged.
- [ ] **`[PROD-DATA]`** Run the idempotent full import in bounded/checkpointed batches. Because legacy `updatedAt` is incomplete, prefer a frozen full import over timestamp-based delta guessing or long-lived dual writes.
- [ ] **`[PROD-DATA]`** Reconcile again. Any silent loss, unexpected overwrite, duplicate active interval, count mismatch, or unmapped future appointment is a stop condition.
- [ ] **`[PROD-CONFIG]` / `[PROD-DATA]`** Verify Supabase Pro backups are active, create an immediate encrypted post-import logical export/recovery point, restore it into an isolated target, and reconcile it before accepting customer writes. Record owner-approved RPO/RTO.
- [ ] **`[PROD-APP]`** Verify the already-built staged Production deployment privately against the reconciled import, then assign/promote that exact deployment without rebuilding.
- [ ] **`[PROD-APP]` / `[PROD-DATA]`** While public/admin writes remain frozen, use the audited one-time cutover-operator bypass to smoke-test owner login, availability, controlled booking, block, edit/reschedule, soft cancellation, newsletter, export, database record, and email/outbox state. Include every bypass mutation in reconciliation and rollback.
- [ ] **`[PROD-APP]`** Reopen both public booking and dashboard mutations only after canary cleanup/reconciliation and the full smoke checklist pass.
- [ ] **`[PROD-CONFIG]`** Replace temporary deny-write rules with tested final deny-all browser rules and run negative probes. Do not restore the insecure direct-client legacy app merely to shorten an outage.
- [ ] **`[PROD-DATA]`** Keep Firestore read-only, Firebase Auth recovery access, encrypted backups, import/reverse-ETL tooling, and high-water evidence for **30 days**. Reverse ETL preserves data portability; it is not permission to reopen unsafe browser writes.

Failure recovery has two explicit branches, both preferring customer-data safety over availability:

- **Before reopening writes:** keep maintenance and Firestore deny-write rules active, reverse canary mutations if required, and fix forward or restore the empty/imported Supabase target. The old direct-client app is not a safe writable rollback.
- **After reopening writes:** immediately freeze every Supabase public/admin/server write path, record the change-log high-water mark, restore/fix forward in Supabase, and reconcile every create/edit/reschedule/cancellation/block/vacation/subscriber mutation before reopening. Reverse ETL to the frozen Firestore copy is an emergency preservation path only; reactivation requires a separately built and tested secure server adapter plus explicit approval.

**Done when:** Supabase is authoritative, all source/target invariants reconcile, live booking/admin/email flows pass, and Firestore remains read-only and recoverable. Nothing is deleted.

### Phase 6 — Delete legacy architecture, then convert survivors

- [ ] **`[LOCAL]`** Delete dead hooks/files before converting them.
- [ ] **`[LOCAL]`** Adopt one TanStack Query hook family backed by server APIs; delete both hand-rolled caches and `lib/utils/performance.js`.
- [ ] **`[LOCAL]`** Dismantle `AppointmentContext`; keep only genuine local UI state.
- [ ] **`[LOCAL]`** Collapse duplicate submission, validation, date-normalization, and end-time implementations into the typed core.
- [ ] **`[LOCAL]`** Split `Dashy.jsx`, `BookAppointment.jsx`, and notification/loading sprawl into small route/domain components without public visual change.
- [ ] **`[LOCAL]`** Convert only surviving code to strict TypeScript in dependency order; `tsc --noEmit` stays mandatory.
- [ ] **`[LOCAL]`** Consolidate UI libraries only when screenshot/interaction parity proves it safe.
- [ ] **`[LOCAL]`** Remove Firebase client/admin packages, transition readers, legacy scripts, and hardcoded project configuration only after the 30-day recovery-retention window.
- [ ] **`[DESTRUCTIVE]`** After 30 days, a successful restore drill, zero fallback usage, and separate approval, retire obsolete Firestore projects/fields—or retain them inert if deletion has no operational benefit.

**Done when:** one path exists per operation; Firebase and custom caches are gone; no file exceeds roughly 400 lines; strict TypeScript and all tests pass.

### Phase 7 — Operations, supported framework, security headers, SEO, and performance

- [ ] **`[PROD-CONFIG]` / `[PROD-APP]`** Complete Sentry EU/PII-safe setup, source maps, release tags, handled Resend-error capture, uptime alerts, owner escalation, and `docs/OPERATIONS.md`.
- [ ] **`[LOCAL]`** Add one dependency-update system (Dependabot or Renovate), recurring audit gates, and an explicit patch cadence.
- [ ] **`[LOCAL]` / `[TEST]` / `[PROD-APP]`** Upgrade to the current supported Next 16.x/React line using official codemods and compatibility tests; replace `next lint` with ESLint CLI/flat config.
- [ ] **`[LOCAL]` / `[PROD-APP]`** Roll out CSP in Report-Only first; handle inline scripts and Vercel/Sentry/Supabase/map origins; then enforce with `frame-ancestors`, `nosniff`, Referrer-Policy, and Permissions-Policy. HSTS already exists.
- [ ] **`[LOCAL]` / `[PROD-APP]`** Remove the observed wildcard CORS response from business/API routes; allow only required same-origin or explicit origins and add negative preflight tests.
- [ ] **`[LOCAL]`** Fix sitemap field names/stable modification dates, remove noindexed policy from sitemap or change the indexing decision, and add route-specific canonicals.
- [ ] **`[PROD-CONFIG]` / `[PROD-APP]`** Resolve Via Emilia 58/60 and placeholder contact data with the owner; centralize verified NAP across site, privacy policy, schema, Google Business Profile, Instagram, and directories.
- [ ] **`[PROD-APP]`** Render real visible FAQ content before retaining FAQ schema. Do not promise Google FAQ rich results for a salon.
- [ ] **`[PROD-APP]`** Add useful service-category pages only when each has unique, owner-approved content; make the checklist and done criterion agree.
- [ ] **`[LOCAL]` / `[PROD-APP]`** Measure first: split the gallery modal, audit images, fix hero LCP priority/alt text, remove unused fonts, and set evidence-based bundle/Lighthouse budgets with repeated runs.
- [ ] **`[PROD-CONFIG]`** Keep key facts server-rendered; allow actual search crawlers such as OAI-SearchBot as desired; treat GPTBot/training separately. `llms.txt` is optional, not a ranking requirement; Google says normal SEO powers its AI features.
- [ ] **`[PROD-CONFIG]`** Choose a booking-funnel metric available on the actual Vercel plan. Hobby does not include custom events; use a PII-free server aggregate or approve Pro.
- [ ] **`[PROD-CONFIG]`** Verify Search Console, sitemap, Rich Results/schema validators, Google/Apple business listings, and Speed Insights. Use Speed Insights when low traffic yields insufficient CrUX data.

**Done when:** supported dependencies are in production, alerts have been test-fired, security headers are enforced, measured performance budgets pass, and business facts are consistent.

### Phase 8 — Owner-led dashboard redesign

- [ ] **`[LOCAL]`** Interview the owner before design: daily workflow, devices, pain points, cancellation/reschedule behavior, preferred calendar/list views, and recovery needs.
- [ ] **`[LOCAL]` / `[TEST]`** Design and test mobile-first appointments, day/week views, filters, blocks, vacations, newsletter, export, and notes.
- [ ] **`[LOCAL]` / `[TEST]`** Add explicit loading/empty/error/offline/session-expiry states, conflict feedback, keyboard/a11y behavior, confirmation for destructive actions, and visible email retry state.
- [ ] **`[TEST]`** Acceptance test create/edit/reschedule/cancel/block/vacation/export on phone and desktop with bounded query counts.
- [ ] **`[PROD-APP]`** Deploy only after owner preview approval and preserve a rollback build.
- [ ] **`[PROD-READ]`** Compare live error rate, booking completion, owner workflow, and database query load after rollout.

**Done when:** the owner confirms the dashboard is faster and clearer in real use, the acceptance checklist passes, and reads remain bounded.

### Phase 9 — Optional future work

- SMS/WhatsApp reminders.
- Owner-editable services/prices after audit/versioning rules are defined.
- Booking modification links with secure single-use tokens.
- English/i18n if clientele warrants it.
- More detailed business reporting.

---

## 5. Load-bearing sequence

```text
0 emergency containment
→ 1 isolation + CI + backup/restore + Supabase approval
→ 2 tested relational schema and booking kernel
→ 3 complete server/auth/email vertical slice in staging
→ 4 full Supabase application cutover in staging + frozen source/lockfile
→ 5 frozen, reconciled Firestore→Supabase cutover
→ 6 delete legacy code, then TypeScript-convert survivors
→ 7 operations/framework/security/SEO/performance
→ 8 owner-led dashboard redesign
```

The central rule is:

> **Never canonicalize production Firestore and then migrate it to Supabase. Choose the target first, prove it locally and against a restored snapshot, and perform one production-data transition.**

### Realistic duration

The original 4–5 week “part-time” estimate was too optimistic. The implementation is approximately **25–40 focused development days**, plus the DMARC observation window, production cutover scheduling, the 30-day recovery-retention window, and owner testing. A realistic part-time calendar is roughly **8–12 weeks before dashboard redesign**, depending on review speed and migration anomalies.

---

## 6. Success metrics

- **Production safety:** local/normal-CI/Preview cannot reach production; every production action has a label, target, approval, backup/recovery evidence, and worklog entry.
- **Security:** public raw-PII/mail routes gone; browser business-table access denied; owner authorization is explicit; public operations are validated and abuse-limited.
- **Reliability:** database-enforced active-interval overlap; parallel same-slot test yields exactly one booking; idempotent retries never duplicate; email failures persist and alert.
- **Migration integrity:** every Firestore source ID is imported or explicitly quarantined; future bookings, blocks, vacations, subscribers, statuses, and date/time conversions reconcile; Firestore remains read-only for 30 days.
- **Privacy:** concrete retention/anonymization matrix, consent/unsubscribe evidence, processor inventory, data-subject workflow, no PII logs, and PII-safe monitoring.
- **Cost:** non-booking public routes perform zero database calls; availability responses contain slots only; dashboard queries are bounded; Supabase/Vercel budgets and alerts are documented.
- **Maintainability:** one canonical operation path, one typed booking core, strict TypeScript for surviving code, no custom cache infrastructure, small modules, reproducible local database.
- **Quality gates:** mandatory CI, exhaustive slot/DST/migration/rules/auth/email tests, preview and production smoke tests, screenshot/accessibility regression checks.
- **Operations:** restore drill succeeds; RPO/RTO and failure recovery are documented; alerts reach the owner/operator; supported dependency line stays current.
- **Business:** booking completion is measurable without PII, service information is accurate, and the owner validates the final dashboard workflow.

---

## 7. Rules of engagement

1. Read `docs/PRODUCTION-SAFETY.md` before any database, auth, deployment, DNS, email-provider, or environment work.
2. Every plan, commentary update, PR, and worklog entry names labels, target environment/project, and data impact.
3. Public UI remains pixel-frozen unless an explicitly approved public content/SEO item says otherwise; additive pages still require visual review.
4. No production database mutation occurs from local development, CI, Preview, a browser client, or an ad-hoc dashboard query.
5. Backups precede migrations; restore proof precedes production writes; additive and destructive changes are separate approvals.
6. Stale clients fail visibly and safely. Compatibility spans at least two production releases before cleanup.
7. Every database query is bounded or aggregate. Every production change states expected reads/writes/rows and verifies the actual result.
8. If evidence invalidates the foundation, redesign it. Do not preserve architecture merely because work has already started.
