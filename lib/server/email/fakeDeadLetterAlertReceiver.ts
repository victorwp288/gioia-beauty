import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { DeadLetterAlertEventSchema } from "@/lib/server/database/emailDeadLetterAlertRepository.ts";

const BatchSchema = z.array(DeadLetterAlertEventSchema).min(1).max(25);

export function createFakeDeadLetterAlertReceiver() {
  return Object.freeze({
    async accept(events: unknown) {
      const batch = BatchSchema.parse(events);
      const acceptanceId = `fake_alert_${createHash("sha256")
        .update(batch.map((event) => event.sequenceId).join(":"), "utf8")
        .digest("hex")}`;
      return Object.freeze({ accepted: true as const, acceptanceId });
    },
  });
}
