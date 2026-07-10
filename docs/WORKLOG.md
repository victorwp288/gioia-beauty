# Worklog

Session journal for the refactor. **Newest entry on top.** Every working session inserts one entry immediately below the divider — this is how the next session (human or LLM) picks up where you left off.

## Entry template

```markdown
## YYYY-MM-DD — <one-line session focus>
**Phase:** <masterplan phase(s) touched>
**Labels/environment:** <e.g. [LOCAL], local only>
**Data impact:** <none | bounded read | additive write | update | soft delete | destructive>
**Target:** <project/database/environment or none>
**Expected reads/writes/rows:** <exact bounds or none>
**Done:** <what shipped, with commit hashes; reference masterplan items ticked>
**Verified/reconciled:** <build, tests, flow, counts/invariants, or n/a>
**Production actions performed:** <none or exact actions with run/deploy IDs>
**Backup/restore evidence:** <named evidence or n/a>
**Rollback/forward recovery:** <path or n/a>
**Next:** <the exact next action, specific enough to start cold>
**Gotchas:** <surprises, decisions made, anything the next session must know — omit if none>
```

Rules: keep entries under ~20 lines; insert the newest entry immediately below the divider; don't duplicate what the masterplan or git history already says; "Next" must be actionable without reading this whole file. Never rewrite old entries.

---

## 2026-07-10 — Reconciled and enforced all active API contracts
**Phase:** Phase 3 server-boundary verification; no broad checklist item completed
**Labels/environment:** [LOCAL] documentation, static analysis, and tests only
**Data impact:** none; no runtime, database, Auth, provider, schema, fixture, or remote call
**Target:** local `refactor`; no remote or Production target
**Expected reads/writes/rows:** verification and this commit perform 0 application DB/Auth/provider reads, 0 writes, and 0 rows
**Done:** Commit `dd23995` replaces the stale 4-route list with all 19 exported route contracts, truthful result/mutation/Auth/provider bounds, physical-read caveats, day-lock costs, current activation state, and explicit hardening gaps. A TypeScript-AST/filesystem test now requires one exact marker and active table row per route across route groups and `.js/.jsx/.ts/.tsx`, rejects wildcard/type-only/malformed/misplaced exports/markers, and checks every removed-route extension.
**Verified/reconciled:** format/static SQL/lint/TS7/TS6 and 80 files/806 tests pass; two independent accuracy/security re-reviews report no blockers. Exact prior booking-parser head `4cb9d75` passed all six CI jobs, dependency/secret checks, and both clean database cycles in run `29079779049`; runtime/build bytes are unchanged here and replacement CI is pending.
**Production actions performed:** none; no Firebase, Supabase, Vercel, DNS, Resend, `main`, Production data, or configuration access
**Backup/restore evidence:** n/a; no remote mutation
**Rollback/forward recovery:** revert `dd23995`; no external state changed
**Next:** Apply the public-booking streamed-body pattern to shared `readValidatedJson` for temporary `/api/send` and `/api/cancel`: strict query/media/identity/length gates, raw 8 KiB cap, fatal UTF-8, bounded bearer/origin handling, and regression-proof zero-delivery tests. Preserve owner authorization and process limiter order unless a reviewed security reason changes it.
**Gotchas:** Owner commands still ignore query strings and accept versions above PostgreSQL int32 until repository validation; modern public routes lack durable abuse limits; legacy validation can reflect supplied unknown field names. The inventory now fails CI when any explicit API export changes without a contract update.

