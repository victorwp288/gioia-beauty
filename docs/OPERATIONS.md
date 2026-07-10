# Operations and recovery targets

This runbook defines the intended operating posture for the replacement system. Values marked **launch gate** are requirements, not evidence that the current Free TEST project or live Firebase source already satisfies them. Exact production actions still require the preflight in `PRODUCTION-SAFETY.md`.

## Ownership and escalation

| Responsibility                                              | Primary                          | Escalation trigger                                                                 |
| ----------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| Business decision, customer communication, release approval | Victor / salon owner             | Any booking loss, double booking, owner lockout, or customer-facing outage         |
| Application/database incident lead                          | Designated production operator   | Error-rate alert, invariant failure, migration stop condition, or restore decision |
| Hosting/database/email provider                             | Vercel, Supabase, Resend support | Provider health issue or recovery action outside repository tooling                |

Contact details belong in the protected operator environment and provider accounts, never in git. One person may fill multiple roles, but the release checklist names the active people and confirms account recovery before cutover.

## Recovery objectives

| System/state                                            |                          Target RPO | Target RTO | Status                                                       |
| ------------------------------------------------------- | ----------------------------------: | ---------: | ------------------------------------------------------------ |
| Production appointments, blocks, vacations, subscribers |                          15 minutes |    2 hours | **Launch gate; backup/PITR tier not yet approved**           |
| Auth owner account and authorization mapping            | 24 hours plus documented recreation |    2 hours | **Launch gate; recovery contact not yet proven**             |
| Application code and database schema                    |                 0 committed changes |     1 hour | Reproducible from git and reviewed migrations                |
| Email delivery state                                    |                          15 minutes |    4 hours | Outbox must recover without changing committed booking state |
| TEST synthetic data                                     |                            24 hours |     1 hour | Disposable; reset from migrations and fixtures is preferred  |

If the selected Supabase plan cannot meet the 15-minute data RPO with proven PITR or an equivalent encrypted off-platform backup cadence, the system does not cut over. Daily snapshots alone are insufficient for the booking target.

## Backup and restore cadence

- Keep Firestore authoritative and covered by its separately verified backup/export posture until the write freeze and final reconciliation complete.
- Before production import: name a current source backup, prove a restore in a restricted environment, record counts/checksums, and keep the raw export encrypted outside git.
- Before Supabase becomes Production: remove all synthetic rows/users, rebuild from migrations, approve the backup/PITR tier, and restore a complete backup into an isolated target.
- After launch: verify automated backup health daily, create encrypted logical exports at the cadence needed to meet RPO, and run a full isolated restore at least quarterly and before destructive schema/data work.
- Retain the read-only Firestore recovery source for 30 days after cutover unless legal/privacy retention requires earlier removal. Destruction is a separate approved action.
- A restore is proven only when schema/version history, owner access, bounded representative queries, counts, checksums, exclusion constraints, outbox leases, and direct-access denials all pass.

Backup locations, credentials, encryption keys, restore project IDs, and customer-bearing artifacts are recorded only in the protected operator evidence store. Logs and git contain identifiers, counts, hashes, and machine codes—not customer fields.

## Incident response

1. Stop new writes with the approved maintenance control; do not improvise client-side dual writes.
2. Name the exact environment, first bad time/change sequence, affected operations, and whether reads remain safe.
3. Preserve PII-safe application, database, provider, and deployment evidence.
4. If integrity is uncertain, keep booking closed and the dashboard read-only while reconciling.
5. Choose a reviewed fix-forward or restore point. After cutover, the insecure direct-client Firebase application is not a writable rollback.
6. Verify owner login, availability, exactly-one overlap behavior, booking/cancel/reschedule, outbox recovery, and bounded counts before reopening.
7. Record the incident timeline, customer impact, data reconciliation, corrective tests, and recovery evidence in the protected incident record; add only a redacted summary to the repository.

## Email completion uncertainty

Resend currently retains an email idempotency key for 24 hours. The outbox must
reuse its immutable provider key unchanged, but that provider window is not a
permanent exactly-once guarantee.

- A provider-accepted send whose database completion cannot be proven is an
  alertable recovery state, not an ordinary blind retry.
- Automatic lease recovery must finish inside the provider's 24-hour window.
- At or beyond that window, stop automatic and manual retry until the operator
  reconciles provider evidence and chooses a documented forward-recovery path;
  another send can duplicate customer mail.
- Cron activation remains a launch gate until the claim contract exposes enough
  immutable timing/disposition evidence to enforce this stop policy without
  reading private tables directly.

## Migration stop conditions

Stop before or during import/cutover when any of these occurs:

- target project/ref/environment does not exactly match the approved preflight;
- backup or restore evidence is missing, stale, or unreconciled;
- source inventory exceeds declared bounds or changes after the write-freeze high-water mark;
- source count is not exactly imported plus quarantined for every collection;
- same source ID/checksum maps differently on an idempotent rerun;
- duplicate legacy IDs, unexplained checksum drift, invalid dates, overlap, or authorization/direct-access tests fail;
- more than the approved quarantine threshold is reached, or any quarantine category is not reviewed;
- migration duration, error count, or downtime reaches its declared bound;
- canary booking, owner login, email-outbox, monitoring, or recovery verification fails.

On a stop, preserve the source and target, keep writes frozen, and follow the pre-declared rollback or forward-recovery branch. Never “fix” customer rows ad hoc in a provider dashboard.

## Routine checks after launch

- Shallow read-free health endpoint and uptime check.
- Error rate, latency, rate-limit, database connection/pool, and outbox pending/failed/dead-letter alerts.
- Bounded daily review of failed webhook/outbox machine codes; no payload logging.
- Supabase security and performance advisors after every migration and on a regular schedule.
- Dependency, secret-history, unit/integration/concurrency/E2E, visual, and accessibility gates on every release candidate.
- Monthly account-recovery check and quarterly restore drill with recorded RPO/RTO observations.
