import { asBufferMinutes, asDurationMinutes } from "./primitives";
import type { BufferMinutes, DurationMinutes } from "./types";

const CATALOG_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

declare const activeBookingVariantBrand: unique symbol;
declare const blockOccupancyBrand: unique symbol;

export interface ServerResolvedVariantInput {
  readonly serviceId: unknown;
  readonly variantId: unknown;
  readonly serviceActive: unknown;
  readonly variantActive: unknown;
  readonly serviceDurationMinutes: unknown;
  readonly bufferMinutes: unknown;
}

export type ActiveBookingVariant = Readonly<{
  serviceId: string;
  variantId: string;
  serviceDurationMinutes: DurationMinutes;
  bufferMinutes: BufferMinutes;
  active: true;
  [activeBookingVariantBrand]: true;
}>;

export interface BlockOccupancyInput {
  readonly durationMinutes: unknown;
  readonly bufferMinutes: unknown;
}

export type ValidatedBlockOccupancy = Readonly<{
  durationMinutes: DurationMinutes;
  bufferMinutes: BufferMinutes;
  [blockOccupancyBrand]: true;
}>;

function asCatalogId(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length > 100 ||
    !CATALOG_ID_PATTERN.test(value)
  ) {
    throw new RangeError(`${field} must be a stable catalog ID`);
  }
  return value;
}

export function asActiveBookingVariant(
  input: ServerResolvedVariantInput,
): ActiveBookingVariant {
  if (input.serviceActive !== true || input.variantActive !== true) {
    throw new RangeError("booking service and variant must both be active");
  }

  return {
    serviceId: asCatalogId(input.serviceId, "service ID"),
    variantId: asCatalogId(input.variantId, "variant ID"),
    serviceDurationMinutes: asDurationMinutes(input.serviceDurationMinutes),
    bufferMinutes: asBufferMinutes(input.bufferMinutes),
    active: true,
  } as ActiveBookingVariant;
}

export function asValidatedBlockOccupancy(
  input: BlockOccupancyInput,
): ValidatedBlockOccupancy {
  return {
    durationMinutes: asDurationMinutes(input.durationMinutes),
    bufferMinutes: asBufferMinutes(input.bufferMinutes),
  } as ValidatedBlockOccupancy;
}
