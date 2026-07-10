import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import {
  ProviderIdSchema,
  VerifiedEmailWebhookEventSchema,
  WebhookSignatureHeadersSchema,
  assertWebhookTimestampFresh,
  type VerifiedEmailWebhookEvent,
} from "@/lib/domain/schemas/index.ts";

import type {
  ResendWebhookHeaders,
  ResendWebhookVerifier,
} from "./resendWebhookVerifier.ts";

const MAX_WEBHOOK_BODY_BYTES = 32 * 1_024;
const MAX_CONTENT_TYPE_BYTES = 64;
const ResendPayloadSchema = z
  .object({
    type: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z][a-z0-9._-]*$/),
    data: z.record(z.unknown()),
  })
  .passthrough();
const MessageDataSchema = z
  .object({ email_id: ProviderIdSchema })
  .passthrough();

type Failure = {
  readonly ok: false;
  readonly status: 400 | 413 | 415;
  readonly code:
    "INVALID_WEBHOOK" | "PAYLOAD_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE";
};

export type VerifiedResendWebhookRequest =
  Failure | { readonly ok: true; readonly event: VerifiedEmailWebhookEvent };

function failure(status: Failure["status"], code: Failure["code"]): Failure {
  return { ok: false, status, code };
}

function declaredBodyLength(request: Request): number | null {
  const value = request.headers.get("content-length");
  if (value === null) return null;
  if (!/^(0|[1-9]\d*)$/.test(value)) return Number.NaN;
  return Number(value);
}

function readHeaders(request: Request):
  | Failure
  | {
      readonly ok: true;
      readonly parsed: z.infer<typeof WebhookSignatureHeadersSchema>;
      readonly provider: ResendWebhookHeaders;
    } {
  const raw = {
    webhookId: request.headers.get("svix-id"),
    webhookTimestamp: request.headers.get("svix-timestamp"),
    webhookSignature: request.headers.get("svix-signature"),
  };
  const parsed = WebhookSignatureHeadersSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.webhookId !== raw.webhookId ||
    parsed.data.webhookTimestamp !== raw.webhookTimestamp ||
    parsed.data.webhookSignature !== raw.webhookSignature
  ) {
    return failure(400, "INVALID_WEBHOOK");
  }
  return {
    ok: true,
    parsed: parsed.data,
    provider: {
      "svix-id": parsed.data.webhookId,
      "svix-timestamp": parsed.data.webhookTimestamp,
      "svix-signature": parsed.data.webhookSignature,
    },
  };
}

async function readRawBody(
  request: Request,
): Promise<Failure | { readonly ok: true; readonly bytes: Buffer }> {
  const reader = request.body?.getReader();
  if (!reader) return failure(400, "INVALID_WEBHOOK");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_WEBHOOK_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The bounded-size result is authoritative even if cleanup fails.
        }
        return failure(413, "PAYLOAD_TOO_LARGE");
      }
      chunks.push(value);
    }
  } catch {
    return failure(400, "INVALID_WEBHOOK");
  } finally {
    reader.releaseLock();
  }

  const body = Buffer.allocUnsafe(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes: body };
}

function mapEventKind(type: string) {
  return {
    "email.delivered": "delivered",
    "email.bounced": "bounced",
    "email.complained": "complained",
  }[type] as "delivered" | "bounced" | "complained" | undefined;
}

export async function verifyResendWebhookRequest({
  request,
  verifier,
  now = () => new Date(),
}: {
  request: Request;
  verifier: ResendWebhookVerifier;
  now?: () => Date;
}): Promise<VerifiedResendWebhookRequest> {
  if (new URL(request.url).search !== "") {
    return failure(400, "INVALID_WEBHOOK");
  }
  const contentType = request.headers.get("content-type") ?? "";
  const contentEncoding = request.headers.get("content-encoding");
  if (
    Buffer.byteLength(contentType, "utf8") > MAX_CONTENT_TYPE_BYTES ||
    !/^application\/json(?:;\s*charset=utf-8)?$/i.test(contentType) ||
    (contentEncoding !== null &&
      (contentEncoding.trim() !== contentEncoding ||
        contentEncoding.toLowerCase() !== "identity"))
  ) {
    return failure(415, "UNSUPPORTED_MEDIA_TYPE");
  }

  const headers = readHeaders(request);
  if (!headers.ok) return headers;

  const declaredLength = declaredBodyLength(request);
  if (declaredLength !== null && !Number.isSafeInteger(declaredLength)) {
    return failure(400, "INVALID_WEBHOOK");
  }
  if (declaredLength !== null && declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return failure(413, "PAYLOAD_TOO_LARGE");
  }

  const raw = await readRawBody(request);
  if (!raw.ok) return raw;

  let payload: unknown;
  let receivedAt: Date;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(raw.bytes);
    payload = verifier.verify(raw.bytes, headers.provider);
    receivedAt = now();
    assertWebhookTimestampFresh(headers.parsed, receivedAt);
  } catch {
    return failure(400, "INVALID_WEBHOOK");
  }

  const parsedPayload = ResendPayloadSchema.safeParse(payload);
  if (!parsedPayload.success) return failure(400, "INVALID_WEBHOOK");
  const eventKind = mapEventKind(parsedPayload.data.type);
  let providerMessageId: string | null = null;
  if (eventKind) {
    const message = MessageDataSchema.safeParse(parsedPayload.data.data);
    const rawMessageId = parsedPayload.data.data.email_id;
    if (
      !message.success ||
      typeof rawMessageId !== "string" ||
      message.data.email_id !== rawMessageId
    ) {
      return failure(400, "INVALID_WEBHOOK");
    }
    providerMessageId = message.data.email_id;
  }

  try {
    return {
      ok: true,
      event: VerifiedEmailWebhookEventSchema.parse({
        verifiedHeaders: headers.parsed,
        signatureVerified: true,
        providerMessageId,
        eventKind: eventKind ?? "other",
        payloadSha256: createHash("sha256").update(raw.bytes).digest("hex"),
        receivedAt: receivedAt.toISOString(),
      }),
    };
  } catch {
    return failure(400, "INVALID_WEBHOOK");
  }
}
