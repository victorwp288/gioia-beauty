# Gioia Beauty — Refactor and Supabase Migration Masterplan

> From a fragile client-side Firebase application to a production booking system with a tested domain core, server-only data access, a relational database, reproducible environments, and an owner-friendly dashboard.
>
> **Version 2:** rewritten 2026-07-09 after an independent security, booking, data-model, frontend, operations, SEO, and dependency cross-check.
>
> **Progress tracking:** checkboxes record roadmap outcomes, not permission to do ordinary product work. Tick an item only when it is complete and verified in the environment named by its label. Durable milestone detail belongs in `docs/WORKLOG.md`; lane and safety rules are in `AGENTS.md` and `docs/PRODUCTION-SAFETY.md`.

---

## 0. Current operating rule: accelerate the non-authoritative rebuild

Firestore is the live Production authority and remains protected. Supabase remains a greenfield rebuild with no live users or production authority. The owner-approved 2026-07-29 representative rehearsal left a PII-bearing TEST copy in place until handover cleanup, so the target itself is not currently synthetic-only. **Fast Lane remains the default for repository, Local/CI, UI/copy, ordinary application work, and separately isolated synthetic testing; direct access to the retained TEST data is Guarded.**

- **Fast Lane:** UI/copy, non-sensitive workflows, isolated bugs, ordinary features, application integration, versioned and reversible/forward-fixable schema iteration, synthetic seed/test data, and Preview/staging deployments bound to the registered non-production Supabase target with fake providers. Use focused tests and, after a deploy, one simple health/static-route plus changed-flow smoke check.
- **Guarded Lane:** any Firebase/Firestore action; real, restorable, identifying, or linkable personal data; real-data import; authentication/authorization or access-control changes; real secrets, payments, provider activation, or live integrations; live-user enablement; Production deploy/config/write/routing; backup/restore; shared-target destructive reset; irreversible/destructive action; or cutover. Apply the explicit target, approval, bounds, privacy, reconciliation, recovery, and operator controls required by the actual boundary.

Fast Lane greenfield work does not require production-style backup/restore, broad hosted proof, runtime-role credential choreography, repetitive clean-environment replays, a formal row ledger, or the full CI/E2E matrix after every change. Keep migrations committed and reproducible, use synthetic data only, keep secrets out of source, preserve fail-closed environment checks and least privilege, and run the full harness once at a coherent release/security/cutover boundary. If a task mixes lanes, split it and guard only the risky action.

Existing completed milestones, migrations, CI checks, security controls, and hosted evidence remain valid. Historical strict checkpoints are evidence and optional release tools; they are not retroactively invalidated and do not become the default workflow for future routine work.

### Deferred representative-data review

The retained rehearsal is useful for read-only product development, but its data-quality findings do not block finishing the site. They must be resolved privately before handover, live-user enablement, or cutover:

- 2,433 source records reconcile exactly to 1,667 imported plus 766 quarantined.
- 44 certain future confirmed appointments are quarantined: 41 overlap dispositions and 3 unmapped-service records.
- The 240 unmapped records reduce to 20 distinct catalog patterns; historical mapping can wait, but the 3 future records cannot.
- Three retained future appointments fall inside one retained active vacation. The imported target has zero appointment-to-appointment and vacation-to-vacation overlaps.
- The aggregate-only local evidence is `manifest.quarantine-review.json` beside the encrypted rehearsal artifacts; it contains no record-level PII and remains outside git.

- [ ] **`[PROD-READ]` / `[TEST]`** Before handover/cutover, privately resolve the 44 quarantined future appointments and the three future vacation conflicts, rerun the bounded import/reconciliation, and require zero unresolved future-booking stop conditions. Delete the retained TEST/raw rehearsal data only when Victor requests handover cleanup.

### Blast-radius labels

