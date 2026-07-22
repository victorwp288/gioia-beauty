import { randomBytes } from "node:crypto";

import { expect, test as base } from "@playwright/test";

type Database = {
  begin<T>(callback: (transaction: Database) => Promise<T>): Promise<T>;
  unsafe(
    query: string,
    parameters?: unknown[],
  ): Promise<Record<string, unknown>[]>;
};

type BookingTarget = Readonly<{
  localDate: string;
  serviceId: string;
  variantId: string;
}>;

type AbuseKey = Readonly<{
  action: string;
  scopeKind: string;
  hmacKeyId: string;
  scopeHashHex: string;
  bucketStart: string;
}>;

type AbuseSnapshot = ReadonlyMap<string, AbuseKey & { requestCount: number }>;

type MaintenanceState = Readonly<{ freezeId: string; version: number }>;

interface PreviewHarness {
  readonly database: Database;
  readonly owner: Readonly<{ email: string; password: string }>;
  readonly target: BookingTarget;
  beginMaintenance(): Promise<MaintenanceState>;
  completeMaintenance(state: MaintenanceState): Promise<void>;
  captureAbuseDelta(
    before: AbuseSnapshot,
    expected: readonly string[],
  ): Promise<void>;
  snapshotAbuse(): Promise<AbuseSnapshot>;
}

interface WorkerFixtures {
  readonly previewHarness: PreviewHarness;
}

function abuseKey(row: Record<string, unknown>): AbuseKey & {
  requestCount: number;
} {
  const value = {
    action: String(row.action ?? ""),
    scopeKind: String(row.scope_kind ?? ""),
    hmacKeyId: String(row.hmac_key_id ?? ""),
    scopeHashHex: String(row.scope_hash_hex ?? ""),
    bucketStart: String(row.bucket_start ?? ""),
    requestCount: Number(row.request_count),
  };
  if (
    !/^[a-z_]{3,32}$/u.test(value.action) ||
    !new Set(["network", "account", "token"]).has(value.scopeKind) ||
    value.hmacKeyId !== "public_v1" ||
    !/^[0-9a-f]{64}$/u.test(value.scopeHashHex) ||
    value.bucketStart.length < 20 ||
    !Number.isSafeInteger(value.requestCount) ||
    value.requestCount < 1
  ) {
    throw new Error("Preview abuse snapshot is invalid");
  }
  return Object.freeze(value);
}

function abuseIdentity(key: AbuseKey): string {
  return [
    key.action,
    key.scopeKind,
    key.hmacKeyId,
    key.scopeHashHex,
    key.bucketStart,
  ].join("|");
}

async function snapshotAbuse(database: Database): Promise<AbuseSnapshot> {
  const rows = await database.unsafe(
    `select action, scope_kind, hmac_key_id,
       encode(scope_hash, 'hex') as scope_hash_hex,
       bucket_start::text as bucket_start, request_count
     from gioia_private.public_abuse_buckets
     order by action, scope_kind, hmac_key_id, scope_hash, bucket_start
     limit 32`,
  );
  const snapshot = new Map<string, AbuseKey & { requestCount: number }>();
  for (const row of rows) {
    const key = abuseKey(row);
    const identity = abuseIdentity(key);
    if (snapshot.has(identity)) {
      throw new Error("Preview abuse snapshot contains duplicate keys");
    }
    snapshot.set(identity, key);
  }
  return snapshot;
}

function exactTarget(value: unknown): BookingTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Preview booking target is invalid");
  }
  const target = value as Record<string, unknown>;
  if (
    typeof target.localDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(target.localDate) ||
    typeof target.serviceId !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(target.serviceId) ||
    typeof target.variantId !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(target.variantId)
  ) {
    throw new Error("Preview booking target is invalid");
  }
  return Object.freeze({
    localDate: target.localDate,
    serviceId: target.serviceId,
    variantId: target.variantId,
  });
}

async function cleanupAttempt(
  errors: Error[],
  message: string,
  operation: () => Promise<unknown>,
) {
  try {
    await operation();
  } catch {
    errors.push(new Error(message));
  }
}