## 2026-07-10 — Bounded public booking streams before buffering
**Phase:** Phase 3 public booking boundary; broad booking/abuse/E2E checklist items remain open
**Labels/environment:** [LOCAL] implementation and static/unit/build verification only
**Data impact:** none; no database, Auth, provider, schema, fixture, or remote call
**Target:** local `refactor`; no remote or Production target
**Expected reads/writes/rows:** rejected requests perform 0 DB/Auth/provider work. An accepted runtime request keeps the existing 1 transaction/1 private-function query/1 result-row contract; a fresh success has at most 7 row mutations across 6 distinct rows (command twice, optional day lock, appointment, domain change, and up to 2 pending outbox rows), while an exact replay writes 0 rows and no request calls a provider.
**Done:** Commit `6a331f4` replaces unbounded `request.text()` buffering with a raw streamed 8 KiB cap/cancellation, fatal UTF-8 decoding, canonical query/origin/idempotency/media/encoding/length gates, explicit rejection precedence, and regression-proof zero-DB tests. Repository, SQL overlap, fingerprinting, and concurrency behavior are unchanged.
**Verified/reconciled:** format/lint/TS7/TS6, 79 files/792 tests, 24 focused boundary tests, and production build pass; independent parser/security review reports no blockers. Exact prior health head `812a148` passed all six CI jobs, dependency/secret checks, and both clean 342-assertion database cycles in run `29079160588`; replacement CI is pending.
**Production actions performed:** none; no Firebase, Supabase, Vercel, DNS, Resend, `main`, Production data, or configuration access
**Backup/restore evidence:** n/a; no remote mutation
**Rollback/forward recovery:** revert `6a331f4`; no external state changed
**Next:** Reconcile `docs/API-INVENTORY.md` against all 19 current route modules and add an exact filesystem-to-document coverage test, including truthful logical-versus-observed effect bounds. Then apply the same streamed-cap correction to the two temporary legacy mail boundaries without changing their owner-only/fail-closed policy.
**Gotchas:** Legitimate callers must send no query, lowercase canonical UUID idempotency, canonical same-origin when Origin is present, and JSON with only optional UTF-8 charset plus identity encoding. The legacy mail handlers still check 8 KiB only after `request.text()`; all 10 owner mutations currently ignore query strings, and version values above PostgreSQL int32 reach a redacted 503 instead of request validation.

## 2026-07-10 — Added constant read-free liveness endpoint
**Phase:** Phase 3 observability foundation; combined Sentry/logging/metrics/health checklist item remains open
**Labels/environment:** [LOCAL] implementation and static/unit/build verification only
**Data impact:** none; no database, Auth, provider, schema, fixture, or remote call
**Target:** local `refactor`; no remote or Production target
**Expected reads/writes/rows:** each `GET /api/health` performs 0 database/Auth/provider/network reads, 0 writes, and 0 rows; it returns one constant response
**Done:** Commit `324efae` adds a dynamic Node liveness route with strict `{status:"ok"}` output, no request/environment/build metadata, shared hardened no-store headers, noindex, direct-schema validation, focused tests, and explicit liveness-not-readiness operations guidance.
**Verified/reconciled:** format/static SQL/lint/TS7/TS6, 79 files/781 tests, and an isolated production build pass; build lists `/api/health` as dynamic. Independent security/acceptance reviews report no blockers. Exact prior webhook head `1c03b6e` passed all six CI jobs, dependency/secret checks, and both clean 342-assertion database cycles in run `29078531360`; replacement CI is pending.
**Production actions performed:** none; no Firebase, Supabase, Vercel, DNS, Resend, `main`, Production data, or configuration access
**Backup/restore evidence:** n/a; no remote mutation
**Rollback/forward recovery:** revert `324efae`; no external state exists
**Next:** Push and green replacement CI, then reconcile `docs/API-INVENTORY.md` with all 19 current route modules and add a coverage test. After that, replace the public booking handler's unbounded `request.text()` buffering with the reviewed streamed 8 KiB/fatal-UTF-8/identity-encoding/query-free boundary.
**Gotchas:** A 200 proves only Next.js process liveness, never database/Auth/provider/migration/queue/restore readiness. Sentry, PII-safe structured logging, and route metrics remain separate work. Manual outbox retry must remain Production-disabled until a post-checkpoint migration enforces the 24-hour provider-idempotency stop.

