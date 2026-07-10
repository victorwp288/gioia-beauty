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
