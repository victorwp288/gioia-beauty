# API route inventory

Current refactor-branch server routes and their maximum effects. This inventory describes repository code, not a deployed Production state. Production behavior is verified only after a separately approved deployment.

## Active routes

| Route | Audience | Input bound | Response / PII | Authorization | Rate limit | Cache policy | Maximum effects per request |
|---|---|---|---|---|---|---|---|
| `POST /api/send` | Temporary owner-dashboard delivery only | Strict JSON, 8 KiB; normalized optional email, name ≤100, `HH:mm` times, integer duration 1–480, date ≤64, appointment type ≤120; unknown keys rejected | Per-recipient `sent` / `skipped` / redacted `failed` state; no address, template data, provider error, or provider message ID | Verified Firebase emulator owner ID token; legacy Firebase auth is sink-disabled outside Local/Test/Preview | 5 requests / 15 minutes / client address / process | `private, no-store` | 0 database reads/writes; at most 1 customer provider send + 1 admin provider send, attempted independently |
| `POST /api/cancel` | Owner dashboard only | Strict JSON, 8 KiB; required normalized email plus the bounded common fields above; unknown keys rejected | Redacted customer delivery state only; no PII or provider details | Verified Firebase ID token, verified owner email allowlist | 20 requests / 15 minutes / client address / process | `private, no-store` | 0 database reads/writes; at most 1 customer provider send |

Both routes reject cross-origin browser requests and unsupported media types. Resend is initialized only when an approved request reaches delivery, so builds and tests require no provider secret.

The public legacy caller now fails closed and reports that its booking succeeded without email; the refactor branch is not deployable until Phase 3 replaces this temporary owner-only boundary with the atomic booking/outbox path. The process-local limiter remains defense in depth, not a durable distributed Vercel limit. No automatic client retry is allowed because this legacy mail operation has no persisted idempotency key.

## Removed routes

| Former route | Reason removed | Refactor expectation |
|---|---|---|
| `GET /api/appointments/by-date` | Unauthenticated raw appointment/PII response; no tracked caller | No route module; static regression test enforces absence |
| `GET /api/appointments/counts` | Unauthenticated nine-month document download; no tracked runtime caller | No route module; static regression test enforces absence |
| `GET/POST /api/test` | Public request reflection and no product use | No route module; static regression test enforces absence |

Production 404/401 behavior remains a `[PROD-APP]` verification gate and is not implied by local deletion.
