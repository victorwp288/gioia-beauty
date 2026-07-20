import "server-only";

import {
  assertOwnerOutboxListReadRequest,
  type OwnerOutboxListReadRequest,
} from "./ownerOutboxReadContract.ts";
import {
  assertOwnerSubscriberListReadRequest,
  type OwnerSubscriberListReadRequest,
} from "./ownerSubscriberReadContract.ts";
import {
  assertOwnerVacationListReadRequest,
  type OwnerVacationListReadRequest,
} from "./ownerVacationReadContract.ts";
import {
  unwrapCursorItemRows,
  unwrapItemRows,
} from "./ownerReadRepositorySupport.ts";
import {
  createRuntimeDatabase,
  type OwnerTransactionIdentity,
  type RuntimeDatabase,
} from "./runtime.ts";

const VACATION_QUERY = `
  select result.item
  from gioia_private.list_vacations_as_owner(
    $1::uuid, $2::date, $3::date, $4::date, $5::uuid, $6::smallint
  ) as result
  limit $6
`;
const SUBSCRIBER_QUERY = `
  select result.cursor_created_at, result.item
  from gioia_private.list_newsletter_subscribers_as_owner(
    $1::uuid, $2::text[], $3::timestamptz, $4::uuid, $5::smallint
  ) as result
  limit $5
`;
const OUTBOX_QUERY = `
  select result.cursor_created_at, result.item
  from gioia_private.list_email_outbox_as_owner(
    $1::uuid, $2::text[], $3::timestamptz, $4::uuid, $5::smallint
  ) as result
  limit $5
`;

export interface OwnerOperationsReadRepository {
  listVacations(
    identity: OwnerTransactionIdentity,
    request: Readonly<OwnerVacationListReadRequest>,
  ): Promise<unknown[]>;
  listSubscribers(
    identity: OwnerTransactionIdentity,
    request: Readonly<OwnerSubscriberListReadRequest>,
  ): Promise<unknown[]>;
  listOutbox(
    identity: OwnerTransactionIdentity,
    request: Readonly<OwnerOutboxListReadRequest>,
  ): Promise<unknown[]>;
}

export function createOwnerOperationsReadRepository(
  database: Pick<RuntimeDatabase, "ownerTransaction"> = createRuntimeDatabase(),
): OwnerOperationsReadRepository {
  return {
    async listVacations(identity, request) {
      assertOwnerVacationListReadRequest(request);
      const rows = await database.ownerTransaction(identity, (transaction) =>
        transaction.unsafe(VACATION_QUERY, [
          identity.userId,
          request.fromDate,
          request.toDate,
          request.after?.startDate ?? null,
          request.after?.id ?? null,
          request.rowLimit,
        ]),
      );
      return unwrapItemRows(rows, request.rowLimit);
    },

    async listSubscribers(identity, request) {
      assertOwnerSubscriberListReadRequest(request);
      const rows = await database.ownerTransaction(identity, (transaction) =>
        transaction.unsafe(SUBSCRIBER_QUERY, [
          identity.userId,
          request.statuses,
          request.after?.createdAt ?? null,
          request.after?.id ?? null,
          request.rowLimit,
        ]),
      );
      return unwrapCursorItemRows(rows, request.rowLimit);
    },

    async listOutbox(identity, request) {
      assertOwnerOutboxListReadRequest(request);
      const rows = await database.ownerTransaction(identity, (transaction) =>
        transaction.unsafe(OUTBOX_QUERY, [
          identity.userId,
          request.statuses,
          request.after?.createdAt ?? null,
          request.after?.id ?? null,
          request.rowLimit,
        ]),
      );
      return unwrapCursorItemRows(rows, request.rowLimit);
    },
  };
}

export const ownerOperationsReadRepository =
  createOwnerOperationsReadRepository();
