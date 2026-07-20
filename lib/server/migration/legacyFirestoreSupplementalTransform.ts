import {
  SubscriberPersistenceSchema,
  type SubscriberPersistence,
} from "@/lib/domain/schemas/subscribers.ts";
import {
  VacationPersistenceSchema,
  type VacationPersistence,
} from "@/lib/domain/schemas/vacations.ts";
import {
  LegacySubscriberDataSchema,
  LegacyVacationDataSchema,
  RecordQuarantine,
  type LegacyDocument,
  type LegacyImportedRecord,
  type TransformContext,
} from "./legacyFirestoreTransformContract.ts";
import {
  cancellationInstant,
  deterministicUuid,
  importedRecord,
  normalizedNullable,
  normalizeLookup,
  operationalTimestamps,
  resolveSalonDate,
  strictSourceData,
} from "./legacyFirestoreTransformHelpers.ts";

function vacationStatus(value: string | undefined): "active" | "cancelled" {
  if (value === undefined || value.trim() === "") return "active";
  const normalized = normalizeLookup(value);
  if (normalized === "active") return "active";
  if (normalized === "cancelled") return "cancelled";
  throw new RecordQuarantine("INVALID_VACATION_STATUS", ["STATUS"]);
}

export function transformVacation(
  document: LegacyDocument,
  context: TransformContext,
): LegacyImportedRecord<VacationPersistence> {
  const data = strictSourceData(LegacyVacationDataSchema, document.data, [
    "VACATION_DOCUMENT",
  ]);
  const startDate = resolveSalonDate(
    data.startDate,
    "vacations",
    document.id,
    "startDate",
    context,
  );
  const endDate = resolveSalonDate(
    data.endDate,
    "vacations",
    document.id,
    "endDate",
    context,
  );
  if (endDate < startDate) {
    throw new RecordQuarantine("INVALID_VACATION_RANGE", [
      "START_DATE",
      "END_DATE",
    ]);
  }
  const timestamps = operationalTimestamps(
    "vacations",
    document.id,
    context.importedAt,
    data.createdAt,
    data.updatedAt,
    context,
  );
  const status = vacationStatus(data.status);
  const candidate = {
    id: deterministicUuid("vacations", document.id),
    schemaVersion: 1,
    legacyFirestoreId: document.id,
    importedAt: context.importedAt,
    ...timestamps,
    startDate,
    endDate,
    status,
    reason: normalizedNullable(data.reason),
    source: "migration" as const,
    createdBy: null,
    cancelledAt: cancellationInstant(
      status,
      data.cancelledAt,
      timestamps,
      context.importedAt,
    ),
    cancelledBy: null,
    version: 1,
  };
  const parsed = VacationPersistenceSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new RecordQuarantine("INVALID_VACATION_RANGE", ["VACATION_RANGE"]);
  }
  return importedRecord("vacations", document, "vacation", parsed.data);
}

function subscriberStatus(
  value: string | undefined,
): "legacy_unverified" | "unsubscribed" {
  if (value === undefined || value.trim() === "") return "legacy_unverified";
  const normalized = normalizeLookup(value);
  if (["active", "pending", "legacy_unverified"].includes(normalized)) {
    return "legacy_unverified";
  }
  if (normalized === "unsubscribed") return "unsubscribed";
  throw new RecordQuarantine("INVALID_SUBSCRIBER_STATUS", ["STATUS"]);
}

export function transformSubscriber(
  document: LegacyDocument,
  context: TransformContext,
): LegacyImportedRecord<SubscriberPersistence> {
  const data = strictSourceData(LegacySubscriberDataSchema, document.data, [
    "SUBSCRIBER_DOCUMENT",
  ]);
  const status = subscriberStatus(data.status);
  const timestamps = operationalTimestamps(
    "newsletter_subscribers",
    document.id,
    context.importedAt,
    data.createdAt ?? data.subscribedAt ?? data.subscribed_at,
    data.updatedAt ?? data.statusUpdatedAt,
    context,
  );
  const candidate = {
    id: deterministicUuid("newsletter_subscribers", document.id),
    schemaVersion: 1,
    legacyFirestoreId: document.id,
    importedAt: context.importedAt,
    ...timestamps,
    email: data.email.trim().toLowerCase(),
    status,
    source: "migration" as const,
    consentAt: null,
    consentSource: null,
    consentPolicyVersion: null,
    confirmedAt: null,
    unsubscribedAt:
      status === "unsubscribed"
        ? cancellationInstant(
            "cancelled",
            data.unsubscribedAt ?? data.statusUpdatedAt,
            timestamps,
            context.importedAt,
          )
        : null,
    version: 1,
  };
  const parsed = SubscriberPersistenceSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new RecordQuarantine("INVALID_SUBSCRIBER_EMAIL", ["EMAIL"]);
  }
  return importedRecord(
    "newsletter_subscribers",
    document,
    "subscriber",
    parsed.data,
  );
}
