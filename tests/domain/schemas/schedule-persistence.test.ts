import { describe, expect, it } from "vitest";

import {
  AdminAppointmentDtoSchema,
  AppointmentPersistenceSchema,
  BlockPersistenceSchema,
} from "@/lib/domain/schemas/index.ts";

const ENTRY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CREATED_AT = "2026-07-09T10:00:00Z";

const PUBLIC_APPOINTMENT = {
  id: ENTRY_ID,
  schemaVersion: 1,
  kind: "appointment" as const,
  status: "confirmed" as const,
  source: "public" as const,
  date: "2026-08-10",
  startMinutes: 600,
  serviceDurationMinutes: 60,
  bufferMinutes: 15,
  serviceId: "massaggio-relax",
  variantId: "massaggio-relax-60",
  serviceNameSnapshot: "Massaggio relax",
  variantNameSnapshot: "60 minuti",
  priceCentsSnapshot: null,
  currencySnapshot: null,
  clientName: "Maria Rossi",
  clientEmail: "maria@example.com",
  clientPhone: "+393331234567",
  clientNote: null,
  internalNote: null,
  createdBy: null,
  legacyFirestoreId: null,
  timestampProvenance: "source" as const,
  importedAt: null,
  cancelledAt: null,
  cancelledBy: null,
  cancellationReason: null,
  version: 1,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

describe("schedule persistence schemas", () => {
  it("validates the complete public persistence shape", () => {
    expect(
      AppointmentPersistenceSchema.parse(PUBLIC_APPOINTMENT),
    ).toMatchObject({
      clientEmail: "maria@example.com",
      legacyFirestoreId: null,
    });
    expect(
      AppointmentPersistenceSchema.safeParse({
        ...PUBLIC_APPOINTMENT,
        clientEmail: null,
      }).success,
    ).toBe(false);
    expect(
      AppointmentPersistenceSchema.safeParse({
        ...PUBLIC_APPOINTMENT,
        internalNote: "Not allowed on public writes",
      }).success,
    ).toBe(false);
  });

  it("uses the SQL cancellation actor vocabulary", () => {
    const cancelled = {
      ...PUBLIC_APPOINTMENT,
      source: "admin" as const,
      status: "cancelled" as const,
      createdBy: OWNER_ID,
      cancelledAt: "2026-07-10T10:00:00Z",
      cancelledBy: "admin" as const,
      cancellationReason: "Richiesta cliente",
      updatedAt: "2026-07-10T10:00:00Z",
    };
    expect(AppointmentPersistenceSchema.safeParse(cancelled).success).toBe(
      true,
    );
    for (const staleActor of ["owner", "customer"]) {
      expect(
        AppointmentPersistenceSchema.safeParse({
          ...cancelled,
          cancelledBy: staleActor,
        }).success,
      ).toBe(false);
    }
  });

  it("requires complete migration provenance and ordered timestamps", () => {
    const migrated = {
      ...PUBLIC_APPOINTMENT,
      source: "migration" as const,
      legacyFirestoreId: "legacy-42",
      importedAt: "2026-07-09T11:00:00Z",
    };
    expect(AppointmentPersistenceSchema.safeParse(migrated).success).toBe(true);
    expect(
      AppointmentPersistenceSchema.safeParse({
        ...migrated,
        legacyFirestoreId: null,
      }).success,
    ).toBe(false);
    expect(
      AppointmentPersistenceSchema.safeParse({
        ...migrated,
        updatedAt: "2026-07-09T09:59:59Z",
      }).success,
    ).toBe(false);
  });

  it("keeps blocks structurally separate from appointments", () => {
    const block = {
      id: ENTRY_ID,
      schemaVersion: 1,
      kind: "block" as const,
      status: "active" as const,
      source: "admin" as const,
      date: "2026-08-10",
      startMinutes: 600,
      serviceDurationMinutes: 60,
      bufferMinutes: 0,
      internalNote: "Riunione",
      createdBy: OWNER_ID,
      legacyFirestoreId: null,
      timestampProvenance: "source" as const,
      importedAt: null,
      cancelledAt: null,
      cancelledBy: null,
      cancellationReason: null,
      version: 1,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    };
    expect(BlockPersistenceSchema.safeParse(block).success).toBe(true);
    expect(
      BlockPersistenceSchema.safeParse({
        ...block,
        clientEmail: "maria@example.com",
      }).success,
    ).toBe(false);
  });

  it("keeps admin DTOs free of migration-only fields", () => {
    const {
      createdBy: _createdBy,
      importedAt: _importedAt,
      ...candidate
    } = PUBLIC_APPOINTMENT;
    const {
      legacyFirestoreId: _legacyFirestoreId,
      timestampProvenance: _timestampProvenance,
      ...dto
    } = candidate;
    expect(AdminAppointmentDtoSchema.safeParse(dto).success).toBe(true);
    expect(
      AdminAppointmentDtoSchema.safeParse(PUBLIC_APPOINTMENT).success,
    ).toBe(false);
  });
});
