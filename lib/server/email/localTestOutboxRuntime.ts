import "server-only";

import { validateEnvironment } from "@/config/environment.mjs";
import { emailOutboxRepository } from "@/lib/server/database/emailOutboxRepository.ts";
import { emailDeadLetterAlertRepository } from "@/lib/server/database/emailDeadLetterAlertRepository.ts";
import { publicAbuseRepository } from "@/lib/server/database/publicAbuseRepository.ts";
import { verifiedEmailWebhookReplayRepository } from "@/lib/server/database/verifiedEmailWebhookReplayRepository.ts";
import { createNewsletterActionTokenCodec } from "@/lib/server/newsletterActionToken.ts";
import { parseNewsletterActionTokenEnvironment } from "@/lib/server/newsletterActionTokenEnvironment.ts";

import { createFakeEmailProvider } from "./emailProvider.ts";
import { createFakeDeadLetterAlertReceiver } from "./fakeDeadLetterAlertReceiver.ts";
import { scheduleEmailRenderersV1 } from "./emailTemplatesV1.ts";
import { createNewsletterConfirmationEmailRendererV1 } from "./newsletterConfirmationEmailV1.ts";
import { createOutboxWorker } from "./outboxWorker.ts";

const CRON_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export class LocalTestOutboxRuntimeConfigurationError extends Error {
  constructor() {
    super("Local/Test outbox runtime is not configured");
    this.name = "LocalTestOutboxRuntimeConfigurationError";
  }
}

function validCronSecret(value: string | undefined): value is string {
  if (!value || !CRON_SECRET_PATTERN.test(value)) return false;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === value;
}

export function createLocalTestOutboxRuntime(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const validation = validateEnvironment(env);
  if (
    !validation.ok ||
    !["local", "test"].includes(validation.appEnv ?? "") ||
    env.EMAIL_TRANSPORT !== "fake" ||
    !validCronSecret(env.CRON_SECRET)
  ) {
    throw new LocalTestOutboxRuntimeConfigurationError();
  }

  const tokenCodec = createNewsletterActionTokenCodec(
    parseNewsletterActionTokenEnvironment(env),
  );
  const outboxWorker = createOutboxWorker({
    repository: emailOutboxRepository,
    provider: createFakeEmailProvider(),
    renderers: {
      ...scheduleEmailRenderersV1,
      newsletter_confirmation: createNewsletterConfirmationEmailRendererV1({
        tokenCodec,
        now: () => new Date(),
      }),
    },
  });
  const alertReceiver = createFakeDeadLetterAlertReceiver();
  const worker = Object.freeze({
    async run(
      input: { readonly workerId: string },
      options: { readonly signal: AbortSignal },
    ) {
      const summary = await outboxWorker.run(input, options);
      if (options.signal.aborted) return summary;
      await verifiedEmailWebhookReplayRepository.replay(25);
      const alertBatch = await emailDeadLetterAlertRepository.claim({
        workerId: input.workerId,
        batchSize: 25,
        leaseSeconds: 120,
      });
      if (
        alertBatch.eventCount > 0 &&
        alertBatch.batchId &&
        alertBatch.throughSequenceId
      ) {
        await alertReceiver.accept(alertBatch.events);
        await emailDeadLetterAlertRepository.ack({
          workerId: input.workerId,
          batchId: alertBatch.batchId,
          throughSequenceId: alertBatch.throughSequenceId,
        });
      }
      await publicAbuseRepository.purgeExpired(1_000);
      return summary;
    },
  });

  return Object.freeze({ worker, cronSecret: env.CRON_SECRET });
}