Every checklist item carries at least one label. Labels describe reachable state; they do not by themselves decide the lane. In particular, ordinary synthetic `[TEST]` work is Fast Lane, while a Production-derived snapshot in a temporary test target is Guarded.

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
2. Fast Lane `[TEST]` work names and verifies the non-production target once before the first remote operation, then may proceed through the coherent task without repetitive preflights.
3. `[REMOTE-CONFIG]` work names the remote target and requires explicit approval before mutation. Every discrete `[PROD-READ]`, `[PROD-APP]`, `[PROD-CONFIG]`, `[PROD-DATA]`, or `[DESTRUCTIVE]` action requires Victor's explicit approval **at execution time**. Approval of this plan is not blanket approval for later production actions.
4. `[PROD-DATA]` additionally requires a current named backup, a successful restore rehearsal, a dry-run report, invariant/count reconciliation, idempotent/checkpointed tooling, stop conditions, and a written rollback or forward-recovery path.
5. `[DESTRUCTIVE]` work is split from additive work and delayed until the recovery-retention window has passed. It is never described as “trivial.”
6. Production credentials never live in `.env.local`, developer shells, normal CI, or Vercel Preview. Preview deployments never point at production data. The only exception is the dedicated manually approved, short-lived production-operator environment.
7. All schema changes are versioned. Greenfield Local/TEST migrations use focused rebuild/assertion checks; Production or real-data migrations additionally use the full guarded process and never ad-hoc dashboard SQL.

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
- The audited Production baseline used `app/layout.js` to mount appointment machinery globally. The current local Fast Lane batch replaces that shell with isolated public/owner route-group layouts; this does not change Production until an approved deployment.
- The audited Production baseline had conflicting address/contact values. The owner confirmed Via Emilia 60 on 2026-07-29, and the current local batch centralizes that verified NAP; external listings and Production deployment still require separate verification.
- The audited Production baseline has FAQ JSON-LD without equivalent visible content. The current local batch now renders matching visible FAQ content, interaction-loads Leaflet and the gallery lightbox, and records build-size evidence; deployed validation remains open.

---

## 2. Architecture decisions

| Area                | Decision                                                                                                                                                                          | Reason                                                                                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework           | **Keep Next.js; patch immediately, then upgrade to the current supported release after safety tests.**                                                                            | Replatforming the frontend adds no value. Next 15 is no longer the final target; current official guidance is Next 16.x.                                                                                  |
| Hosting             | **Keep Vercel.**                                                                                                                                                                  | Fits the traffic and integrates previews, but Preview and Production environment variables must be isolated.                                                                                              |
| Database            | **Migrate once: Firestore → Supabase Postgres. Do not canonicalize Firestore first.**                                                                                             | The project already needs a canonical ETL, server data layer, auth rewrite, tests, and conflict redesign. Postgres can enforce schedule overlap at the database layer and is better for reporting/export. |
| Auth                | **Move the single owner account to Supabase Auth during the controlled cutover.**                                                                                                 | One account is cheap to recreate/invite. Avoid maintaining Firebase session-cookie infrastructure that would immediately become legacy.                                                                   |
| Data access         | **All public/admin CRUD goes through validated Next.js server boundaries and a least-privilege pooled Postgres application role.**                                                | The business schema is not exposed through the Data API. RLS/grants still deny browser roles, but a privileged service key would bypass RLS and is not the business-data adapter.                         |
| Email               | **Keep Resend, but use an outbox/delivery-state model with idempotency and webhooks.**                                                                                            | Booking commit is authoritative; email is a retryable post-commit side effect with independent customer/admin outcomes.                                                                                   |
| Booking concurrency | **Postgres is the final authority.**                                                                                                                                              | Keep `computeFreeSlots` as pure presentation logic, but enforce active interval overlap with a database constraint or one transactional database function.                                                |
| Data fetching       | **TanStack Query for the interactive client shell after server APIs exist.**                                                                                                      | Deletes the hand-rolled cache infrastructure without putting business rules in components.                                                                                                                |
| Code language       | **Strict TypeScript for new code; delete before converting legacy code.**                                                                                                         | TypeScript 7 is current but has tooling/API transition caveats. Verify Next/ESLint/Vitest compatibility; use the supported fallback if necessary.                                                         |
| Localization        | **Keep Italian on the existing unprefixed URLs and add crawlable English equivalents under `/en`.**                                                                               | Separate URLs preserve Italian rankings and allow correct document language, self-canonicals, reciprocal `hreflang`, localized schema, and link-based switching without cookie or crawler ambiguity.      |
| Testing             | **Vitest + Testing Library + Playwright + local Supabase.**                                                                                                                       | Tests precede the risky migration and security work rather than arriving afterwards.                                                                                                                      |
| Observability       | **PII-safe structured server logs + route metrics + uptime checks + runbooks; add an external error provider only when its operational value and privacy controls are approved.** | Keep the release foundation provider-neutral and avoid making Sentry account/configuration a staging blocker.                                                                                             |
| UI                  | **Internal refactors preserve output; intentional UI/copy/product changes are Fast Lane before Production.**                                                                      | Focused visual/interaction checks protect the affected surface without blocking ordinary product development.                                                                                             |

