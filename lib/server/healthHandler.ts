import "server-only";

import { HealthResponseSchema } from "@/lib/domain/schemas/responses.ts";

import { validatedJsonResponse } from "./publicApiResponse.ts";

const HEALTH_RESPONSE = Object.freeze({ status: "ok" as const });

export function createHealthGetHandler() {
  return async function GET(): Promise<Response> {
    return validatedJsonResponse(HealthResponseSchema, HEALTH_RESPONSE, 200, {
      "X-Robots-Tag": "noindex, nofollow",
    });
  };
}
