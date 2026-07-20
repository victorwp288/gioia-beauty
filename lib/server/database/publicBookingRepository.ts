import "server-only";

import {
  createRuntimeDatabase,
  type DatabaseRow,
  type RuntimeDatabase,
} from "./runtime.ts";
import { authorizeCutoverWrite } from "./cutoverWriteRepository.ts";

export interface AvailabilityDatabaseInput {
  date: string;
  serviceId: string;
  variantId: string;
}

export interface PublicBookingDatabaseInput extends AvailabilityDatabaseInput {
  principalScopeHash: Buffer;
  idempotencyKey: string;
  requestFingerprint: Buffer;
  startMinutes: number;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientNote: string | null;
  canaryToken?: string | null;
}

export interface PublicBookingRepository {
  getAvailability(input: AvailabilityDatabaseInput): Promise<DatabaseRow[]>;
  createBooking(input: PublicBookingDatabaseInput): Promise<DatabaseRow>;
}

const AVAILABILITY_QUERY = `
  select availability.start_minutes
  from gioia_private.get_public_availability(
    $1::date, $2::text, $3::text
  ) as availability
  order by availability.start_minutes
  limit 96
`;

const CREATE_BOOKING_QUERY = `
  select command.http_status, command.result, command.replayed
  from gioia_private.create_public_booking(
    $1::bytea, $2::text, $3::bytea, $4::date, $5::smallint,
    $6::text, $7::text, $8::text, $9::text, $10::text, $11::text
  ) as command
  limit 1
`;

export function createPublicBookingRepository(
  database: Pick<RuntimeDatabase, "transaction"> = createRuntimeDatabase(),
): PublicBookingRepository {
  return {
    getAvailability(input) {
      return database.transaction((transaction) =>
        transaction.unsafe(AVAILABILITY_QUERY, [
          input.date,
          input.serviceId,
          input.variantId,
        ]),
      );
    },

    async createBooking(input) {
      const rows = await database.transaction(async (transaction) => {
        await authorizeCutoverWrite(transaction, {
          operation: "public_booking",
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: input.requestFingerprint,
          canaryToken: input.canaryToken ?? null,
        });
        return transaction.unsafe(CREATE_BOOKING_QUERY, [
          input.principalScopeHash,
          input.idempotencyKey,
          input.requestFingerprint,
          input.date,
          input.startMinutes,
          input.serviceId,
          input.variantId,
          input.clientName,
          input.clientEmail,
          input.clientPhone,
          input.clientNote,
        ]);
      });

      if (rows.length !== 1 || !rows[0]) {
        throw new Error("Unexpected booking command result");
      }
      return rows[0];
    },
  };
}

export const publicBookingRepository = createPublicBookingRepository();