### Why Supabase now

The project chose this switch before the replacement implementation landed, while the database was still small. That decision avoided building guard/version documents, canonical dual writes, Firebase session cookies, rules/emulator coverage, migrations, and server adapters that would later be discarded. The greenfield Supabase implementation has since completed substantial Phases 2–4 work without changing Production authority.

Postgres gives this domain:

- database-enforced non-overlapping appointments/blocks;
- relational services, variants, vacations, subscribers, and audit data;
- predictable queries for day/week/month views and exports;
- unique constraints for subscriber normalization and request idempotency;
- local Docker development, versioned SQL migrations, seeds, resettable CI databases, and a registered non-production staging target.

Production cutover is conditional on:

- Victor approving the complete recurring Production and backup/recovery quote (verify current pricing before purchase); the existing empty project is authorized as a Free greenfield integration/staging target in the meantime;
- completing a representative staging import with zero silent loss;
- accepting ownership of reviewed SQL migrations;
- using a short controlled write freeze for cutover.

If the recurring Production cost is rejected, keep the Supabase rebuild non-authoritative and stop before Guarded Phase 5/cutover. Write a replacement ADR before choosing any server-only Firestore production path. Do **not** run both canonical migrations.

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

### Phase 1 — Greenfield isolation, tests, and ADR gate

No production data is mutated in this phase except explicitly approved backup/configuration actions.

- [x] **`[LOCAL]`** Write `docs/ADR-001-SUPABASE.md` and obtain explicit approval of the one-migration approach. Production spend and cutover remain separately gated.
- [x] **`[LOCAL]`** Add local Supabase CLI/Docker configuration, version-pinned tooling, synthetic seed data, and reset commands. Local email uses Mailpit/fake transport.
- [x] **`[TEST]`** Register replacement integration/staging Supabase project `hzibzwhrwmljgjjdzspi` in `eu-central-2`, retire the provider-failed prior TEST project, and record ownership in `docs/ENVIRONMENTS.md`. The later hosted Phase 2 checkpoint is complete. Only destructive shared-fixture/reset runs serialize; ordinary additive schema/application work and Preview smoke tests are Fast Lane while the target is synthetic-only. The separately approved retained-data exception and its Guarded boundary are recorded above and in `docs/ENVIRONMENTS.md`.
- [x] **`[LOCAL]`** Make development/test/CI fail closed if any production Firebase/Supabase project ID or production credential is detected.
- [x] **`[PROD-CONFIG]`** Audit Vercel Development/Preview/Production env scopes. Preview must use staging data and non-delivering/test-only email.
- [ ] **`[TEST]`** After isolation, capture desktop/mobile screenshots of `/`, gallery, contacts, booking states/modals/errors, login, and dashboard without touching production data.
- [x] **`[LOCAL]`** Add strict TypeScript for new files (`allowJs: true`) after a TypeScript 7 compatibility spike; keep the supported fallback documented.
- [x] **`[LOCAL]`** Add Vitest, Testing Library, Playwright, local Supabase, and GitHub Actions for lint, typecheck, unit/integration tests, and build on PRs and `refactor` pushes.
- [ ] **`[REMOTE-CONFIG]`** Protect `refactor` and `main`; agents use short branches/PRs instead of pushing unfinished DB-aware work directly to a shared deploy branch.
- [x] **`[LOCAL]`** Add migration tooling that defaults to dry-run and refuses production unless exact environment, project ref, run ID, `--apply`, bounds, and confirmation are supplied.
- [x] **`[LOCAL]`** Extend `.gitignore` for service-account JSON, database exports, before-images, migration manifests, Supabase local data, and backup directories.
- [x] **`[LOCAL]`** Document RPO, RTO, restore cadence, migration stop conditions, and incident contacts in `docs/OPERATIONS.md`.

