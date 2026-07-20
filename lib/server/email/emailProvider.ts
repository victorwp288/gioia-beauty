import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import {
  NormalizedEmailSchema,
  ProviderIdSchema,
} from "@/lib/domain/schemas/index.ts";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_USER_AGENT = "gioia-beauty-outbox/1.0";
const MAX_PROVIDER_RESPONSE_BYTES = 16_384;
const DEFAULT_TIMEOUT_MS = 8_000;

export const EmailMessageSchema = z
  .object({
    from: z.literal("Gioia Beauty <noreply@gioiabeauty.net>"),
    to: z.array(NormalizedEmailSchema).length(1),
    subject: z.string().min(1).max(200),
    html: z.string().min(1).max(100_000),
    text: z.string().min(1).max(50_000),
  })
  .strict();

const ProviderIdempotencyKeySchema = z
  .string()
  .min(8)
  .max(255)
  .regex(/^[A-Za-z0-9._:-]{8,255}$/);

const EmailProviderErrorCodeSchema = z.enum([
  "PROVIDER_AUTH_INVALID",
  "PROVIDER_CONCURRENT_IDEMPOTENCY",
  "PROVIDER_IDEMPOTENCY_CONFLICT",
  "PROVIDER_NETWORK_ERROR",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_REQUEST_INVALID",
  "PROVIDER_RESPONSE_INVALID",
  "PROVIDER_TIMEOUT",
  "PROVIDER_UNAVAILABLE",
]);

export const EmailProviderResultSchema = z.discriminatedUnion("ok", [
  z
    .object({ ok: z.literal(true), providerMessageId: ProviderIdSchema })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      errorCode: EmailProviderErrorCodeSchema,
      retryable: z.boolean(),
    })
    .strict(),
]);

export type EmailMessage = z.infer<typeof EmailMessageSchema>;
export type EmailProviderResult = z.infer<typeof EmailProviderResultSchema>;

export interface EmailProvider {
  send(
    message: EmailMessage,
    options: { idempotencyKey: string; signal?: AbortSignal },
  ): Promise<EmailProviderResult>;
}

export class EmailProviderConfigurationError extends Error {
  constructor() {
    super("Email provider is not configured");
    this.name = "EmailProviderConfigurationError";
  }
}

export type FetchEmail = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, "body" | "ok" | "status">>;

async function readBoundedJson(
  response: Pick<Response, "body">,
): Promise<unknown> {
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PROVIDER_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

function failure(
  errorCode: z.infer<typeof EmailProviderErrorCodeSchema>,
  retryable: boolean,
): EmailProviderResult {
  return { ok: false, errorCode, retryable };
}

function classifyHttpFailure(status: number, body: unknown) {
  if (status === 408) return failure("PROVIDER_TIMEOUT", true);
  if (status === 429) return failure("PROVIDER_RATE_LIMITED", true);
  if (status >= 500) return failure("PROVIDER_UNAVAILABLE", true);
  if (status === 401 || status === 403) {
    return failure("PROVIDER_AUTH_INVALID", false);
  }
  if (status === 409) {
    const name = z.object({ name: z.string() }).passthrough().safeParse(body);
    return name.success && name.data.name === "concurrent_idempotent_requests"
      ? failure("PROVIDER_CONCURRENT_IDEMPOTENCY", true)
      : failure("PROVIDER_IDEMPOTENCY_CONFLICT", false);
  }
  return failure("PROVIDER_REQUEST_INVALID", false);
}

function createRequestSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}

export function createFakeEmailProvider(): EmailProvider {
  return {
    async send(message, options) {
      const parsedMessage = EmailMessageSchema.safeParse(message);
      const parsedKey = ProviderIdempotencyKeySchema.safeParse(
        options.idempotencyKey,
      );
      if (!parsedMessage.success || !parsedKey.success) {
        return failure("PROVIDER_REQUEST_INVALID", false);
      }
      const providerMessageId = `fake_${createHash("sha256")
        .update(parsedKey.data, "utf8")
        .digest("hex")}`;
      return { ok: true, providerMessageId };
    },
  };
}

export function createResendEmailProvider({
  apiKey,
  fetchEmail = globalThis.fetch as FetchEmail,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  apiKey: string | undefined;
  fetchEmail?: FetchEmail;
  timeoutMs?: number;
}): EmailProvider {
  if (
    !apiKey ||
    apiKey.trim() !== apiKey ||
    !/^re_[A-Za-z0-9_-]{16,508}$/.test(apiKey) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 30_000
  ) {
    throw new EmailProviderConfigurationError();
  }

  return {
    async send(message, options) {
      const parsedMessage = EmailMessageSchema.safeParse(message);
      const parsedKey = ProviderIdempotencyKeySchema.safeParse(
        options.idempotencyKey,
      );
      if (!parsedMessage.success || !parsedKey.success) {
        return failure("PROVIDER_REQUEST_INVALID", false);
      }

      const requestSignal = createRequestSignal(options.signal, timeoutMs);
      try {
        const response = await fetchEmail(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": parsedKey.data,
            "User-Agent": RESEND_USER_AGENT,
          },
          body: JSON.stringify(parsedMessage.data),
          signal: requestSignal.signal,
        });
        const body = await readBoundedJson(response);
        if (!response.ok) return classifyHttpFailure(response.status, body);

        const success = z
          .object({ id: ProviderIdSchema })
          .passthrough()
          .safeParse(body);
        return success.success
          ? { ok: true, providerMessageId: success.data.id }
          : failure("PROVIDER_RESPONSE_INVALID", true);
      } catch (error) {
        const isAbort =
          requestSignal.signal.aborted ||
          (error instanceof Error && error.name === "AbortError");
        return isAbort
          ? failure("PROVIDER_TIMEOUT", true)
          : failure("PROVIDER_NETWORK_ERROR", true);
      } finally {
        requestSignal.cleanup();
      }
    },
  };
}

export function createEmailProvider(
  env: Readonly<Record<string, string | undefined>> = process.env,
): EmailProvider {
  if (env.EMAIL_TRANSPORT === "fake") return createFakeEmailProvider();
  if (env.EMAIL_TRANSPORT === "resend") {
    return createResendEmailProvider({ apiKey: env.RESEND_API_KEY });
  }
  throw new EmailProviderConfigurationError();
}
