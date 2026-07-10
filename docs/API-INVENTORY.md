# API route inventory

Current `refactor` server routes and their bounded contracts. This describes
repository code, not deployed Production behavior. Production verification
requires a separately approved deployment.

## Active-route manifest

The JSON markers are checked against explicitly exported HTTP methods in every
`app/**/route.{js,jsx,ts,tsx}` module whose route-group-normalized URL begins
with `/api`. Framework-generated `HEAD`/`OPTIONS` behavior is outside this
explicit-export manifest. Keep the markers exact and unique.

<!-- api-inventory-active:start -->
<!-- api-route {"method":"POST","path":"/api/admin/appointments"} -->
<!-- api-route {"method":"POST","path":"/api/admin/appointments/details"} -->
<!-- api-route {"method":"POST","path":"/api/admin/appointments/reschedule"} -->
<!-- api-route {"method":"POST","path":"/api/admin/appointments/status"} -->
<!-- api-route {"method":"POST","path":"/api/admin/blocks"} -->
<!-- api-route {"method":"POST","path":"/api/admin/blocks/details"} -->
<!-- api-route {"method":"POST","path":"/api/admin/blocks/reschedule"} -->
<!-- api-route {"method":"POST","path":"/api/admin/schedule/cancel"} -->
<!-- api-route {"method":"POST","path":"/api/admin/vacations"} -->
<!-- api-route {"method":"POST","path":"/api/admin/vacations/cancel"} -->
<!-- api-route {"method":"POST","path":"/api/auth/login"} -->
<!-- api-route {"method":"POST","path":"/api/auth/logout"} -->
<!-- api-route {"method":"GET","path":"/api/auth/session"} -->
<!-- api-route {"method":"GET","path":"/api/availability"} -->
<!-- api-route {"method":"POST","path":"/api/bookings"} -->
<!-- api-route {"method":"POST","path":"/api/cancel"} -->
<!-- api-route {"method":"GET","path":"/api/health"} -->
<!-- api-route {"method":"POST","path":"/api/send"} -->
<!-- api-route {"method":"POST","path":"/api/webhooks/resend"} -->
<!-- api-inventory-active:end -->

All modern TypeScript handlers return hardened, `private, no-store` JSON and
redacted machine errors. Exact physical database rows/pages scanned cannot be
claimed statically: query plans, indexes, constraints, absence checks, and data
cardinality determine that. The bounds below are function calls, returned rows,
row locks, distinct affected rows, and row mutations. Observe physical reads in
Local/TEST with representative data before assigning a cost budget.

## Public and provider routes

