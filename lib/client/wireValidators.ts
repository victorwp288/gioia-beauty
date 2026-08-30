import { asSalonDate } from "@/lib/domain/booking/primitives.ts";
import type {
  CommandResultResponse,
  PublicAvailabilityResponse,
  PublicNonEnumeratingAcceptedResponse,
} from "@/lib/domain/schemas/responses.ts";

type SafeParseResult<T> =
  { success: true; data: T } | { success: false; data?: never };

export type WireValidator<T> = {
  safeParse(value: unknown): SafeParseResult<T>;
};

type JsonRecord = Record<string, unknown>;

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function validator<T>(parse: (value: unknown) => T | null): WireValidator<T> {
  return {
    safeParse(value) {
      try {
        const data = parse(value);
        return data === null ? { success: false } : { success: true, data };
      } catch {
        return { success: false };
      }
    },
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATALOG_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

function parseUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function parseCatalogId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length <= 100 && CATALOG_ID_PATTERN.test(normalized)
    ? normalized
    : null;
}

function parseErrorCode(value: unknown): string | null {
  return typeof value === "string" && ERROR_CODE_PATTERN.test(value)
    ? value
    : null;
}

export const ApiErrorResponseWire = validator<{
  code: string;
  requestId: string;
}>((value) => {
  if (!isExactRecord(value, ["code", "requestId"])) return null;
  const code = parseErrorCode(value.code);
  const requestId = parseUuid(value.requestId);
  return code && requestId ? { code, requestId } : null;
});

export const CommandResultResponseWire = validator<CommandResultResponse>(
  (value) => {
    if (!isExactRecord(value, ["code", "resourceId", "replayed"])) {
      return null;
    }
    const code = parseErrorCode(value.code);
    const resourceId = parseUuid(value.resourceId);
    if (!code || !resourceId || typeof value.replayed !== "boolean") {
      return null;
    }
    return {
      code,
      resourceId,
      replayed: value.replayed,
    } as CommandResultResponse;
  },
);

export const PublicAvailabilityResponseWire =
  validator<PublicAvailabilityResponse>((value) => {
    if (!isExactRecord(value, ["date", "serviceId", "variantId", "slots"])) {
      return null;
    }
    if (!Array.isArray(value.slots) || value.slots.length > 96) return null;

    const date = asSalonDate(value.date);
    const serviceId = parseCatalogId(value.serviceId);
    const variantId = parseCatalogId(value.variantId);
    if (!serviceId || !variantId) return null;

    let previous = -1;
    for (const slot of value.slots) {
      if (
        typeof slot !== "number" ||
        !Number.isInteger(slot) ||
        slot < 0 ||
        slot > 1_439 ||
        slot % 15 !== 0 ||
        slot <= previous
      ) {
        return null;
      }
      previous = slot;
    }
    return {
      date,
      serviceId,
      variantId,
      slots: value.slots,
    } as PublicAvailabilityResponse;
  });

export const PublicNonEnumeratingAcceptedResponseWire =
  validator<PublicNonEnumeratingAcceptedResponse>((value) =>
    isExactRecord(value, ["code"]) && value.code === "REQUEST_ACCEPTED"
      ? { code: "REQUEST_ACCEPTED" }
      : null,
  );

export type MaintenanceStatus = {
  code: "MAINTENANCE_STATUS";
  publicBookingEnabled: boolean;
  ownerMutationsEnabled: boolean;
  messageCode:
    "OPERATIONS_OPEN" | "MAINTENANCE_ACTIVE" | "OWNER_RECONCILIATION_ACTIVE";
};

const MAINTENANCE_MESSAGE_CODES = new Set<MaintenanceStatus["messageCode"]>([
  "OPERATIONS_OPEN",
  "MAINTENANCE_ACTIVE",
  "OWNER_RECONCILIATION_ACTIVE",
]);

export const MaintenanceStatusWire = validator<MaintenanceStatus>((value) => {
  if (
    !isExactRecord(value, [
      "code",
      "publicBookingEnabled",
      "ownerMutationsEnabled",
      "messageCode",
    ]) ||
    value.code !== "MAINTENANCE_STATUS" ||
    typeof value.publicBookingEnabled !== "boolean" ||
    typeof value.ownerMutationsEnabled !== "boolean" ||
    typeof value.messageCode !== "string" ||
    !MAINTENANCE_MESSAGE_CODES.has(
      value.messageCode as MaintenanceStatus["messageCode"],
    )
  ) {
    return null;
  }
  return value as MaintenanceStatus;
});
