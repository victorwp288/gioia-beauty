# Privacy operations launch gate

## Status, authority, and scope

**Status:** engineering draft; every retention value and owner choice below is
`PENDING`. This document is not legal advice, is not an approved public privacy
policy, and does not authorize a Production read, write, deletion, restore, or
provider action.

This is the implementation contract for the Phase 3 privacy package in
[MASTERPLAN.md](./MASTERPLAN.md). [PRODUCTION-SAFETY.md](./PRODUCTION-SAFETY.md)
governs every operation; [DATA-MODEL.md](./DATA-MODEL.md) and committed
[Supabase migrations](../supabase/migrations/) govern the current executable
schema. If they conflict, stop. Do not silently choose the least restrictive
interpretation.

Provider, DPA, browser-third-party, retention, and decommission evidence is
tracked separately in [PROCESSORS.md](./PROCESSORS.md). Unknown entries there
remain stop conditions for the affected processing path.

Victor is the decision owner. Owner approval is not a substitute for any legal
or processor review Victor decides is necessary. A decision becomes effective
only when its row below records `APPROVED`, approval date, approver, evidence,
and the migration/runbook/tests that enforce it. Until then:

- no automated Production retention or erasure job may run;
- no public statement may quote the proposed periods as fact;
- the current Firestore source remains authoritative; and
- this file alone completes no item in [MASTERPLAN.md](./MASTERPLAN.md).

### Environment and action classification

| Environment/action                         | Permitted data                                                                   | Required label and rule                                                                                                                                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local/CI                                   | Synthetic fixtures only                                                          | `[LOCAL]`; reset freely, fake email only.                                                                                                                                                                 |
| Greenfield Supabase `lxvsspniipcotimbsfqm` | Synthetic or separately approved anonymized data only                            | `[TEST]`; name/verify the target before work. Raw customer data immediately makes the target Production.                                                                                                  |
| Preview/staging                            | Synthetic by default; approved anonymized derivative only                        | `[TEST]`; serialized reset, non-delivering email, no Production credentials.                                                                                                                              |
| Restricted recovery                        | Approved PII-bearing restore, named access, email disabled, destruction deadline | Reading the source is `[PROD-READ]`; creating/restoring the PII-bearing clone is separately `[PROD-DATA]`; later destruction is `[DESTRUCTIVE]`. Each needs exact approval. It is never ordinary staging. |
| Current Firestore `gioia-beauty-b95e0`     | Live customer/business data                                                      | Every bounded lookup/export is `[PROD-READ]`; every change is separately approved `[PROD-DATA]`, `[PROD-CONFIG]`, or `[DESTRUCTIVE]`.                                                                     |
| Future Production Supabase                 | Live data only after approved cutover/reclassification                           | Same Production controls; no action is inherited from greenfield authorization.                                                                                                                           |

A synthetic access/erasure rehearsal is `[LOCAL]` or `[TEST]`. A real-subject
dry run still reads Production PII and therefore needs exact `[PROD-READ]`
approval. Creating or restoring any PII-bearing database/clone is separately
`[PROD-DATA]`, as is applying scrubs/deletes. Deleting a source, backup, clone,
or provider copy may also be `[DESTRUCTIVE]`. Provider configuration changes
are separately `[PROD-CONFIG]`.

## Canonical enums

Every inventoried field or artifact uses at least one classification and one
planned disposition. `U1_UNKNOWN` is a stop condition, not a permissive bucket.

| Code                    | Classification                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `P1_DIRECT`             | Direct identifier or contact value, including name, email, phone, or raw address.              |
| `P2_FREE_TEXT`          | Human-entered text that can contain identifiers or sensitive facts.                            |
| `P3_BEHAVIORAL`         | Appointment, service, timing, status, marketing, or other activity history.                    |
| `P4_PSEUDONYM`          | Stable or linkable ID, account/session/provider identifier, or legacy record key.              |
| `P5_DERIVED`            | Hash, checksum, aggregate, code, or other derived evidence. It is not automatically anonymous. |
| `S1_CREDENTIAL`         | Secret, password/reset/session material, signed token, API key, or equivalent authenticator.   |
| `E1_CONSENT`            | Consent wording/version, timestamp, source, confirmation, withdrawal, or suppression evidence. |
| `O1_LINKED_OPERATIONAL` | Operational state linked to a person or their record.                                          |
| `U1_UNKNOWN`            | Uninventoried or ambiguous content/shape; quarantine and inspect before processing.            |

| Code                         | Disposition                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `D1_SCRUB_IN_PLACE`          | Null or replace the personal field while preserving the minimum row/invariants.                             |
| `D2_DELETE_TERMINAL_ROW`     | Delete the complete row only after it is terminal and no required link remains.                             |
| `D3_PSEUDONYMIZE_EVIDENCE`   | Replace direct/linkable evidence with a purpose-bound, non-reversible reference.                            |
| `D4_PURGE_AT_EXPIRY`         | Delete automatically after the approved expiry and prove the bounded purge.                                 |
| `D5_REVOKE_OR_ROTATE`        | Revoke, rotate, or invalidate credential/configuration material.                                            |
| `D6_DELINK_AND_RETAIN`       | Remove person links and retain only approved non-identifying operational detail.                            |
| `D7_INVENTORY_OR_QUARANTINE` | Stop, inventory the shape, and explicitly resolve or quarantine it.                                         |
| `D8_ALIGN_PROVIDER_DELETION` | Request/verify deletion or expiry in the processor/provider and record only minimized, classified evidence. |
| `D9_REMOVE_LEGACY_PATH`      | Remove the obsolete store, browser path, cache, or duplicate after its recovery gate.                       |
| `D10_AGGREGATE_THEN_PURGE`   | Preserve approved aggregate evidence, then purge row-level/source evidence.                                 |

