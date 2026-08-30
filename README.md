# Gioia Beauty

Production website and booking system for Gioia Beauty in Roveleto di Cadeo, Italy. The public website and owner dashboard use Italian copy. The live business currently remains on `main` and Firebase; the replacement is developed on `refactor` against isolated local services and the authorized non-authoritative Supabase integration project.

## Safety first

Start with `AGENTS.md` and choose Fast or Guarded Lane. Read the other files when they are relevant to the task:

1. `AGENTS.md`
2. `docs/MASTERPLAN.md` for roadmap/migration outcomes
3. the newest relevant entry in `docs/WORKLOG.md` when resuming a milestone or handoff
4. `docs/PRODUCTION-SAFETY.md` and `docs/ENVIRONMENTS.md` for Guarded or remote-target work

Local, test, and Preview commands fail closed when a known remote Firebase target, a cloud database URL, or a production provider credential is present. Ordinary repository, Local/CI, UI/copy, product/schema, and isolated synthetic work use Fast Lane. Production and operator commands have separate Guarded gates. The current Supabase TEST target temporarily retains the owner-approved PII-bearing rehearsal copy described in `docs/ENVIRONMENTS.md`; direct access is Guarded, no further real data may be added, and writable tests use Local or a separate synthetic target.

## Toolchain

- Node 24.18.0 LTS (`.nvmrc` and `.node-version`)
- npm 11.16.0
- Next.js 16.2.12 with React 19.2.8
- TypeScript 7.0.2 for strict new-code checks, with the official TypeScript 6.0.2 compatibility package for Next/ESLint's compiler API
- Tailwind CSS 4.3.3 with the CSS-first PostCSS integration
- Supabase CLI 2.110.0 with PostgreSQL 17 local services

```bash
nvm use
npm ci
npm run hooks:install
cp .env.example .env.local
```

The legacy Firebase client is hard-wired to loopback emulators outside Production. Until the local Firebase/Supabase services exist, static verification is expected to pass but data-backed flows will be unavailable.

## Verification

Use focused checks for the changed Fast Lane boundary. The full matrix below is for a coherent PR/release/security/cutover checkpoint, not every iterative layer:

```bash
npm run lint
npm run typecheck
npm run typecheck:ts6
npm test
npm run build
npm run security:dependencies
npm run security:secrets
```

`npm run security:secrets` requires Gitleaks 8.30.1 or later. The production dependency exception is documented in `docs/DEPENDENCY-AUDIT.md`.

The database foundation requires a Docker-compatible runtime:

```bash
npm run db:start
npm run db:reset
npm run db:lint
npm run db:advisors
npm run db:test
npm run db:clean
```

These commands are local-only and unlinked. They recreate the private business schema from committed migrations and the deterministic synthetic seed; application mail remains fake and Auth mail is captured by the local mail-testing service.

The broader Local E2E/recovery harnesses are on-demand milestone tools. They are
not prerequisites for ordinary schema, seed, UI, bug-fix, or application work.
The Phase 3 API E2E suite is local-only. It starts Next against the already
running loopback Supabase stack, uses fake application email, and reaches the
application only through `/api/health`, `/api/availability`, and
`/api/bookings`. It never opens the legacy public UI. Reset and replay the
synthetic seed explicitly before running it:

```bash
npm run db:start
npm run db:reset
npm run db:seed:replay
npm run test:e2e:phase3
npm run test:e2e:phase4
```

Run `npm run db:test:migration-rehearsal` and
`npm run db:test:phase5-recovery` only when the migration/import/recovery
boundary is in scope. `npm run db:test:greenfield` and
`npm run test:guarded-manifest` validate the frozen historical hosted checkpoint
only and are expected to refuse after the schema evolves. Ordinary append-only
greenfield iteration does not run the exact-manifest test through `npm test`.
A future full release/cutover checkpoint must add a new versioned candidate
manifest/harness instead of overwriting the historical one.

The migration rehearsal transforms a bounded synthetic legacy Firestore batch,
imports it transactionally, proves exact replay/idempotency, reconciles its
ledger/domain counts, and rejects a changed source checksum. It is Local-only
and does not read Firebase.

The Phase 5 recovery precursor resets Local, rehearses a deterministic
multi-batch import/restart and overlap rollback, then creates a guarded logical
dump and scratch clone. It compares redacted fingerprints, detects deliberate
clone-only corruption, restores the identical archive again, and removes every
scratch artifact. It does not satisfy the hosted TEST or production cutover
gates.

The Phase 4 browser slice adds public desktop/mobile visual baselines,
keyboard and recovery acceptance, owner-session/idempotency flows, and the
Local freeze/canary/reconciliation lifecycle. It also fails if the browser
addresses Firebase or Supabase business-data protocols directly.

Performance experiments use a separate loopback-only harness and do not need a
database. `test:performance` builds first; `test:performance:run` reuses the
current optimized build. Both block public write requests and attach Playwright
plus Chrome timeline traces and browser metrics under ignored test artifacts.

```bash
npm run analyze
npm run build:profile
npm run build:cpu-profile
npm run test:performance
```

`build:profile` and `build:cpu-profile` are diagnostic outputs, not deployment
artifacts. Run a normal `npm run build` before any approved Preview.

`db:reset` destroys and recreates local synthetic data. The E2E command refuses
remote URLs, linked Supabase projects, protected operator inputs, provider
credentials, Preview, and Production. Shared-target destructive reset and full
remote TEST acceptance remain serialized Guarded actions; additive remote TEST
migrations and ordinary Preview deployments do not use that lifecycle.

Do not run `npm run dev` simply as a smoke test. Start the application only when the named Local/Test backing services and synthetic fixtures are ready, then verify the affected flow in that environment.

## Branch and release model

- `main`: current production; protected actions require Victor's exact approval.
- `refactor`: reviewed replacement-system integration branch.
- short `idea/*` branches: coherent implementation slices when parallel work benefits from isolation.

Production deployment, data access, provider configuration, migration, DNS, and cutover are not implied by code approval. Their required preflight and rollback evidence live in `docs/PRODUCTION-SAFETY.md` and the phase checklists in `docs/MASTERPLAN.md`.

Privacy retention, subject-request, restore-replay, and processor activation are
separate launch gates in
[docs/PRIVACY-OPERATIONS.md](./docs/PRIVACY-OPERATIONS.md) and
[docs/PROCESSORS.md](./docs/PROCESSORS.md). Proposed periods in those drafts are explicitly
unapproved until the named owner/legal/provider decisions and executable tests
are complete.
