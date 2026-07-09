import { randomUUID } from "node:crypto";

import {
  PublicAvailabilityResponseSchema,
  parseAvailabilitySearchParams,
} from "@/lib/domain/schemas/index.ts";

import {
  apiErrorResponse,
  databaseErrorResponse,
  validatedJsonResponse,
} from "./publicApiResponse.ts";

const MAX_QUERY_BYTES = 1_024;

interface AvailabilityDatabase {
  getAvailability(input: {
    date: string;
    serviceId: string;
    variantId: string;
  }): Promise<Array<Record<string, unknown>>>;
}

export interface AvailabilityHandlerDependencies {
  database: AvailabilityDatabase;
  createRequestId?: () => string;
}

export function createAvailabilityGetHandler({
  database,
  createRequestId = randomUUID,
}: AvailabilityHandlerDependencies) {
  return async function GET(request: Request): Promise<Response> {
    const requestId = createRequestId();
    let query;

    try {
      const url = new URL(request.url);
      if (Buffer.byteLength(url.search, "utf8") > MAX_QUERY_BYTES) {
        return apiErrorResponse(414, "QUERY_TOO_LARGE", requestId);
      }
      query = parseAvailabilitySearchParams(url.searchParams);
    } catch {
      return apiErrorResponse(422, "INVALID_QUERY", requestId);
    }

    try {
      const rows = await database.getAvailability(query);
      const response = {
        ...query,
        slots: rows.map((row) => row.start_minutes),
      };
      return validatedJsonResponse(PublicAvailabilityResponseSchema, response);
    } catch (error) {
      return databaseErrorResponse(error, requestId);
    }
  };
}