## Pending decision register

All baselines are engineering proposals only. **None is approved.** “Terminal”
means an appointment is `completed`, `cancelled`, or `no_show`; an outbox row is
not terminal while `pending`, `sending`, `failed`, or `dead_letter` still needs
resolution; an active future booking is never treated as terminal by age alone.

| ID         | Status    | Proposed baseline (not approved)                                                                                                                                                       | Primary enforcement after approval                                                           |
| ---------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `RET-01`   | `PENDING` | Booking contact fields: scrub 24 months after the appointment becomes terminal.                                                                                                        | `schedule_entries` privacy function/job; future-booking and outbox preconditions.            |
| `RET-02`   | `PENDING` | Client/internal/cancellation notes: scrub 30 days after the related appointment becomes terminal.                                                                                      | Notes-first scrub; sensitive-note prohibition below.                                         |
| `RET-03`   | `PENDING` | De-linked schedule/service/status detail: retain no more than 5 years after terminal, then aggregate/purge.                                                                            | Delinked history plus bounded aggregate purge.                                               |
| `RET-04`   | `PENDING` | Newsletter raw email: while active; pending for 7 days; terminal (`unsubscribed`, `bounced`, `complained`, or unresolved legacy) for 30 days.                                          | Consent-cycle-aware subscriber transition and suppression design.                            |
| `RET-05`   | `PENDING` | Pseudonymized consent/withdrawal proof: 5 years after the last relevant consent or withdrawal event.                                                                                   | Separate immutable consent-event evidence; no raw email required.                            |
| `RET-06`   | `PENDING` | Email outbox recipient/template snapshot: 90 days after terminal delivery state. Never age-purge unresolved delivery work.                                                             | Transactional terminal-row purge/scrub and provider reconciliation.                          |
| `RET-07`   | `PENDING` | Verified webhook event evidence: 90 days after receipt/processing.                                                                                                                     | Bounded webhook purge after no unresolved processing error.                                  |
| `RET-08`   | `PENDING` | Command/idempotency records: the existing exact 7-day expiry.                                                                                                                          | Add a bounded purge; current SQL sets `expires_at` but does not enforce deletion.            |
| `RET-09`   | `PENDING` | Linked domain/audit evidence: 24 months after the recorded event, then pseudonymize/delink or aggregate.                                                                               | Preserve integrity/high-water evidence without direct values.                                |
| `RET-10`   | `PENDING` | Raw migration linkage/quarantine evidence: through the 30-day recovery window; aggregate reconciliation proof: 24 months after the run.                                                | Resolve quarantine, aggregate counts/checksums, purge source IDs/linkage.                    |
| `RET-11`   | `PENDING` | Owner/Auth account: active lifetime plus 90 days; expired/revoked session rows: 30 days; owner security audit: 12 months.                                                              | Auth deletion/disable workflow, session purge, minimal security ledger.                      |
| `RET-12`   | `PENDING` | Direct-identifier-free, PII-minimized application/observability logs: 30 days; an identified incident copy: at most 90 days.                                                           | Provider setting plus incident ID, scope, approver, and deletion check.                      |
| `RET-13`   | `PENDING` | Firestore recovery source: 30 days after cutover; Supabase PITR: 30 days; encrypted logical export: 35 days; restricted recovery clone: 7 days; minimized restore evidence: 24 months. | Backup/provider configuration, expiry inventory, restore replay gate.                        |
| `RET-14`   | `PENDING` | Subject-request intake, identity proof, access package, and operator working artifacts require an owner/legal decision; no duration is proposed by this audit.                         | Purpose-specific case store outside logs; encrypted artifact lifecycle and deletion receipt. |
| `RET-15`   | `PENDING` | Provider-side message, request, log, backup, and support copies require provider verification and an owner/legal decision; no duration is proposed by this audit.                      | Processor inventory, configured expiry, deletion API/request, and verified result.           |
| `RET-16`   | `PENDING` | Vacation free-text reason: scrub 30 days after end/cancellation; de-linked date/status detail: 24 months.                                                                              | Vacation privacy function/job with schedule-integrity checks.                                |
| `RET-17`   | `PENDING` | Raw credentials/action tokens: keep only for their explicit functional TTL, then purge/revoke; never log token values.                                                                 | TTL/one-time-use constraints, key rotation, revoked-session/token cleanup.                   |
| `RET-HOLD` | `PENDING` | A hold must name exact records/purpose/approver, start, review date, and expiry. It is never global or open-ended; maximum duration remains pending.                                   | Hold ledger checked by every purge; expiry/review alerts; separately approved release.       |

## Field and artifact matrix

The matrix names current stores and exact field groups. A row with several
dispositions means the implementation must choose by state and record the
result; it does not authorize arbitrary deletion.

### Canonical database tables and Auth

