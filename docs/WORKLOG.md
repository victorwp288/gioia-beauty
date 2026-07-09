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
