import "server-only";

import {
  assertOwnerScheduleCountReadRequest,
  type OwnerScheduleCountReadRequest,
} from "./ownerScheduleCountReadContract.ts";
import {
  assertOwnerScheduleExportReadRequest,
  type OwnerScheduleExportReadRequest,
} from "./ownerScheduleExportReadContract.ts";
import {
  assertOwnerScheduleListReadRequest,
  type OwnerScheduleListReadRequest,
} from "./ownerScheduleReadContract.ts";
import {
  exactCountRows,
  unwrapItemRows,
} from "./ownerReadRepositorySupport.ts";
import {
  createRuntimeDatabase,
  type OwnerTransactionIdentity,
  type RuntimeDatabase,
} from "./runtime.ts";

const LIST_QUERY = `
  select result.item
  from gioia_private.list_schedule_as_owner(
    $1::uuid, $2::date, $3::date, $4::text, $5::text[],
    $6::date, $7::smallint, $8::uuid, $9::smallint
  ) as result
  limit $9
`;
const COUNT_QUERY = `
  select result.kind, result.status, result.count
  from gioia_private.count_schedule_as_owner(
    $1::uuid, $2::date, $3::date, $4::text, $5::text[]
  ) as result
  limit 7
`;
const EXPORT_QUERY = `
  select result.item
  from gioia_private.export_schedule_as_owner(
    $1::uuid, $2::date, $3::date, $4::boolean,
    $5::date, $6::smallint, $7::uuid, $8::smallint
  ) as result
  limit $8
`;

export interface OwnerScheduleReadRepository {
  listSchedule(
    identity: OwnerTransactionIdentity,
    request: Readonly<OwnerScheduleListReadRequest>,
  ): Promise<unknown[]>;
  countSchedule(
    identity: OwnerTransactionIdentity,
    request: Readonly<OwnerScheduleCountReadRequest>,
  ): Promise<unknown[]>;
  exportSchedule(
    identity: OwnerTransactionIdentity,
    request: Readonly<OwnerScheduleExportReadRequest>,
  ): Promise<unknown[]>;
}

export function createOwnerScheduleReadRepository(
  database: Pick<RuntimeDatabase, "ownerTransaction"> = createRuntimeDatabase(),
): OwnerScheduleReadRepository {
  return {
    async listSchedule(identity, request) {
      assertOwnerScheduleListReadRequest(request);
      const rows = await database.ownerTransaction(identity, (transaction) =>
        transaction.unsafe(LIST_QUERY, [
          identity.userId,
          request.fromDate,
          request.toDate,
          request.kind,
          request.statuses,
          request.after?.date ?? null,
          request.after?.startMinutes ?? null,
          request.after?.id ?? null,
          request.rowLimit,
        ]),
      );
      return unwrapItemRows(rows, request.rowLimit);
    },

    async countSchedule(identity, request) {
      assertOwnerScheduleCountReadRequest(request);
      const rows = await database.ownerTransaction(identity, (transaction) =>
        transaction.unsafe(COUNT_QUERY, [
          identity.userId,
          request.fromDate,
          request.toDate,
          request.kind,
          request.statuses,
        ]),
      );
      return exactCountRows(rows);
    },

    async exportSchedule(identity, request) {
      assertOwnerScheduleExportReadRequest(request);
      const rows = await database.ownerTransaction(identity, (transaction) =>
        transaction.unsafe(EXPORT_QUERY, [
          identity.userId,
          request.fromDate,
          request.toDate,
          request.includeNotes,
          request.after?.date ?? null,
          request.after?.startMinutes ?? null,
          request.after?.id ?? null,
          request.rowLimit,
        ]),
      );
      return unwrapItemRows(rows, request.rowLimit);
    },
  };
}

export const ownerScheduleReadRepository = createOwnerScheduleReadRepository();