| Store and exact fields                                                                                                                           | Class                                                                                  | Decision           | Intended disposition / current gate                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `booking_policy.admin_notification_email`                                                                                                        | `P1_DIRECT`, `O1_LINKED_OPERATIONAL`                                                   | `RET-11`           | `D1_SCRUB_IN_PLACE` or replace with the approved active owner address. Current singleton has no privacy lifecycle.                                             |
| `schedule_entries.client_name`, `client_email`, `client_phone`                                                                                   | `P1_DIRECT`                                                                            | `RET-01`           | `D1_SCRUB_IN_PLACE`; blocked by required appointment name and no privacy command.                                                                              |
| `schedule_entries.client_note`, `internal_note`, `cancellation_reason`                                                                           | `P2_FREE_TEXT`                                                                         | `RET-02`           | `D1_SCRUB_IN_PLACE`; sensitive content is prohibited pending the owner decision.                                                                               |
| `schedule_entries.local_date`, `start_minutes`, durations/buffer, service/variant and price snapshots, `kind`, `status`, cancellation timestamps | `P3_BEHAVIORAL`, `O1_LINKED_OPERATIONAL`                                               | `RET-03`           | `D6_DELINK_AND_RETAIN`, later `D10_AGGREGATE_THEN_PURGE`; preserve active schedule invariants.                                                                 |
| `schedule_entries.id`, `created_by`, `legacy_firestore_id`, provenance/import timestamps                                                         | `P4_PSEUDONYM`, `O1_LINKED_OPERATIONAL`                                                | `RET-03`, `RET-10` | `D3_PSEUDONYMIZE_EVIDENCE`/`D6_DELINK_AND_RETAIN`; legacy reconciliation link survives only through its gate.                                                  |
| `vacations.reason`                                                                                                                               | `P2_FREE_TEXT`                                                                         | `RET-16`           | `D1_SCRUB_IN_PLACE`.                                                                                                                                           |
| `vacations` dates/status plus creator, legacy ID, cancellation/provenance fields                                                                 | `P3_BEHAVIORAL`, `P4_PSEUDONYM`, `O1_LINKED_OPERATIONAL`                               | `RET-16`, `RET-10` | `D6_DELINK_AND_RETAIN`, then `D10_AGGREGATE_THEN_PURGE`; do not break occupied/future-day checks.                                                              |
| `schedule_day_locks.local_date`, `created_at`                                                                                                    | No personal class identified                                                           | n/a                | Durable concurrency mutex state, not subject-linked data. Any cleanup belongs to a separately proven concurrency-safe maintenance design, not a privacy purge. |
| `newsletter_subscribers.email` and stable/legacy IDs                                                                                             | `P1_DIRECT`, `P4_PSEUDONYM`                                                            | `RET-04`           | `D1_SCRUB_IN_PLACE` or `D2_DELETE_TERMINAL_ROW`; current email is non-null, unique, immutable, and mutator deletion is revoked.                                |
| Subscriber status, `consent_at/source/policy_version`, confirmation/unsubscribe timestamps                                                       | `E1_CONSENT`, `P3_BEHAVIORAL`, `O1_LINKED_OPERATIONAL`                                 | `RET-05`           | `D3_PSEUDONYMIZE_EVIDENCE`/`D6_DELINK_AND_RETAIN`; current row is not a complete multi-cycle consent ledger.                                                   |
| `email_outbox.recipient_address`, `template_data.client_name`                                                                                    | `P1_DIRECT`                                                                            | `RET-06`           | `D1_SCRUB_IN_PLACE` or `D2_DELETE_TERMINAL_ROW`; currently immutable and delete-revoked.                                                                       |
| Outbox schedule/template fields, status, attempts, lease/error/timestamps                                                                        | `P3_BEHAVIORAL`, `O1_LINKED_OPERATIONAL`                                               | `RET-06`           | Terminal-only `D2_DELETE_TERMINAL_ROW` or `D10_AGGREGATE_THEN_PURGE`; unresolved work is a stop condition.                                                     |
| Outbox IDs, aggregate/provider/idempotency IDs                                                                                                   | `P4_PSEUDONYM`, `P5_DERIVED`                                                           | `RET-06`, `RET-15` | `D3_PSEUDONYMIZE_EVIDENCE` then `D2_DELETE_TERMINAL_ROW`; provider result must reconcile first.                                                                |
| `email_outbox.template_data.policy_version`                                                                                                      | `E1_CONSENT`                                                                           | `RET-05`, `RET-06` | Move minimum proof to consent evidence before terminal outbox purge.                                                                                           |
| `email_webhook_events.provider_event_id`, `provider_message_id`                                                                                  | `P4_PSEUDONYM`                                                                         | `RET-07`, `RET-15` | `D2_DELETE_TERMINAL_ROW`/`D8_ALIGN_PROVIDER_DELETION`; never purge unprocessed/error state silently.                                                           |
| Webhook hash, kind, verified flag, timestamps, error code                                                                                        | `P5_DERIVED`, `O1_LINKED_OPERATIONAL`                                                  | `RET-07`           | `D10_AGGREGATE_THEN_PURGE`; current table has no purge.                                                                                                        |
| `command_requests.principal_scope_hash`, resource ID                                                                                             | `P4_PSEUDONYM`, `P5_DERIVED`                                                           | `RET-08`           | `D4_PURGE_AT_EXPIRY`; `expires_at` exists, cleanup does not.                                                                                                   |
| Command operation/key/fingerprint/state/status/code/redacted response/timestamps                                                                 | `P5_DERIVED`, `O1_LINKED_OPERATIONAL`                                                  | `RET-08`           | `D4_PURGE_AT_EXPIRY`; response must remain code plus opaque UUID only.                                                                                         |
| `domain_change_log.aggregate_id`, command/run/actor IDs                                                                                          | `P4_PSEUDONYM`                                                                         | `RET-09`           | `D3_PSEUDONYMIZE_EVIDENCE`/`D6_DELINK_AND_RETAIN`; append-only/FK constraints currently block lifecycle changes.                                               |
| Domain change kind/source/changed field **names**/timestamps                                                                                     | `P3_BEHAVIORAL`, `P5_DERIVED`, `O1_LINKED_OPERATIONAL`                                 | `RET-09`           | `D10_AGGREGATE_THEN_PURGE`; values must never enter `changed_fields`.                                                                                          |
| `migration_runs` source ref/manifest/counts/status/timestamps                                                                                    | `P4_PSEUDONYM`, `P5_DERIVED`                                                           | `RET-10`           | `D10_AGGREGATE_THEN_PURGE`; counts must be redacted aggregates.                                                                                                |
| `migration_records` source collection/record ID and source/target hashes/IDs                                                                     | `P4_PSEUDONYM`, `P5_DERIVED`, possibly `U1_UNKNOWN`                                    | `RET-10`           | `D7_INVENTORY_OR_QUARANTINE`, then `D3_PSEUDONYMIZE_EVIDENCE`/`D10_AGGREGATE_THEN_PURGE`.                                                                      |
| `migration_quarantine` source ID, reason/field codes, resolution IDs                                                                             | `P4_PSEUDONYM`, `P5_DERIVED`, `U1_UNKNOWN` until reviewed                              | `RET-10`           | `D7_INVENTORY_OR_QUARANTINE`; never infer, silently drop, or store payload values.                                                                             |
| Supabase Auth owner email/metadata and `owner_accounts.user_id`/role/state                                                                       | `P1_DIRECT`, `P4_PSEUDONYM`, `O1_LINKED_OPERATIONAL`, unknown metadata is `U1_UNKNOWN` | `RET-11`           | `D7_INVENTORY_OR_QUARANTINE`, then `D1_SCRUB_IN_PLACE`/account disable-delete; FK restrictions require an ordered function.                                    |
| Auth password/reset/MFA/session material                                                                                                         | `S1_CREDENTIAL`                                                                        | `RET-17`           | `D5_REVOKE_OR_ROTATE`; never export or include in subject packages.                                                                                            |
| `owner_sessions.session_id`, user ID, expiry/revocation timestamps                                                                               | `S1_CREDENTIAL`, `P4_PSEUDONYM`, `O1_LINKED_OPERATIONAL`                               | `RET-11`, `RET-17` | `D5_REVOKE_OR_ROTATE` plus `D4_PURGE_AT_EXPIRY`; current table has no delete grant/job.                                                                        |
| Catalog, business-hours, and non-email booking-policy fields                                                                                     | No personal class identified                                                           | n/a                | Keep only as business configuration; reclassify if future free text or owner identity is added.                                                                |

