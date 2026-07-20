# Cutover maintenance and emergency booking

This is a rehearsal contract for Local/TEST until Phase 5 receives separate,
exact Production approvals. It does not authorize a deployment, Firebase Rules
change, provider send, customer-data read, or remote database mutation.

## Modes

1. `open`: public booking and owner mutations are enabled.
2. `frozen`: public booking and every owner mutation are blocked. Bounded reads
   remain available. Only an exact, short-lived synthetic canary grant may pass.
3. `owner_reconcile`: public booking remains blocked while the owner records the
   offline backlog through normal authenticated, idempotent dashboard commands.
4. `open`: public booking reopens only after the backlog and all synthetic
   canary runs are reconciled.

Missing, malformed, or unreadable state fails closed. A stale browser receives
`503 MAINTENANCE_ACTIVE`, `Retry-After: 300`, and a private no-store response.
The response never confirms whether a supplied canary token existed or matched.

## Customer and owner messages

Customer: “Le prenotazioni online sono temporaneamente sospese per
manutenzione. Nessun appuntamento è stato registrato. Riprova più tardi oppure
contatta Gioia Beauty al +39 391 421 3634.”

Owner: “Manutenzione attiva: le modifiche sono bloccate, ma le consultazioni
restano disponibili. Registra le richieste nel registro manuale e attendi la
fase di riconciliazione.”

## Emergency manual-booking procedure

- Use one offline ledger as the temporary authority. Assign each request an ID
  `MAN-YYYYMMDD-NNN`; record received time, requested date/time, service, minimum
  contact details, and `pending`/`confirmed`. Never record sensitive notes.
- Do not use the canary bypass for a real customer. It is synthetic-only.
- Do not promise a slot until it is checked against the frozen imported
  schedule. Tell the customer that confirmation follows reconciliation.
- After canary cleanup, enter `owner_reconcile`. Enter each manual item in ID
  order through the authenticated no-email dashboard path. Record the returned
  booking ID in the offline ledger and resolve every conflict before continuing.
- Reconcile counts and future active intervals. Only then complete unfreeze and
  verify a fresh public availability read before announcing that booking is open.

## Audited synthetic canary

- Begin one run under the current `freeze_id`; maximum lifetime is 30 minutes.
- Generate one random 32-byte token per exact operation. Store only SHA-256 in
  Postgres. Bind the grant to the operation, UUID idempotency key, request
  fingerprint, run, freeze, and an expiry of at most 15 minutes.
- Keep the raw token in operator memory only. Never place it in dotenv, command
  arguments, URLs, screenshots, logs, support tickets, or artifacts.
- Allowed bypass operations are create public/owner appointment, create block,
  create vacation, and their normal soft-cancel operations. Update, reschedule,
  status, subscriber, and outbox-retry grants are intentionally unavailable.
- Canary transactions suppress outbox insertion so no email/provider effect can
  occur. A valid exact replay is allowed; scope drift and reuse are rejected.
- Soft-cancel every created schedule entry/vacation with a separately scoped
  grant. Revoke unused grants. Reconciliation refuses active resources or
  unconsumed grants, and `owner_reconcile` refuses unreconciled runs.

The Local-only helper is `scripts/local-cutover-maintenance-operator.mjs`. It
accepts an injected loopback SQL client and returns raw canary tokens only to its
in-memory caller; it has no executable CLI that could print secrets. Hosted TEST
and Production operator launchers remain separate future work.