| Route                       | Input and authorization                                                                                                                                                                                                        | Response / PII                                                                              | Rate and cache                                               | Maximum effect                                                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`           | Public process-liveness probe; request body/query are ignored                                                                                                                                                                  | Constant `{ "status": "ok" }`; no environment, build, dependency, request, or customer data | No app limiter; no-store and noindex                         | 0 DB/Auth/provider/network calls; 0 rows or writes                                                                                                                                                                                                       |
| `GET /api/availability`     | Public; query ≤1 KiB with exactly one `date`, `serviceId`, and `variantId`; duplicates and unknowns rejected                                                                                                                   | Date/catalog IDs plus ≤96 ordered slot integers; no PII                                     | No app limiter; no-store                                     | 1 DB transaction/function, ≤96 result rows, 0 writes/Auth/provider calls                                                                                                                                                                                 |
| `POST /api/bookings`        | Public; canonical supplied Origin must match; no query; canonical lowercase UUID idempotency header ≤128 B; raw fatal-UTF-8 JSON ≤8 KiB; exact JSON media type ≤64 B; identity encoding; strict date/slot/catalog/contact body | Booking code, resource UUID, replay flag; contact PII is never echoed                       | No durable app limiter; no-store                             | 1 DB transaction/function/1 result row. Fresh success: 6 distinct rows/7 mutations—command row twice, optional day lock, appointment, domain change, 2 pending outbox rows. Replay writes 0; handled failure is 1 row/2 mutations; 0 Auth/provider sends |
| `POST /api/webhooks/resend` | Resend only; no query; raw fatal-UTF-8 JSON ≤32 KiB; identity encoding; bounded Svix headers; HMAC verification and ±300 s freshness                                                                                           | Request UUID, code, replay flag; no payload, signature, recipient, subject, or provider ID  | Provider retry plus database event-ID/digest fence; no-store | Current runtime is disabled: 0 effects. If separately approved/enabled: 1 DB transaction/function, SQL ≤2 rows and app accepts exactly 1; fresh bounce/complaint ≤4 distinct rows/5 mutations; processed replay writes 0; 0 Auth/provider outbound calls |

`GET /api/health` proves only that the Next.js process answers; it is not
database, Auth, provider, migration, queue, restore, or cutover readiness
evidence.

The webhook remains unreachable because no Production Supabase target is
registered. Provider endpoint registration is separate `[PROD-CONFIG]` work.
Only `email.delivered`, `email.bounced`, and `email.complained` have stateful
semantics today. Failed/suppressed/delayed policy, permanent signed-error retry
handling, alert thresholds, and endpoint registration remain launch gates.

## Owner authentication

Supabase Auth method counts are SDK invocations, not guaranteed outbound HTTP
counts: refresh and internal retry behavior belong to the SDK/provider.

| Route                   | Input and authorization                                                                                                       | Response / PII                                                                                                 | Rate and cache                                                          | Maximum effect                                                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/login`  | Owner; exact Origin/Host; raw fatal-UTF-8 strict JSON ≤4 KiB; identity encoding; email ≤254 and password 8–256; query ignored | Session-created code, 43-character CSRF credential, and Auth/binding/CSRF cookies; email/password never echoed | No local limiter; upstream Auth 429 maps to `Retry-After: 60`; no-store | Normal success: 3 Auth SDK methods plus 1 DB session-start function/result and ≤1 ledger insert. Exceptional compensation: ≤4 Auth methods, 2 DB functions, at most 1 ledger insert, and at most 1 revoke update |
| `GET /api/auth/session` | Owner Auth cookies, bounded extracted access token, HMAC binding, valid CSRF cookie; body/query ignored                       | Active-session code, CSRF credential, and possible refreshed Auth cookies; no PII                              | No local limiter; upstream Auth may 429; no-store                       | Normal success: 2 Auth methods plus 1 DB authorization function/result and 0 writes. Cleanup maximum: 3 Auth methods; DB remains 1 call                                                                          |
| `POST /api/auth/logout` | Owner; exact Origin plus 43-character CSRF; fresh identity and HMAC binding; body/query ignored                               | Session-ended code and cleared cookies; no PII                                                                 | No local limiter; upstream Auth may 429; no-store                       | Normal success: 3 Auth methods plus 1 DB revoke function/result and ≤1 ledger insert/update. If sign-out throws, cleanup may make a fourth Auth invocation; DB remains 1 call                                    |

## Owner schedule commands

All ten routes require exact Origin/Host, double-submit CSRF, a canonical
lowercase UUID idempotency header, fresh Supabase `getSession` + `getUser`, an
HMAC-bound session, and SQL-enforced enabled-owner/session authorization. Raw
fatal-UTF-8 JSON is ≤8 KiB; content encoding is absent/`identity`; bodies are
strict. Query strings are currently ignored. Each authorized, repository-valid
request makes exactly one owner DB transaction/private command call; every path
makes at most one. SQL is capped at 2 result rows and the application accepts
exactly 1. There are no synchronous provider sends.
Auth cleanup may add one local `signOut` for a maximum of 3 SDK invocations.

A fresh handled 400/404/409 persists only one command row with two mutations
(insert then fail). Exact replay writes 0 rows and skips schedule, vacation,
domain-change, and outbox mutation. Each fresh success appends one PII-minimized
domain-change row. Day-lock rows are real persistent effects and are included.

