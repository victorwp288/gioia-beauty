import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

export const OWNER_SESSION_BINDING_COOKIE = "gioia_owner_session";
export const OWNER_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

const MAX_CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_BYTES = 768;
const SIGNATURE_BYTES = 32;
const BindingPayloadSchema = z
  .object({
    version: z.literal(1),
    userId: z.string().uuid(),
    sessionId: z.string().uuid(),
    issuedAt: z.number().int().nonnegative(),
  })
  .strict();

export type OwnerSessionBinding = z.infer<typeof BindingPayloadSchema>;

export interface OwnerSessionBindingInput {
  userId: string;
  sessionId: string;
  secret: string;
  now?: Date;
}

export interface OwnerSessionVerificationInput {
  token: string | null | undefined;
  expectedUserId: string;
  expectedSessionId: string;
  secret: string;
  now?: Date;
}

function validatedSecret(secret: string): string {
  if (
    secret.trim() !== secret ||
    secret.includes("\0") ||
    Buffer.byteLength(secret, "utf8") < 32
  ) {
    throw new Error("Owner session binding is not configured");
  }
  return secret;
}

function signatureFor(payload: string, secret: string): Buffer {
  return createHmac("sha256", validatedSecret(secret))
    .update(payload, "utf8")
    .digest();
}

function encodedSignature(signature: Buffer): string {
  return signature.toString("base64url");
}

function decodedSignature(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.length !== SIGNATURE_BYTES ||
    decoded.toString("base64url") !== value
  ) {
    return null;
  }
  return decoded;
}

function nowInSeconds(now: Date): number | null {
  const milliseconds = now.getTime();
  if (!Number.isFinite(milliseconds)) return null;
  const seconds = Math.floor(milliseconds / 1_000);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

export function issueOwnerSessionBinding({
  userId,
  sessionId,
  secret,
  now = new Date(),
}: OwnerSessionBindingInput): string {
  const payload = BindingPayloadSchema.parse({
    version: 1,
    userId,
    sessionId,
    issuedAt: nowInSeconds(now),
  });
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${encodedPayload}.${encodedSignature(
    signatureFor(encodedPayload, secret),
  )}`;
}

export function verifyOwnerSessionBinding({
  token,
  expectedUserId,
  expectedSessionId,
  secret,
  now = new Date(),
}: OwnerSessionVerificationInput): OwnerSessionBinding | null {
  validatedSecret(secret);
  if (
    !token ||
    Buffer.byteLength(token, "utf8") > MAX_TOKEN_BYTES ||
    token.split(".").length !== 2
  ) {
    return null;
  }

  const [encodedPayload, encodedActualSignature] = token.split(".");
  const actualSignature = decodedSignature(encodedActualSignature ?? "");
  if (!encodedPayload || !actualSignature) return null;

  const expectedSignature = signatureFor(encodedPayload, secret);
  if (!timingSafeEqual(actualSignature, expectedSignature)) return null;

  let decodedPayload: unknown;
  try {
    const payloadBuffer = Buffer.from(encodedPayload, "base64url");
    if (payloadBuffer.toString("base64url") !== encodedPayload) return null;
    decodedPayload = JSON.parse(payloadBuffer.toString("utf8"));
  } catch {
    return null;
  }

  const parsed = BindingPayloadSchema.safeParse(decodedPayload);
  if (!parsed.success) return null;

  const currentTime = nowInSeconds(now);
  if (currentTime === null) return null;
  const age = currentTime - parsed.data.issuedAt;
  if (
    age < -MAX_CLOCK_SKEW_SECONDS ||
    age > OWNER_SESSION_MAX_AGE_SECONDS ||
    parsed.data.userId !== expectedUserId ||
    parsed.data.sessionId !== expectedSessionId
  ) {
    return null;
  }

  return parsed.data;
}
