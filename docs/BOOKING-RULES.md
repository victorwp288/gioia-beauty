# Booking rules

This is the reviewed behavioral contract for the replacement booking system. PostgreSQL is the final conflict authority; `lib/domain/booking/` mirrors these rules to present candidate availability. Changes require matching domain, database, API, and regression-test updates.

## Time and opening hours

- Every salon date and minute is interpreted in `Europe/Rome`, independent of the server, browser, or database session timezone.
- Persist a calendar date plus minute-of-day. Convert to an instant only at a boundary that needs one, using Rome's actual DST offset for that date.
- Slots align to 15-minute boundaries.
- Opening hours are Monday 09:00–19:00, Tuesday 10:00–20:00, Wednesday 09:00–19:00, Thursday 10:00–20:00, and Friday 09:00–18:30. Saturday and Sunday are closed.
- A service must finish, including its post-service buffer, inside one opening-hours segment and the same calendar day.

## Public booking

- Same-day public booking is disabled. The first eligible date is the next Rome calendar day.
- The public window extends through 60 Rome calendar days after today.
- The server accepts stable service and variant IDs plus the requested date/start. It derives duration, buffer, active state, snapshots, and any future verified price from the authoritative catalog.
- The public caller cannot supply end time, duration, buffer, status, source, price, or email-delivery state.
- A displayed slot is advisory. The transactional insert rechecks policy, vacation, and overlap state under the date lock.

## Occupancy and buffers

- Intervals are half-open: `[start, start + service duration + buffer)`. Adjacent intervals are allowed; any positive overlap is rejected.
- Confirmed and completed appointments consume availability. Active blocks consume availability. Cancelled and no-show appointments and cancelled blocks do not.
- Buffers are hidden from the customer but consume the schedule after the visible service duration.
- No public or owner workflow may override an overlap. The database exclusion constraint is final.

## Owner operations

- The enabled owner may create appointments or blocks for today or a future date, subject to opening hours, vacations, and the same overlap invariant. The owner may edit historical non-occupancy details and explicitly mark an appointment completed or no-show.
- Rescheduling locks the old and new dates in deterministic order, requires the current row version, and rechecks the new interval. The original row ID and history are retained.
- Cancellation is a soft status transition with actor and timestamp; it is never a booking-row deletion.
- Creating an active vacation is rejected if any consuming schedule entry exists in its inclusive date range. Booking and vacation writes share the same ordered day-lock table, so concurrent requests cannot cross.
- A vacation spans at most 366 inclusive calendar days. Active vacations may not overlap each other.

## Idempotency and side effects

- Every mutation uses an operation/principal-scoped idempotency key and a SHA-256 request fingerprint. Public principal scopes are keyed HMACs, never plain hashes of an email or telephone number.
- A same-key/same-body retry returns the immutable original PII-free result. A same-key/different-body request fails with a stable conflict and cannot reuse the first resource.
- Booking state and required email-outbox rows commit atomically. Provider delivery occurs after commit, in bounded leased batches; email success never determines whether the booking exists.
- Completion, delivery, webhook, and audit records expose identifiers and machine codes only. Logs never include names, email addresses, telephone numbers, notes, tokens, or message payloads.
