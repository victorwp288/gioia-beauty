import "server-only";

import { z } from "zod";

import {
  DatabaseConfigurationError,
  createRuntimeDatabase,
  type RuntimeDatabase,
} from "./database/runtime.ts";
import { readCutoverWriteState } from "./database/cutoverWriteRepository.ts";
import {
  apiErrorResponse,
  validatedJsonResponse,
} from "./publicApiResponse.ts";

const MaintenanceStatusResponseSchema = z
  .object({
    code: z.literal("MAINTENANCE_STATUS"),
    publicBookingEnabled: z.boolean(),
    ownerMutationsEnabled: z.boolean(),
    messageCode: z.enum([
      "OPERATIONS_OPEN",
      "MAINTENANCE_ACTIVE",
      "OWNER_RECONCILIATION_ACTIVE",
    ]),
  })
  .strict();

type MaintenanceFailureStage = "configuration" | "database";

function writeMaintenanceFailureStage(stage: MaintenanceFailureStage): void {
  console.warn(
    JSON.stringify({ v: 1, event: "maintenance_dependency_failure", stage }),
  );
}

export function createMaintenanceStatusGetHandler(
  database: Pick<RuntimeDatabase, "transaction"> = createRuntimeDatabase(),
  failureSink: (
    stage: MaintenanceFailureStage,
  ) => void = writeMaintenanceFailureStage,
) {
  return async function GET(request: Request): Promise<Response> {
    if (new URL(request.url).search !== "") {
      return apiErrorResponse(400, "INVALID_REQUEST");
    }
    try {
      const state = await database.transaction(readCutoverWriteState);
      return validatedJsonResponse(MaintenanceStatusResponseSchema, {
        code: "MAINTENANCE_STATUS",
        publicBookingEnabled: state.mode === "open",
        ownerMutationsEnabled: state.mode !== "frozen",
        messageCode:
          state.mode === "open"
            ? "OPERATIONS_OPEN"
            : state.mode === "frozen"
              ? "MAINTENANCE_ACTIVE"
              : "OWNER_RECONCILIATION_ACTIVE",
      });
    } catch (error) {
      try {
        failureSink(
          error instanceof DatabaseConfigurationError
            ? "configuration"
            : "database",
        );
      } catch {
        // Diagnostics must never change the fixed public failure contract.
      }
      return apiErrorResponse(503, "SERVICE_UNAVAILABLE");
    }
  };
}