Schema evidence: [schedule/idempotency migration](../supabase/migrations/20260709235549_create_schedule_and_idempotency_core.sql),
[outbox/subscriber/audit migration](../supabase/migrations/20260709235554_create_outbox_subscribers_audit_and_migration.sql),
[migration ledger](../supabase/migrations/20260709235627_add_migration_record_ledger.sql),
[storage hardening](../supabase/migrations/20260709235640_harden_runtime_storage_boundaries.sql),
and [owner sessions](../supabase/migrations/20260710013427_add_owner_session_revocation_ledger.sql).

### Transient requests, tokens, logs, and caches

| Store/artifact                                                                                    | Class                                                                               | Decision              | Intended disposition / gate                                                                                                                                         |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Booking/admin/newsletter request bodies                                                           | `P1_DIRECT`, `P2_FREE_TEXT`, `P3_BEHAVIORAL`, `E1_CONSENT`                          | Source-table decision | Parse once with bounded schemas; do not persist/log raw body outside the atomic domain row/outbox. `D4_PURGE_AT_EXPIRY` at request end.                             |
| Raw IP, forwarded headers, user agent, cookies, Authorization/JWT                                 | `P1_DIRECT` or `P4_PSEUDONYM`; tokens are `S1_CREDENTIAL`                           | `RET-12`, `RET-17`    | Do not log/store raw values. Use only purpose-bound HMAC where required; `D4_PURGE_AT_EXPIRY`/`D5_REVOKE_OR_ROTATE`.                                                |
| Idempotency keys, request fingerprints, cursor/action-token claims                                | `P4_PSEUDONYM`, `P5_DERIVED`; signed wire is `S1_CREDENTIAL`                        | `RET-08`, `RET-17`    | Bound length/TTL, redact wire values, atomically consume where required, then `D4_PURGE_AT_EXPIRY`.                                                                 |
| Fixed observability JSONL: timestamp, request UUID, static route/method, status/outcome, duration | `P4_PSEUDONYM`, `P5_DERIVED`                                                        | `RET-12`              | `D4_PURGE_AT_EXPIRY`; no URL, query, headers, body, original error, or arbitrary metadata. See [observability contracts](../lib/server/observability/contracts.ts). |
| Legacy `console.*`, free-form errors/debug objects                                                | `U1_UNKNOWN`, potentially `P1_DIRECT`/`P2_FREE_TEXT`                                | `RET-12`              | Launch blocker: `D9_REMOVE_LEGACY_PATH`; never route legacy console output into a retained provider sink.                                                           |
| Legacy appointment/query caches and component/context state                                       | `P1_DIRECT`, `P2_FREE_TEXT`, `P3_BEHAVIORAL`                                        | `RET-01`, `RET-02`    | Memory only, clear on sign-out/session end, then `D9_REMOVE_LEGACY_PATH` with the legacy cache architecture. No persisted browser PII cache.                        |
| Browser storage                                                                                   | `U1_UNKNOWN` until key inventory proves otherwise                                   | `RET-12`, `RET-17`    | `D7_INVENTORY_OR_QUARANTINE`; forbid booking/customer PII and credentials beyond reviewed secure session mechanics.                                                 |
| Future privacy case selector/link, identity/approval digest, snapshot and plan hash               | `P1_DIRECT` at selector input; persisted references are `P4_PSEUDONYM`/`P5_DERIVED` | `RET-14`, `RET-17`    | Keep only in the protected case ledger under the approved expiry. It is personal/pseudonymous evidence, never aggregate telemetry.                                  |

