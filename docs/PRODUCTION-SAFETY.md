# Production safety — environments, data, migrations, and deployments

This is a live booking system. The purpose of this document is to make it difficult to touch production accidentally and easy to tell what is safe before running a command.

## Current isolation status

The `refactor` branch now has the first Phase 1 fail-closed gate:

- Local/Test/Preview reject known remote Firebase targets, cloud database URLs in Local/Test, provider credentials, and mismatched Supabase refs/URLs.
- The legacy Firebase browser client uses only the `demo-gioia-beauty` project and loopback Auth, Firestore, and Storage emulators outside Production.
- Legacy Firebase Admin owner auth has an independent sink assertion and works only with the exact demo project plus loopback Auth emulator.
- Refactor Production startup is intentionally disabled because no Supabase target is Production-classified. Reclassification requires a reviewed code change that registers the exact target plus a separate approval identifier.
- Ordinary tests require `APP_ENV=test`; the protected operator environment cannot start the application.

The root legacy hooks still auto-fetch, but outside Production they can now reach only loopback emulators. Do not open the application merely for a smoke test until the named local services and synthetic fixtures are running. Static verification is safe now; interactive verification begins with the completed local Supabase/Firebase test foundation.

This repository isolation does **not** change the live `main` deployment. Production still runs the legacy Firebase application and retains its audited risks until separately approved hotfixes or cutover actions are deployed.

## Mandatory labels

- **`[LOCAL]`** — no remote service and no production credential is reachable; synthetic local data only.
- **`[TEST]`** — dedicated non-production project; synthetic or approved anonymized data only.
- **`[REMOTE-CONFIG]`** — remote collaboration configuration such as GitHub branch protection; no running application or customer data.
- **`[PROD-READ]`** — bounded live read with no mutation.
- **`[PROD-APP]`** — changes deployed production code/behavior.
- **`[PROD-CONFIG]`** — changes production environment, auth, RLS/rules, DNS, providers, routing, monitoring, or infrastructure.
- **`[PROD-DATA]`** — creates, updates, imports, deletes, restores, or migrates live records.
- **`[DESTRUCTIVE]`** — irreversible delete/overwrite of data, backups, project, infrastructure, or history.

Every task also declares a data impact:

```text
none | bounded read | additive write | update | soft delete | destructive
```

Classification follows reachable state, not the machine. A command run on a laptop with a production credential is production work.

## Environment matrix

| Environment         | Database                                                | Data                                                                    | Email                            | Allowed work                                                 |
| ------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------ |
| Local               | Local Docker Supabase                                   | Synthetic seed only                                                     | Mailpit/fake                     | Freely writable/resettable                                   |
| CI                  | Ephemeral local Supabase                                | Deterministic fixtures                                                  | Fake adapter                     | Freely writable/resettable                                   |
| Preview/staging     | One serialized separate Supabase project                | Synthetic by default; explicitly anonymized snapshot only when approved | Test inbox/non-delivering domain | Locked/reset integration, E2E, and migration rehearsals      |
| Restricted recovery | Isolated, access-controlled temporary project           | Approved PII-bearing restore only; destroy by deadline                  | Disabled                         | Backup/restore proof and anonymized derivative creation only |
| Production          | Supabase production after cutover; Firestore until then | Real customer/business data                                             | Real Resend domain               | Only separately approved production operations               |

Required controls:

1. Production credentials never appear in `.env.local`, normal CI, test fixtures, Preview variables, repository scripts, shell history copied into logs, or client bundles. The sole exception is the dedicated manually approved production-operator environment described below.
2. Local/test startup fails if it resolves a production project ID, hostname, database URL, Firebase project, Supabase ref, or Resend production key.
3. Preview startup fails if it resolves Production data or email configuration.
4. Production environment variables exist only in the production provider scope.
5. Client code receives at most a publishable Auth key and never direct access to business/PII tables. Server business-data access uses a least-privilege pooled Postgres role; any Supabase service secret is narrowly scoped to Auth administration and is understood to bypass RLS.
6. Firebase/Supabase CLI commands always receive an explicit target. Never rely on a current/default linked production project.

## Approval boundary

Agents and developers may perform `[LOCAL]` work without a separate production approval. `[TEST]` work must name and verify the target first. `[REMOTE-CONFIG]` changes name the remote target and require explicit approval.