## 2026-07-10 — Added inactive verified Resend webhook boundary
**Phase:** Phase 3 reliable-side-effect foundation; broad outbox checklist item remains open
**Labels/environment:** [LOCAL] implementation and static/unit/build verification only
**Data impact:** none; no database, Auth, fixture, provider, schema, or remote call
**Target:** local `refactor`; webhook side effects remain disabled because no Production Supabase target is registered
**Expected reads/writes/rows:** verification performed 0 database/provider operations. A rejected request performs 0 database work. A future enabled verified request makes 1 transaction and 1 private-function call returning exactly 1 row; it touches at most 1 webhook event, 1 outbox, 1 subscriber, and 1 audit row, with at most 5 row mutations. An already-processed exact replay writes 0 rows.
**Done:** Commit `aa5ef5c` adds a 32 KiB raw-body boundary, exact pinned-Svix verification, five-minute freshness enforcement, PII-reducing event mapping, payload hashing, replay-deduplicated persistence, redacted responses, and fail-closed Production activation gates.
**Verified/reconciled:** format/static SQL/lint/TS7/TS6/build and 778 tests pass; independent security/code/acceptance reviews report no blockers. Prior head `b3770c8` passed all six CI jobs, including two clean 342-assertion database cycles, in run `29077228922`; replacement CI and its dependency-audit lane are pending.
**Production actions performed:** none; no Firebase, Supabase, Vercel, DNS, Resend, `main`, Production data, or configuration access
**Backup/restore evidence:** n/a; no remote mutation
**Rollback/forward recovery:** revert `aa5ef5c`; provider registration and Production environment remain unchanged
**Next:** Push and green replacement CI, then implement the migration-free owner outbox retry boundary against the existing reviewed SQL command. Keep Cron activation, newsletter rendering, retry-age enforcement, dead-letter alerting, migration 38, and TEST credit blocked until the exact 37-migration TEST checkpoint and required contract evidence.
**Gotchas:** Only delivered/bounced/complained are stateful; failed/suppressed/delayed require a later schema/state policy. Provider registration and Production secrets/flags/deployment remain separately approved Production actions, and permanent signed 400/409 retry handling is a launch policy/alerting gate.

## 2026-07-10 — Added inactive bounded email-outbox worker foundation
**Phase:** Phase 3 reliable-side-effect foundation; broad outbox checklist item remains open
**Labels/environment:** [LOCAL] implementation and static/unit/build verification only
**Data impact:** none; no database, Auth, fixture, provider, schema, or remote call
**Target:** local `refactor`; no Cron route/schedule and no TEST or Production target
**Expected reads/writes/rows:** verification performed 0 DB/Auth/provider operations. One future enabled invocation makes exactly 1 claim function call with batch 5/120-second lease, at most 5 provider attempts at concurrency 5, and at most 5 one-row completion calls: maximum 6 DB function calls, 5 sends, and 10 outbox row transitions.
**Done:** Commit `65ebb2f` adds strict snake/camel claim and fenced completion repositories, immutable escaped v1 schedule email renderers, bounded Resend REST/idempotency handling, deterministic no-network fake delivery, a complete-renderer fail-closed gate, one-batch worker isolation, Production Resend-key validation, and the 24-hour completion-uncertainty launch policy.
**Verified/reconciled:** format/static SQL/lint/TS7/TS6/build and 727 tests pass; independent security/code/acceptance re-reviews report no blockers. Prior head `554ea5d` passed all six CI jobs, including two clean 342-assertion database cycles, in run `29075261589`; replacement CI is pending. Local Gitleaks is unavailable and remains a required CI lane.
**Production actions performed:** none; no Firebase, Supabase, Vercel, DNS, Resend, `main`, Production data, or configuration access
**Backup/restore evidence:** n/a; no remote mutation
**Rollback/forward recovery:** revert `65ebb2f`; worker activation is intentionally unreachable and all schema/provider state remains unchanged
**Next:** Push and green replacement CI, then implement the migration-free raw-body Resend webhook signature/freshness mapper and strict verified-webhook repository against the existing SQL command. Keep Cron exposure, newsletter action rendering, retry-age enforcement, dead-letter alerting, migration 38, and TEST credit blocked until the exact 37-migration TEST checkpoint and required contract evidence.
**Gotchas:** Schedule-only renderers cannot instantiate the worker, so newsletter rows cannot be accidentally claimed. Resend idempotency expires after 24 hours; automatic/manual recovery beyond that window remains a launch stop, not a blind retry.

