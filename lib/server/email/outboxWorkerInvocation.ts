import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { UuidSchema } from "@/lib/domain/schemas/index.ts";
import {
  apiErrorResponse,
  validatedJsonResponse,
} from "@/lib/server/publicApiResponse.ts";

import { OutboxWorkerSummarySchema } from "./outboxWorkerContracts.ts";
import {
  OUTBOX_INVOCATION_DEADLINE_MS,
  createDeadlineSignal,
  settleBeforeAbort,
} from "./outboxWorkerDeadline.ts";

const OUTBOX_CRON_PATH = "/api/cron/outbox";
const AUTHORIZATION_CONTEXT = "gioia:outbox-cron-authorization:v1\0";
const CRON_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const AUTHORIZATION_PATTERN = /^Bearer ([A-Za-z0-9_-]{43})$/;
const RESPONSE_HEADERS = Object.freeze({
  "X-Robots-Tag": "noindex, nofollow, noarchive",
});

const OutboxBatchProcessedResponseSchema = z
  .object({
    code: z.literal("OUTBOX_BATCH_PROCESSED"),
    requestId: UuidSchema,
    summary: OutboxWorkerSummarySchema,
  })
  .strict();

interface InvocationDependencies {
  readonly worker: {
    run(
      input: { readonly workerId: string },
      options: { readonly signal: AbortSignal },
    ): Promise<unknown>;
  };
  readonly cronSecret: string;
  readonly requestId: () => string;
}

export class OutboxWorkerInvocationConfigurationError extends Error {
  constructor() {
    super("Outbox worker invocation is not configured");
    this.name = "OutboxWorkerInvocationConfigurationError";
  }
}

function requireCanonicalSecret(value: unknown): string {
  if (typeof value !== "string" || !CRON_SECRET_PATTERN.test(value)) {
    throw new OutboxWorkerInvocationConfigurationError();
  }
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.length !== 32 || bytes.toString("base64url") !== value) {
      throw new OutboxWorkerInvocationConfigurationError();
    }
  } catch {
    throw new OutboxWorkerInvocationConfigurationError();
  }
  return value;
}

function authorizationDigest(value: string): Buffer {
  return createHash("sha256")
    .update(AUTHORIZATION_CONTEXT, "utf8")
    .update(value, "utf8")
    .digest();
}

function requestIsCanonical(request: Request): boolean {
  try {
    if (request.method !== "GET" || request.body !== null) return false;
    const url = new URL(request.url);
    return (
      url.pathname === OUTBOX_CRON_PATH &&
      url.search === "" &&
      url.hash === "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function fixedError(status: number, code: string, requestId?: string) {
  return apiErrorResponse(status, code, requestId, RESPONSE_HEADERS);
}

export function createOutboxWorkerInvocationGetHandler({
  worker,
  cronSecret,
  requestId,
}: InvocationDependencies) {
  const secret = requireCanonicalSecret(cronSecret);
  let run: InvocationDependencies["worker"]["run"];
  try {
    if (typeof worker?.run !== "function" || typeof requestId !== "function") {
      throw new OutboxWorkerInvocationConfigurationError();
    }
    run = worker.run.bind(worker);
  } catch {
    throw new OutboxWorkerInvocationConfigurationError();
  }
  const expectedAuthorization = authorizationDigest(secret);

  function requestIsAuthorized(request: Request): boolean {
    try {
      const header = request.headers.get("authorization");
      const match = header === null ? null : AUTHORIZATION_PATTERN.exec(header);
      if (!match?.[1]) return false;
      const candidate = requireCanonicalSecret(match[1]);
      return timingSafeEqual(
        authorizationDigest(candidate),
        expectedAuthorization,
      );
    } catch {
      return false;
    }
  }

  return async function outboxWorkerInvocationGet(
    request: Request,
  ): Promise<Response> {
    if (!requestIsAuthorized(request)) {
      return fixedError(401, "UNAUTHORIZED");
    }
    if (!requestIsCanonical(request)) {
      return fixedError(400, "INVALID_REQUEST");
    }

    let id: string;
    try {
      const candidate = requestId();
      const parsed = UuidSchema.safeParse(candidate);
      if (!parsed.success || parsed.data !== candidate) {
        return fixedError(503, "SERVICE_UNAVAILABLE");
      }
      id = parsed.data;
    } catch {
      return fixedError(503, "SERVICE_UNAVAILABLE");
    }

    const deadline = createDeadlineSignal(OUTBOX_INVOCATION_DEADLINE_MS);
    try {
      const invocation = await settleBeforeAbort(
        Promise.resolve().then(() =>
          run({ workerId: `cron:${id}` }, { signal: deadline.signal }),
        ),
        deadline.signal,
      );
      if (invocation.status === "aborted") {
        return fixedError(503, "SERVICE_UNAVAILABLE", id);
      }
      const result = OutboxWorkerSummarySchema.safeParse(invocation.value);
      if (!result.success) {
        return fixedError(503, "SERVICE_UNAVAILABLE", id);
      }
      if (result.data.completionUncertain > 0) {
        return fixedError(503, "OUTBOX_COMPLETION_UNCERTAIN", id);
      }
      if (result.data.rendererOperationalFaults > 0) {
        return fixedError(503, "OUTBOX_RENDERER_UNAVAILABLE", id);
      }
      return validatedJsonResponse(
        OutboxBatchProcessedResponseSchema,
        {
          code: "OUTBOX_BATCH_PROCESSED",
          requestId: id,
          summary: result.data,
        },
        200,
        RESPONSE_HEADERS,
      );
    } catch {
      return fixedError(503, "SERVICE_UNAVAILABLE", id);
    } finally {
      deadline.cleanup();
    }
  };
}
