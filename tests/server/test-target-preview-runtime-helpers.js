import { vi } from "vitest";

import {
  GREENFIELD_PREVIEW_ROLE_SQL,
  GREENFIELD_RUNTIME_ROLE_SQL,
  GREENFIELD_TEST_LOCK_SQL,
  GREENFIELD_TEST_UNLOCK_SQL,
} from "../../scripts/test-target-harness.mjs";

export const operatorSessionUrl =
  "postgresql://postgres.ref:operator@pooler.test:5432/postgres?sslmode=verify-full";
export const operatorWorkerUrl =
  "postgresql://postgres.ref:operator@pooler.test:6543/postgres?sslmode=verify-full";
export const PREVIEW_PASSWORD = "Preview!Password-Only-In-Memory-12345";
export const runtimeUrl = `postgresql://app_runtime_login.ref:${PREVIEW_PASSWORD}@pooler.test:6543/postgres?sslmode=verify-full`;
const CA_CERTIFICATE = "synthetic-ca-certificate";

export function config() {
  return {
    getDatabaseCaCertificate: () => CA_CERTIFICATE,
    getOperatorSessionDatabaseUrl: () => operatorSessionUrl,
    getOperatorWorkerDatabaseUrl: () => operatorWorkerUrl,
    getPreviewRuntimeDatabaseUrl: () => runtimeUrl,
  };
}

function safeWorkerResult(
  query,
  rolcanlogin = false,
  attributesAreSafe = true,
  credentialIsSafe = true,
  hasUnsafeMembership = false,
  hasUnsafeAccess = false,
  rolePresent = true,
) {
  if (query === GREENFIELD_RUNTIME_ROLE_SQL.state) {
    if (!rolePresent) return [];
    return [
      {
        attributes_are_safe: attributesAreSafe,
        credential_is_safe: credentialIsSafe,
        has_unsafe_access: hasUnsafeAccess,
        has_unsafe_membership: hasUnsafeMembership,
        rolcanlogin,
      },
    ];
  }
  if (query === GREENFIELD_RUNTIME_ROLE_SQL.sessions[1]) {
    return [{ active: 0 }];
  }
  return [];
}

export function lifecycleHarness({
  initialLogin = true,
  authorizations = [true, true],
  attributesAreSafe = true,
  credentialIsSafe = true,
  restoredCredentialIsSafe = true,
  disableFailure = null,
  terminateFailureAfter = Number.POSITIVE_INFINITY,
  closeFailures = [],
  cleanupFailures = {},
  hasUnsafeMembership = false,
  hasUnsafeAccess = false,
  rolePresent = true,
} = {}) {
  let roleCanLogin = initialLogin;
  let roleCredentialIsSafe = credentialIsSafe;
  let terminateCount = 0;
  const events = [];
  const lockClient = {
    unsafe: vi.fn(async (query) => {
      if (query === GREENFIELD_TEST_LOCK_SQL) {
        events.push("lock");
        return [{ acquired: true }];
      }
      if (query === GREENFIELD_TEST_UNLOCK_SQL) {
        events.push("unlock");
        if (cleanupFailures.unlock) throw cleanupFailures.unlock;
        return [{ released: true }];
      }
      if (query === GREENFIELD_RUNTIME_ROLE_SQL.cleanup[0]) {
        events.push("suspend");
        if (disableFailure) throw disableFailure;
        roleCanLogin = false;
        roleCredentialIsSafe = true;
      }
      if (
        query === GREENFIELD_RUNTIME_ROLE_SQL.sessions[0] &&
        ++terminateCount > terminateFailureAfter
      ) {
        throw new Error("synthetic termination failure");
      }
      return safeWorkerResult(
        query,
        roleCanLogin,
        attributesAreSafe,
        roleCredentialIsSafe,
        hasUnsafeMembership,
        hasUnsafeAccess,
        rolePresent,
      );
    }),
    begin: vi.fn(async (callback) =>
      callback({
        unsafe: vi.fn(async (query) => {
          if (query === GREENFIELD_PREVIEW_ROLE_SQL.restore[1]) {
            events.push("restore");
            roleCanLogin = true;
            roleCredentialIsSafe = restoredCredentialIsSafe;
          }
          return [];
        }),
      }),
    ),
    release: vi.fn(async () => {
      if (cleanupFailures.release) throw cleanupFailures.release;
    }),
  };
  const lockPool = {
    reserve: vi.fn(async () => lockClient),
    end: vi.fn(async () => {
      if (cleanupFailures.pool) throw cleanupFailures.pool;
    }),
  };
  const worker = {
    end: vi.fn(async () => {
      if (cleanupFailures.worker) throw cleanupFailures.worker;
    }),
  };
  let authorizationIndex = 0;
  const credentialClients = authorizations.map((authorization, index) => {
    const transactionUnsafe = vi.fn(async (query) => {
      if (query === GREENFIELD_PREVIEW_ROLE_SQL.authenticate) {
        return [{ authorized: true }];
      }
      if (query === GREENFIELD_PREVIEW_ROLE_SQL.assume) return [];
      if (query === GREENFIELD_PREVIEW_ROLE_SQL.authorize) {
        events.push(`authenticate-${authorizationIndex++}`);
        if (authorization instanceof Error) throw authorization;
        return [{ authorized: authorization }];
      }
      return [];
    });
    return {
      begin: vi.fn(async (callback) => callback({ unsafe: transactionUnsafe })),
      end: vi.fn(async () => {
        events.push("close-auth");
        if (closeFailures[index]) throw closeFailures[index];
      }),
      transactionUnsafe,
    };
  });
  const clientFactory = vi
    .fn()
    .mockReturnValueOnce(lockPool)
    .mockReturnValueOnce(worker);
  for (const client of credentialClients) {
    clientFactory.mockReturnValueOnce(client);
  }
  return {
    clientFactory,
    credentialClients,
    events,
    lockClient,
    lockPool,
    roleCanLogin: () => roleCanLogin,
    worker,
  };
}

export function errorText(error) {
  if (!(error instanceof Error)) return String(error);
  return [
    error.message,
    ...(error instanceof AggregateError ? error.errors.map(errorText) : []),
  ].join(" ");
}