| Route                                     | Strict body                                                                           | Success                                 | Maximum fresh-success database effect                                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/admin/appointments`            | date/start, service/variant, name, nullable email/phone/note                          | `APPOINTMENT_CREATED` + ID              | Optional 1 day-lock insert; appointment + domain change + owner outbox + optional customer outbox; command insert+complete: **6 distinct rows/7 mutations**            |
| `POST /api/admin/appointments/details`    | `entryId`, positive `expectedVersion`, and ≥1 contact/client-note/internal-note patch | `APPOINTMENT_DETAILS_UPDATED` + same ID | Appointment update + domain change; command insert+complete: **3 rows/4 mutations**                                                                                    |
| `POST /api/admin/appointments/reschedule` | `entryId`, version, date/start, service/variant                                       | `APPOINTMENT_RESCHEDULED` + same ID     | Up to 2 day-lock inserts; appointment update + domain change + owner outbox + optional customer outbox; command insert+complete: **7 rows/8 mutations**                |
| `POST /api/admin/appointments/status`     | `entryId`, version, `completed` or `no_show`                                          | `APPOINTMENT_STATUS_UPDATED` + same ID  | Optional 1 day lock; appointment update + domain change; command insert+complete: **4 rows/5 mutations**                                                               |
| `POST /api/admin/blocks`                  | date/start/duration, optional buffer/internal note                                    | `BLOCK_CREATED` + ID                    | Optional 1 day lock; block + domain change; command insert+complete: **4 rows/5 mutations**                                                                            |
| `POST /api/admin/blocks/details`          | `entryId`, version, required internal-note patch                                      | `BLOCK_DETAILS_UPDATED` + same ID       | Block update + domain change; command insert+complete: **3 rows/4 mutations**                                                                                          |
| `POST /api/admin/blocks/reschedule`       | `entryId`, version, date/start/duration, optional buffer                              | `BLOCK_RESCHEDULED` + same ID           | Up to 2 day locks; block update + domain change; command insert+complete: **5 rows/6 mutations**                                                                       |
| `POST /api/admin/schedule/cancel`         | `entryId`, version, optional/null reason                                              | `SCHEDULE_ENTRY_CANCELLED` + same ID    | Appointment maximum: optional 1 day lock, entry update, domain change, up to 2 outbox rows, command insert+complete: **6 rows/7 mutations**. Block: 4 rows/5 mutations |
| `POST /api/admin/vacations`               | start/end date spanning ≤366 inclusive dates, optional/null reason                    | `VACATION_CREATED` + ID                 | Up to 366 day locks; vacation + domain change; command insert+complete: **369 rows/370 mutations**                                                                     |
| `POST /api/admin/vacations/cancel`        | `vacationId`, positive `expectedVersion`                                              | `VACATION_CANCELLED` + same ID          | Up to 366 day locks; vacation update + domain change; command insert+complete: **369 rows/370 mutations**                                                              |

## Temporary legacy mail routes

These are containment boundaries, not the target mail path. Local/Test/Preview
validation forces fake transport, the operator environment cannot start the
application, and legacy Production Firebase authorization remains disabled on
`refactor`.

| Route              | Input and authorization                                                                                                                                                                                        | Response / PII                                                                                                                                                | Rate and cache                                                                      | Maximum code-path effect                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `POST /api/send`   | Temporary owner dashboard; supplied Origin must match but absence is accepted; no app-level bearer-header bound; Firebase emulator owner verification; accepted strict JSON ≤8 KiB with bounded booking fields | Per-recipient sent/skipped/redacted-failed state; values/provider IDs are not echoed, but validation paths/messages can reflect attacker-supplied field names | Process-local 5/15 min/address, ≤1,000 buckets; charged before Auth/body; no-store  | 1 Firebase token verification, 0 DB; ≤2 delivery invocations in parallel |
| `POST /api/cancel` | Same containment; required normalized customer email and bounded booking fields                                                                                                                                | Customer delivery state/safe code; address/provider details not echoed                                                                                        | Process-local 20/15 min/address, ≤1,000 buckets; charged before Auth/body; no-store | 1 Firebase token verification, 0 DB; ≤1 delivery invocation              |

Both handlers still use `request.text()` before their 8 KiB accepted-payload
check, so streamed memory consumption is not yet bounded. Their media check is
only `startsWith("application/json")`; they do not reject content encoding.
They have no persisted idempotency key, so automatic client retry is forbidden.

## Known hardening gaps

- All ten owner command routes ignore query strings.
- Owner request schemas accept any positive version; values above PostgreSQL
  `int4` reach repository validation and return redacted 503 instead of edge 422.
- Modern public booking, availability, owner commands, and Auth have no durable
  application-level abuse limiter. Idempotency and upstream Auth 429 are not
  rate limits.
- Legacy mail has the framing/header gaps documented above and will be deleted
  once the atomic outbox path replaces its callers.
- Legacy validation issue paths/messages can reflect supplied unknown field
  names and therefore may contain attacker-supplied text.
- Physical rows/pages scanned and SDK-internal Auth HTTP calls require observed
  Local/TEST evidence; they are intentionally not presented as exact here.

## Removed routes

| Former route                    | Reason removed                                                          | Refactor expectation                                                  |
| ------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `GET /api/appointments/by-date` | Unauthenticated raw appointment/PII response; no tracked caller         | No supported route-module extension; regression test enforces absence |
| `GET /api/appointments/counts`  | Unauthenticated nine-month document download; no tracked runtime caller | No supported route-module extension; regression test enforces absence |
| `GET/POST /api/test`            | Public request reflection and no product use                            | No supported route-module extension; regression test enforces absence |

Production 404/401 behavior remains a `[PROD-APP]` verification gate and is not
implied by local deletion.