### Legacy sources, exports, providers, and backups

| Store/artifact                                                                          | Class                                                                      | Decision                               | Intended disposition / gate                                                                                                                            |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Firestore `customers`: contact, note, schedule, status, IDs and ambiguous legacy fields | `P1_DIRECT`, `P2_FREE_TEXT`, `P3_BEHAVIORAL`, `P4_PSEUDONYM`, `U1_UNKNOWN` | `RET-01`–`RET-03`, `RET-10`, `RET-13`  | Inventory exact shapes, quarantine ambiguity, import/reconcile, keep read-only for recovery, then separately approve `D9_REMOVE_LEGACY_PATH`.          |
| Firestore `newsletter_subscribers`                                                      | `P1_DIRECT`, `E1_CONSENT`, `P4_PSEUDONYM`, `U1_UNKNOWN`                    | `RET-04`, `RET-05`, `RET-10`, `RET-13` | Unproven consent stays `legacy_unverified`; `D7_INVENTORY_OR_QUARANTINE`, then approved import or purge.                                               |
| Firestore `vacations`                                                                   | `P2_FREE_TEXT`, `P3_BEHAVIORAL`, `P4_PSEUDONYM`, `U1_UNKNOWN`              | `RET-10`, `RET-13`, `RET-16`           | `D7_INVENTORY_OR_QUARANTINE`, import/reconcile, then remove duplicate source after recovery gate.                                                      |
| Firestore `settings` / `analytics`                                                      | `U1_UNKNOWN`                                                               | `RET-10`, `RET-13`                     | Prove a live consumer and classify every field; otherwise quarantine/omit with explicit disposition. Never guess.                                      |
| Firebase Auth owner identities, provider metadata, sessions and recovery state          | `P1_DIRECT`, `P4_PSEUDONYM`, `S1_CREDENTIAL`, `U1_UNKNOWN`                 | `RET-11`, `RET-13`, `RET-15`, `RET-17` | Provider-side inventory is required; never export credentials. Revoke/delete only through the approved account and recovery sequence.                  |
| Firebase Analytics telemetry, device/user identifiers and provider-derived audiences    | `P3_BEHAVIORAL`, `P4_PSEUDONYM`, `U1_UNKNOWN`                              | `RET-12`, `RET-13`, `RET-15`           | Inventory provider fields, consent basis, retention, export and deletion path; otherwise remove collection before cutover.                             |
| Firebase Storage buckets/objects and metadata                                           | `U1_UNKNOWN`                                                               | `RET-13`, `RET-15`                     | Client initialization exists but no repository consumer is proven. Inventory the provider target and contents; unknown objects are a stop condition.   |
| Legacy browser `/export` JSON and any downloaded database dump                          | All source classes, including `U1_UNKNOWN`                                 | `RET-13`, `RET-14`                     | Current unbounded direct-client export is a launch blocker: `D9_REMOVE_LEGACY_PATH`. Raw artifacts stay encrypted/outside git and need named deletion. |
| Approved owner/subject access package                                                   | Potentially all subject classes                                            | `RET-14`                               | Exact-subject, minimal encrypted package; authenticated handoff; `D4_PURGE_AT_EXPIRY` only after RET-14 approval and deletion receipt.                 |
| Raw migration export/before-image/recovery copy                                         | Potentially all source classes                                             | `RET-10`, `RET-13`                     | Encrypted, access-controlled, outside git; `D4_PURGE_AT_EXPIRY`; retain only classified, minimized reconciliation evidence.                            |
| Anonymized staging derivative                                                           | `P5_DERIVED`; any linkability becomes `P4_PSEUDONYM`                       | `RET-13`                               | Validate anonymity against the approved transform; `D10_AGGREGATE_THEN_PURGE` when its test purpose ends.                                              |
| Resend message/recipient/provider copies                                                | `P1_DIRECT`, `P3_BEHAVIORAL`, `P4_PSEUDONYM`                               | `RET-06`, `RET-07`, `RET-15`           | `D8_ALIGN_PROVIDER_DELETION`; verify actual provider controls before approval. Do not assume a duration.                                               |
| Vercel request/function logs and future monitoring provider                             | `U1_UNKNOWN` until configured; intended `P4_PSEUDONYM`/`P5_DERIVED` only   | `RET-12`, `RET-15`                     | Register fields and provider retention first; `D8_ALIGN_PROVIDER_DELETION`. Sentry remains unregistered/inert.                                         |
| Supabase database/Auth operational copies                                               | Same class as canonical rows/Auth                                          | Row decision plus `RET-15`             | Apply server-side privacy function and provider-aligned deletion; browser roles remain denied.                                                         |
| Firestore recovery backup/export                                                        | All legacy source classes                                                  | `RET-13`                               | Proposed 30-day recovery window, then separate `[DESTRUCTIVE]` approval and verified `D4_PURGE_AT_EXPIRY`.                                             |
| Supabase PITR/managed backups                                                           | Same classes as Production database                                        | `RET-13`, `RET-15`                     | Proposed 30-day window; erasure propagates by backup expiry plus restore replay, not unsafe in-place editing.                                          |
| Encrypted logical export                                                                | Same classes as exported rows                                              | `RET-13`                               | Proposed 35-day expiry, named encryption/access/deletion evidence.                                                                                     |
| Restricted recovery clone                                                               | Same classes as restored source                                            | `RET-13`                               | Proposed 7-day deadline, no public app/email, named access, destroy and verify.                                                                        |
| Reconciliation/restore evidence                                                         | `P4_PSEUDONYM`, `P5_DERIVED` unless proven unlinkable                      | `RET-10`, `RET-13`                     | Proposed 24 months; minimized counts, hashes, reason codes, run IDs only—no raw values or stable subject lookup key.                                   |