**Fast Lane foundation done when:** Local/CI/Preview cannot reach Production, Local/TEST are reproducible with synthetic data and fake providers, and production-capable tooling fails closed. Firestore inventory/backup/restore, Production cost/tier approval, and the protected operator workflow are Guarded Phase 5 gates; they do not block greenfield product development.

### Phase 2 — Typed relational schema and booking kernel

Everything remains `[LOCAL]` or synthetic `[TEST]` and is Fast Lane unless an item changes an authentication/authorization boundary. Ordinary schema/migration/seed iteration uses a committed migration, clean local rebuild or focused database assertion, and affected invariant tests. The broad reset/advisor/RLS/concurrency suite is a coherent schema or release checkpoint, not a per-migration ritual.

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
- [x] **`[TEST]`** Run migrations from zero, seed, reset, rerun, advisors, RLS-negative tests, and concurrency tests in staging. Many parallel overlapping requests must yield exactly one accepted booking.

**Done when:** a clean local database can be recreated from version control; the database—not UI timing—prevents overlap; and every business rule has an executable test.

### Phase 3 — Server vertical slice, auth, and reliable side effects

- [x] **`[LOCAL]` / `[TEST]`** Implement one server-only database adapter; no Supabase secret appears in a client bundle.
- [x] **`[LOCAL]` / `[TEST]`** Implement `GET /api/availability?date=&serviceId=&variantId=` returning slots only, with bounded reads and no PII.
- [x] **`[LOCAL]` / `[TEST]`** Implement idempotent `POST /api/bookings`; derive catalog data server-side and return 409 for occupied slots.
- [x] **`[LOCAL]` / `[TEST]`** Implement authenticated appointment/block create, edit, reschedule, soft-cancel, vacation, subscriber, count, and bounded export operations.
- [x] **`[LOCAL]` / `[TEST]`** Implement Supabase Auth for the owner with explicit admin authorization, secure SSR cookies, CSRF defenses, bounded session lifetime, refresh, logout/revocation, and correct 401/403 behavior. Sensitive mutations recheck fresh user/session state and current authorization rather than trusting cached claims alone.
- [x] **`[LOCAL]` / `[TEST]`** Add public abuse defenses: IP/account limits plus CAPTCHA/App Check-equivalent verification where useful. Public GET cost must also be bounded.
- [x] **`[LOCAL]` / `[TEST]`** Commit domain changes and immutable recipient/template snapshots atomically with the outbox. Drain it with a Vercel Cron worker authenticated by the exact `CRON_SECRET` bearer (not a request signature or replay fence), using a database claim lease/`SKIP LOCKED`, stale-lease recovery, provider idempotency within its proven retention window, dead-letter alerting, and signed/replay-deduplicated delivery webhooks; tolerate duplicate and missed Cron delivery, and support customer, admin, and newsletter confirmation mail.
- [x] **`[LOCAL]` / `[TEST]`** Implement newsletter normalized uniqueness, consent timestamp/source/policy version, non-enumerating responses, signed one-click unsubscribe, and preferably double opt-in.
- [x] **`[LOCAL]` / `[TEST]`** Add provider-neutral handled-error capture, PII-safe structured logs, route metrics, and a shallow read-free `/api/health`. An external error provider is optional and remains a separately approved Production integration.
- [ ] **`[LOCAL]` / `[TEST]`** Complete the pre-cutover privacy package: retention/anonymization by field/table/log/backup, executable deletion/access workflow, sensitive-note policy, consent evidence, privacy-policy update, processor/DPA inventory, and restore-retention interaction.
- [x] **`[LOCAL]` / `[TEST]`** Run API contract, auth, rate-limit, email, idempotency, concurrency, and E2E tests against local/staging adapters.