## 2026-07-10 — Added owner details, reschedule, and status commands
**Phase:** Phase 3 authenticated server vertical slice; broad checklist items remain open
**Labels/environment:** [LOCAL] implementation and static/unit/build verification only
**Data impact:** none; no database, Auth, fixture, schema, or provider call
**Target:** local `refactor`; no remote or Production target
**Expected reads/writes/rows:** verification performed 0 DB/Auth reads/writes; accepted runtime requests make 1 fresh Auth user check and 1 owner transaction/1 private function query bounded to 2 result rows. A success changes 1 command row, 1 schedule row, and 1 audit row; appointment reschedule additionally queues exactly 2 outbox rows, while replay adds no domain write.
**Done:** Commit `50cf783` adds appointment/block detail and reschedule plus appointment status routes/repositories; strict body/command parity; status-qualified failure pairs; exact resource/patch contracts; and 24 pgTAP assertions. The guarded TEST manifest remains 37 migrations and now pins 21 test files/342 assertions.
**Verified/reconciled:** format/static SQL/lint/TS7/TS6/build and 682 tests pass; independent code and SQL reviews report no blockers. Prior ten-route head `c35f0ea` passed all six CI jobs in run `29074286432`; replacement CI must execute the new pgTAP file twice before this slice is complete.
**Production actions performed:** none; no Firebase, Supabase, Vercel, DNS, Resend, `main`, or Production data/config access
**Backup/restore evidence:** n/a; no remote mutation
**Rollback/forward recovery:** revert `50cf783`; remote TEST and all migration bytes remain unchanged
**Next:** Push and confirm replacement CI, then implement the migration-free server outbox claim/delivery completion worker and fake-transport tests against the existing reviewed SQL commands. Keep migration 38 and list/count/vacation-read work blocked until the exact 37-migration TEST checkpoint runs.
**Gotchas:** Appointment detail patches translate only supplied camelCase fields to snake_case JSON; explicit null is preserved and absent fields stay absent. `STATUS_TRANSITION_INVALID` is valid at both 400 and 409 and is keyed by status plus code.

## 2026-07-10 — Exposed five transaction-authorized owner schedule commands
**Phase:** Phase 3 authenticated server vertical slice; broad checklist items remain open
**Labels/environment:** [LOCAL] implementation and static/unit/build verification only
**Data impact:** none; no database, Auth, fixture, schema, or provider call
**Target:** local `refactor`; no remote or Production target
**Expected reads/writes/rows:** verification performed 0 DB/Auth reads/writes; invalid runtime requests stop before Auth/DB, while accepted requests make 1 fresh Auth user check and 1 owner transaction/1 private function query bounded to 2 result rows; domain writes remain atomic inside the existing reviewed SQL command
**Done:** Commit `295ad0c` adds POST routes for appointment/block create, schedule soft-cancel, and vacation create/cancel; canonical body schemas and fingerprint metadata; exact stored/thrown result adapters; Next cookie/config failure handling; and removes duplicate `/api/admin/**` middleware Auth.
**Verified/reconciled:** format/static SQL/lint/TS7/TS6/build and 611 tests pass; two independent route/security audits report no blockers after exact route-wiring and Next cookie/config proof. Prior boundary head `5978f96` passed all six CI jobs in run `29073212320`; replacement CI for this route head is pending.
**Production actions performed:** none; no Firebase, Supabase, Vercel, DNS, Resend, `main`, or Production data/config access
**Backup/restore evidence:** n/a; no remote mutation
**Rollback/forward recovery:** revert `295ad0c`; remote TEST and all schemas remain unchanged
**Next:** Push and confirm replacement CI, then add the migration-free owner appointment/block edit, reschedule, and status command repository/routes against the already committed SQL functions. Keep migration 38 and list/count/vacation-read work blocked until the exact 37-migration TEST checkpoint runs.
**Gotchas:** Every admin mutation now self-enforces origin/CSRF, fresh Auth, HMAC binding, and transaction-local owner/session authorization. Middleware refresh remains dashboard-only; do not re-add API matching.

## 2026-07-10 — Guarded owner command request and response boundaries
**Phase:** Phase 3 server vertical-slice foundation; no broad checklist item completed yet
**Labels/environment:** [LOCAL] implementation and static/unit/build verification only
**Data impact:** none; no database, Auth, fixture, schema, or provider call
**Target:** local `refactor`; no remote or Production target
**Expected reads/writes/rows:** verification performed 0 DB/Auth reads/writes; rejected runtime requests stop before Auth/DB, while accepted requests will make 1 fresh Auth user check plus the repository's 1 owner transaction/1 private function query bounded to 2 result rows
**Done:** Commit `28b27df` adds exact origin/CSRF, UUID idempotency, JSON/UTF-8/8 KiB, normalized fingerprint, fresh Auth/session-binding, fail-closed SQL-error mapping, request-ID, and repeated refresh-cookie boundaries for the five owner schedule commands.
**Verified/reconciled:** format/static SQL/lint/TS7/TS6/build and 557 tests pass; integrated security review passed 109 focused tests with no blockers. Exact repository-slice head `eca1ed1` passed all six CI jobs in run `29072163596`; replacement CI for this boundary head is pending.
**Production actions performed:** none; no Firebase, Supabase, Vercel, DNS, Resend, `main`, or Production data/config access
**Backup/restore evidence:** n/a; no remote mutation
**Rollback/forward recovery:** revert `28b27df`; schema and remote TEST remain unchanged
**Next:** Wire five thin `/api/admin/**` mutation handlers to this guard and `ownerScheduleRepository`, prove CSRF-before-Auth/DB plus exact success/error/replay behavior, then remove duplicate middleware Auth work only after every matched route is self-guarding. Keep migration 38 blocked until the exact 37-migration TEST checkpoint runs.
**Gotchas:** Unknown SQLSTATE/message combinations deliberately redact to 503. Only repeated `Set-Cookie` and exact `Expires: 0` may pass from Auth refresh headers into owner command errors.

