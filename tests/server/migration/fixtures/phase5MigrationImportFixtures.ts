import { createHash } from "node:crypto";

import type { LegacyFirestoreTransformResult } from "@/lib/server/migration/legacyFirestoreTransform.ts";

export function largeSyntheticSubscriberResult(): LegacyFirestoreTransformResult {
  const imported = Array.from({ length: 205 }, (_, index) => {
    const suffix = String(index + 1).padStart(12, "0");
    const sourceRecordId = `phase5-subscriber-${String(index + 1).padStart(4, "0")}`;
    const id = `b7000000-0000-4000-8000-${suffix}`;
    return {
      sourceCollection: "newsletter_subscribers" as const,
      sourceRecordId,
      sourceRecordSha256: createHash("sha256")
        .update(sourceRecordId)
        .digest("hex"),
      targetKind: "subscriber" as const,
      targetId: id,
      record: {
        id,
        schemaVersion: 1 as const,
        legacyFirestoreId: sourceRecordId,
        timestampProvenance: "import_time" as const,
        importedAt: "2026-07-20T10:00:00.000Z",
        createdAt: "2026-07-20T10:00:00.000Z",
        updatedAt: "2026-07-20T10:00:00.000Z",
        email: `phase5-${index + 1}@example.test`,
        status: "legacy_unverified" as const,
        source: "migration" as const,
        consentAt: null,
        consentSource: null,
        consentPolicyVersion: null,
        confirmedAt: null,
        unsubscribedAt: null,
        version: 1,
      },
    };
  });
  return {
    imported,
    quarantine: [],
    counts: {
      source: imported.length,
      imported: imported.length,
      quarantined: 0,
    },
  };
}
