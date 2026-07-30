# Processor and third-party register

This is the engineering register for services that can receive Gioia Beauty
data or browser traffic. It is not a legal conclusion, an approved DPA record,
or public privacy copy. `Unknown` and `pending` are launch blockers, not
assumptions agents may fill in.

Provider credentials, account contacts, signed agreements, recovery details,
and customer-bearing evidence stay in the protected operator evidence store.
The repository records only status, scope, machine-safe identifiers, and the
location of that protected evidence.

Field/store retention, subject-request, sensitive-note, and restore-replay
controls are defined in [PRIVACY-OPERATIONS.md](./PRIVACY-OPERATIONS.md).

## Status vocabulary

- `active-production`: the live `main` system currently uses the service.
- `authorized-test`: only synthetic Local/Test/Preview data is authorized.
- `planned`: code or runbooks anticipate the service, but it is not activated.
- `inactive`: configuration is deliberately absent or rejected.
- `review-required`: observed integration whose controller/processor role or
  privacy controls have not been approved.

Every active or planned service needs an approved record for: purpose; exact
data categories; environments; account owner and recovery; hosting/processing
region and transfer mechanism; DPA and subprocessor evidence; provider and
local retention/deletion; data-subject-request handling; incident contact; and
decommission procedure.

## Core service register

### Vercel

- **Status:** hosting is `active-production`; Analytics and Speed Insights are
  mounted globally; Cron/outbox execution is `planned`.
- **Purpose:** web hosting/server execution, deployment, performance and traffic
  telemetry, and future scheduled outbox work.
- **Data in scope:** public HTTP/network metadata; booking, Auth, and dashboard
  requests while handled by server functions; fixed PII-minimized application logs;
  deployment/release metadata. Analytics/Speed Insights collection details must
  be verified before the cookie decision is approved.
- **Environment boundary:** Production may process real data; ordinary Preview
  and CI may contain synthetic data only.
- **Repository evidence:** [`app/layout.js`](../app/layout.js),
  [`docs/ENVIRONMENTS.md`](ENVIRONMENTS.md), and
  [`docs/OPERATIONS.md`](OPERATIONS.md).
- **Pending:** DPA/subprocessor evidence, account owner/recovery, exact processing
  regions/transfers, log/analytics retention, deletion/request path, plan limits,
  and whether non-essential telemetry is consent-gated or removed.

### Supabase

- **Status:** replacement project `hzibzwhrwmljgjjdzspi` is
  `authorized-test`; provider-failed TEST project `lxvsspniipcotimbsfqm` is
  retired from current configuration; no Supabase project is
  Production-authoritative.
- **Purpose:** future Postgres/Auth platform and current synthetic integration
  target.
- **Data in scope:** synthetic schema/Auth/fixtures today; after approved cutover,
  booking contacts and notes, schedule behavior, subscribers/consent, email
  snapshots/state, owner Auth/session data, and migration/privacy evidence.
- **Verified technical location:** replacement TEST registry records
  `eu-central-2`;
  this does not by itself approve future Production transfers or backup posture.
- **Repository evidence:** [`docs/ENVIRONMENTS.md`](ENVIRONMENTS.md),
  [`docs/DATA-MODEL.md`](DATA-MODEL.md), and committed `supabase/` migrations.
- **Pending:** Production target/plan, DPA/subprocessors, account owner/recovery,
  Auth and log retention, backup/PITR/export deletion, provider request path,
  incident contact, and proven restore-after-erasure replay.

### Firebase / Google

- **Status:** Firestore and Auth are `active-production` on `main`; Firebase
  Analytics initializes only in Production and remains `review-required` for
  consent/telemetry controls. Storage is configured and initialized, but no
  repository consumer was found; its use and contents are `review-required`,
  not assumed active.
- **Purpose:** current live booking/customer store and owner Auth; Production
  telemetry until the controlled cutover; Storage purpose is unknown pending a
  provider-side inventory.
- **Data in scope:** live customer/booking/subscriber records, owner identity and
  Auth/session/recovery metadata, schemaless collections, backup/export copies,
  analytics/device/network metadata, and unknown Storage bucket contents.
- **Environment boundary:** `refactor` resolves only loopback demo emulators
  outside Production. Real Firebase data is prohibited in ordinary TEST.
- **Repository evidence:** [`docs/FIREBASE-INVENTORY.md`](FIREBASE-INVENTORY.md),
  [`lib/firebase/config.js`](../lib/firebase/config.js), and
  [`docs/PRODUCTION-SAFETY.md`](PRODUCTION-SAFETY.md).
- **Pending:** exact remote-project ownership and Firestore/Auth/Analytics/Storage
  provider inventory, Storage bucket/object existence and consumers,
  DPA/subprocessor evidence, analytics/cookie decision, regions/transfers,
  retention/PITR/export deletion, subject-request propagation, and separately
  approved retirement.