## 2026-07-10 — Added session-bound owner schedule command repository
**Phase:** Phase 3 server vertical-slice foundation; Phase 2 remote TEST checkpoint remains pending
**Labels/environment:** [LOCAL] implementation and static/unit/build verification only
**Data impact:** none; no database, Auth, fixture, schema, or provider call
**Target:** local `refactor`; no remote or Production target
**Expected reads/writes/rows:** verification performed 0 DB reads/writes; at runtime each method makes 1 owner transaction + 1 private function query bounded to 2 rows, while domain writes remain those of the existing reviewed command
**Done:** Commit `061e24e` adds normalized, session-bound repositories for appointment/block create, schedule soft-cancel, and vacation create/cancel. Each uses exact SQL parameter contracts, copied 32-byte fingerprints, PostgreSQL integer bounds, operation-specific result/error validation, and no direct table access.
**Verified/reconciled:** format/static SQL/lint/TS7/TS6/build and 475 tests pass; two independent repository contract/security re-audits report no blockers. Exact prior head `19b3da3` passed all six CI jobs in run `29071345565`; replacement CI for this head is pending.
**Production actions performed:** none; no Firebase, Supabase, Vercel, DNS, Resend, `main`, or Production data/config access
**Backup/restore evidence:** n/a; no remote mutation
**Rollback/forward recovery:** revert `061e24e`; schema and remote TEST remain unchanged
**Next:** Keep the 37-migration checkpoint stable: inject the authorized TEST operator DSN + publishable key and run the two-cycle checkpoint before migration 38. While credentials are unavailable, implement the reusable fresh-bound owner request guard and strict admin command handlers/routes against these repositories.
**Gotchas:** Owner list/count/vacation-read functions require migration 38 and must wait until current TEST acceptance is captured. Middleware refreshes cookies but is not authorization; every future `/api/admin/**` route must enforce fresh Auth/binding/CSRF itself.

## 2026-07-10 — Added atomic two-cycle greenfield TEST acceptance operator
**Phase:** Phase 2 TEST acceptance tooling; remote execution remains pending
**Labels/environment:** [LOCAL] implementation/verification; [TEST] bounded read-only migration metadata inspection
**Data impact:** 35 TEST migration-history metadata rows read; 0 business rows and 0 remote writes
**Target:** `refactor`; authorized TEST Supabase `lxvsspniipcotimbsfqm`; no Production target
**Expected reads/writes/rows:** performed: 35 metadata reads/0 writes/0 business rows; a future operator run is separately bounded to one locked target, 37 migrations, 194 reference rows, synthetic fixtures only, and zero final residue
**Done:** Commit `a4acf16` adds exact-SHA/green-CI preflight, allowlisted verify-full session-pooler access, reviewed-byte manifests, an atomic 35-or-37-to-37 rebuild, exact history/catalog/role/ACL reconciliation, bounded Data API/Auth-negative probes, two full acceptance cycles, and fail-closed cleanup. `526fc8a` requires exact safe Auth error bodies/request IDs; `8016f18` clears rejected owner sessions and accepts only strict deletion cookies.
**Verified/reconciled:** local format/static SQL/lint/TS7/TS6/build and 463 tests pass; independent SQL, acceptance, replay, and cookie-parser audits report no blockers. CI `29070605405` and `29070850789` passed five lanes each and exposed only the route-probe/session-cleanup gaps now fixed; exact-head replacement CI remains required.
**Production actions performed:** none; no Firebase, Vercel, DNS, Resend, `main`, or Production data/config access
**Backup/restore evidence:** n/a; no remote mutation. The pending TEST rebuild is one serializable transaction, so failure retains the exact prior clean state.
**Rollback/forward recovery:** revert `8016f18`, `526fc8a`, then `a4acf16`; remote TEST remains on its clean 35-migration/17-table snapshot
**Next:** Wait for exact-commit CI, then securely inject the TEST session-pooler operator DSN plus modern publishable key and run `npm run db:test:greenfield` with the exact confirmation; only tick Phase 2 TEST after both cycles reconcile.
**Gotchas:** No operator DSN/public key is available in this process and GitHub Environment `gioia-test` does not exist; no remote rebuild, Auth, fixture, or schema mutation was attempted.

