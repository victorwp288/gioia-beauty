# Dependency audit

Snapshot refreshed: 2026-07-29. Scope: the local `refactor` worktree on Node 24.18.0 LTS and npm 11.16.0.

## Outcome

The audited production tree moved from the legacy baseline of 44 package records (4 critical, 13 high, 25 moderate, 2 low) to **6 moderate, 0 high, and 0 critical** records.

The verified command is:

```bash
npm audit --omit=dev --json
```

`npm audit` exits non-zero because the six accepted moderate records remain. CI should fail on high or critical findings, while this documented temporary exception is tracked to Firebase removal:

```bash
npm audit --omit=dev --audit-level=high
```

## Fixed in this milestone

- Upgraded Next to 16.2.12, React/React DOM to 19.2.8, Tailwind to 4.3.3, and the compatible Radix, form, calendar, email, Supabase, Playwright, PostCSS, Prettier, and validation packages.
- Migrated the Next file convention from `middleware.ts` to `proxy.ts`, the calendar wrapper to DayPicker 10, validation contracts to Zod 4, and ESLint to Next 16's native flat configuration.
- Added the official React Compiler Babel plugin in annotation mode for one measured gallery boundary. Removed `@hookform/resolvers` after replacing its public-browser-only Zod adapter with a focused resolver; server/API/domain validation remains on Zod 4.
- Pinned ESLint 9.39.5 because ESLint 10.8.0 currently crashes inside the React plugin bundled by `eslint-config-next` 16.2.12. This is a verified compatibility hold, not an ignored update.
- Overrode only the vulnerable transitive `minimatch`/`brace-expansion` pair to their patched current releases. Lint, the full test suite, and the production build cover the resolved graph.
- Upgraded Next from unsupported 14.2.16 to 15.5.20 and aligned `eslint-config-next`.
- Kept React and React DOM on 18.3.1 to avoid an unrelated public-UI migration; Next 15 supports this line.
- Upgraded Firebase Web to 12.16.0 and Firebase Admin to 14.1.0.
- Removed unused Twilio and React Scan dependencies.
- Moved `tailwindcss-animate` to development dependencies.
- Upgraded ESLint 8 to 9.39.4 and replaced deprecated `next lint` with the ESLint CLI.
- Applied compatible overrides for Babel runtime, JWS, brace expansion, minimatch, cross-spawn, glob, js-cookie, Picomatch, YAML, and PostCSS. Tests, lint, and the production build cover the overridden graph.

The older bullets record the original July 9 remediation baseline; the refreshed state above supersedes their versions without invalidating that evidence. No `npm audit fix --force` or dependency downgrade was used.

## Accepted temporary finding

All six remaining package records are one advisory propagated through this optional dependency chain:

```text
firebase-admin
└── optional @google-cloud/storage
    ├── gaxios ── uuid@9.0.1
    └── retry-request ── teeny-request ── uuid@9.0.1
```

The advisory affects UUID v3/v5/v6 when a caller supplies an output buffer. This application imports only Firebase Admin App/Auth, never Storage, and the transitive callers use UUID v4 without a supplied buffer. The refactor additionally sink-disables Firebase Admin outside the exact Local/Test/Preview demo project and Auth emulator. The affected path is therefore not reachable from an application request.

Forcing UUID 11 into parents that declare UUID 9 would be an unreviewed major-version substitution. Downgrading Firebase Admin to npm's suggested 10.3.0 would reintroduce an old unsupported dependency. The safe resolution is to remove Firebase Admin with the legacy Firebase boundary during the planned application cutover. Until then, any new high/critical production advisory fails the dependency gate.

## Recheck

Run after every lockfile change:

```bash
npm ci
npm audit --omit=dev --json
npm run lint
npm test
npm run build
```

The production audit must remain at 0 high and 0 critical. The six moderate records may only remain while `firebase-admin` is present solely for emulator-isolated legacy owner-auth tests.
