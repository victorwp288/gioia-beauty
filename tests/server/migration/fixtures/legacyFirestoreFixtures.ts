import type {
  LegacyFirestoreBatch,
  LegacyFirestoreTransformOptions,
} from "@/lib/server/migration/legacyFirestoreTransform.ts";

export const IMPORTED_AT = "2026-02-10T08:30:00.000Z";

export const SERIALIZED_FIRESTORE_TIMESTAMP = Object.freeze({
  seconds: 1_768_435_200,
  nanoseconds: 0,
});

const appointment = (
  id: string,
  selectedDate: unknown,
): LegacyFirestoreBatch["customers"][number] => ({
  id,
  data: {
    name: "Maria Rossi",
    email: " Maria.Rossi@Example.com ",
    number: "+39 333 1234567",
    appointmentType: "Manicure",
    variant: "30",
    selectedDate,
    startTime: "14:30",
    endTime: "23:59",
    duration: 477,
    totalDuration: 479,
    note: "Preferenza sintetica",
    status: "confirmed",
    isTimeBlock: false,
    createdAt: "2025-11-03T09:12:44.120Z",
    updatedAt: "2025-11-03T10:00:00.000Z",
  },
});

export function legacyFirestoreFixture(): LegacyFirestoreBatch {
  return {
    importedAt: IMPORTED_AT,
    customers: [
      appointment("appointment-date", "2026-01-14"),
      appointment("appointment-iso", "2026-01-15T00:00:00.000Z"),
      appointment("appointment-timestamp", SERIALIZED_FIRESTORE_TIMESTAMP),
      {
        id: "appointment-redundant-fields",
        data: {
          name: "Cliente sintetico",
          email: "synthetic@example.com",
          phone: "+39 333 7654321",
          appointmentType: "Manicure",
          variant: "30",
          selectedDate: "2026-01-17",
          date: SERIALIZED_FIRESTORE_TIMESTAMP,
          startTime: "09:30",
          timeSlot: "09:30",
          duration: 30,
          totalDuration: 35,
          isSubscribedToNewsletter: true,
        },
      },
      {
        id: "block-legacy",
        data: {
          name: "Blocco Orario",
          appointmentType: "Blocco Orario",
          selectedDate: "2026-01-16",
          startTime: "11:00",
          endTime: "17:00",
          duration: 999,
          totalDuration: 999,
          note: "Formazione sintetica",
          status: "confirmed",
        },
      },
    ],
    vacations: [
      {
        id: "vacation-timestamp",
        data: {
          startDate: SERIALIZED_FIRESTORE_TIMESTAMP,
          endDate: { _seconds: 1_768_435_200, _nanoseconds: 0 },
          reason: "Chiusura sintetica",
        },
      },
    ],
    newsletterSubscribers: [
      {
        id: "subscriber-active",
        data: {
          email: " Newsletter@Example.com ",
          status: "active",
          subscribed_at: "2025-11-03T09:12:44.120Z",
          updatedAt: "2025-11-03T10:00:00.000Z",
          source: "website",
        },
      },
      {
        id: "subscriber-unsubscribed",
        data: {
          email: "former@example.com",
          status: "unsubscribed",
          createdAt: "2025-11-03T09:12:44.120Z",
          updatedAt: "2025-11-03T10:00:00.000Z",
          unsubscribedAt: "2025-11-03T10:00:00.000Z",
          statusReason: "User request",
        },
      },
    ],
  };
}

export function legacyTransformOptions(): LegacyFirestoreTransformOptions {
  return {
    timestampDateResolutions: [
      {
        collection: "customers",
        sourceId: "appointment-timestamp",
        field: "selectedDate",
        salonDate: "2026-01-15",
      },
      {
        collection: "vacations",
        sourceId: "vacation-timestamp",
        field: "startDate",
        salonDate: "2026-01-15",
      },
      {
        collection: "vacations",
        sourceId: "vacation-timestamp",
        field: "endDate",
        salonDate: "2026-01-15",
      },
    ],
    blockDurationMappings: [
      {
        sourceId: "block-legacy",
        serviceDurationMinutes: 90,
        bufferMinutes: 0,
      },
    ],
    trustedTimestampRecords: [
      { collection: "customers", sourceId: "appointment-date" },
      {
        collection: "newsletter_subscribers",
        sourceId: "subscriber-unsubscribed",
      },
    ],
  };
}