## 2026-07-10 — Proved twice-clean booking kernel and revocable owner sessions
**Phase:** Phases 1–3; Local acceptance checkpoint
**Labels/environment:** [LOCAL], ephemeral GitHub Actions Supabase and fail-closed loopback route probe
**Data impact:** synthetic reset/seed/test writes only; ephemeral containers removed after each cycle
**Target:** `refactor`; GitHub Actions run `29065538790`; no remote Supabase or Production target
**Expected reads/writes/rows:** each cycle rebuilt 37 migrations/18 tables/194 reference rows; seeded 1 Auth user + 1 identity + 1 owner; bounded Auth ledger and concurrency fixtures only, followed by volume deletion
**Done:** Commits `79e6386..7d4b1d9` add deterministic Auth seed/replay, 20-way conflict/idempotency and cross-operation races, database-bound revocable owner sessions, real login/session/logout routes, strict authority/CSRF/cookies, and twice-clean CI. `eea6b48` additionally proves public signup remains disabled. Ticked the now-executable Phase 1 foundation and Phase 2 Local database items.
**Verified/reconciled:** run `29065538790` passed all six jobs; twice: seed reconciliation, DB lint/advisors, 326 pgTAP assertions, owner password login, real Next cookie/logout/replay flow, distinct-key 1/19, identical-key 1/19, booking-vacation one winner, opposite reschedules both rejected/originals preserved. Local: 302 Vitest tests, lint, typecheck, format, build.
**Production actions performed:** none; no Firebase, Vercel, DNS, Resend, `main`, or Production data/config access
**Backup/restore evidence:** n/a for disposable Local/CI; Production backup/restore gates remain open
**Rollback/forward recovery:** revert the phase-prefixed commits; remote TEST remains on its prior clean 35-migration snapshot
**Next:** Green the signup-denial CI addition, add the exact-ref locked TEST runner, then perform two guarded rebuild/seed/advisor/pgTAP/Auth/concurrency/cleanup cycles on authorized TEST `lxvsspniipcotimbsfqm`; after that implement the bounded owner schedule list/count/create/cancel slice.
**Gotchas:** This Mac still has no Docker daemon, so executable DB evidence comes from clean CI. Repository state is 37 migrations/18 private tables; remote TEST is intentionally still 35/17 until the reviewed rebuild runner exists.

## 2026-07-10 — Established typed database foundation and public booking boundary
**Phase:** Phases 1–3
**Labels/environment:** [LOCAL], static/build/unit verification only
**Data impact:** none
**Target:** local `refactor` worktree; no database, deployment, auth provider, email provider, or Production target
**Expected reads/writes/rows:** 0 database/provider reads; 0 writes; 0 rows
**Done:** Commits `858dd70` and `63ba794` add strict TypeScript 7 with a TS6 fallback, pinned Supabase/CI/test tooling, a stable 12-category/74-service/102-variant catalog, the pure Europe/Rome booking kernel, private schema and transactional command migrations, pgTAP/concurrency coverage, and server-only availability/booking endpoints. Ticked only locally proven Phase 1–2 checklist items.
**Verified/reconciled:** clean `npm ci`; format; static SQL checks; 203 Vitest tests; TypeScript 7 and 6; ESLint; Next production build; timezone reruns under New York/Tokyo; bundle secret scan; dependency audit 0 high/critical. `git diff --check` passed.
**Production actions performed:** none
**Backup/restore evidence:** n/a; no remote data/configuration action
**Rollback/forward recovery:** revert `63ba794` then `858dd70`; migrations remain unapplied remotely
**Next:** Push `refactor`, inspect GitHub CI, and fix the Docker Supabase reset/lint/advisor/pgTAP/concurrency-twice gates until green; only then preflight and apply the reviewed migrations to authorized TEST `lxvsspniipcotimbsfqm`.
**Gotchas:** This Mac has no Docker, so database execution is deliberately unclaimed until CI. Local Gitleaks is absent; CI installs pinned Gitleaks. The legacy UI/root Firebase provider is not yet wired to the new endpoints and must not be manually loaded.