### Resend

- **Status:** real delivery is `active-production` on `main`; replacement-system
  application mail remains fake until separately activated. The new webhook is
  disabled outside an approved Production target.
- **Purpose:** booking/cancellation/newsletter delivery and delivery-state
  callbacks.
- **Data in scope:** recipient address, rendered customer name and appointment
  details, provider message/event IDs, delivery metadata, and signed webhooks.
- **Repository evidence:** [`lib/server/resend.js`](../lib/server/resend.js),
  [`lib/server/email/`](../lib/server/email/), and
  [`docs/OPERATIONS.md`](OPERATIONS.md).
- **Pending:** account owner/recovery, DPA/subprocessors, processing
  regions/transfers, provider message/event retention, deletion/request path,
  support contact, test/non-delivering domain, and alignment with local outbox
  retention and completion-uncertainty rules.

### GitHub / GitHub Actions

- **Status:** repository and CI are `authorized-test` operational tooling.
- **Purpose:** source control, review, dependency/secret checks, and ephemeral
  synthetic database/application verification.
- **Data in scope:** source, commits, machine-safe test logs, synthetic fixtures,
  and CI metadata. Customer data, raw exports, access packages, secrets, and
  PII-bearing restore artifacts are prohibited from commits, logs, caches, and
  artifacts.
- **Repository evidence:** [`.github/workflows/ci.yml`](../.github/workflows/ci.yml),
  [`docs/PRODUCTION-SAFETY.md`](PRODUCTION-SAFETY.md), and `.gitleaks.toml`.
- **Pending:** organization/repository owner and recovery evidence, DPA/account
  terms, runner and artifact locations/transfers, artifact/log/cache retention,
  deletion/request path, and protected production-operator evidence policy.

### Sentry

- **Status:** `authorized-test`; fresh EU project
  `gioia-beauty-observability` exists in EU organization `my-org-gw`. Only
  `refactor` Preview has its server-side DSN; Production is unconfigured.
- **Purpose:** fixed surrogate 5xx/error grouping and later alerting.
- **Data in scope:** static route/method, event-scoped request UUID,
  `preview`/future `production`, immutable commit release, and the constant
  `UNEXPECTED_SERVER_ERROR`, plus the SDK/package name and version and
  event/send identifiers and timestamps added by its envelope. The SDK receives
  no original error, stack, request/user data, URL, header, body, cookie,
  breadcrumb, trace, log, replay, profile, or attachment.
- **Provider controls:** EU storage; server/default scrubbers and prevent-IP are
  on; additional direct/contact/auth field names are scrubbed; high-priority
  email alert exists. Automatic integrations and OpenTelemetry setup are
  disabled in code.
- **Repository evidence:** [`config/environment.mjs`](../config/environment.mjs)
  and [`lib/server/observability/`](../lib/server/observability/).
- **Pending:** synthetic immutable-Preview test-fire and alert delivery;
  account recovery, DPA/subprocessors, verified retention/deletion/request
  path, source-map policy, uptime/owner escalation, and separate Production
  configuration approval.

### PostHog

- **Status:** `authorized-test`; separate EU organization `Gioia Beauty` and
  project `Gioia Beauty Observability` (`86721`) exist on the Free plan. Only
  `refactor` Preview has the server-side project token and EU ingestion host;
  Production is unconfigured.
- **Purpose:** personless route completion, outcome, and bounded-duration
  metrics. It is not browser analytics or session tracking.
- **Data in scope:** schema version, static route/method, event-scoped request
  UUID, status/outcome, bounded duration, environment, and immutable release.
  Every event sets `$process_person_profile=false` and disables GeoIP. The SDK
  transport also adds library/version, event UUID/timestamps, capture type, and
  a GeoIP-disable marker; it adds no request or customer field.
- **Provider controls:** EU Cloud; project IP discard and the organization
  default are on. Web autocapture, heatmaps, web vitals, dead-click capture,
  session replay, third-party AI, internal AI training, remote config, surveys,
  feature preload, and exception autocapture are off.
- **Repository evidence:** [`config/environment.mjs`](../config/environment.mjs)
  and [`lib/server/observability/providerRuntime.ts`](../lib/server/observability/providerRuntime.ts).
- **Pending:** the Free plan advertises one-year analytics retention, which does
  not yet prove proposed `RET-12` 30-day expiry. Keep the Preview synthetic-only
  until retention/deletion/request handling, account recovery,
  DPA/subprocessors, alert/dashboard ownership, and separate Production
  approval are resolved.

### Vercel bot controls

