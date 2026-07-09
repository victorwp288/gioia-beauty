# Dependency audit

Snapshot date: 2026-07-09. Scope: the `refactor` branch on Node 22.21.1 and npm 10.9.4.

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

- Upgraded Next from unsupported 14.2.16 to 15.5.20 and aligned `eslint-config-next`.
- Kept React and React DOM on 18.3.1 to avoid an unrelated public-UI migration; Next 15 supports this line.
- Upgraded Firebase Web to 12.16.0 and Firebase Admin to 14.1.0.
- Removed unused Twilio and React Scan dependencies.
- Moved `tailwindcss-animate` to development dependencies.
- Upgraded ESLint 8 to 9.39.4 and replaced deprecated `next lint` with the ESLint CLI.
- Applied compatible overrides for Babel runtime, JWS, brace expansion, minimatch, cross-spawn, glob, js-cookie, Picomatch, YAML, and PostCSS. Tests, lint, and the production build cover the overridden graph.

No `npm audit fix --force` or dependency downgrade was used.

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