Each discrete `[PROD-READ]`, `[PROD-APP]`, `[PROD-CONFIG]`, `[PROD-DATA]`, or `[DESTRUCTIVE]` action requires Victor's explicit approval after the exact preflight is shown. Approval for one action does not authorize later actions, and approval of the masterplan does not authorize its future production steps.

Never perform these merely because a plan mentions them:

- production migration/import/backfill/delete/restore/bulk update;
- production SQL, `supabase db push`, Firebase rules deployment, or production auth/IAM change;
- `vercel --prod`, production promotion, production environment change, or production-branch merge;
- DNS, DMARC, SPF/DKIM, email-domain, webhook, or rate-limit configuration change;
- unbounded production query/export, except a separately approved managed full migration export with an explicit collection allowlist, encrypted destination, expected document/read cost, active write freeze, and completion verification;
- project deletion, history rewrite, live-table truncation, or in-place full-database restore.

## Production operator environment

Production migrations/imports use a dedicated protected GitHub Environment or equivalent ephemeral operator runner—not a developer shell, normal CI, Vercel Preview, or provider Dashboard SQL. It must:

- require Victor's manual approval for each run and bind the exact Production allowlisted project/database;
- fetch short-lived secrets only after approval and never expose them to build/test/development jobs;
- accept only versioned migration, verification, backup, import, and recovery commands;
- show plan/run hashes, expected reads/writes/rows, and stop conditions before mutation;
- redact logs/artifacts, prevent application startup, and revoke/tear down credentials after the run.

## Safe migration tooling

Migration/import tools must:

- default to dry-run;
- require an explicit environment and exact project/database identifier;
- require `--apply`, a unique run ID, and an explicit confirmation for production;
- display commit SHA, target, source, tables/collections, intended reads/inserts/updates/deletes, plan hash, bounds, and stop conditions before writing;
- refuse inferred, ambiguous, unknown, or non-allowlisted targets;
- process bounded/checkpointed batches and be safely rerunnable;
- preserve source IDs in `legacy_firestore_id` and never silently coerce, drop, or overwrite malformed data;
- use constraints/preconditions/transactions so concurrent writes cannot be overwritten;
- emit redacted reports only; raw exports/before-images remain encrypted, access-controlled, and outside git;
- never write during module import, build, test discovery, application startup, or deployment startup.

`npm run migration:preflight` is the inert v2 plan compiler for the only
currently registered ledger actions: `inventory`, `import`, and `reconcile`.
It accepts only code-owned source/target/table allowlists and canonical
per-effect bounds, then binds the full commit, manifests, stop conditions,
recovery plan, counts, bounds, and evidence hashes into one SHA-256 confirmation.
It deliberately rejects inherited database/provider variables and performs no evidence
lookup, network call, or mutation. An evidence hash identifies a protected
artifact; it does not prove that the backup, restore, freeze, rehearsal, or
recovery claim is true. The protected operator must verify those artifacts and
the live stop conditions separately. Production remains disabled while
`PRODUCTION_SUPABASE_REF` is unregistered.

## Production-data migration gate

No production import/migration starts until all are true:

1. Unit fixtures cover every known legacy shape and anomaly.
2. Dry-run and apply/rerun pass locally from a clean database.
3. The exact process passes against an anonymized staging snapshot derived inside a separately approved restricted recovery environment; ordinary staging never contains raw production PII.
4. Unknown records are quarantined for manual review; mappings are never guessed.
5. A current named production backup/export exists.
6. Restoration into a separate environment has been proven.
7. The target application is already tested against the target schema.
8. Rollback/forward recovery, write-freeze, maintenance message, stop conditions, and expected downtime are documented.
9. Reconciliation queries and expected counts/invariants are recorded before execution.
10. Victor approves the displayed production preflight.

For the Firestore → Supabase cutover:

1. Rehearse a full idempotent import in staging.
2. Freeze booking/dashboard/server writes and deploy temporary deny-write Firestore Rules; a maintenance banner alone does not stop stale direct-client tabs. Verify negative writes before export. Legacy `updatedAt` is too inconsistent for a guessed timestamp delta.
3. Create the final Firestore backup/export and pre-cutover counts/checksums.
4. Import in bounded/checkpointed batches keyed by `legacy_firestore_id`.
5. Reconcile IDs, totals, future bookings, blocks, vacations, subscribers, statuses, date/time/duration conversion, quarantine, and active-overlap invariants.
6. Switch Production environment variables only after reconciliation.
7. Smoke-test with identified synthetic canary records through an audited operator bypass while the public/dashboard write freeze remains active; reconcile and clean up/soft-cancel every mutation.
8. Reopen booking and dashboard mutations only after the full checklist passes.
9. Keep Firestore read-only as a recovery source for 30 days.
10. Before cutover, prove reverse ETL for imported and Supabase-created IDs, legacy field/service mappings, every mutable entity/action, a reliable high-water mark, and idempotent reruns.
11. If failure occurs before writes reopen, keep maintenance and Firestore deny-write rules active, reverse canary mutations if required, and fix forward or restore Supabase.
12. If failure occurs after writes reopen, freeze all Supabase write paths, capture the high-water mark, restore/fix forward, and reconcile all creates/edits/reschedules/cancellations/blocks/vacations/subscriber changes before reopening. Reverse ETL preserves an emergency copy, but the insecure direct-client legacy app is not a writable rollback.

Long-lived dual writes are avoided unless a separate design proves they are necessary. For this small database, a short write freeze is easier to reason about and test.

## Backups and recovery

The field/store retention matrix, subject-request evidence contract, and
mandatory erasure replay before a restored target can reopen live in
[PRIVACY-OPERATIONS.md](./PRIVACY-OPERATIONS.md). Provider-side copies and
activation/decommission evidence are tracked in [PROCESSORS.md](./PROCESSORS.md).
Pending values in either file are launch blockers, not approved defaults.

- Keep a source Firestore backup/export before every rehearsal and production cutover.
- Configure Supabase Pro backups before cutover; before reopening customer writes, create an immediate encrypted post-import logical export/recovery point, restore it into an isolated target, and reconcile it.
- Daily backups can still permit roughly a day of loss. Add encrypted off-platform logical exports at the owner-approved RPO. PITR is optional and separately cost-approved.
- Use soft cancellation and audit/history so ordinary mistakes do not require a full restore.
- Restore into a separate environment at least quarterly and before major migrations; do not test recovery over the live database.
- Verify row counts, representative records, constraints, indexes, grants/RLS, auth, and application reads after restore.
- Version schemas, RLS/grants, functions, indexes, auth configuration, and operational setup in the repository because a database backup alone is not the whole system.
- Record owner-approved RPO and RTO in `docs/OPERATIONS.md`.

## Deployment and rollback gate

Before a production deploy:

1. CI is green.
2. Local and staging integration/E2E tests pass.
3. Preview is confirmed to use staging—not production—data and email.
4. Schema/API changes are backward-compatible with the currently deployed client.
5. Visual/accessibility baselines pass for affected public flows.
6. Expected production data reads/writes, monitoring, stop conditions, and rollback are shown.
7. Any required backup is current and its restore evidence is linked.
8. Victor approves the exact deploy/promotion.

Stale clients must fail visibly and safely: show refresh/retry guidance, never silently lose a booking, and never reopen direct database writes to support an old tab. Additive compatibility spans at least two production releases before cleanup. Vercel Preview promotion may rebuild with Production variables; the cutover therefore uses a staged Production build with no public domain, then assigns that already-built deployment during the window.

## Worklog and PR record

Every DB/auth/deploy-related worklog entry and PR includes:

```text
Labels/environment:
Data impact:
Target project/database:
Expected reads/writes/rows:
Production actions performed: none | exact actions and run/deploy IDs
Backup/restore evidence:
Verification/reconciliation:
Rollback/forward-recovery path:
Next safe action:
```

When nothing touched production, explicitly write `Production actions performed: none`.

## Current official references

- [Supabase local development](https://supabase.com/docs/guides/local-development/overview)
- [Supabase deployment environments and branching](https://supabase.com/docs/guides/deployment)
- [Supabase branching usage and cost](https://supabase.com/docs/guides/platform/manage-your-usage/branching)
- [Supabase service-role RLS bypass behavior](https://supabase.com/docs/guides/troubleshooting/why-is-my-service-role-key-client-getting-rls-errors-or-not-returning-data-7_1K9z)
- [Supabase backups and restore](https://supabase.com/docs/guides/platform/backups)
- [Firestore backups](https://firebase.google.com/docs/firestore/backups)
- [Firestore point-in-time recovery](https://firebase.google.com/docs/firestore/pitr)
- [Vercel Local, Preview, and Production environments](https://vercel.com/docs/deployments/environments)
- [Vercel Preview promotion behavior](https://vercel.com/docs/deployments/promote-preview-to-production)