## 2026-07-09 — Contained legacy routes and made development fail closed
**Phase:** Phase 0 containment and Phase 1 environment isolation
**Labels/environment:** [LOCAL], static/build/unit verification only
**Data impact:** none
**Target:** local worktree; no database, deployment, auth provider, email provider, or Production target
**Expected reads/writes/rows:** 0 database/provider reads; 0 writes; 0 rows
**Done:** Commit `c3ba3f4` removed raw appointment/test routes, made legacy mail owner-only with strict validation/redacted outcomes, separated deletion from email failure, removed unsafe scripts/keys/logs/React Scan/Twilio, upgraded to Next 15.5.20, pinned Node/npm, added ESLint 9/Prettier/lint-staged/Gitleaks, and installed exact environment/URL/emulator sink gates. Production startup is disabled until a Supabase Production target is formally registered.
**Verified/reconciled:** clean `npm ci`; build; ESLint; Prettier; 40 Vitest tests; current-tree + 193-commit Gitleaks scans; client-bundle secret scan; forbidden Firebase-target build rejection. Production dependency audit: 0 critical/high, 6 accepted moderate records from unused optional Firebase Admin Storage/UUID code, documented in `DEPENDENCY-AUDIT.md`.
**Production actions performed:** none
**Backup/restore evidence:** n/a; no remote data/configuration action
**Rollback/forward recovery:** revert `c3ba3f4`; forward path replaces owner-only legacy mail with atomic booking/outbox before any release
**Next:** Add strict TypeScript and the full local/CI test harness, initialize versioned Supabase CLI files, then implement the reviewed private schema/day-lock/idempotency migrations and pure Europe/Rome booking kernel.
**Gotchas:** Public booking email intentionally fails closed on `refactor`, so the branch is not releasable until Phase 3 outbox integration. Supabase CLI 2.105.0 exists, but no Docker/Podman/Colima/OrbStack runtime is installed; prefer repository scaffolding plus the authorized synthetic TEST project until a local runtime is available.

## 2026-07-09 — Reclassified Supabase as greenfield integration target
**Phase:** Phase 1 environment registry and ADR gate
**Labels/environment:** [LOCAL] documentation; [TEST] bounded Supabase metadata inspection
**Data impact:** none; read-only metadata, zero business rows
**Target:** Supabase `gioia-beauty` / `lxvsspniipcotimbsfqm` (`eu-central-2`)
**Expected reads/writes/rows:** project, public-table, migration, and advisor metadata; 0 writes; 0 business rows
**Done:** Reconciled `ENVIRONMENTS.md`, `ADR-001-SUPABASE.md`, and `MASTERPLAN.md` with Victor's authorization to use the empty project for resettable greenfield integration/staging. Accepted the one-migration ADR for implementation while preserving separate Production cost, backup, restore, migration, and cutover gates.
**Verified/reconciled:** project remains `ACTIVE_HEALTHY`; PostgreSQL 17; 0 public tables; 0 migrations; 0 advisor findings; `git diff --check` passed
**Production actions performed:** none
**Backup/restore evidence:** n/a; no data or remote mutation
**Rollback/forward recovery:** revert the documentation commit; remote project is unchanged
**Next:** Complete Phase 0 locally, beginning with the isolated route-test harness and lazy Resend construction; do not start the application before fail-closed isolation.
**Gotchas:** The older worklog entry is historical and intentionally still says the project was initially reserved for Production; the current environment registry supersedes it.