- **Status:** automatic DDoS protection, the normal firewall, and protected
  Preview access are active. Managed Bot Protection remains off because
  publishing it is project-wide and would change Production. BotID is not
  installed.
- **Decision:** the current durable database abuse limits plus threshold-based
  Turnstile already protect Preview public writes. Adding BotID now would
  duplicate that collection and enforcement boundary. Reconsider it only as a
  reviewed replacement for Turnstile, not an extra tracking layer.
- **Data impact of this batch:** none; no BotID checks, deep analysis, custom
  firewall rule, or Production setting was created.

### Cloudflare Turnstile

- **Status:** `planned`; the replacement app contains a fail-closed adapter,
  but no repository action has activated Turnstile in Production. Official
  dummy keys may be authorized only for the synthetic `refactor` Preview.
- **Purpose:** challenge public booking and newsletter submission after the
  durable database abuse policy requests additional human verification.
- **Data in scope:** ordinary browser/network metadata visible to Cloudflare,
  challenge telemetry/token, configured action, and serving hostname. The Gioia
  server deliberately omits the optional visitor IP from Siteverify and sends
  no booking/contact fields.
- **Repository evidence:**
  [`lib/server/turnstileHumanChallengeVerifier.ts`](../lib/server/turnstileHumanChallengeVerifier.ts),
  [`components/common/TurnstileChallenge.jsx`](../components/common/TurnstileChallenge.jsx),
  and [`docs/API-INVENTORY.md`](API-INVENTORY.md).
- **Pending:** owner/recovery, DPA/subprocessors, challenge processing
  regions/transfers, telemetry and token retention/deletion, data-subject
  request path, public notice/cookie classification, support/incident contact,
  and a separate decision before real Production keys are created.

## Browser third parties and external destinations

These entries are not automatically classified as processors. Their role and
public-notice/cookie impact require review.

| Surface                                          | Current behavior and possible data                                                                           | Required disposition                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| OpenStreetMap tile servers                       | The contact map automatically requests third-party tiles and exposes ordinary browser/network metadata.      | Verify controller/processor role, terms, retention, and notice; approve or proxy/self-host/remove.             |
| `unpkg.com` Leaflet marker images                | The map automatically downloads three marker assets and exposes browser/network metadata.                    | Self-host before release or approve and document the external request.                                         |
| Vercel Analytics / Speed Insights                | Global components can collect traffic/performance telemetry independently of the current banner.             | Approve collection and real consent control, or remove; document exact cookies/storage and retention.          |
| Firebase Analytics                               | Production-only browser initialization can collect analytics/network metadata.                               | Inventory and align with the analytics/cookie decision before cutover or removal.                              |
| Tailwind UI / Unsplash dashboard images          | Legacy dashboard code references remote image assets, exposing owner browser/network metadata when rendered. | Remove or self-host during dashboard replacement.                                                              |
| Google Drive service link                        | External destination reached through a service link.                                                         | Confirm business purpose and public notice; avoid sending booking data in the URL.                             |
| Google Maps, Instagram, Payhip, and social links | User-initiated external navigation may transfer ordinary referral/browser metadata to independent services.  | Inventory exact links, use safe link attributes, and describe only where required; never append customer data. |

Repository evidence for these surfaces is in
[`components/common/Map.jsx`](../components/common/Map.jsx),
[`components/services/ServicesContainer.jsx`](../components/services/ServicesContainer.jsx),
[`components/layout/`](../components/layout/), and
[`app/contacts/page.jsx`](../app/contacts/page.jsx).

## Activation checklist

Before a new service or data category is enabled:

1. Name the exact provider product, account, owner, recovery contact, environment,
   and technical target.
2. Approve purpose, minimum data fields, controller/processor role, DPA,
   subprocessors, region/transfer evidence, retention, deletion, data-subject
   request, incident, and support paths.
3. Prove Local/CI/Preview fail closed against Production credentials and data.
4. Configure least privilege, redaction, non-delivering TEST behavior, alerting,
   cost limits, and account recovery; store secrets only in the approved scope.
5. Run synthetic security/privacy tests and record evidence without payloads.
6. Update this register, the privacy operations matrix, public policy/consent
   copy where approved, and the exact production preflight.
7. Obtain separate approval for any Production configuration or application
   activation.

## Decommission checklist

1. Freeze new ingestion and record the last accepted event/message/deployment.
2. Reconcile local state, provider state, pending callbacks, exports, and legal
   holds without logging subject data.
3. Export only approved evidence to the protected store, then delete provider
   data under the approved schedule and obtain deletion evidence.
4. Revoke keys/webhooks/tokens, remove environment variables and client assets,
   disable integrations, and verify negative network/configuration tests.
5. Preserve only the approved minimized, classified operational record and
   update this register, runbooks, public notice, and recovery procedures.