## Current SQL and application blockers

No privacy migration, database-backed operator, or Production-capable privacy
workflow exists yet. A future implementation must be bound to a validated
actual Local/Test/Production target, not a caller-declared environment label.
Specifically:

1. There is no retention-policy table, hold ledger, subject-request ledger,
   privacy role/function, bounded purge job, deletion receipt, or restore replay
   ledger.
2. Appointment `client_name` is required, while existing transition rules keep
   identity/provenance and terminal occupancy facts immutable. Contact/note
   fields can be owner-edited, but there is no purpose-built atomic scrub that
   preserves constraints, outbox state, audit evidence, and idempotent replay.
3. Subscriber email is non-null, unique, and immutable; table deletion is
   revoked. The current subscriber row cannot both erase raw email and retain
   minimum suppression/consent evidence.
4. Outbox recipient/template snapshots are immutable and table deletion is
   revoked. A subject scrub could otherwise strand or misdirect `pending`,
   `sending`, `failed`, or `dead_letter` work.
5. Domain/migration ledgers are append-only or FK-restricted. They minimize
   values but still contain linkable IDs and have no approved delink/purge path.
6. Command rows receive an exact seven-day `expires_at` in
   [the helper migration](../supabase/migrations/20260709235655_add_command_audit_outbox_helpers.sql),
   but no bounded cleanup enforces it. Owner sessions likewise have expiry but
   no approved retention cleanup.
7. The legacy [browser export page](../app/export/page.jsx) reads entire
   Firestore collections directly and creates a raw JSON download. It must be
   replaced by a bounded authenticated server export; it is not a DSR tool.
8. Legacy caches, contexts, and free-form console/error paths can hold or print
   whole records. They must be removed or replaced with classified,
   direct-identifier-free fixed fields before any retained provider logging is
   enabled.
9. Backup/provider expiry and deletion capabilities have not been verified or
   approved. A database scrub does not erase an already-created export,
   provider message, log, support copy, or backup.

### Local executable contract foundation

The repository now has provider-free, non-mutating contracts in
[`lib/server/privacy/`](../lib/server/privacy/) for the parts of the workflow
that do not require an owner, legal, provider, or Production decision:

- `privacyDecisionRegistry.ts` accepts only the complete ordered
  `RET-01`–`RET-17`/`RET-HOLD` manifest. Pending decisions carry no invented
  value or evidence. A decided row binds only to a protected-artifact digest
  and canonical decision instant. A complete `APPROVED` shape can pass the
  structural plan gate, but a digest does not prove authentic approval and the
  generated plan explicitly carries `authority: none`.
- `privacyWorkflow.ts` compiles fixed access, erasure-dry-run, and erasure-apply
  plans for the exact Local or authorized TEST identifiers. It enforces the
  selector, page, row, and plaintext bounds above and fails closed on unknown
  fields, ambiguous identity, quarantine, holds, future bookings, active email
  or webhook state, provider reconciliation, restore-replay gaps, and pending
  policy decisions. No Production target is registered.
- `privacyOperationalEvidence.ts` derives one bounded, fixed-shape operational
  artifact from an issued plan. It excludes the protected case ID, selectors,
  subject values, payloads, paths, tokens, and free-form errors. It is still a
  classified protected artifact under the rules below, not permission to emit
  it to console, CI, Sentry, a ticket, or another provider.

These contracts perform no database, Auth, filesystem, network, provider,
export, scrub, delete, or restore operation. They do not replace the missing
privacy tables/functions/operator, owner decisions, identity procedure,
encrypted package lifecycle, provider evidence, TEST rehearsal, or Production
approval. Caller booleans and structurally valid decision rows are not execution
authority. No acceptance item is completed by this local foundation.

### Sensitive-note interim rule and owner decision

Until Victor explicitly decides the allowed purpose/content and legal review:

- **do not collect or enter health, diagnosis, medication, pregnancy,
  allergy, treatment-contraindication, or other sensitive/special-category
  information in `client_note`, `internal_note`, `cancellation_reason`, or
  `vacations.reason`;**
