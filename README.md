# Gioia Beauty

Production website and booking system for Gioia Beauty in Roveleto di Cadeo, Italy. The public website and owner dashboard use Italian copy. The live business currently remains on `main` and Firebase; the replacement is developed on `refactor` against isolated local services and the authorized synthetic-data Supabase integration project.

## Safety first

Read these files before changing the application:

1. `AGENTS.md`
2. the newest entry in `docs/WORKLOG.md`
3. `docs/MASTERPLAN.md`
4. `docs/PRODUCTION-SAFETY.md`
5. `docs/ENVIRONMENTS.md`

Local, test, and Preview commands fail closed when a known remote Firebase target, a cloud database URL, or a production provider credential is present. Production and operator commands have separate gates. Never copy live customer data into Local, CI, Preview, or the resettable Supabase integration project.

## Toolchain

- Node 22.21.1 (`.nvmrc` and `.node-version`)
- npm 10.9.4
- Next.js 15.5.20 with React 18.3.1

```bash
nvm use
npm ci
npm run hooks:install
cp .env.example .env.local
```

The legacy Firebase client is hard-wired to loopback emulators outside Production. Until the local Firebase/Supabase services exist, static verification is expected to pass but data-backed flows will be unavailable.

## Verification

```bash
npm run lint
npm test
npm run build
npm run security:dependencies
npm run security:secrets
```

`npm run security:secrets` requires Gitleaks 8.30.1 or later. The production dependency exception is documented in `docs/DEPENDENCY-AUDIT.md`.

Do not run `npm run dev` simply as a smoke test. Start the application only when the named Local/Test backing services and synthetic fixtures are ready, then verify the affected flow in that environment.

## Branch and release model

- `main`: current production; protected actions require Victor's exact approval.
- `refactor`: reviewed replacement-system integration branch.
- short `idea/*` branches: coherent implementation slices when parallel work benefits from isolation.

Production deployment, data access, provider configuration, migration, DNS, and cutover are not implied by code approval. Their required preflight and rollback evidence live in `docs/PRODUCTION-SAFETY.md` and the phase checklists in `docs/MASTERPLAN.md`.