export const test = base.extend<{}, WorkerFixtures>({
  previewHarness: [
    async ({}, provide) => {
      const [
        { getBookingConcurrencyTargets },
        { cleanupPreviewBrowserResidue, cleanupPreviewMaintenanceResidue },
        { parseTestTargetConfig },
        {
          assertCleanGreenfield,
          cleanupKnownGreenfieldResidue,
          GREENFIELD_TEST_OWNER,
          provisionGreenfieldOwner,
        },
        { withGreenfieldTestLock },
        { createRemoteTestMaintenanceOperator },
        { GREENFIELD_TARGET_VERSIONS },
        { createGreenfieldOwnerPassword },
        { drainGreenfieldRuntimeSessions },
      ] = await Promise.all([
        import("../../scripts/booking-concurrency-suite.mjs"),
        import("../../scripts/preview-e2e-fixtures.mjs"),
        import("../../scripts/test-target-config.mjs"),
        import("../../scripts/test-target-fixtures.mjs"),
        import("../../scripts/test-target-harness.mjs"),
        import("../../scripts/test-target-maintenance-operator.mjs"),
        import("../../scripts/test-target-migrations.mjs"),
        import("../../scripts/test-target-runtime.mjs"),
        import("../../scripts/test-target-runtime-role.mjs"),
      ]);
      const config = parseTestTargetConfig(process.env);
      await withGreenfieldTestLock(
        config,
        async ({ worker }: { worker: Database }) => {
          const database = worker;
          const fingerprint = await assertCleanGreenfield(
            worker,
            GREENFIELD_TARGET_VERSIONS,
          );
          const targets = await getBookingConcurrencyTargets(worker);
          if (!Array.isArray(targets) || targets.length !== 5) {
            throw new Error("Preview booking targets are unavailable");
          }
          const target = exactTarget(targets[0]);
          const password = createGreenfieldOwnerPassword();
          await provisionGreenfieldOwner(worker, password);
          const operator = createRemoteTestMaintenanceOperator({
            database: worker,
            config,
            tokenBytes: randomBytes,
          });
          await operator.assertOpen();
          const capturedPublicAbuse = new Map<string, AbuseKey>();
          const maintenance = new Map<string, MaintenanceState>();
          const harness: PreviewHarness = {
            database,
            owner: Object.freeze({
              email: GREENFIELD_TEST_OWNER.email,
              password,
            }),
            target,
            snapshotAbuse: () => snapshotAbuse(database),
            async captureAbuseDelta(before, expected) {
              const after = await snapshotAbuse(database);
              const delta = [...after.entries()].filter(
                ([identity]) => !before.has(identity),
              );
              const actual = delta
                .map(([, key]) => `${key.action}:${key.scopeKind}`)
                .sort();
              if (
                actual.join("|") !== [...expected].sort().join("|") ||
                delta.some(([, key]) => key.requestCount !== 1)
              ) {
                throw new Error("Preview abuse delta is not exact");
              }
              for (const [identity, key] of delta) {
                if (
                  new Set(["availability", "booking"]).has(key.action) &&
                  capturedPublicAbuse.has(identity)
                ) {
                  throw new Error("Preview abuse cleanup key was reused");
                }
                if (new Set(["availability", "booking"]).has(key.action)) {
                  capturedPublicAbuse.set(identity, key);
                }
              }
            },
            async beginMaintenance() {
              const state = await operator.freeze("PHASE4_PREVIEW_BROWSER");
              maintenance.set(state.freezeId, state);
              return state;
            },
            async completeMaintenance(state) {
              const expected = maintenance.get(state.freezeId);
              if (!expected || expected.version !== state.version) {
                throw new Error("Preview maintenance state is not owned");
              }
              const reconcileVersion = await operator.enterOwnerReconcile({
                freezeId: state.freezeId,
                expectedVersion: state.version,
                reasonCode: "PHASE4_PREVIEW_RECONCILE",
              });
              await operator.unfreeze({
                freezeId: state.freezeId,
                expectedVersion: reconcileVersion,
                reasonCode: "PHASE4_PREVIEW_ACCEPTED",
              });
            },
          };

          let operationError: unknown;
          try {
            await provide(harness);
          } catch (error) {
            operationError = error;
          }

          const cleanupErrors: Error[] = [];
          for (const state of maintenance.values()) {
            await cleanupAttempt(
              cleanupErrors,
              "Preview maintenance did not recover to open",
              async () => {
                const current = await operator.readState();
                if (current.mode === "open") return;
                if (current.freezeId !== state.freezeId) {
                  throw new Error("Unexpected Preview maintenance owner");
                }
                let version = current.version;
                if (current.mode === "frozen") {
                  version = await operator.enterOwnerReconcile({
                    freezeId: state.freezeId,
                    expectedVersion: version,
                    reasonCode: "PHASE4_PREVIEW_TEST_CLEANUP_RECONCILE",
                  });
                }
                await operator.unfreeze({
                  freezeId: state.freezeId,
                  expectedVersion: version,
                  reasonCode: "PHASE4_PREVIEW_TEST_CLEANUP_OPEN",
                });
              },
            );
          }
          await cleanupAttempt(
            cleanupErrors,
            "Preview maintenance evidence did not clean up",
            () =>
              cleanupPreviewMaintenanceResidue(worker, [...maintenance.keys()]),
          );
          await cleanupAttempt(
            cleanupErrors,
            "Preview browser booking residue did not clean up",
            () =>
              cleanupPreviewBrowserResidue(worker, {
                abuseKeys: [...capturedPublicAbuse.values()],
                target,
              }),
          );
          await cleanupAttempt(
            cleanupErrors,
            "Preview owner/Auth residue did not clean up",
            () =>
              cleanupKnownGreenfieldResidue(
                worker,
                targets,
                GREENFIELD_TARGET_VERSIONS,
                fingerprint,
              ),
          );
          await cleanupAttempt(
            cleanupErrors,
            "Preview runtime sessions did not drain",
            () => drainGreenfieldRuntimeSessions(worker),
          );
          if (operationError && cleanupErrors.length > 0) {
            throw new AggregateError(
              [operationError, ...cleanupErrors],
              "Preview browser operation and cleanup failed",
            );
          }
          if (operationError) throw operationError;
          if (cleanupErrors.length === 1) throw cleanupErrors[0];
          if (cleanupErrors.length > 1) {
            throw new AggregateError(
              cleanupErrors,
              "Preview browser cleanup failed",
            );
          }
        },
      );
    },
    { scope: "worker", timeout: 900_000 },
  ],
});

export { expect };
