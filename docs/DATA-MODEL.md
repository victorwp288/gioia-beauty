# Data model — legacy formats, canonical schema, and the transition

Reference for anyone (human or LLM) touching appointment data. The masterplan's "booking core" section defines *why*; this documents *exactly what's in the database*.

## 1. Legacy document shape (what's in Firestore today)

Collection: `customers` (misnamed — it holds appointments). A representative legacy document:

```jsonc
{
  "name": "Maria Rossi",
  "email": "maria.rossi@gmail.com",     // may be "" for admin-created entries and time-blocks
  "number": "+39 333 1234567",
  "appointmentType": "Manicure",         // human-readable Italian label, doubles as the type key
  "variant": "Applicazione smalto classico",  // "" when none
  "selectedDate": /* ⚠️ ONE OF FOUR FORMATS — see below */,
  "startTime": "14:30",                  // "HH:mm" string, local salon time
  "endTime": "15:20",                    // "HH:mm", includes extraTime, computed CLIENT-SIDE at write
  "duration": 45,                        // minutes, service only
  "totalDuration": 50,                   // minutes, duration + extraTime
  "note": "",
  "status": "confirmed",                 // present on newer docs; missing on old ones
  "createdAt": "2025-11-03T09:12:44.120Z",  // ISO STRING, not a Timestamp
  "updatedAt": "2025-11-03T09:12:44.120Z"   // ditto; missing on old docs
}
```

### ⚠️ The `selectedDate` format zoo

| # | Format (at rest / in memory) | Example value | Written by |
|---|---|---|---|
| 1 | Date-only string | `"2024-06-14"` | oldest era of the code |
| 2 | Full ISO string (UTC) | `"2025-03-14T00:00:00.000Z"` | `useBookingForm.js` (`.toISOString()`) |
| 3 | Firestore `Timestamp` | `Timestamp(seconds=…, nanos=…)` | `dataManager.createAppointmentSafe` (stores a JS `Date`, which Firestore persists as `Timestamp`) |
| 4 | JS `Date` instance | `Date Fri Mar 14 2025…` | never at rest — appears **in memory** when cache layers hand back already-converted values |

Consequences the migration and any transition-era reader must handle:
- Format 2 encodes **UTC midnight**, but the intended meaning is a **local (Europe/Rome) calendar day** — naive `new Date(...)` parsing shifts it a day in some TZ/DST combinations. Interpret the *date part* only.
- Format 1 has no time component at all; format 3 has whatever local-midnight instant the writing code produced.
- `status`, `updatedAt`, and `variant` are missing on old documents — treat absent `status` as `"confirmed"`.
- **Time-blocks** are documents in this same collection with no meaningful `email`/`number` (admin "block time" feature). Don't email them; don't count them as customers.
- Do **not** trust `endTime` to equal `startTime + totalDuration` on every old doc — it was computed client-side by three different implementations. The migration recomputes rather than trusts.

## 2. Canonical schema (all writes from Phase 1 onward)

Defined as a Zod schema in `lib/validation/` (the schema is the source of truth; this is documentation of it):

```jsonc
{
  "serviceId": "manicure",               // stable key into the services catalog
  "variantId": "smalto-classico",        // optional
  "date": "2026-07-15",                  // LOCAL Europe/Rome calendar day, always date-only string
  "startMinutes": 870,                   // minutes since local midnight (870 = 14:30)
  "durationMinutes": 50,                 // INCLUDES extraTime; snapshotted from catalog at booking time
  "status": "confirmed",                 // "confirmed" | "completed" | "cancelled" | "no_show" | "block"
  "client": { "name": "Maria Rossi", "email": "maria.rossi@gmail.com", "phone": "+39 333 1234567", "note": "" },
  "createdAt": /* Firestore serverTimestamp */,
  "updatedAt": /* Firestore serverTimestamp */
}
```

Design intents (full rationale in the masterplan):
- `date` + `startMinutes` are timezone-unambiguous by construction — no instant math, no DST class of bugs. All conversions go through `lib/booking/time.ts`, pinned to Europe/Rome.
- Time-blocks become first-class: `status: "block"` with no `client` — no more fake customers.
- Display strings ("14:30") are **derived at render time**, never stored.
- `client.email` is either a validated address or absent — never `""`.

## 3. Transition rules (Phase 1 → Phase 3)

1. **Phase 1 migration is additive and idempotent**: it computes canonical fields from the legacy ones and writes them **alongside** the legacy fields on every existing document (re-running it is safe). Nothing is deleted; old bookings stay fully readable/editable throughout.
2. **During the window**: server writes populate **both** shapes; readers prefer canonical fields and fall back to legacy only via one shared helper (no new ad-hoc normalization branches — there's exactly one fallback function, and it's deleted with the window).
3. **Phase 3 closes the window**: once every reader uses canonical fields, a second trivial migration drops the legacy fields. From then on, **code that handles multiple formats is a bug**, not defensiveness.
4. **Never write legacy-only.** Any new code path that writes `selectedDate`/`startTime` without the canonical fields re-opens the wound.
5. Migrations run against the Firebase emulator (or a scratch project) before production, per masterplan rules of engagement.

## 4. Other collections (for completeness)

- `vacations`: `{ startDate, endDate, reason }` — date handling has the same string/Date looseness; migrate to `"YYYY-MM-DD"` strings when touched in Phase 1/3.
- `newsletter_subscribers`: `{ email, subscribedAt, status, source }` — written client-side today (moves server-side in Phase 1); email validated by `emailSchema` going forward.