**Done when:** staging proves the complete booking/admin/cancellation/email flow without Firebase writes or customer PII.

**Compatibility note:** the 2026-07-22 Local and hosted TEST checkpoints proved the technical Phase 3 boundary with synthetic data; their exact deployment, full-suite, and zero-residue evidence remains in the append-only worklog. That proof stays valid but is not a template that every later Fast Lane change must repeat. The privacy package remains Guarded and inert until its owner/legal decisions are approved.

### Phase 4 — Greenfield application integration

Firestore remains the untouched production authority. The new Supabase application is exercised only in Local/Preview/staging until Phase 5's approved migration window. This avoids building a disposable canonical Firestore server layer or performing two data transitions.

**Compatibility note:** the 2026-07-20 through 2026-07-22 Local/hosted checkpoints already proved the server-only application, least-privilege traffic, synthetic booking/owner flows, privacy isolation, and maintenance behavior. The worklog retains exact deployments and evidence. Preserve those safeguards, but use focused checks plus a simple Preview smoke for later Fast Lane changes; repeat the full hosted harness only when its boundary changes or at a coherent release/cutover checkpoint.

- [x] **`[LOCAL]` / `[TEST]`** Move public availability and booking UI behind the Supabase-backed server API while preserving pixel output and explicit failure states.
- [x] **`[LOCAL]` / `[TEST]`** Move dashboard appointments, blocks, vacations, newsletter, counts, and export behind authenticated server operations.
- [x] **`[LOCAL]` / `[TEST]`** Remove `AppointmentProvider` from the root layout and prove non-booking public page loads make zero database calls.
- [x] **`[LOCAL]` / `[TEST]`** Remove latent preloading, raw appointment responses, full-collection reads, client listeners, and client database mutations from the release candidate.
- [ ] **`[TEST]`** With synthetic fixtures only, run the affected visual/accessibility and booking/admin flows needed for the current coherent application batch; use the full E2E matrix once at a release boundary.
- [x] **`[TEST]`** Verify Preview browser traffic contains no direct Firestore/Supabase business-table access and no other customer's appointment document.
- [x] **`[LOCAL]` / `[TEST]`** Implement and E2E-test maintenance/freeze behavior before cutover: public booking and every dashboard mutation disabled, owner/customer messaging, stale-client failure, emergency manual-booking procedure, audited operator-canary bypass, cleanup, and unfreeze.

**Done when:** the coherent Supabase application batch works with synthetic data in Local/Preview, focused affected-flow checks pass, and a simple deploy smoke passes. Production still runs the legacy Firestore application; representative production-derived import and release freezing belong to Guarded Phase 5.

### Phase 5 — Rehearsed Firestore → Supabase production cutover

This phase is intentionally split into separately approved actions. There is no casual “run migration” step.

