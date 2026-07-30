# Operations and recovery targets

This runbook defines the intended operating posture for the replacement system. Values marked **launch gate** are requirements, not evidence that the current Free TEST project or live Firebase source already satisfies them. Exact production actions still require the preflight in `PRODUCTION-SAFETY.md`.

Privacy-specific retention, subject access/erasure, and post-restore replay gates
are in [PRIVACY-OPERATIONS.md](./PRIVACY-OPERATIONS.md); provider ownership,
DPA, retention, and deletion evidence is tracked in
[PROCESSORS.md](./PROCESSORS.md). Unapproved entries in those registers prevent
cutover.

## Ownership and escalation

| Responsibility                                              | Primary                          | Escalation trigger                                                                 |
| ----------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| Business decision, customer communication, release approval | Victor / salon owner             | Any booking loss, double booking, owner lockout, or customer-facing outage         |
| Application/database incident lead                          | Designated production operator   | Error-rate alert, invariant failure, migration stop condition, or restore decision |
| Hosting/database/email provider                             | Vercel, Supabase, Resend support | Provider health issue or recovery action outside repository tooling                |

Contact details belong in the protected operator environment and provider accounts, never in git. One person may fill multiple roles, but the release checklist names the active people and confirms account recovery before cutover.

## Current observability boundary

Every current API method is wrapped by one static, server-only route label. With
the exact `OBSERVABILITY_TRANSPORT=console` local transport, the runtime emits
only bounded fixed-shape JSON lines containing: schema version, timestamp,
event code, route label, HTTP method, generated request ID, status/outcome, and
duration. Thrown failures and handled 5xx responses emit the same fixed
`unexpected_error` surrogate context; original exceptions, request objects,
headers, cookies, bodies, URLs, customer fields, database rows, and provider
payloads are never accepted by that boundary. Sink failure cannot change route
behavior.

Local, Test, and operator environments reject remote provider credentials. A
complete Preview or future Production bundle may activate two EU server-only
sinks without a code or branch-specific toggle:

- PostHog receives exactly one `server_route_completed` event for every valid
  observed response. Its event-scoped request UUID is the `distinctId`,
  `$process_person_profile` is false, GeoIP is disabled, and app-supplied
  properties are limited to version, static route/method, request UUID,
  status/outcome, bounded duration, environment, and immutable release. The
  SDK adds its library/version, event UUID/timestamps, capture type, and
  GeoIP-disable marker to the transport envelope.
- Sentry receives one fixed `UnexpectedServerError("UNEXPECTED_SERVER_ERROR")`
  for a returned 5xx or thrown error. It receives no original exception or
  stack, request, URL, headers, body, cookies, user, breadcrumbs, database
  statement, tracing, profiling, replay, logs, or automatic integrations. Its
  envelope adds only the SDK/package name and version plus event/send
  identifiers and timestamps.
- Both sends run through `after()` with no retry, a 500 ms SDK request/flush
  bound, and an independent 750 ms deferred-lifecycle deadline. Scheduler,
  capture, flush, or hung-provider failure cannot delay or change the route
  response.

The `refactor` Preview has a fresh EU Sentry project and separate PostHog EU
project bound by three branch-only server variables. Production has no
observability variables and is unchanged. The same variable names can be added
to Production after the cutover gates; no code rewrite is needed.

This is PII-minimized/personless operational telemetry, not distributed tracing
or browser analytics. PostHog autocapture, replay, web vitals, heatmaps, AI
features, and browser SDKs remain off. Sentry server scrubbing, default
scrubbers, and IP prevention are on. Provider retention/deletion evidence,
synthetic test-fire, alert delivery, source maps, uptime monitoring, and owner
escalation remain open Production gates in [PROCESSORS.md](./PROCESSORS.md).

Rollback is either removing the three `refactor` Preview variables and
redeploying, or reverting the adapter commit. Neither path changes Supabase,
Firebase, customer data, or business behavior.

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

