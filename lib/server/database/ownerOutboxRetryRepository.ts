import "server-only";

import { AdminRetryOutboxCommandSchema } from "@/lib/domain/schemas/index.ts";

import {
  ownerCommandFailureKey,
  type OwnerCommandContract,
} from "./ownerScheduleCommandContracts.ts";
import {
  executeOwnerCommand,
  parseOwnerCommandContext,
  parsePostgresVersion,
  type OwnerCommandResult,
} from "./ownerScheduleRepositorySupport.ts";
import {
  createRuntimeDatabase,
  type OwnerTransactionIdentity,
  type RuntimeDatabase,
} from "./runtime.ts";

export const OWNER_OUTBOX_RETRY_CONTRACT = Object.freeze({
  operation: "owner_outbox_retry",
  fingerprintVersion: 1,
  query: `
    select command.http_status, command.result, command.replayed
    from gioia_private.retry_email_outbox_as_owner(
      $1::uuid, $2::text, $3::bytea, $4::uuid, $5::integer
    ) as command
    limit 2
  `,
  httpStatus: 200,
  code: "OUTBOX_RETRY_SCHEDULED",
  failures: Object.freeze([
    ownerCommandFailureKey(409, "OUTBOX_RETRY_CONFLICT"),
  ]),
} satisfies OwnerCommandContract);

export interface OwnerOutboxRetryRepository {
  retryOutbox(
    identity: OwnerTransactionIdentity,
    command: unknown,
    requestFingerprint: Buffer,
  ): Promise<OwnerCommandResult>;
}

export function createOwnerOutboxRetryRepository(
  database: Pick<RuntimeDatabase, "ownerTransaction"> = createRuntimeDatabase(),
): OwnerOutboxRetryRepository {
  return {
    async retryOutbox(identityInput, commandInput, fingerprintInput) {
      const { identity, requestFingerprint } = parseOwnerCommandContext(
        identityInput,
        fingerprintInput,
      );
      const command = AdminRetryOutboxCommandSchema.parse(commandInput);
      const expectedVersion = parsePostgresVersion(command.expectedVersion);
      return executeOwnerCommand(
        database,
        identity,
        [
          identity.userId,
          command.idempotencyKey,
          requestFingerprint,
          command.outboxId,
          expectedVersion,
        ],
        {
          ...OWNER_OUTBOX_RETRY_CONTRACT,
          resourceId: command.outboxId,
        },
      );
    },
  };
}

export const ownerOutboxRetryRepository = createOwnerOutboxRetryRepository();