- [ ] **`[PROD-CONFIG]`** Before any real customer write or live traffic, approve/upgrade the full billing and backup tier, record DPA/processor status and ownership/recovery contacts, remove synthetic data/test users, rebuild from committed migrations, prove restore, and reclassify the exact Supabase target as Production.
- [ ] **`[LOCAL]` / `[REMOTE-CONFIG]` / `[PROD-CONFIG]`** Define a dedicated production-operator workflow: protected GitHub Environment/manual approval, exact project allowlist, short-lived production secrets, no development startup, migration/import-only commands, redacted artifacts, and credential teardown. Normal CI never receives Production credentials.
- [ ] **`[LOCAL]` / `[TEST]`** Capture/version current Firestore rules/indexes and prepare tested temporary deny-write plus final deny-all rules for the cutover. Do not deploy them yet.
- [ ] **`[PROD-READ]`** After explicit approval, take a bounded read-only Firestore inventory/export only after target/project verification; declare PII and read cost, redact reports, and store raw exports encrypted outside git.
- [ ] **`[PROD-CONFIG]`** Enable/verify a current Firestore backup/PITR strategy for the source until cutover is complete.
- [ ] **`[PROD-READ]` / `[TEST]`** With separate approval, restore the PII-bearing source export only into a restricted recovery environment with named access, no public app/email, and a destruction deadline. Prove counts/representative records, generate an anonymized derivative for staging tests, then securely destroy the recovery copy.
- [ ] **`[LOCAL]`** Freeze the exact source commit and dependency lockfile for Production and record its environment manifest, smoke tests, and forward-recovery commit. Production-scoped values may be baked at build time, so Preview is not treated as a promotable binary artifact.
- [ ] **`[PROD-READ]` / `[TEST]`** Transform the approved production-derived source inside the restricted recovery workflow; import only the approved anonymized derivative to ordinary staging using preserved `legacy_firestore_id`, and emit only redacted counts/anomalies.
- [ ] **`[PROD-READ]` / `[TEST]`** Reconcile source IDs and totals: appointments, blocks, vacations, subscribers, status counts, future confirmed bookings, date/time conversions, duration/buffer, duplicates, and quarantine. Source must equal imported plus explicitly reviewed quarantine.
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

