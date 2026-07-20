import "server-only";

import {
  createRuntimeDatabase,
  type RuntimeDatabase,
} from "./database/runtime.ts";
import {
  readCutoverWriteState,
  type CutoverWriteMode,
} from "./database/cutoverWriteRepository.ts";
import { apiErrorResponse } from "./publicApiResponse.ts";

export const CUTOVER_CANARY_HEADER = "x-gioia-cutover-canary";
const CANARY_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MAINTENANCE_HEADERS = { "Retry-After": "300" } as const;

export type CutoverWriteChannel = "public" | "owner";

export interface CutoverWriteGateResult {
  readonly ok: true;
  readonly canaryToken: string | null;
  readonly mode: CutoverWriteMode;
}

export interface CutoverWriteGate {
  check(
    request: Pick<Request, "headers">,
    channel: CutoverWriteChannel,
  ): Promise<
    CutoverWriteGateResult | { readonly ok: false; readonly response: Response }
  >;
}

export function maintenanceActiveResponse(requestId?: string) {
  return apiErrorResponse(
    503,
    "MAINTENANCE_ACTIVE",
    requestId,
    MAINTENANCE_HEADERS,
  );
}

export function createCutoverWriteGate(
  database: Pick<RuntimeDatabase, "transaction"> = createRuntimeDatabase(),
): CutoverWriteGate {
  return {
    async check(request, channel) {
      let state;
      try {
        state = await database.transaction(readCutoverWriteState);
      } catch {
        return {
          ok: false,
          response: apiErrorResponse(503, "SERVICE_UNAVAILABLE"),
        };
      }

      const supplied = request.headers.get(CUTOVER_CANARY_HEADER);
      const canaryToken =
        supplied && CANARY_TOKEN.test(supplied) ? supplied : null;

      if (state.mode === "open") {
        if (supplied !== null) {
          return { ok: false, response: maintenanceActiveResponse() };
        }
        return { ok: true, canaryToken: null, mode: state.mode };
      }

      if (state.mode === "owner_reconcile") {
        if (channel === "owner" && supplied === null) {
          return { ok: true, canaryToken: null, mode: state.mode };
        }
        return { ok: false, response: maintenanceActiveResponse() };
      }

      if (canaryToken === null) {
        return { ok: false, response: maintenanceActiveResponse() };
      }
      return { ok: true, canaryToken, mode: state.mode };
    },
  };
}

export const cutoverWriteGate = createCutoverWriteGate();
