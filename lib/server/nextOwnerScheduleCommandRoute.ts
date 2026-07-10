import "server-only";

import { cookies } from "next/headers";
import type { z } from "zod";

import {
  AdminCancelScheduleEntryBodySchema,
  AdminCancelVacationBodySchema,
  AdminCreateAppointmentBodySchema,
  AdminCreateBlockBodySchema,
  AdminCreateVacationBodySchema,
} from "@/lib/domain/schemas/index.ts";

import { createNextOwnerAuthContext } from "./auth/nextOwnerAuthContext.ts";
import { clearOwnerSecurityCookies } from "./auth/ownerSecurityCookies.ts";
import { OWNER_CSRF_COOKIE } from "./auth/requestSecurity.ts";
import { OWNER_SESSION_BINDING_COOKIE } from "./auth/sessionBinding.ts";
import { OWNER_SCHEDULE_COMMAND_CONTRACTS } from "./database/ownerScheduleCommandContracts.ts";
import {
  ownerScheduleRepository,
  type OwnerScheduleRepository,
} from "./database/ownerScheduleRepository.ts";
import { createOwnerScheduleCommandHandler } from "./ownerScheduleCommandHandler.ts";
import { apiErrorResponse } from "./publicApiResponse.ts";

export type OwnerScheduleCommandName = keyof OwnerScheduleRepository;

const COMMAND_BODY_SCHEMAS = Object.freeze({
  createAppointment: AdminCreateAppointmentBodySchema,
  createBlock: AdminCreateBlockBodySchema,
  cancelScheduleEntry: AdminCancelScheduleEntryBodySchema,
  createVacation: AdminCreateVacationBodySchema,
  cancelVacation: AdminCancelVacationBodySchema,
});

interface OwnerSecurityTokens {
  readonly bindingToken: string | null | undefined;
  readonly csrfToken: string | null | undefined;
}

type NextOwnerAuthContext = Awaited<
  ReturnType<typeof createNextOwnerAuthContext>
>;

export interface NextOwnerScheduleCommandRouteDependencies {
  readonly repository?: OwnerScheduleRepository;
  readonly readSecurityTokens?: () => Promise<OwnerSecurityTokens>;
  readonly createAuthContext?: (
    request: Request,
  ) => Promise<NextOwnerAuthContext>;
  readonly getBindingSecret?: () => string;
  readonly createRequestId?: () => string;
  readonly now?: Date;
}

async function readNextOwnerSecurityTokens(): Promise<OwnerSecurityTokens> {
  const store = await cookies();
  return {
    bindingToken: store.get(OWNER_SESSION_BINDING_COOKIE)?.value,
    csrfToken: store.get(OWNER_CSRF_COOKIE)?.value,
  };
}

export function createNextOwnerScheduleCommandRoute(
  commandName: OwnerScheduleCommandName,
  {
    repository = ownerScheduleRepository,
    readSecurityTokens = readNextOwnerSecurityTokens,
    createAuthContext = createNextOwnerAuthContext,
    getBindingSecret = () => process.env.OWNER_SESSION_HMAC_SECRET ?? "",
    createRequestId,
    now,
  }: NextOwnerScheduleCommandRouteDependencies = {},
) {
  const contract = OWNER_SCHEDULE_COMMAND_CONTRACTS[commandName];
  const bodySchema = COMMAND_BODY_SCHEMAS[commandName] as z.ZodType<
    Record<string, unknown>
  >;

  return async function POST(request: Request): Promise<Response> {
    let tokens: OwnerSecurityTokens;
    try {
      tokens = await readSecurityTokens();
    } catch {
      return apiErrorResponse(503, "SERVICE_UNAVAILABLE");
    }

    return createOwnerScheduleCommandHandler({
      csrfCookieToken: tokens.csrfToken,
      bodySchema,
      operation: contract.operation,
      version: contract.fingerprintVersion,
      createRequestId,
      now,
      loadRuntimeContext: async () => {
        const context = await createAuthContext(request);
        return {
          auth: context.auth,
          bindingToken: tokens.bindingToken,
          bindingSecret: getBindingSecret(),
          responseHeaders: context.responseHeaders,
          securityCookies: {
            clear: () =>
              clearOwnerSecurityCookies(
                context.securityCookieStore,
                context.secure,
              ),
          },
        };
      },
      execute: (identity, command, requestFingerprint) =>
        repository[commandName](identity, command, requestFingerprint),
    })(request);
  };
}