The inert worker boundary reserves a code-owned 16-second claim/provider
cutoff, a 24-second worker-settlement cutoff, and a 25-second invocation
fail-safe, leaving one second for fixed response serialization. The database's
8-second statement timeout and provider's 8-second request timeout fit inside
that composition, and the 120-second lease remains longer than every execution
budget. Each external await is raced against its applicable signal so a late
claim or provider result cannot start another effect; a late fenced completion
may still finish, but is reported as uncertain. These proofs do not activate a
Vercel schedule or a real provider. The database now persists the first
provider-attempt instant and inclusive 24-hour retry deadline before the side
effect; automatic and manual retry stop at or beyond that deadline.

- A provider-accepted send whose database completion cannot be proven is an
  alertable recovery state, not an ordinary blind retry.
- A renderer may signal only the fixed, branded operational-fault contract for
  unavailable dependencies such as a signing key or injected clock. The worker
  makes zero provider calls, fences one retryable `OUTBOX_RENDERER_UNAVAILABLE`
  completion, and returns an alerting 503 even when that retry is durably
  scheduled. Unknown renderer errors remain permanent `OUTBOX_TEMPLATE_INVALID`.
  If the failure completion cannot be proven, completion uncertainty takes
  alert precedence; neither response reflects the private thrown detail.
- A completion that returns `dead_letter` makes the inert invocation return the
  fixed alert `OUTBOX_DELIVERY_DEAD_LETTERED`. Completion uncertainty has higher
  precedence because the persisted state is unknown; a proven dead letter has
  higher precedence than a renderer-operational retry alert because it is
  terminal. No response includes an outbox ID, recipient, provider detail, or
  renderer exception.
- The claim function conserves every bounded selected candidate across returned
  sends and exact terminal dispositions. Candidate saturation derives from all
  selected candidates. The bounded durable dead-letter monitor uses a leased
  high-water cursor and advances only after PII-free receiver acceptance.
- Provider timeout, network failure, invalid success response, 5xx, and
  concurrent-idempotency outcomes are also acceptance-uncertain; the worker
  must not persist them as proven delivery failures.
- Automatic lease recovery must finish inside the provider's 24-hour window.
- At or beyond that window, stop automatic and manual retry until the operator
  reconciles provider evidence and chooses a documented forward-recovery path;
  another send can duplicate customer mail.
- Production provider and scheduler activation remain separate launch gates.

## Outbox activation readiness

The code-owned `outbox-activation-readiness-v2` contract records the reviewed
`claim-dispositions-v2`, `dead-letter-monitor-v1`,
`provider-retry-window-v1`, and `newsletter-confirmation-snapshot-v1` proofs.
Its TEST checkpoint is bound to the exact registered TEST ref and the current
reviewed migration/pgTAP manifest; caller booleans, environment claims, run IDs,
and prose cannot widen it. The contract is explicitly `productionReady: false`.

The non-production composition uses fake email and alert receivers and claims
at most 25 eligible stored
`PROVIDER_MESSAGE_NOT_FOUND` events. Recovery attempts persist an exact
1-minute, 5-minute, 15-minute, then 1-hour backoff; the fifth failed replay is
terminally disposed as `WEBHOOK_REPLAY_EXHAUSTED`, so poison oldest rows cannot
starve later eligible work. Each invocation also durably acknowledges at most
25 dead-letter events after fake acceptance and purges at most 1,000 expired
abuse buckets. It can be manually exercised in Local/Test or in an exact
`APP_ENV=preview`, `VERCEL_ENV=preview` deployment bound to the registered TEST
project, fake transport, disabled webhook, valid Cron secret, and token keyring.
Every other remote target fails closed. There is no Vercel schedule, Resend
transport, real alert receiver, webhook activation, or Production authority.

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

- Shallow read-free `/api/health` uptime check. A 200 proves only process
  liveness; it does not prove database, Auth, provider, migration, queue, or
  restore readiness.
- Error rate, latency, rate-limit, database connection/pool, and outbox pending/failed/dead-letter alerts.
- Bounded daily review of failed webhook/outbox machine codes; no payload logging.
- Supabase security and performance advisors after every migration and on a regular schedule.
- Dependency, secret-history, unit/integration/concurrency/E2E, visual, and accessibility gates on every release candidate.
- Monthly account-recovery check and quarterly restore drill with recorded RPO/RTO observations.