- do not invite such content in UI copy; replace the note UI with a neutral
  operational warning or disable it before launch;
- do not migrate a legacy note that may contain sensitive information into
  ordinary TEST/staging; classify it `U1_UNKNOWN` and quarantine it in the
  approved restricted recovery workflow without copying the payload into the
  migration ledger; and
- if the owner requires sensitive notes, stop this workstream and document the
  precise purpose, minimum fields, access, retention, encryption, incident,
  access/erasure, and public-policy requirements before implementation.

The owner decision must be explicit: **prohibit sensitive notes** or approve a
separately reviewed design. Silence does not approve collection.

### Consent-version gap

The database currently hardcodes `newsletter-consent-v1`, while
[the public policy page](../app/policy/page.jsx) has no canonical immutable
policy/version artifact tied to that value. The Zod schema only checks that a
version string is bounded; it does not prove which wording the person saw.
Re-consent overwrites the single row's consent fields rather than recording a
complete immutable consent cycle. Confirmation SQL is not yet bound to the
issued token/cycle, and legacy consent remains unproven.

Before newsletter activation, version the exact Italian consent wording and
public policy artifact in the repository, bind form + outbox + token + database
event to that immutable version, preserve confirmation/withdrawal events, and
prove `legacy_unverified` recipients cannot receive marketing.

## Dry-run subject access and erasure workflow

There is no public self-service endpoint in this phase. The owner handles a
request through a protected operator workflow. Real-subject work cannot use a
developer shell, ordinary CI, Preview, or an ad-hoc dashboard query.

### Fixed bounds and identity gate

1. Open one opaque case ID. Accept at most **three exact selectors** supplied by
   the requester (normalized email plus corroborating phone/booking ID where
   available); never fuzzy-search names or enumerate possible matches.
2. Verify identity through an owner-approved out-of-band method. Store no raw
   identity document in application logs, git, tickets, or the evidence
   artifact. If identity is ambiguous, stop.
3. Query one subject, exact identifiers only, all-history pagination of at most
   **100 rows per page, 100 pages per store, 10,000 rows total, and 25 MiB of
   packaged plaintext**. Exceeding any bound stops the run for a separately
   reviewed plan; it never truncates the response silently.
4. Classify every discovered field. `U1_UNKNOWN`, conflicting identifiers,
   ambiguous shared contact data, unresolved migration quarantine, or an
   unexpected store stops mutation and moves the case to manual quarantine.
5. Check `RET-HOLD`. A hold without exact scope/review/expiry is invalid and a
   stop condition, not permission to retain everything.

### Access dry run

1. Show exact target, commit/migration fingerprint, case ID, selectors count
   (not values), stores, bounds, expected reads/rows, no-write assertion,
   package maximum, and destruction plan. Obtain exact Production-read approval.
2. Read through reviewed server/operator queries only. Include the subject's
   domain data and consent evidence; exclude secrets, other customers, internal
   security controls, provider secrets, and unrelated owner data.
3. Render a minimal package in an encrypted ephemeral location. Validate schema,
   record counts, provenance, and package hash without emitting values.
4. Have the owner review identity and scope, hand off through the approved
   channel, then delete working/package copies under the eventual `RET-14`
   decision. Keep subject-linked evidence only in the protected case record and
   emit a separately classified, minimized operational artifact.

### Erasure dry run and apply gate

1. Re-run discovery in one consistent snapshot and produce a row-by-row plan
   using `D1`–`D10`. Dry run writes nothing.
2. **Future-booking stop:** if a confirmed future appointment still needs
   contact/delivery, do not scrub it silently. Offer owner-handled cancellation
   or defer only the minimum fields until the booking is terminal; suppress
   newsletter activity immediately where authorized.
3. **Outbox stop:** do not scrub/delete a subject while any related outbox row is
   `pending`, `sending`, `failed`, or `dead_letter`, any webhook is unprocessed,
   or provider reconciliation is incomplete. Resolve/cancel delivery through a
   reviewed transaction first; no post-erasure email may be sent.
4. Stop on hold, FK/constraint failure, unknown field, quarantine mismatch,
   missing consent-cycle evidence, backup/replay ledger gap, provider failure,
   changed counts/fingerprint, or any plan exceeding the fixed bounds.
5. Applying the exact plan needs separate `[PROD-DATA]` approval. Use a
   transaction/checkpointed idempotent operator, not SQL copied into a dashboard.
6. Reconcile planned versus actual rows by store/disposition; prove direct
   identifiers are gone except explicitly deferred/held rows, future booking
   invariants still pass, no deliverable outbox remains, and browser/API access
   remains denied. A provider/backup action stays open until separately verified.

## Evidence separation and minimization

The protected subject-case ledger is personal/pseudonymous data. It may contain
the opaque case ID, exact selector references, identity/approval evidence
digests, snapshot/plan binding, holds, and approved result under `RET-14` and
`RET-17`; it is access-controlled, expiring, and remains personal data.

The separate dry-run, apply, purge, provider, backup, and restore operational
artifact is direct-identifier-free but still `P4_PSEUDONYM`/`P5_DERIVED` while
it can correlate to a case. It is access-controlled under the applicable
pending retention decision and may contain only:

- non-subject run ID, target allowlist ID, commit and migration fingerprints;
- policy decision IDs/versions, approval ID, operator role (not contact data);
- start/end timestamps and exact query/page/byte bounds;
- per-store counts and per-disposition counts;
- aggregate non-subject checksums, reason/error codes, stop condition;
- test/assertion counts, backup/restore IDs, provider deletion request status;
- reconciliation result and artifact-deletion receipt.