## 2026-07-09 — Registered empty Supabase Production target
**Phase:** Phase 1 environment inventory; no implementation checklist item completed
**Labels/environment:** [PROD-READ] Supabase metadata/schema inspection; [LOCAL] documentation
**Data impact:** bounded read only; no customer/business rows exist in the target
**Target:** Supabase `gioia-beauty` / `lxvsspniipcotimbsfqm` (`eu-central-2`)
**Expected reads/writes/rows:** project/org metadata, public schema/migration/branch/advisor listings; 0 writes; 0 business rows
**Done:** Verified the user-created project and added `docs/ENVIRONMENTS.md`. Reserved it as the empty Production target; it is explicitly forbidden for Local/CI/Preview development. Recorded current Free-plan backup limitation and the pre-cutover upgrade gate.
**Verified/reconciled:** project `ACTIVE_HEALTHY`; PostgreSQL 17; zero public tables; zero migrations; zero security/performance advisor findings. `npm run lint` and documentation checks passed; runtime code is unchanged, so the known Resend build failure documented below was not rerun. Branch listing returned a plugin permission-validation error and made no change.
**Production actions performed:** read-only Supabase plugin calls only; no SQL, migration, Auth, key, branch, backup, setting, or data mutation
**Backup/restore evidence:** none required for metadata-only inspection; project is empty
**Rollback/forward recovery:** docs-only registration can be reverted; remote project was unchanged
**Next:** Keep this project untouched. Start Phase 0 locally, then Phase 1 local Docker/isolation. Before remote Supabase setup, approve Production + staging cost and decide whether staging is a separate project or paid branch.
**Gotchas:** Organization is currently Free. Supabase automatic accessible daily backups are a Pro launch gate; do not mistake this Production target for a staging sandbox.

## 2026-07-09 — Revalidated masterplan and guarded Supabase decision
**Phase:** planning v2; Phases 0–9 resequenced, no implementation item completed
**Labels/environment:** [LOCAL], repository documentation only
**Data impact:** none
**Target:** local worktree only; no database, deployment, provider, DNS, auth, or remote configuration
**Expected reads/writes/rows:** none
**Done:** Rewrote the plan around one conditional Firestore→Supabase migration; added environment/blast-radius labels, fail-closed local/Preview isolation, protected production-operator workflow, relational booking constraints, staged cutover, backups/reconciliation, and maintenance-plus-forward-recovery. Added `PRODUCTION-SAFETY.md` and proposed `ADR-001-SUPABASE.md`; updated the data model and agent rules. Independent booking, security/data, frontend/ops, and Supabase audits were folded in.
**Verified/reconciled:** `npm run lint`, checklist-label validation, and `git diff --check` passed. `npm run build` compiles but still hits the unchanged known baseline failure: Resend is constructed without `RESEND_API_KEY` while collecting `/api/send`.
**Production actions performed:** none
**Backup/restore evidence:** n/a; no production access or mutation
**Rollback/forward recovery:** docs-only change; revert the documentation commit if rejected
**Next:** Start Phase 0 locally: create the isolated Vitest route harness and lazy Resend initialization, then prepare the focused `main` hotfix for the unauthenticated appointment endpoints and email routes. Do not load `npm run dev` before Phase 1 isolation; obtain separate approval before any deploy/provider action.
**Gotchas:** Supabase ADR remains Proposed until Victor approves the full Production + serialized staging cost. The legacy direct-client Firestore app is not treated as a safe writable rollback after cutover; the safe failure posture is maintenance plus restore/fix-forward.

## 2026-07-08 — Planning session (no code changes)
**Phase:** pre-work
**Done:** Audited the codebase, Vercel, and DNS. Wrote `docs/MASTERPLAN.md` (8 phases), `AGENTS.md` (+ `CLAUDE.md` symlink), `docs/DATA-MODEL.md` (legacy format zoo with examples, canonical schema, transition rules — required reading before the migration), and this worklog. Created the `refactor` branch. Ran a full crosscheck pass over all docs: fixed a wrong Phase 6 claim (per-page metadata already exists), corrected the count-query claim (`getTotalAppointmentCount` already uses aggregation), resolved TS-timing and migration-sequencing contradictions (new code is TS from Phase 1; DB migration is additive dual-field until Phase 3), and defined the hotfix branch flow.
**Verified:** claims re-checked against code (line-level); docs mutually consistent as of this entry.
**Next:** the 🚨 HOTFIX (masterplan Phase 0, first item): validate `/api/send` + `/api/cancel` bodies. **Branch off `main`** as `hotfix/email-validation`, PR to `main` (NOT via refactor branch), then merge `main` back into `refactor`. See the hotfix item for exact requirements.
**Gotchas:** Production bug is live (customers silently missing confirmation emails since Feb). Firestore read-cost mindfulness is a hard rule — see AGENTS.md rule 2. The legacy `useX` hook family is dead code (verified unimported) — don't study it to understand the app.
