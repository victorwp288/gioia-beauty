import "server-only";

import type {
  FreshSupabaseIdentity,
  OwnerAuthorizationDecision,
} from "../auth/freshOwnerSession.ts";
import { createRuntimeDatabase, type RuntimeDatabase } from "./runtime.ts";

const OWNER_SESSION_FUNCTIONS = {
  start: "start_owner_session",
  authorize: "authorize_owner_session",
  revoke: "revoke_owner_session",
} as const;
const SESSION_DENIAL_MESSAGES = new Set([
  "OWNER_SESSION_EXPIRED",
  "OWNER_SESSION_REQUIRED",
  "OWNER_SESSION_REVOKED",
]);
const AUTHORIZATION_DENIAL_MESSAGES = new Set([
  "OWNER_AUTHORIZATION_REQUIRED",
  "OWNER_IDENTITY_MISMATCH",
  "OWNER_SESSION_MISMATCH",
]);

export interface OwnerAuthRepository {
  startSession(
    identity: FreshSupabaseIdentity,
  ): Promise<OwnerAuthorizationDecision>;
  authorizeSession(
    identity: FreshSupabaseIdentity,
  ): Promise<OwnerAuthorizationDecision>;
  revokeSession(identity: FreshSupabaseIdentity): Promise<boolean>;
}

function denialDecision(error: unknown): OwnerAuthorizationDecision | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  if (typeof record.message !== "string") return null;
  if (record.code === "PT401" && SESSION_DENIAL_MESSAGES.has(record.message)) {
    return { ok: false, status: 401, code: "OWNER_SESSION_REQUIRED" };
  }
  if (
    record.code === "PT403" &&
    AUTHORIZATION_DENIAL_MESSAGES.has(record.message)
  ) {
    return { ok: false, status: 403, code: "OWNER_AUTHORIZATION_REQUIRED" };
  }
  return null;
}

export function createOwnerAuthRepository(
  database: Pick<RuntimeDatabase, "ownerTransaction"> = createRuntimeDatabase(),
): OwnerAuthRepository {
  async function execute(
    operation: keyof typeof OWNER_SESSION_FUNCTIONS,
    identity: FreshSupabaseIdentity,
  ): Promise<boolean> {
    const functionName = OWNER_SESSION_FUNCTIONS[operation];
    const rows = await database.ownerTransaction(identity, (transaction) =>
      transaction.unsafe(
        `select gioia_private.${functionName}($1::uuid, $2::uuid) ` +
          "as authorized limit 1",
        [identity.userId, identity.sessionId],
      ),
    );
    if (
      rows.length === 1 &&
      rows[0]?.authorized === true &&
      Object.keys(rows[0]).length === 1
    ) {
      return true;
    }
    throw new Error("Unexpected owner session result");
  }

  async function check(
    operation: "start" | "authorize",
    identity: FreshSupabaseIdentity,
  ): Promise<OwnerAuthorizationDecision> {
    try {
      await execute(operation, identity);
      return { ok: true };
    } catch (error) {
      const denial = denialDecision(error);
      if (denial) return denial;
      throw error;
    }
  }

  return {
    startSession: (identity) => check("start", identity),
    authorizeSession: (identity) => check("authorize", identity),
    revokeSession: (identity) => execute("revoke", identity),
  };
}

export const ownerAuthRepository = createOwnerAuthRepository();
