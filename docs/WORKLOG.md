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

## 2026-07-11 — Pinned TEST database TLS trust before the greenfield checkpoint
**Phase:** Phase 2 staging migration/reset acceptance foundation; the TEST checkpoint remains open
**Labels/environment:** [LOCAL] trust/runtime/CLI tooling and tests; bounded read-only [TEST] TLS, lint, and advisor diagnostics
**Data impact:** none; TEST diagnostics read connection/schema metadata only, with no schema/data/Auth/provider write and no customer data
**Target:** authorized greenfield TEST Supabase `lxvsspniipcotimbsfqm`; live Firebase remains Production authority and was not accessed
**Expected reads/writes/rows:** 1 direct metadata query returning exactly 1 row plus 7 CLI metadata-only lint/advisor invocations; 0 business rows and 0 writes. The future checkpoint remains exactly 2 destructive synthetic TEST rebuild cycles.
**Done:** Commit `4fe60f3` pins the official Supabase Root 2021 CA by exact fingerprint/canonical PEM, rejects global TLS overrides and unsafe certificate files/bundles, passes explicit per-client trust through operator/runtime/Auth-child paths, uses disposable CLI trust homes, and requires exact structured CLI/pgTAP evidence. No masterplan item was ticked.
**Verified/reconciled:** certificate matches the supplied download and is valid through 2031; direct TEST verify-full query, final remote lint/advisors, format/static SQL/lint/TS7/TS6, 128 files/1,726 tests, both 56-test timezone runs, and production build pass. Two audit rounds found and resolved CA-bundle, IPv6, cleanup, and false pgTAP-success cases; final review found no P1/P2. Dependency audit has 0 high/critical and 6 existing Firebase-Admin-chain moderate records; local Gitleaks is unavailable, so CI must supply secret/history evidence.
**Production actions performed:** none; no Firebase, Production Supabase, Resend, Vercel, DNS, `main`, deployment, configuration, or customer-data access
**Backup/restore evidence:** n/a; no Production or persistent TEST change occurred
**Rollback/forward recovery:** revert `4fe60f3`; remove no external state. The guarded checkpoint still fails closed before mutation unless exact clean pushed commit and green CI evidence are supplied.
**Next:** Commit this handoff, push `refactor`, green all six CI jobs, then run `npm run db:test:greenfield` with the exact CI run/commit and two-cycle confirmation before reserved migration 38.
**Gotchas:** The pinned CLI emits structured JSON only with `--output-format json`; default successful lint output can be empty. Never replace explicit CA trust with `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, or disabled verification.

## 2026-07-11 — Completed the inert bounded owner outbox read family
**Phase:** Phase 3 authenticated owner read and reliable-side-effect foundation; broad checklist items remain open
**Labels/environment:** [LOCAL] schema/contracts/handler, synthetic Auth/executors, static analysis, documentation, and build only
**Data impact:** none; no SQL/function/repository singleton, real Auth/DB/provider call, route, UI activation, migration, environment key, remote, or customer-data action
**Target:** local `refactor`; Production Supabase remains unregistered/null and protected TEST operator credentials remain absent
**Expected reads/writes/rows:** verification executed 0 real DB/Auth/provider/network calls, 0 writes, and 0 rows. A future accepted page uses 1 context load, at most 2 Auth SDK checks, 1 owner authorization, and 1 transaction-authorized executor returning at most 101 rows; rejected requests stop before data access. Physical scans remain unclaimed.
**Done:** Hardened admin outbox DTOs to the persistence delivery-state, snapshot-compatibility, and timestamp invariants. Added capability-issued status-filtered newest-first request/response contracts, exact six-digit PostgreSQL cursor positions tied to millisecond DTOs, strict `pageSize + 1` lookahead, and a GET-only owner handler with 1 KiB/9-pair pre-Auth gates and private PII-bearing responses. No masterplan item was ticked.
**Verified/reconciled:** focused 3 files/33 tests after final equal-timestamp/page-two coverage; full format/static SQL/lint/TS7/TS6, 128 files/1,709 tests, both 56-test timezone runs, and production build pass before that test-only addition. Two independent reviews found no P1/P2. Commit `93dab57` passed all six CI jobs, including secrets/dependencies and two clean DB cycles, in run `29144550454`; replacement CI for this batch is pending.
**Production actions performed:** none; no Firebase, Supabase project, Resend, Vercel, DNS, `main`, Production data, deployment, or configuration access
**Backup/restore evidence:** n/a; no external state changed
**Rollback/forward recovery:** revert this batch commit; no external recovery is required
**Next:** Commit and push this batch, then green replacement CI. The migration-free owner list/count contract backlog is complete; obtain the exact protected TEST session-pooler DSN plus publishable key and run the guarded 37-migration checkpoint before reserved migration 38 and any read SQL/function/repository/route activation.
**Gotchas:** Existing outbox indexes support provider lookup, claiming, and expired leases—not `(created_at DESC,id DESC)` owner listing. The future TEST-backed read migration must add/prove the exact global and status-filtered plans, repeat owner/session authorization atomically, preserve cursor microseconds, and keep recipient PII private/no-store/no-log.

## 2026-07-11 — Batched inert vacation, subscriber, and schedule-export owner reads
**Phase:** Phase 3 authenticated owner read foundation; broad owner-operation checklist remains open
**Labels/environment:** [LOCAL] injected server contracts/handlers, synthetic Auth/executors, static analysis, documentation, and build only
**Data impact:** none; no SQL/function/repository singleton, real Auth/DB/provider call, route, UI activation, migration, environment key, remote, or customer-data action
**Target:** local `refactor`; Production Supabase remains unregistered/null and protected TEST operator credentials remain absent
**Expected reads/writes/rows:** verification executed 0 real DB/Auth/provider/network calls, 0 writes, and 0 rows. Future accepted pages each use 1 context load, at most 2 Auth SDK checks, 1 owner authorization, and 1 transaction-authorized executor: vacation/subscriber return at most 101 rows; export returns at most 501 rows and emits at most 500 rows/16 MiB over at most 366 inclusive dates. Rejections stop earlier; physical scans remain unclaimed.
**Done:** Added exact capability-issued vacation-overlap, newest-first subscriber, and schedule-export request/response contracts plus GET handler factories. Cursors bind scope/filter/page/time/position; subscriber pagination preserves PostgreSQL microseconds; CSV is server-rendered with note projection, BOM/CRLF, formula neutralization, safe filename, byte cap, private headers, and bounded continuation. Shared owner-read responses now support validated private non-JSON output. No masterplan item was ticked.
**Verified/reconciled:** focused 5 files/38 tests; full format/static SQL/lint/TS7/TS6, 126 files/1,692 tests, both 56-test timezone runs, and production build pass. Two independent final reviews found no P1/P2. Prior pushed handler/cadence head passed all six CI jobs, including secrets/dependencies and two clean DB cycles, in run `29144125717`; replacement CI for this batch is pending.
**Production actions performed:** none; no Firebase, Supabase project, Resend, Vercel, DNS, `main`, Production data, deployment, or configuration access
**Backup/restore evidence:** n/a; no external state changed
**Rollback/forward recovery:** revert this batch commit; no external recovery is required
**Next:** Commit and push this coherent owner-read batch, then green replacement CI. If the exact protected TEST session-pooler DSN and publishable key remain absent, implement one migration-free outbox owner-list request/response/handler contract batch with synthetic collaborators only—no SQL/function, runtime singleton, route/UI activation, or remote access.
**Gotchas:** Future vacation SQL must use overlap semantics. Future subscriber SQL/indexes must match `(created_at DESC,id DESC)` and bounded status filters; do not recreate legacy global sorts by loading every page. Each export page repeats its BOM/header, so the future client must follow `X-Next-Cursor` and merge pages deliberately rather than treating page one as complete.

## 2026-07-11 — Guarded inert owner schedule read handlers
**Phase:** Phase 3 authenticated owner read foundation; broad owner-operation checklist remains open
**Labels/environment:** [LOCAL] injected server handlers, synthetic Auth/executors, static analysis, documentation, and build only
**Data impact:** none; no SQL/function/repository singleton, real Auth/DB/provider call, route, UI activation, migration, environment key, remote, or customer-data action
**Target:** local `refactor`; Production Supabase remains unregistered/null and protected TEST operator credentials remain absent
**Expected reads/writes/rows:** this slice executed 0 real DB/Auth/provider/network calls, 0 writes, and 0 rows. A future accepted list request is bounded to 1 context load, at most 2 Auth SDK checks, 1 current-owner authorization, 1 transaction-authorized executor, and at most 101 returned rows over 32 inclusive dates; count accepts at most 6 of 7 requested groups. Rejections stop earlier; physical scans remain unclaimed.
**Done:** Commit `5ab55f1` adds GET-only list/count factories with 1 KiB and 10/8-pair query gates, pre-Auth cursor verification, one exact clock snapshot, fresh bound/current-owner authorization, transaction-authorization executor contracts, exact decision/error decoding, cleanup on authorization races, strict result derivation, safe Auth-header filtering, and static no-activation guards. No masterplan item was ticked.
**Verified/reconciled:** focused 3 files/63 tests; full format/static SQL/lint/TS7/TS6, 121 files/1,646 tests, both 56-test timezone runs, and production build pass. Three independent final reviews found no P1/P2. The local dependency audit approval was temporarily unavailable; dependency files are unchanged and exact prior head passed secrets/dependencies plus all six CI jobs, including two clean DB cycles, in run `29126309436`; replacement CI is pending.
**Production actions performed:** none; no Firebase, Supabase project, Resend, Vercel, DNS, `main`, Production data, deployment, or configuration access
**Backup/restore evidence:** n/a; no external state changed
**Rollback/forward recovery:** revert `5ab55f1`; no external recovery is required
**Next:** Commit this handoff, push, and green replacement CI. Then run the guarded 37-migration TEST checkpoint if the exact protected session-pooler DSN and publishable key are available; otherwise implement one migration-free owner-read batch covering vacation, subscriber, and export request/response/handler contracts with injected synthetic collaborators—no SQL/function, runtime singleton, route/UI activation, or remote access.
**Gotchas:** Read-only GET intentionally has no mutation Origin/CSRF gate; it is GET/body-only and relies on SameSite cookies plus SOP/CORP/private no-store. Future executors must repeat owner/session authorization atomically with the read. Trusted context cookies are passed through; request/executor data can never supply response headers.

## 2026-07-10 — Bound inert owner schedule list and count contracts
**Phase:** Phase 3 authenticated owner read foundation; broad owner-operation checklist remains open
**Labels/environment:** [LOCAL] pure server contracts, synthetic tests, static analysis, documentation, and build only
**Data impact:** none; no SQL/function, repository executor, Auth/DB/provider call, route, UI activation, migration, environment key, remote, or customer-data action
**Target:** local `refactor`; Production Supabase remains unregistered/null and the protected TEST operator DSN is absent
**Expected reads/writes/rows:** this slice executes 0 DB/Auth/provider/network reads or writes and 0 rows. A future list executor is fixed to at most `pageSize + 1` rows (maximum 101) over at most 32 inclusive dates; count requests at most 7 groups and accepts at most 6 unique nonzero kind/status groups. Physical scan bounds remain unclaimed until TEST `EXPLAIN` evidence.
**Done:** Commit `828e4fb` adds capability-issued request plans, exact proxy/accessor-safe query and DTO decoding, authenticated cursor filter/page/time/position binding, strict keyset ordering/lookahead, derived reconciled PII-free counts, block and appointment coverage, year-zero rejection, and production-graph/route-extension inertness guards. Live-page/count limitations and the future matching-index gate are documented. No masterplan item was ticked.
**Verified/reconciled:** focused 5 files/38 tests; full format/static SQL/lint/TS7/TS6, 120 files/1,600 tests, both 56-test timezone runs, production build, and dependency audit pass (0 high/critical; 6 documented Firebase-Admin-chain moderate records). Three independent final reviews found no P1/P2. Prior readiness head passed all six CI jobs, including two clean database cycles, in run `29125067640`; replacement CI is pending.
**Production actions performed:** none; no Firebase, Supabase project, Resend, Vercel, DNS, `main`, Production data, deployment, or configuration access
**Backup/restore evidence:** n/a; no external state changed
**Rollback/forward recovery:** revert `828e4fb`; no external recovery is required
**Next:** Commit this handoff, push, and green replacement CI. Then run the guarded 37-migration TEST checkpoint if the exact protected session-pooler DSN is available; otherwise implement injected owner schedule list/count HTTP handlers over these contracts with strict query-before-Auth ordering, fresh bound owner authorization, private no-store responses, and synthetic executors only—no SQL/function, runtime singleton, route file, UI activation, or remote access.
**Gotchas:** A page with `nextCursor` is not complete month coverage; count is a filtered range total, not per-day/all-time. List/count calls are live rather than snapshot-consistent across reschedules. The future read migration needs an index matching `(local_date,start_minutes,id)` plus TEST plan/bound proof before activation.

## 2026-07-10 — Locked outbox activation behind verifier-backed evidence
**Phase:** Phase 3 reliable-side-effect/Cron foundation; broad atomic-outbox checklist remains open
**Labels/environment:** [LOCAL] pure server contract, static import/activation guards, synthetic tests, documentation, and build only
**Data impact:** none; no route, schedule, database/provider singleton or call, migration, environment key, renderer registration, remote, or customer-data action
**Target:** local `refactor`; Production Supabase remains unregistered/null and protected TEST evidence remains external
**Expected reads/writes/rows:** readiness import/evaluation makes 0 DB/Auth/provider/network calls, 0 writes, and 0 rows; it accepts no evidence input and creates no timers, routes, or runtime composition
**Done:** Commit `1575e2d` adds a zero-input, code-owned, deep-frozen v1 readiness contract structurally fixed to `ready: false` with exact blockers for claim dispositions, durable historical dead-letter monitoring, persisted provider retry cutoff, versioned newsletter snapshot, and TEST checkpoint. Forged booleans/hashes/env/PII cannot alter it; guards cover aliases, alternate route extensions, package scripts, workflows, and composition factories. Operations defines future verifier contracts and separates remote alert configuration. No masterplan item was ticked.
**Verified/reconciled:** focused 3 files/42 tests; full format/static SQL/lint/TS7/TS6, 118 files/1,583 tests, both 56-test timezone runs, production build, and dependency audit (0 high/critical; 6 documented Firebase-Admin-chain moderate records) pass. Three independent final reviews found no P1/P2. Prior dead-letter head passed all six CI jobs, including two clean database cycles, in run `29124225944`; replacement CI is pending.
**Production actions performed:** none; no Firebase, Supabase project, Resend, Vercel, DNS, `main`, Production data, deployment, or configuration access
**Backup/restore evidence:** n/a; no external state changed
**Rollback/forward recovery:** revert `1575e2d`; no external recovery is required
**Next:** Commit this handoff, push, and green replacement CI. Then run the guarded 37-migration TEST checkpoint if the exact protected session-pooler DSN is available; otherwise audit and implement the next migration-free bounded owner schedule/list/count request and response contract without adding a database function, route/UI activation, or remote access.
**Gotchas:** V1 deliberately has no success path; future readiness requires a contract-version change plus trusted proof producers. Hash presence is only artifact binding, not execution proof, and remote alert-receiver configuration remains a separately approved activation preflight.

## 2026-07-10 — Alerted on completion-observed outbox dead letters
**Phase:** Phase 3 reliable-side-effect/Cron foundation; broad atomic-outbox checklist remains open
**Labels/environment:** [LOCAL] inert response classification, synthetic tests, documentation, static analysis, and build only
**Data impact:** none; no route, database/provider singleton or call, migration, environment key, fixture, remote, or customer-data action
**Target:** local `refactor`; Production Supabase remains unregistered/null and the protected TEST operator DSN is absent
**Expected reads/writes/rows:** verification made 0 DB/Auth/provider calls and 0 writes. Future invocation bounds are unchanged: 1 claim transaction selecting at most 5 candidates, at most 5 provider attempts and 5 one-row completions for returned sending rows, at most 10 transitions; claim-time terminal rows can be omitted from the summary.
**Done:** Commit `7eba5e2` makes a completion-observed `dead_letter` return fixed PII-free 503 `OUTBOX_DELIVERY_DEAD_LETTERED`, with precedence completion uncertainty > dead letter > renderer fault > success. Tests prove terminal renderer exhaustion, exact headers/body, inconsistent-summary rejection, and ordinary retry 200. Operations now records claim-time/historical undercount. No masterplan item was ticked.
**Verified/reconciled:** focused 2 files/55 tests; full format/static SQL/lint/TS7/TS6, 117 files/1,573 tests, both 56-test timezone runs, production build, and dependency audit (0 high/critical; 6 documented Firebase-Admin-chain moderate records) pass. Three independent final reviews found no P1/P2. Prior renderer-fault head passed all six CI jobs, including two clean database cycles, in run `29123709932`; replacement CI is pending.
**Production actions performed:** none; no Firebase, Supabase project, Resend, Vercel, DNS, `main`, Production data, deployment, or configuration access
**Backup/restore evidence:** n/a; no external state changed
**Rollback/forward recovery:** revert `7eba5e2`; no external recovery is required
**Next:** Commit this handoff, push, and green replacement CI. Then run the guarded 37-migration TEST checkpoint if the exact protected session-pooler DSN is available; otherwise add a pure fail-closed outbox activation-readiness contract that cannot pass until claim-time disposition counts, bounded historical dead-letter monitoring, the persisted 24-hour retry cutoff, newsletter snapshot/version prerequisites, and TEST checkpoint evidence are explicit—without adding a route, singleton, migration, or renderer registration.
**Gotchas:** This 503 observes only dead letters returned by fenced completion. Claim SQL can dead-letter up to its candidate limit for `AGGREGATE_STATE_STALE`/`LEASE_EXPIRED` and omit them, while historical dead letters are not queried; 200, zero counters, and `budgetReached: false` are not queue-health proof. Cron activation remains blocked.

## 2026-07-10 — Made renderer operational faults recoverable and alerting
**Phase:** Phase 3 reliable-side-effect/newsletter foundation; broad outbox and newsletter checklist items remain open
**Labels/environment:** [LOCAL] server-only contracts, synthetic tests, static analysis, and build only
**Data impact:** none; no route, worker singleton/catalog registration, database/provider call, migration, environment key, fixture, remote, or customer-data action
**Target:** local `refactor`; newsletter renderer remains absent from every production import path and Production Supabase remains unregistered/null
**Expected reads/writes/rows:** verification made 0 DB/Auth/provider calls and 0 writes. Per future branded renderer fault: 0 provider calls and at most 1 fenced failure transaction affecting exactly its claimed row; a five-row invocation remains bounded to 1 claim plus at most 5 one-row completions, 5 provider attempts for unaffected rows, and 10 outbox transitions.
**Done:** Commit `14522bc` adds a duplicate-module-safe, non-spoofable operational renderer fault; retryable fixed `OUTBOX_RENDERER_UNAVAILABLE` persistence; an orthogonal bounded summary counter; fixed 503 alerting with completion-uncertainty precedence; deterministic expiry/future classification; mixed-batch isolation proof; and inert newsletter subclass/import guards. No masterplan item was ticked.
**Verified/reconciled:** focused 5 files/75 tests; full format/static SQL/lint/TS7/TS6, 117 files/1,570 tests, both 56-test timezone runs, production build, and dependency audit (0 high/critical; 6 documented Firebase-Admin-chain moderate records) pass. Three independent final reviews found no P1/P2. Prior newsletter head passed all six CI jobs in run `29122985040`; replacement CI is pending.
**Production actions performed:** none; no Firebase, Supabase project, Resend, Vercel, DNS, `main`, Production data, deployment, or configuration access
**Backup/restore evidence:** n/a; no external state changed
**Rollback/forward recovery:** revert `14522bc`; no external recovery is required
**Next:** Commit this handoff, push, and green replacement CI. Then run the guarded 37-migration TEST checkpoint if the exact protected session-pooler DSN is available; otherwise add migration-free dead-letter alert semantics to the inert invocation contract, including claim-time undercount documentation, without adding a Cron route/provider/database singleton or registering the newsletter renderer.
**Gotchas:** Operational faults retry only while fenced completion is proven and still alert with 503; an unproven completion takes precedence. Expired or more-than-five-minute-future snapshots remain permanent invalid input. Route/catalog activation is still blocked by the TEST checkpoint, missing persisted 24-hour cutoff, claim-time dead-letter undercount, and complete dead-letter monitoring.

## 2026-07-10 — Defined the inert newsletter confirmation email
**Phase:** Phase 3 newsletter/outbox foundation; broad outbox and newsletter checklist items remain open
**Labels/environment:** [LOCAL] pure server renderer contract, synthetic tests, static analysis, and build only
**Data impact:** none; no route, worker catalog, database/provider singleton, environment key, schema, migration, fixture, remote, or customer-data action
**Target:** local `refactor`; renderer has no production-source importer and Production Supabase remains unregistered/null
**Expected reads/writes/rows:** import/factory/render makes 0 DB/Auth/provider/network calls, 0 writes, and 0 rows; one accepted synthetic render makes exactly 1 injected clock call, 1 deterministic token issue, and 1 exact-purpose/full-claim verification, producing 1 in-memory email message and 0 sends
**Done:** Commit `a92c387` adds byte-pinned Italian HTML/text copy over the complete future immutable claim envelope, exact 24-hour/freshness checks, fixed fragment bearer URL, full codec round-trip claim binding, input-versus-operational error separation, and AST/import-graph inertness guards. `docs/DATA-MODEL.md` records expiry/reissue, key-retention, consent-cycle, fragment-scrub/POST, pseudonym, provider-retention, and no-log gates. No masterplan item was ticked.
**Verified/reconciled:** focused renderer/activation 2 files/21 tests plus renderer/token/template 5 files/113 tests; full format/static SQL/lint/TS7/TS6, 116 files/1,562 tests, both 56-test timezone runs, production build, and dependency audit (0 high/critical; 6 documented Firebase-Admin-chain moderate records) pass. Three independent final reviews found no P1/P2. Exact prior head passed all six CI jobs including Gitleaks/history/dependencies and two clean database cycles in run `29121296305`; replacement CI is pending.
**Production actions performed:** none; no Firebase, Supabase project, Resend, Vercel, DNS, `main`, Production data, deployment, or configuration access
**Backup/restore evidence:** n/a; no external state changed
**Rollback/forward recovery:** revert `a92c387`; no external recovery is required
**Next:** Push and green replacement CI. Then run the guarded 37-migration TEST checkpoint if the exact protected session-pooler DSN is available; otherwise add a generic renderer operational-fault contract so future missing-key/clock faults become alertable uncertainty rather than permanent `OUTBOX_TEMPLATE_INVALID`, without importing or activating the newsletter renderer.
**Gotchas:** Current migration 37 persists only `policy_version`; renderer registration remains unsafe until the reserved post-checkpoint migration snapshots token ID/timing/key ID atomically and confirmation SQL consumes the exact versioned consent cycle. `newsletter-consent-v1` still lacks an approved immutable Italian policy/form artifact, and no confirmation landing/POST route exists.

## 2026-07-10 — Proved the inert outbox execution deadline
**Phase:** Phase 3 reliable-side-effect/Cron foundation; the broad outbox checklist item remains open
**Labels/environment:** [LOCAL] injected server implementation, fake-clock tests, static analysis, and build only
**Data impact:** none; no route, database/provider singleton, environment key, Cron configuration, schema, migration, fixture, remote, or customer-data action
**Target:** local `refactor`; the handler remains unreachable from HTTP and Production Supabase remains unregistered/null
**Expected reads/writes/rows:** rejected requests make 0 deadline/worker/DB/provider calls. A future accepted invocation has a 16-second claim/provider cutoff, 24-second settlement cutoff, and 25-second response fail-safe; exactly 1 claim transaction returns at most 5 unique rows, with at most 5 provider attempts and 5 fenced completion transactions—6 DB function calls, 5 provider calls, 5 distinct rows, and at most 10 row transitions. This session executed 0 runtime calls/rows/writes.
**Done:** Commit `b01255f` adds raced/sinked external awaits, parent cancellation, late-result continuation fences, timer cleanup, and fixed deadline responses. Provider timeout/network/invalid-success/5xx/concurrent-idempotency outcomes now remain completion-uncertain with no false failure write. `docs/OPERATIONS.md` records the budget composition. No masterplan item was ticked.
**Verified/reconciled:** focused 2 files/46 tests; full format/static SQL/lint/TS7/TS6, 114 files/1,541 tests, both 56-test timezone runs, production build, and dependency audit (0 high/critical; 6 documented Firebase-Admin-chain moderate records) pass. Two independent final reviews found no P1/P2. Exact prior head passed all six CI jobs including Gitleaks/history/dependencies and two clean database cycles in run `29106539605`; replacement CI is pending.
**Production actions performed:** none; no Firebase, Supabase project, Resend, Vercel, DNS, `main`, Production data, deployment, or configuration access
**Backup/restore evidence:** n/a; no external state changed
**Rollback/forward recovery:** revert `b01255f`; no external recovery is required
**Next:** Push and green replacement CI. Then run the guarded 37-migration TEST checkpoint if the exact protected session-pooler DSN is available; otherwise implement the migration-free production newsletter-confirmation renderer and prove its immutable template contract without adding a route/provider activation.
**Gotchas:** The response deadline cannot undo an already-started external side effect; the real worker prevents late claim/provider continuations, while a late fenced completion may still commit and is reported uncertain. Route activation remains blocked by the TEST checkpoint, dead-letter alerting, claim-time dead-letter undercount, persisted 24-hour provider-idempotency cutoff, and full newsletter/TEST proof.

## 2026-07-10 — Authenticated the inert outbox worker boundary
**Phase:** Phase 3 reliable-side-effect/Cron foundation; the broad outbox checklist item remains open
**Labels/environment:** [LOCAL] injected server implementation, tests, static analysis, and build only
**Data impact:** none; no route, database/provider singleton, environment key, Cron configuration, schema, migration, fixture, remote, or customer-data action
**Target:** local `refactor`; the handler is unreachable from HTTP and Production Supabase remains unregistered/null
**Expected reads/writes/rows:** rejected requests make 0 worker/DB/provider calls. A future accepted invocation makes exactly 1 injected worker call; its current ceiling is 1 claim transaction returning at most 5 unique rows, at most 5 provider attempts, and at most 5 completion transactions—6 DB function calls, 5 provider calls, 5 distinct outbox rows, and at most 10 row transitions. This session executed 0 runtime calls/rows/writes.
**Done:** Commit `363dc34` adds an exact auth-first GET/path/query/body boundary with a canonical 32-byte base64url bearer compared in constant time, server-derived worker UUID, fixed PII-free responses, and 503 uncertainty. It also rejects duplicate/over-five claim arrays before provider effects and corrects Cron bearer/replay wording. No masterplan item was ticked.
**Verified/reconciled:** focused 2 files/33 tests; full format/static SQL/lint/TS7/TS6, 114 files/1,528 tests, both 56-test timezone runs, and production build pass. Three independent contract/security/acceptance reviews found no P1/P2. Exact prior preflight head passed all six CI jobs, including Gitleaks/history/dependencies and two clean database cycles, in run `29105364331`; replacement CI is pending.
**Production actions performed:** none; no Firebase, Supabase project, Resend, Vercel, DNS, `main`, Production data, deployment, or configuration access
**Backup/restore evidence:** n/a; no external state changed
**Rollback/forward recovery:** revert `363dc34`; no external recovery is required
**Next:** Push and green replacement CI. Then run the guarded 37-migration TEST checkpoint if the exact protected session-pooler DSN is available; otherwise harden and prove the outbox invocation deadline/budget without adding a route or provider activation.
**Gotchas:** Vercel Cron uses a static bearer and can miss or duplicate delivery; user-agent/schedule headers are not authentication. Route activation remains blocked by the unproven TEST checkpoint, absent newsletter renderer/dead-letter alerting, claim-time dead-letter undercount, missing persisted 24-hour provider-idempotency cutoff, and an unproven end-to-end deadline.

## 2026-07-10 — Bound inert migration plans to complete operator intent
**Phase:** Phase 1 production-operator workflow foundation; the broad checklist item remains open
**Labels/environment:** [LOCAL] pure plan/compiler implementation, tests, static analysis, and build only
**Data impact:** none; no database, provider, network, Auth, route, schema, migration, fixture, environment, remote, or customer-data action
**Target:** local `refactor`; TEST ref is code-owned and Production Supabase remains unregistered/null
**Expected reads/writes/rows:** runtime compiler performs 0 DB/provider/network reads, 0 writes, and 0 rows; it accepts at most 96 CLI arguments of 4,096 UTF-8 bytes each, scans environment key names without reading values, and computes 1 local SHA-256 plan hash
**Done:** Commit `b1419ad` replaces injectable/coercive preflight v1 with inert v2 for exact ledger actions `inventory|import|reconcile`, full commit/artifact/evidence/count/per-effect binding, canonical input, fixed redacted errors, code-owned targets, credential/provider isolation, and whole-result apply confirmation. Commit `73da93d` permits only CI's non-authoritative Supabase telemetry-disable key. No masterplan item was ticked.
**Verified/reconciled:** format/static SQL/lint/TS7/TS6, CI-shaped 113 files/1,504 tests, both 56-test timezone runs, production build, focused preflight 5 files/57 tests, and TEST target config 41/41 pass. Two independent re-reviews found no P1/P2. CI run `29105031287` greened five jobs including secrets/dependencies/build/two DB cycles but exposed and failed only the telemetry false positive; replacement CI is pending.
**Production actions performed:** none; no Firebase, Supabase project, Resend, Vercel, DNS, `main`, Production data, deployment, or configuration access
**Backup/restore evidence:** n/a; no external state changed, and plan evidence hashes deliberately do not prove protected artifacts
**Rollback/forward recovery:** revert `b1419ad`; no external recovery is required
**Next:** Commit this handoff, push, and green replacement CI. Then obtain the exact protected TEST session-pooler DSN and run the guarded 37-migration two-cycle checkpoint; if it remains unavailable, implement the next migration-free authenticated outbox-worker invocation boundary without route/provider activation.
**Gotchas:** v2 is not an executor or authority grant; Production is disabled and its evidence must later be resolved outside this pure compiler. CI injects `SUPABASE_TELEMETRY_DISABLED=1`; only that exact value-agnostic key bypasses provider-family rejection. The repository has 37 reviewed migrations while the last authorized TEST metadata snapshot recorded 35; do not author reserved migration 38 before the checkpoint.

## 2026-07-10 — Bound dashboard Auth refresh to the validated client
**Phase:** Phase 3 owner Auth reliability/security hardening; the broad Auth checklist item remains open pending TEST/E2E proof
**Labels/environment:** [LOCAL] middleware implementation and static/unit/build verification only
**Data impact:** none; no database, route, schema, migration, fixture, provider, environment, remote, or customer-data action
**Target:** local `refactor`; matcher remains `/dashboard/:path*` in the Node runtime
**Expected reads/writes/rows:** a configured dashboard request makes at most 1 Supabase Auth `getUser` call through a 10-second bounded fetch and may refresh bounded request/response cookies; malformed/unconfigured requests make 0 SDK calls; every path makes 0 business-table calls, rows, or writes
**Done:** Commit `f42d9ef` removes middleware's duplicate unvalidated Supabase client, reuses the strict Auth-only factory, preserves all refreshed cookies/SDK headers, and reasserts private no-store headers after cookie refresh. No masterplan item was ticked.
**Verified/reconciled:** focused Auth 17/17; full format/lint/TS7/TS6, 109 files/1,452 tests, architecture graph, and production build pass. Independent final review found no P1/P2. Prior cursor head passed all six CI jobs, Gitleaks/history/dependencies, and two clean local database cycles in run `29102146944`; replacement CI is pending.
**Production actions performed:** none; no Firebase, Supabase project, Resend, Vercel, DNS, `main`, Production data, deployment, or configuration access
**Backup/restore evidence:** n/a; no external state changed
**Rollback/forward recovery:** revert `f42d9ef`; no external recovery is required
**Next:** Push and green replacement CI, then harden the repository-only migration preflight: remove Production registry injection, bind exact action/commit/per-effect bounds/full hashes, and make invalid CLI output non-reflective while Production remains unregistered.
**Gotchas:** Middleware refresh is not authorization; every owner route still performs its own fresh bound Auth check. One build attempt hit a transient missing `.next` trace artifact after page generation; the immediate sequential rerun passed fully.

## 2026-07-10 — Authenticated bounded pagination context without activating reads
**Phase:** Phase 3 owner-read/server-boundary foundation; database adapter and authenticated read operations remain open
**Labels/environment:** [LOCAL] implementation/tests plus one bounded read-only [TEST] Supabase metadata refresh
**Data impact:** none; no route, repository, schema, migration, Auth, fixture, email, provider configuration, application query, or customer-data operation
**Target:** local `refactor`; read-only metadata for authorized TEST project `lxvsspniipcotimbsfqm` (`ACTIVE_HEALTHY`, 35 applied migrations)
**Expected reads/writes/rows:** cursor issue/verify performs 0 DB/Auth/provider/network operations and one local HMAC; remote refresh read 1 project, 35 migration, and 2 API-key metadata records with 0 writes/business rows
**Done:** Commit `498a44f` adds canonical `c1-<kid>.<payload>.<tag>` cursors for five scopes, fixed 15-minute lifetime/60-second skew, exact filter/page/position binding, 1–3-key rotation, PostgreSQL-microsecond preservation, hostile-input rejection, and a transitive client ban on both Supabase SDK packages. No route/singleton was activated and no masterplan item was ticked.
**Verified/reconciled:** format/static SQL/lint/TS7/TS6, 109 files/1,446 tests, production build, 128 focused boundary tests, five cursor and five fingerprint golden vectors, and two independent final reviews with no P1/P2. CI run `29099281712` greened all six jobs for the preceding privacy head; replacement CI is pending. Local Gitleaks remains unavailable, so CI must supply secret/history evidence.
**Production actions performed:** none; no Firebase, Production Supabase, Resend, Vercel, Sentry, DNS, `main`, customer data, deployment, or configuration access
**Backup/restore evidence:** n/a; no external state changed and the TEST metadata read does not prove restore
**Rollback/forward recovery:** revert `498a44f`; no external recovery is required
**Next:** Push and green replacement CI. Obtain the protected exact `GIOIA_TEST_OPERATOR_DATABASE_URL` session-pooler DSN, then run the guarded 37-migration two-cycle TEST checkpoint before reserved migration 38; owner read SQL must be migration 39 or later.
**Gotchas:** `app_runtime` has no table `SELECT` and no owner list/count/vacation function exists, so adding a read route/repository now would be false safety. Cursors authenticate but neither authorize nor conceal claims; future SQL must use the exact pinned keyset order and preserve six-digit `timestamptz` text rather than JavaScript `Date`/floating-point conversion.

## 2026-07-10 — Defined the privacy and processor launch gates
**Phase:** Phase 3 pre-cutover privacy foundation; the broad privacy checklist item remains open
**Labels/environment:** [LOCAL] documentation, static inventory, and test verification only
**Data impact:** none; no route, schema, migration, Auth, fixture, provider, environment, remote, or customer-data action
**Target:** local `refactor`; TEST remains at the recorded 35-migration snapshot while the reviewed repository manifest has 37
**Expected reads/writes/rows:** documentation/tests perform 0 application DB/Auth/provider/network operations, 0 writes, and 0 customer rows
**Done:** Commit `4dac291` adds pending `RET-01`–`RET-17`/`RET-HOLD` decisions, exact field/copy/provider inventories, sensitive-note/consent/export/restore-replay gates, protected-case versus minimized `P4/P5` evidence, processor activation/decommission controls, cross-runbook links, and an 11-test launch-gate suite. No masterplan item was ticked.
**Verified/reconciled:** focused 11/11; full format/static SQL/lint/TS7/TS6, 104 files/1,403 tests, both 56-test timezone runs, and production build pass. Three independent final audits found no P1/P2. Dependency audit is 0 high/critical with the 6 documented Firebase-Admin moderate records; CI must supply Gitleaks and two clean database cycles.
**Production actions performed:** none; no Firebase, Supabase, Resend, Vercel, Sentry, DNS, `main`, Production data, configuration, restore, or provider access
**Backup/restore evidence:** n/a; no external state changed and the document explicitly does not prove restore
**Rollback/forward recovery:** revert `4dac291`; no external recovery is required
**Next:** Push and green all six CI jobs. If the protected exact TEST session-pooler DSN becomes available, run the guarded 37-migration two-cycle checkpoint before migration 38. Otherwise audit and implement the next migration-free bounded owner schedule/list/count read boundary without UI activation or remote access.
**Gotchas:** All retention periods, processor/DPA facts, sensitive-note policy, public policy wording, and evidence lifetimes are pending owner/legal/provider decisions. Firebase Storage is configured but unproven; schedule locks are non-personal mutex state. A premature generic privacy executor was rejected and deleted because caller-declared target labels and stub replay would create false safety; executable privacy work waits for the durable SQL ledger/functions after the checkpoint and newsletter migration.

## 2026-07-10 — Added PII-safe API observability boundaries
**Phase:** Phase 3 minimal observability foundation; the broad Sentry/alerts checklist item remains open
**Labels/environment:** [LOCAL] server implementation, environment validation, static/unit/build verification only
**Data impact:** none; no schema, migration, Auth, fixture, email, provider, remote, or customer-data action
**Target:** local `refactor`; provider capture is deliberately `null` and no TEST or Production target was used
**Expected reads/writes/rows:** observation performs 0 DB/Auth/provider/network operations and 0 rows; each valid request creates 1 local UUID, reads a monotonic clock twice, and can emit 1 fixed JSONL completion line only when transport is exactly `console`; an uncaught throw can emit 1 additional fixed surrogate-error line
**Done:** Commits `0383fda` and `05d26ca` add strict fixed-shape route/error contracts, fail-open sync/async observation, trusted console composition, unconditional rejection of unregistered Sentry variables, and one exact static label around every current API method (20/20) without inspecting requests/responses or forwarding original errors.
**Verified/reconciled:** 8 focused files/113 tests; full format/static SQL/lint/TS7/TS6, 103 files/1,392 tests, both 56-test timezone runs, and production build pass. Three independent final reviews found no P1/P2; a built-client grep contains no observability/server identifiers. Current runtime audit is 0 high/critical with the 6 documented Firebase-Admin moderate records; local Gitleaks remains unavailable, so CI must supply secret/history evidence.
**Production actions performed:** none; no Firebase, Supabase, Resend, Sentry, Vercel, DNS, `main`, Production data, or configuration access
**Backup/restore evidence:** n/a; no external state changed
**Rollback/forward recovery:** revert `05d26ca` then `0383fda`; no external recovery is required
**Next:** Push and green all six CI jobs. If the exact TEST session-pooler DSN becomes available, run the guarded 37-migration two-cycle checkpoint before migration 38; otherwise begin the Phase 3 pre-cutover privacy package with a field/table/log/backup retention matrix and executable synthetic access/deletion contracts.
**Gotchas:** Provider capture stays inert until a reviewed Sentry TEST target exists; returned/caught 503s produce only a completion metric, while only uncaught throws produce the fixed surrogate-error event. Sink adapters are trusted synchronous code, and the broad masterplan item remains unchecked.

## 2026-07-10 — Enforced the client/server source boundary
**Phase:** Phase 3 server-adapter/browser-secret isolation foundation; actual adapter completion and TEST/bundle proof remain open
**Labels/environment:** [LOCAL] source cleanup, static architecture analysis, unit/static/build verification only
**Data impact:** none; deleted two verified-unimported client modules and browser-inapplicable process hooks, with no route, schema, migration, Auth, fixture, email, provider, environment, or remote call
**Target:** local `refactor`; no TEST or Production target
**Expected reads/writes/rows:** analyzer makes bounded read-only repository source/config reads; runtime and verification perform 0 DB/Auth/provider/network operations, 0 writes, and 0 rows
**Done:** Commits `7d97b87` and `71a0b04` remove a dead broken direct-Firestore subscribe form, an unimported broken loading module, and Node signal handlers from client-reachable caches; add a transitive TypeScript-AST client graph guard for directives/`lib/client`/`client-only`, runtime imports/re-exports/dynamic loaders, exact local resolution, server/API paths, privileged packages, reviewed env keys, database `server-only` sentinels, parse errors, symlinks, and deterministic chains.
**Verified/reconciled:** 3 focused files/102 tests; full format/static SQL/lint/TS7/TS6, 95 files/1,271 tests, and production build pass. Three independent re-reviews found no P1/P2 after terminal assets, all `node:`/Next server spellings, computed/aliased globals, Windows paths, root discovery, `.mts`/`.cts`, false positives, and sub-300-line modularity were covered. `npm audit --audit-level=high` remains 0 high/critical with the 6 documented Firebase-Admin moderate records; local Gitleaks binary is unavailable, so replacement CI must supply secret-scan evidence.
**Production actions performed:** none; no Firebase, Supabase, Resend, Sentry, Vercel, DNS, `main`, Production data, or configuration access
**Backup/restore evidence:** n/a; no external state changed
**Rollback/forward recovery:** revert `71a0b04` then `7d97b87`; no external recovery is required
**Next:** Push and green all six CI jobs. If the exact TEST session-pooler DSN becomes available, run the guarded 37-migration two-cycle checkpoint before migration 38; otherwise implement the inert PII-safe structured observability core with no DSN/provider activation and keep the broad checklist item open.
**Gotchas:** Source-graph evidence is not built-bundle proof, so Phase 3's server-adapter and observability items remain unchecked. The new guard intentionally fails if its prerequisite cleanup commit is omitted. Reliable visual baselines still require local Firebase emulators, Java, deterministic fixtures, and a remote-request firewall.

## 2026-07-10 — Bound newsletter token wire and purpose policy
**Phase:** Phase 3 newsletter/double-opt-in server foundation; persistence, rendering, routes, and end-to-end confirmation remain open
**Labels/environment:** [LOCAL] implementation and static/unit/build verification only
**Data impact:** none; domain/server schemas and pure tests only, with no database, Auth, route, UI, email, provider, fixture, migration, environment-secret, or remote call
**Target:** local `refactor`; no HTTP/outbox consumer or operational singleton was added
**Expected reads/writes/rows:** verification and runtime contracts perform 0 DB/Auth/provider/network operations and 0 rows. Wire parsing is bounded to 512 ASCII bytes; token issue/verify retain their prior at-most-3-key and one-local-HMAC bounds.
**Done:** Commit `3ebb079` makes confirmation lifetime exactly 24 hours and unsubscribe lifetime positive/at most 30 days using absolute instants; adds one branded but explicitly unauthenticated, untrimmed, canonical three-segment/512-byte wire contract; makes codec issue/verify reuse it; centralizes key-ID syntax; and narrows only newsletter unsubscribe input while preserving the prior export as a deprecated structural alias.
**Verified/reconciled:** 5 focused files/136 tests; full format/static SQL/lint/TS7/TS6, 92 files/1,169 tests, and production build pass. Three independent crypto/contract/phase reviews are clear on lifetime, canonical base64url, 512/513 bounds, grammar reuse, generic-token compatibility, and zero activation. Exact prior codec head passed all six CI jobs, including both clean database cycles, in run `29089525056`; replacement CI is pending.
**Production actions performed:** none; no Firebase, Supabase, Resend, Vercel, DNS, `main`, Production data, or configuration access
**Backup/restore evidence:** n/a; no remote mutation
**Rollback/forward recovery:** revert `3ebb079`; no external state changed
**Next:** Push and green replacement CI, then classify and run the exact guarded 37-migration checkpoint against authorized TEST project `lxvsspniipcotimbsfqm`: zero-to-head rebuild with synthetic fixtures, advisors/RLS/ACL checks, owner Auth HTTP flow, concurrency, and a second clean cycle. Use the Supabase plugin/official tooling; do not author migration 38 unless the exact operator DSN and modern publishable-key checkpoint succeeds.
**Gotchas:** Wire parsing is only syntax and HMAC verification is still not authorization, consumption, revocation, or single-use. Current SQL remains subscriber-ID/version-blind and the outbox lacks token/key/timing snapshots; no route or renderer is safe yet. Future action GETs must never mutate (scanner-safe landing plus explicit guarded POST), and purpose must be hard-coded by the route rather than inferred as authorization from the token.

## 2026-07-10 — Added inert newsletter action-token authentication
**Phase:** Phase 3 newsletter/double-opt-in server foundation; consent-cycle persistence, rendering, routes, and end-to-end confirmation remain open
**Labels/environment:** [LOCAL] implementation and static/unit/build verification only
**Data impact:** none; pure injected cryptography and schemas only, with no database, Auth, route, UI, email, provider, fixture, migration, environment-secret, or remote call
**Target:** local `refactor`; the server-only factory has no singleton and is unreachable from HTTP or the outbox worker
**Expected reads/writes/rows:** verification and runtime primitive perform 0 DB/Auth/provider/network operations and 0 rows. Issue/verify inspect at most 3 copied keys and perform one local HMAC; they never send, persist, authorize, consume, or revoke anything.
**Done:** Commit `e6b2ac3` adds consent-cycle `subscriberVersion`, invalid-clock rejection, canonical `n1-<kid>.<payload>.<tag>` tokens, a strict 1..3-key injected rotation ring, snapshotted signing-key selection, 256-bit HMAC-SHA256, fatal UTF-8/canonical JSON and base64url checks, constant-time tag comparison, fixed redacted failures, and private branded authenticated claims. Structural parsing is no longer mislabeled as verification.
**Verified/reconciled:** 3 focused files/87 tests; full format/static SQL/lint/TS7/TS6, 91 files/1,126 tests, and production build pass. Three independent crypto/contract/adversarial reviews are clear after sparse arrays, symbols, non-enumerable extras, accessors, and revoked proxies were made fixed-error cases. Exact prior subscriber-repository head passed all six CI jobs, including both clean database cycles, in run `29087353501`; replacement CI is pending.
**Production actions performed:** none; no Firebase, Supabase, Resend, Vercel, DNS, `main`, Production data, or configuration access
**Backup/restore evidence:** n/a; no remote mutation
**Rollback/forward recovery:** revert `e6b2ac3`; no external state changed
**Next:** Push and green replacement CI, then add and exhaustively test an inert purpose policy plus exact raw-wire parser: confirmation links expire at 24 hours, unsubscribe links at no more than 30 days, and no parser may trim or widen the codec's 512-byte three-segment grammar. Do not add a route, renderer, environment key, or migration 38 until the exact 37-migration TEST checkpoint is proven.
**Gotchas:** The codec authenticates integrity, purpose, time, and opaque consent-cycle claims; it is replayable, non-confidential, and does not authorize or make a link single-use. Migration 38 must snapshot token ID, subscriber version, issue/expiry, purpose, and signing-key ID; atomically bind/consume the right consent cycle; define reissue/retention; and keep old keys until every referenced token expires. Current SQL and outbox snapshots do not satisfy this. Generic `SignedActionTokenSchema` trims input, so future HTTP code must use the exact raw parser.

## 2026-07-10 — Added strict public newsletter command repositories
**Phase:** Phase 3 newsletter/double-opt-in server foundation; public routes and end-to-end confirmation remain open
**Labels/environment:** [LOCAL] implementation and static/unit/build verification only
**Data impact:** none; injected repositories only, with no database, route, UI, email, provider, fixture, schema, migration, or remote call
**Target:** local `refactor`; the new singleton is unreachable from HTTP and opens no connection on import
**Expected reads/writes/rows:** verification performed 0 DB/provider operations and 0 rows. Each future call is 1 transaction + 1 private function + exactly 1 accepted row. Changed subscribe is at most 4 distinct rows/5 mutations; existing/no-change or fresh invalid is 1 command row/2 mutations; changed confirm/unsubscribe is 3 rows/4 mutations; unknown/no-op is 1/2; exact replay is 0 writes; all paths make 0 synchronous sends.
**Done:** Commit `4971588` adds strict subscribe/confirm/unsubscribe adapters for the existing migration-37 functions. Nested inputs require consent=true, canonical UUIDs/email, and cloned 32-byte scope/fingerprint hashes; fixed parameterized queries use `limit 2`; outputs are frozen non-enumerating `{httpStatus, code, replayed}` only. No API route, abuse action, renderer, token claim, or client caller was added.
**Verified/reconciled:** 2 focused files/49 tests; full format/static SQL/lint/TS7/TS6, 89 files/1,043 tests, and production build pass. Independent SQL/security reviews found no blocker and confirmed exact signatures, role isolation, cardinality, PII rejection, replay/error behavior, effect bounds, frozen output, and zero route exposure. Exact prior abuse-boundary head passed all six CI jobs, secrets/dependencies, and both clean 342-assertion database cycles in run `29086509091`; replacement CI is pending.
**Production actions performed:** none; no Firebase, Supabase, Resend, Vercel, DNS, `main`, Production data, or configuration access
**Backup/restore evidence:** n/a; no remote mutation
**Rollback/forward recovery:** revert `4971588`; no external state changed
**Next:** Push and green replacement CI, then implement and exhaustively test a server-only newsletter action-token codec with fixed version/purpose, UUID token ID, subscriber ID/version, immutable issued/expiry instants, constant-time HMAC verification, and redacted errors. Do not add routes or a renderer until the post-checkpoint migration binds those claims to the consent cycle and outbox snapshot.
**Gotchas:** Migration-free routes are unsafe: newsletter outbox rendering intentionally fails; token timing/version is not snapshotted; confirm SQL is not consent-cycle-bound; token consumption/retention is unresolved; pending confirmation cannot be reissued. The active UI still writes Firestore and belongs to Phase 4.

## 2026-07-10 — Added a fail-closed public abuse boundary seam
**Phase:** Phase 3 public abuse-defense foundation; durable limiter/challenge checklist remains open
**Labels/environment:** [LOCAL] implementation and static/unit/build verification only
**Data impact:** none; stateless fake decisions and injected repositories only, with no remote, database, provider, schema, fixture, or migration call
**Target:** local `refactor`; Preview/Production/operator public availability and booking remain code-disabled before DB work
**Expected reads/writes/rows:** verification performed 0 DB/Auth/provider operations and 0 rows. Runtime pre-guard reject is 0 guard/body/DB; guard reject is 1 stateless local check/0 body/DB; post-guard body reject is 1 guard/0 DB. Allowed Local/Test availability is 1 guard + 1 transaction/function/≤96 rows/0 writes; booking is 1 guard + its existing 1 transaction/1 row, fresh 6 rows/7 mutations, handled failure 1 row/2 mutations, replay 0, and 0 synchronous sends.
**Done:** Commit `3c30b40` adds a strict headers-only abuse decision seam for availability/booking, O(1) Local/Test HMAC fake, fixed 403/429/503 normalization, bounded trusted-address parsing, exact guard/body/DB ordering, singleton route wiring, and truthful environment/API contracts. It adds no cache, provider, network, database operation, or remote activation path.
**Verified/reconciled:** 5 focused files/94 tests; full format/static SQL/lint/TS7/TS6, 88 files/1,000 tests, and production build pass. Three independent cross-reviews found no blocker after body capability, pre/post-guard cost, and proxy-header bounds were hardened; final independent evidence includes 6 files/99 tests and API-inventory coverage. Exact prior outbox head passed all six CI jobs, secrets/dependencies, and both clean 342-assertion database cycles in run `29085162733`; replacement CI is pending.
**Production actions performed:** none; no Firebase, Supabase, Resend, Vercel/WAF, CAPTCHA, DNS, `main`, Production data, or configuration access
**Backup/restore evidence:** n/a; no remote mutation
**Rollback/forward recovery:** revert `3c30b40`; no external state changed
**Next:** Push and green replacement CI, then implement the migration-free server repository and strict non-enumerating boundary for the three already-migrated public newsletter subscribe/confirm/unsubscribe commands; reuse the public guard and keep all remote routes disabled until durable abuse protection is reviewed.
**Gotchas:** This seam is an activation stop, not rate-limit evidence, so the broad masterplan item stays unchecked. A future external adapter must receive a curated header allowlist, add a fully valid Production-disable regression after target registration, and pair shared global/per-principal limits with bounded expired-command cleanup.

## 2026-07-10 — Added a Production-disabled owner outbox retry boundary
**Phase:** Phase 3 reliable-side-effect and authenticated server boundary; broad outbox checklist remains open
**Labels/environment:** [LOCAL] implementation and static/unit/build verification only
**Data impact:** none; synthetic requests and injected Auth/repositories only, with no remote, database, provider, schema, fixture, or migration call
**Target:** local `refactor`; no TEST or Production target
**Expected reads/writes/rows:** verification performed 0 DB/Auth/provider operations and 0 rows. Disabled/rejected requests perform 0 downstream work. A safe Local/Test/Preview accepted request uses 2 Auth verification methods and 1 owner transaction/private function capped at 2 rows; success is 2 distinct rows/3 mutations, handled conflict 1 row/2 mutations, replay 0 writes, and all paths send 0 email synchronously. Identity cleanup may add 1 local sign-out.
**Done:** Commit `b374024` adds strict retry schema/fingerprinting, a dedicated owner-transaction repository, shared behavior-preserving owner command adapters, guarded dynamic route, exact response/cardinality contracts, and API inventory coverage. Production/operator stay code-disabled until the provider-attempt/uncertainty and 24-hour stop migration is proven.
**Verified/reconciled:** 9 focused files/162 tests; full format/static SQL/lint/TS7/TS6, 86 files/946 tests, and production build pass. Two independent security/repository re-reviews found no blocker after the injected-environment split-target regression was fixed. Exact prior Auth-boundary head passed all six CI jobs, secrets/dependencies, and both clean 342-assertion database cycles in run `29083746923`; replacement CI is pending.
**Production actions performed:** none; no Firebase, Supabase, Resend, Vercel, DNS, `main`, Production data, or configuration access
**Backup/restore evidence:** n/a; no remote mutation
**Rollback/forward recovery:** revert `b374024`; no external state changed
**Next:** Push and green replacement CI, then implement a fail-closed PII-free public abuse-defense boundary for availability/bookings with bounded Local/Test fakes and exhaustive zero-DB rejection tests; keep any Production CAPTCHA/rate-limit provider/config action separately approved and keep migration 38 blocked until the exact 37-migration TEST checkpoint runs.
**Gotchas:** Any injected retry `env` now requires explicit repository, Auth-context, and HMAC-secret sinks as one trusted bundle; incomplete bundles fail before environment validation/cookies/body/Auth/DB. An environment toggle cannot activate Production retry.

## 2026-07-10 — Rejected ambiguous owner Auth route targets
**Phase:** Phase 3 owner Auth boundary hardening; broad Auth checklist remains open pending TEST/E2E proof
**Labels/environment:** [LOCAL] implementation and static/unit/build verification only
**Data impact:** none; injected Auth/repositories and synthetic requests only, with no remote, database, or provider call
**Target:** local `refactor`; no TEST or Production target
**Expected reads/writes/rows:** verification performed 0 DB/Auth/provider operations and 0 rows. Query rejection may construct a local Supabase client and read bounded request cookies, but performs 0 Auth SDK/network methods, 0 DB calls/rows/writes, 0 body reads, and 0 security-cookie mutations; accepted paths retain their documented bounds.
**Done:** Commit `1396b43` makes login enforce Origin → query → body/Auth/DB, logout enforce Origin+CSRF → query → Auth/DB, and session enforce query → Auth/DB. All return fixed 400 `INVALID_REQUEST` for a query, preserve 403 security precedence, forward the request through the session route, and reconcile the API inventory.
**Verified/reconciled:** 47 focused tests plus full format/static SQL/lint/TS7/TS6, 83 files/903 tests, and production build pass; two independent boundary/security reviews found no blocker after fresh-fixture conflict tests proved zero downstream effects. Exact prior owner-target head passed all six CI jobs, secrets/dependencies, and both clean 342-assertion database cycles in run `29083128679`; replacement CI is pending.
**Production actions performed:** none; no Firebase, Supabase, Resend, Vercel, DNS, `main`, Production data, or configuration access
**Backup/restore evidence:** n/a; no remote mutation
**Rollback/forward recovery:** revert `1396b43`; no external state changed
**Next:** Push and green replacement CI, then implement the migration-free owner outbox-retry request/repository/route against the existing reviewed SQL command with fresh bound Auth, CSRF, idempotency, strict versioning, and exact effect tests. Keep Production activation disabled until a post-checkpoint migration enforces the 24-hour provider-idempotency stop.
**Gotchas:** Session still validates the canonical CSRF cookie after its bounded Auth/DB authorization work; changing that pre-existing order could alter cleanup semantics and is outside this query-only slice.

## 2026-07-10 — Rejected ambiguous owner command targets at the edge
**Phase:** Phase 3 authenticated server boundaries; broad owner-operation checklist remains open
**Labels/environment:** [LOCAL] implementation and static/unit/build verification only
**Data impact:** none; synthetic requests and injected Auth/repositories only, with no remote or database call
**Target:** local `refactor`; no TEST or Production target
**Expected reads/writes/rows:** verification performed 0 DB/Auth/provider operations and 0 rows. Origin/CSRF/query/version rejection performs 0 Auth/DB work; accepted requests retain 1 fresh Auth check and 1 owner transaction/private function call capped at 2 result rows, with operation-specific bounded writes unchanged.
**Done:** Commit `8348323` makes all ten owner schedule mutations reject query parameters before idempotency/body/Auth/DB, caps all SQL-backed positive versions to PostgreSQL `integer` range 1..2,147,483,647, and returns edge 422 instead of allowing overflow to become a redacted repository 503. Exhaustive tests cover 10 query paths, 7 versioned commands, 3 strict creates, boundary acceptance, and conflicting Origin/CSRF precedence; the API inventory is reconciled.
**Verified/reconciled:** 102 focused tests plus full format/static SQL/lint/TS7/TS6, 83 files/899 tests, and production build pass; two independent implementation/schema-impact reviews found no blocker. Exact prior legacy-mail head passed all six CI jobs, secrets/dependencies, and both clean 342-assertion database cycles in run `29082494439`; replacement CI is pending.
**Production actions performed:** none; no Firebase, Supabase, Resend, Vercel, DNS, `main`, Production data, or configuration access
**Backup/restore evidence:** n/a; no remote mutation
**Rollback/forward recovery:** revert `8348323`; repository guards remain defense in depth and no external state changed
**Next:** Push and green replacement CI, then reject query parameters on owner login, logout, and session routes before body/Auth/DB work while preserving their existing Origin/CSRF precedence; add three-route integration coverage and reconcile the enforced API inventory.
**Gotchas:** `readSecurityTokens` reads local cookies before the shared command parser; it performs no Auth/network/DB work. The global positive-version cap is intentional because every consumer maps to a PostgreSQL `integer` column.

## 2026-07-10 — Hardened temporary legacy mail boundaries
**Phase:** Phase 3 server-boundary containment; target atomic-outbox replacement remains open
**Labels/environment:** [LOCAL] implementation and static/unit/build verification only
**Data impact:** none; fake delivery and injected Auth only, with no remote, database, schema, fixture, or provider call
**Target:** local `refactor`; no TEST or Production target
**Expected reads/writes/rows:** verification performed 0 DB/Auth/provider operations and 0 rows. At runtime, Origin/query rejection performs none; rate rejection performs 1 bounded process-local check; an accepted send performs 1 local limiter check, at most 1 Firebase token verification, 0 DB rows, and at most 2 provider sends (`/api/cancel`: at most 1).
**Done:** Commit `52c1781` gives `/api/send` and `/api/cancel` canonical query/origin/bearer/media/encoding/length gates, streamed 8 KiB cancellation, fatal UTF-8, fixed validation errors, immutable hardened response headers, bounded proxy keys, and environment isolation that cannot be bypassed by an injected Auth loader. Both routes have table-driven order/framing/zero-delivery coverage and the API inventory is reconciled.
**Verified/reconciled:** focused 79 tests plus full format/static SQL/lint/TS7/TS6, 83 files/864 tests, and production build pass; independent final review found no blocker and passed 74 focused tests. Local Gitleaks remains unavailable; exact prior inventory head passed all six CI jobs, including secrets/dependencies and both clean database cycles, in run `29080493181`; replacement CI is pending.
**Production actions performed:** none; no Firebase, Supabase, Resend, Vercel, DNS, `main`, Production data, or configuration access
**Backup/restore evidence:** n/a; no remote mutation
**Rollback/forward recovery:** revert `52c1781`; no external state changed
**Next:** Push and green replacement CI, then make every owner command reject query strings before Auth/DB and reject versions above PostgreSQL int32 before repository work; update the enforced API inventory and prove both properties across all ten mutation routes.
**Gotchas:** Legacy mail still has process-local trusted-proxy rate limiting and no durable idempotency; automatic retry remains forbidden, and these routes must be deleted when the atomic outbox replaces all callers.

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