This artifact must not contain a name, email, phone, note, request
body/header/cookie,
raw IP, token/secret, provider payload, source record value, export path that
reveals identity, case ID, plan/snapshot/evidence hash, stable cross-case subject
hash, or free-form exception. Any value linkable to a source identifier belongs
in the protected case ledger as `P4_PSEUDONYM`; do not call it anonymous or
PII-free.

Only a separately derived aggregate may be labelled PII-free after a reviewed
unlinkability test proves it has no case/run/approval/provider/backup/receipt
identifier, exact event timestamp, stable hash, small-cell subject count, or
other correlation path. No current privacy artifact has that proof, so all are
handled as personal/pseudonymous data.

## Backup restore replay gate

Erasure from the live database does not mutate historical backups in place.
Before any PII-bearing restore can become accessible to an app/operator beyond
the restricted recovery team:

1. verify target, backup ID/time, schema fingerprint, access list, email/network
   disablement, and destruction deadline;
2. restore only into an isolated target;
3. load the complete, integrity-checked post-backup privacy-action/hold ledger;
4. replay every scrub/delete/suppression after the backup timestamp in order,
   without sending email or reopening public/browser access;
5. reconcile action count, affected store counts, future booking/overlap state,
   subscriber suppression, outbox terminal state, and direct-access denial;
6. emit only the minimized, classified operational evidence defined above; and
7. stop and destroy/quarantine the clone if the ledger is missing, has a sequence
   gap/hash mismatch, replay changes an active future booking unexpectedly,
   leaves a deliverable outbox row, cannot resolve a hold, or fails any count or
   security invariant.

No restored clone may become Production merely because database restore
succeeded. The full restore and deployment gates in
[PRODUCTION-SAFETY.md](./PRODUCTION-SAFETY.md) still apply.

## Migration ordering

This document creates no migration and reserves no Production action.
The current source manifest contains 60 migrations. Phase 3 migrations 38–54
and Phase 4 migrations 55–60 exist in source and may have Local/CI evidence,
but they have not been applied and accepted by the protected hosted-TEST
checkpoint. Their presence is not remote schema evidence. The Phase 2 TEST
checkpoint is still open.

**The Phase 2 TEST checkpoint also remains unresolved.**

the required final durable `app_runtime` transaction-pooler authentication and
success/zero-residue evidence have not completed.

Ordering is therefore:

1. preserve the unresolved Phase 2 checkpoint and fail-closed TEST runtime
   state; do not infer Phase 2 or hosted-TEST acceptance from local migrations;
2. review the exact Phase 3 candidate-head migration manifest and run its
   protected hosted-TEST apply/rebuild, security, concurrency, and reconciliation
   gates only after the TEST connection blocker is repaired and the named
   preflight is satisfied; and
3. add privacy hold/request/event, scrub/purge, and restore-replay migrations
   only with the next available migration identity and only after the applicable
   owner, legal, and provider decisions below are approved.

Do not renumber or edit an existing migration, treat a local/CI pass as a remote
apply, merge privacy semantics into an opaque existing change, or run privacy
SQL ad hoc through a provider dashboard.

## Acceptance checklist

Every box remains open until executable evidence exists; drafting this file is
not completion.

- [ ] Victor records `APPROVED` or `REJECTED` for every `RET-01`–`RET-17` and
      `RET-HOLD`, including the sensitive-note decision.
- [ ] Exact Italian public privacy/consent wording is versioned, fact-checked,
      owner-approved, and linked to immutable consent events.
- [ ] Processor/DPA and provider retention/deletion capabilities are inventoried
      without assumptions; Production configuration matches approved decisions.
- [ ] Reviewed migrations implement hold, subject-case/evidence, consent events,
      idempotent scrub/delink/purge, and restore replay without weakening grants.
- [ ] Unit/SQL/integration tests cover every table, state, RET decision,
      disposition, bound, stop condition, hold, consent cycle, and idempotent rerun.
- [ ] Synthetic Local and exact TEST access/erasure runs pass from clean database
      twice with zero direct identifiers in logs/operational evidence, protected
      case data only in its case store, and zero direct browser table access.
- [ ] Future bookings, overlap rules, soft cancellation, subscriber suppression,
      outbox/webhook state, audit integrity, and migration reconciliation survive.
- [ ] Owner/server exports are bounded, private/no-store, encrypted as artifacts,
      deletion-tested, and the unbounded direct-client legacy export is removed.
- [ ] Backup/provider expiry is configured; restore replay and clone destruction
      are proven; missing/gapped privacy evidence fails closed.
- [ ] Monitoring is direct-identifier-free and PII-minimized, every field is
      classified, provider retention is verified, and an incident extension
      requires a bounded approved incident record.
- [ ] An independent privacy/security review finds no P1/P2 issue; full CI and
      both clean database cycles pass at the reviewed commit.
- [ ] `docs/MASTERPLAN.md`, `docs/WORKLOG.md`, public policy, processor inventory,
      and operations/recovery runbooks are updated only with proven evidence.

The Phase 3 privacy checklist item remains unchecked until all applicable items
above are approved, implemented, tested, and rehearsed. Production erasure,
provider deletion, backup expiry, migration, and cutover remain separately
approved actions.
