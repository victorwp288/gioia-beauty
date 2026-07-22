import "server-only";

import { z } from "zod";

import { parseTurnstileEnvironment } from "@/config/environment.mjs";

import type {
  PublicAbuseAction,
  PublicHumanChallengeVerifier,
} from "./publicAbuseBoundary.ts";

type ServerEnvironment = Readonly<Record<string, string | undefined>>;

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const HUMAN_CHALLENGE_HEADER = "x-gioia-human-challenge";
const MAX_TOKEN_BYTES = 2_048;
const VERIFY_TIMEOUT_MILLISECONDS = 4_000;
const SUPPORTED_ACTIONS = new Set<PublicAbuseAction>([
  "public_booking",
  "public_newsletter_subscribe",
]);

const SiteverifyResponseSchema = z
  .object({
    success: z.boolean(),
    hostname: z.string().min(1).max(253).optional(),
    action: z.string().min(1).max(32).optional(),
    "error-codes": z.array(z.string().max(100)).max(20).optional(),
  })
  .passthrough();

export function parseTurnstileChallengeToken(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    Buffer.byteLength(value, "utf8") > MAX_TOKEN_BYTES ||
    /[^\x21-\x7e]/u.test(value)
  ) {
    return null;
  }
  return value;
}

export function createTurnstileHumanChallengeVerifier(
  env: ServerEnvironment = process.env,
  fetchImplementation: typeof fetch = fetch,
): PublicHumanChallengeVerifier {
  return {
    async verify(request, action) {
      try {
        const configuration = parseTurnstileEnvironment(env);
        if (!configuration || !SUPPORTED_ACTIONS.has(action)) {
          return { verified: false };
        }
        const token = parseTurnstileChallengeToken(
          request.headers.get(HUMAN_CHALLENGE_HEADER),
        );
        if (!token) return { verified: false };

        const response = await fetchImplementation(SITEVERIFY_URL, {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: configuration.secretKey,
            response: token,
          }),
          signal: AbortSignal.timeout(VERIFY_TIMEOUT_MILLISECONDS),
        });
        if (!response.ok) return { verified: false };
        const parsed = SiteverifyResponseSchema.safeParse(
          await response.json(),
        );
        return {
          verified:
            parsed.success &&
            parsed.data.success &&
            parsed.data.action === action &&
            configuration.allowedHostnames.includes(parsed.data.hostname ?? ""),
        };
      } catch {
        return { verified: false };
      }
    },
  };
}