- [ ] **`[PROD-CONFIG]` / `[PROD-APP]`** If an external error provider is approved, complete its EU/PII-safe setup, source maps, release tags, handled Resend-error capture, uptime alerts, owner escalation, and `docs/OPERATIONS.md`; otherwise prove the equivalent provider-neutral alert path.
- [ ] **`[LOCAL]`** Add one dependency-update system (Dependabot or Renovate), recurring audit gates, and an explicit patch cadence.
- [x] **`[LOCAL]`** Upgrade to Next 16.2.12/React 19.2.8 with the official codemods, migrate Middleware to Proxy, adopt native flat ESLint config, move Tailwind to 4.3.3, and update the compatible runtime/test/build dependencies. Local Turbopack build, TS7/TS6, lint, and 2,236 tests pass; production audit remains 0 high/critical.
- [ ] **`[TEST]` / `[PROD-APP]`** Prove the upgraded framework/tooling on one immutable Preview with public/owner interaction smoke and Lighthouse before any approved Production promotion. Production remains separately guarded.
- [ ] **`[LOCAL]` / `[PROD-APP]`** Roll out CSP in Report-Only first; handle inline scripts and Vercel/Sentry/Supabase/map origins; then enforce with `frame-ancestors`, `nosniff`, Referrer-Policy, and Permissions-Policy. HSTS already exists.
- [ ] **`[LOCAL]` / `[PROD-APP]`** Remove the observed wildcard CORS response from business/API routes; allow only required same-origin or explicit origins and add negative preflight tests.
- [x] **`[LOCAL]`** Fix sitemap field names/stable modification dates, remove noindexed policy from sitemap, add route-specific canonicals, and emit reciprocal Italian/English alternates. Preview/TEST is fail-closed `noindex`; Production indexing still requires deployment verification.
- [x] **`[LOCAL]`** Use the owner-confirmed Via Emilia 60 and centralize verified NAP, contact details, opening hours, map/geo data, and social identity across the site, privacy text, footer, FAQ, and LocalBusiness schema.
- [ ] **`[PROD-CONFIG]` / `[PROD-APP]`** Verify the same NAP after deployment and update Google Business Profile, Instagram, Apple/other directories, and any remaining external listings; do not infer an external listing from repository content.
- [x] **`[LOCAL]`** Render real visible Italian/English FAQ content from the same source as FAQ schema and remove the unsupported bridal claim. Do not promise Google FAQ rich results for a salon; validate the deployed Production schema separately.
- [x] **`[LOCAL]`** Add useful Italian/English landing pages for five high-intent categories using only the existing service catalogue: face treatments, laser hair removal, manicure/pedicure, massage, and lashes/brows. Each has unique copy, reciprocal locale links, metadata, breadcrumbs/schema, internal links, and sitemap coverage. Add complete `/servizi` and `/en/services` catalogues containing all 12 categories and 74 active services, grouped for customer discovery rather than exposing one long booking-form wall. Owner review and deployed search validation remain required before Production promotion.
- [x] **`[LOCAL]`** Measure and optimize the public critical path: split the gallery modal; viewport-load booking/newsletter/gallery images and interaction-load the map; give only real LCP images high priority; consolidate duplicate Tailwind output; use one variable font; add responsive image sizing; and transcode/compress oversized sources. The homepage fell from 248 kB to 119 kB first-load JS, public CSS gzip fell from 23.9 kB to 13.2 kB, 12 JPEG sources fell 47.7% by bytes and 81.3% by decoded pixels, and the OG asset is 56% smaller. Repeated Lighthouse 13 mobile runs on the local optimized build scored Performance 97–99 on the key public surfaces, Accessibility 100 and Best Practices 100 after fixes, with zero TBT/CLS on the representative pages.
- [x] **`[LOCAL]`** Adopt the useful Next 16/React 19 diagnostics and features behind measured gates: native route/bundle analysis, React-profile and CPU-profile builds, loopback Playwright/CDP traces, annotation-only React Compiler for the gallery, and `useEffectEvent` for notification cleanup. Strict lightweight public wire/form validators keep authoritative server Zod validation while cutting deferred booking from 146.9 to 73.9 kB gzip; initial home JS is flat and gallery Compiler cost is only 586 B gzip. Final home/booking and gallery traces have zero CLS/long tasks, mobile Lighthouse median is 94 with Accessibility/Best Practices 100, and desktop is 100/100/100. Activity, optimistic/action state, broad transitions, and deferred gallery filtering remain intentionally unused where privacy, authoritative mutation semantics, or measured benefit do not justify them. Cache Components are explicitly out of scope.
- [ ] **`[PROD-APP]`** After an approved Preview/Production deployment, repeat Lighthouse against the immutable deployment and verify real-user Speed Insights/Core Web Vitals. Preserve fail-closed Preview `noindex`; do not alter crawler safety merely to raise a local SEO score.
- [x] **`[LOCAL]`** Add crawlable English marketing routes at `/en`, `/en/gallery`, `/en/contacts`, and `/en/privacy`, with correct document language, translated navigation/content, self-canonicals, reciprocal `hreflang`, localized schema, and a route-preserving language switch. Preserve the existing unprefixed Italian URLs.
- [x] **`[LOCAL]` / `[TEST]`** Localize the booking form, validation, calendar dates, maintenance/API feedback, notifications, and confirmation after stable catalog IDs became authoritative. English display labels now map to the same canonical service/variant IDs as Italian, and 390×844 interaction/geometry checks plus focused API/UI tests pass on the isolated QA Preview.
- [ ] **`[LOCAL]` / `[TEST]`** Finish the remaining bilingual transaction surfaces: localize customer emails and the newsletter lifecycle without changing persisted IDs or immutable v1 email bytes.
- [ ] **`[PROD-CONFIG]`** Keep key facts server-rendered; allow actual search crawlers such as OAI-SearchBot as desired; treat GPTBot/training separately. `llms.txt` is optional, not a ranking requirement; Google says normal SEO powers its AI features.
- [ ] **`[PROD-CONFIG]`** Choose a booking-funnel metric available on the actual Vercel plan. Hobby does not include custom events; use a PII-free server aggregate or approve Pro.
- [ ] **`[PROD-CONFIG]`** Verify Search Console, sitemap, Rich Results/schema validators, Google/Apple business listings, and Speed Insights. Search Console and Bing Webmaster submission are explicitly owner-deferred; use Speed Insights when low traffic yields insufficient CrUX data.

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
- More detailed business reporting.

---

## 5. Lane-aware sequence

