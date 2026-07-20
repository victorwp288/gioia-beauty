import {
  ScheduleEntryPersistenceSchema,
  type ScheduleEntryPersistence,
} from "@/lib/domain/schemas/schedule.ts";
import {
  LegacyCustomerDataSchema,
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
  parseStartMinutes,
  resolveSalonDate,
  strictSourceData,
} from "./legacyFirestoreTransformHelpers.ts";
import { resolveCatalog } from "./legacyFirestoreCatalogMapping.ts";

const BLOCK_MARKERS = new Set(["blocco", "blocco orario", "time block"]);

function isBlock(data: {
  isTimeBlock?: boolean;
  appointmentType?: string;
  name?: string;
}): boolean {
  return (
    data.isTimeBlock === true ||
    BLOCK_MARKERS.has(normalizeLookup(data.appointmentType ?? "")) ||
    BLOCK_MARKERS.has(normalizeLookup(data.name ?? ""))
  );
}

function appointmentStatus(value: string | undefined): string {
  if (value === undefined || value.trim() === "") return "confirmed";
  const normalized = normalizeLookup(value).replaceAll("-", "_");
  if (["confirmed", "completed", "cancelled", "no_show"].includes(normalized)) {
    return normalized;
  }
  throw new RecordQuarantine("INVALID_APPOINTMENT_STATUS", ["STATUS"]);
}

function blockStatus(value: string | undefined): "active" | "cancelled" {
  if (value === undefined || value.trim() === "") return "active";
  const normalized = normalizeLookup(value);
  if (normalized === "active" || normalized === "confirmed") return "active";
  if (normalized === "cancelled") return "cancelled";
  throw new RecordQuarantine("INVALID_BLOCK_STATUS", ["STATUS"]);
}

export function transformCustomer(
  document: LegacyDocument,
  context: TransformContext,
): LegacyImportedRecord<ScheduleEntryPersistence> {
  const data = strictSourceData(LegacyCustomerDataSchema, document.data, [
    "CUSTOMER_DOCUMENT",
  ]);
  if (data.timeSlot !== undefined && data.timeSlot !== data.startTime) {
    throw new RecordQuarantine("INCONSISTENT_LEGACY_REDUNDANCY", [
      "START_TIME",
      "TIME_SLOT",
    ]);
  }
  if (typeof data.date === "string") {
    const selectedDatePart =
      typeof data.selectedDate === "string"
        ? data.selectedDate.slice(0, 10)
        : null;
    if (
      selectedDatePart !== null &&
      selectedDatePart !== data.date.slice(0, 10)
    ) {
      throw new RecordQuarantine("INCONSISTENT_LEGACY_REDUNDANCY", [
        "DATE",
        "SELECTED_DATE",
      ]);
    }
  }
  const date = resolveSalonDate(
    data.selectedDate,
    "customers",
    document.id,
    "selectedDate",
    context,
  );
  const startMinutes = parseStartMinutes(data.startTime);
  const timestamps = operationalTimestamps(
    "customers",
    document.id,
    context.importedAt,
    data.createdAt,
    data.updatedAt,
    context,
  );
  const id = deterministicUuid("customers", document.id);
  let candidate: unknown;

  if (isBlock(data)) {
    const mapping = context.blockDurations.get(document.id);
    if (!mapping) {
      throw new RecordQuarantine("MISSING_BLOCK_DURATION_MAPPING", [
        "BLOCK_DURATION",
      ]);
    }
    const status = blockStatus(data.status);
    candidate = {
      id,
      schemaVersion: 1,
      legacyFirestoreId: document.id,
      importedAt: context.importedAt,
      ...timestamps,
      kind: "block",
      status,
      source: "migration",
      date,
      startMinutes,
      serviceDurationMinutes: mapping.serviceDurationMinutes,
      bufferMinutes: mapping.bufferMinutes,
      createdBy: null,
      version: 1,
      cancelledAt: cancellationInstant(
        status,
        data.cancelledAt,
        timestamps,
        context.importedAt,
      ),
      cancelledBy: status === "cancelled" ? "migration" : null,
      cancellationReason:
        status === "cancelled"
          ? normalizedNullable(data.cancellationReason)
          : null,
      internalNote:
        normalizedNullable(data.internalNote) ?? normalizedNullable(data.note),
    };
  } else {
    const { service, variant } = resolveCatalog(
      data.appointmentType,
      data.variant,
      context,
    );
    const status = appointmentStatus(data.status);
    const clientName = normalizedNullable(data.name);
    if (!clientName) {
      throw new RecordQuarantine("INVALID_CUSTOMER_CONTACT", ["CLIENT_NAME"]);
    }
    candidate = {
      id,
      schemaVersion: 1,
      legacyFirestoreId: document.id,
      importedAt: context.importedAt,
      ...timestamps,
      kind: "appointment",
      status,
      source: "migration",
      date,
      startMinutes,
      serviceDurationMinutes: variant.serviceDurationMinutes,
      bufferMinutes: variant.bufferMinutes,
      createdBy: null,
      version: 1,
      cancelledAt: cancellationInstant(
        status,
        data.cancelledAt,
        timestamps,
        context.importedAt,
      ),
      cancelledBy: status === "cancelled" ? "migration" : null,
      cancellationReason:
        status === "cancelled"
          ? normalizedNullable(data.cancellationReason)
          : null,
      serviceId: service.id,
      variantId: variant.id,
      serviceNameSnapshot: service.nameIt,
      variantNameSnapshot: variant.nameIt,
      priceCentsSnapshot: variant.priceCents,
      currencySnapshot: variant.currency,
      clientName,
      clientEmail: normalizedNullable(data.email)?.toLowerCase() ?? null,
      clientPhone:
        normalizedNullable(data.phone) ?? normalizedNullable(data.number),
      clientNote: normalizedNullable(data.note),
      internalNote: normalizedNullable(data.internalNote),
    };
  }

  const parsed = ScheduleEntryPersistenceSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new RecordQuarantine(
      candidate &&
        typeof candidate === "object" &&
        "kind" in candidate &&
        candidate.kind === "appointment"
        ? "INVALID_CUSTOMER_CONTACT"
        : "INVALID_TARGET_RECORD",
      ["TARGET_SCHEDULE_ENTRY"],
    );
  }
  return importedRecord("customers", document, "schedule_entry", parsed.data);
}