```text
0 emergency containment
→ 1 greenfield isolation + CI + Supabase approval
→ 2 tested relational schema and booking kernel
→ 3 complete server/auth/email vertical slice in staging
→ 4 greenfield Supabase application integration
→ 5 guarded freeze + reconciled Firestore→Supabase cutover
→ 6 delete legacy code, then TypeScript-convert survivors
→ 7 operations/framework/security/SEO/performance
→ 8 owner-led dashboard redesign
```

The phase order records architectural dependencies. It is strict for the Guarded production-data/cutover chain, but it does not block isolated Fast Lane UI, copy, bug fixes, ordinary features, or greenfield schema/application work. Those changes may proceed whenever target isolation is verified and their focused checks pass.

The migration rule is:

> **Never canonicalize production Firestore and then migrate it to Supabase. Choose the target first, prove it locally and against a restored snapshot, and perform one production-data transition.**

### Realistic duration

The original 4–5 week “part-time” estimate was too optimistic. The implementation is approximately **25–40 focused development days**, plus the DMARC observation window, production cutover scheduling, the 30-day recovery-retention window, and owner testing. A realistic part-time calendar is roughly **8–12 weeks before dashboard redesign**, depending on review speed and migration anomalies.

---

## 6. Success metrics

- **Production safety:** local/normal-CI/Preview cannot reach production; every Guarded production action has a label, target, approval, and proportionate evidence. Backup/restore evidence is mandatory for real-data migration, restoration, destructive data work, and cutover—not unrelated routine development.
- **Security:** public raw-PII/mail routes gone; browser business-table access denied; owner authorization is explicit; public operations are validated and abuse-limited.
- **Reliability:** database-enforced active-interval overlap; parallel same-slot test yields exactly one booking; idempotent retries never duplicate; email failures persist and alert.
- **Migration integrity:** every Firestore source ID is imported or explicitly quarantined; future bookings, blocks, vacations, subscribers, statuses, and date/time conversions reconcile; Firestore remains read-only for 30 days.
- **Privacy:** concrete retention/anonymization matrix, consent/unsubscribe evidence, processor inventory, data-subject workflow, no PII logs, and PII-safe monitoring.
- **Cost:** non-booking public routes perform zero database calls; availability responses contain slots only; dashboard queries are bounded; Supabase/Vercel budgets and alerts are documented.
- **Maintainability:** one canonical operation path, one typed booking core, strict TypeScript for surviving code, no custom cache infrastructure, small modules, reproducible local database.
- **Quality gates:** focused checks during Fast Lane work; the exhaustive slot/DST/migration/rules/auth/email, Preview, screenshot/accessibility, and production smoke matrix at coherent release, security-boundary, and cutover checkpoints.
- **Operations:** restore drill succeeds; RPO/RTO and failure recovery are documented; alerts reach the owner/operator; supported dependency line stays current.
- **Business:** booking completion is measurable without PII, service information is accurate, and the owner validates the final dashboard workflow.

---

## 7. Rules of engagement

1. Choose Fast or Guarded Lane before work. Read `docs/PRODUCTION-SAFETY.md` before Guarded database/auth/deployment/provider/environment work; ordinary synthetic greenfield work follows the lightweight Fast Lane rule above.
2. Fast work gets one concise lane/target/data statement. Guarded plans, approvals, PRs, and worklog entries include the complete target, bounds, evidence, and recovery record.
3. Internal refactors preserve existing visuals. Intentional UI/copy/product changes use focused visual/interaction review in Local/Preview; their Production deployment remains Guarded.
4. No production database mutation occurs from local development, CI, Preview, a browser client, or an ad-hoc dashboard query.
5. Backups precede migrations against authoritative or real-data systems; restore proof precedes production-data writes. Empty synthetic greenfield migrations are versioned, observable, and reversible/forward-fixable. Additive and destructive Guarded changes remain separate approvals.
6. Stale clients fail visibly and safely. Compatibility spans at least two production releases before cleanup.
7. Every database query is bounded or aggregate. Every production change states expected reads/writes/rows and verifies the actual result.
8. If evidence invalidates the foundation, redesign it. Do not preserve architecture merely because work has already started.
