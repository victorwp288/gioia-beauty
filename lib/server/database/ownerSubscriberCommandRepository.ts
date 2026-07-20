import "server-only";

import { AdminUnsubscribeSubscriberCommandSchema } from "@/lib/domain/schemas/index.ts";

import { OWNER_SUBSCRIBER_UNSUBSCRIBE_CONTRACT } from "./ownerScheduleCommandContracts.ts";
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

export interface OwnerSubscriberCommandRepository {
  unsubscribeSubscriber(
    identity: OwnerTransactionIdentity,
    command: unknown,
    requestFingerprint: Buffer,
    canaryToken?: string | null,
  ): Promise<OwnerCommandResult>;
}

export function createOwnerSubscriberCommandRepository(
  database: Pick<RuntimeDatabase, "ownerTransaction"> = createRuntimeDatabase(),
): OwnerSubscriberCommandRepository {
  return {
    async unsubscribeSubscriber(
      identityInput,
      commandInput,
      fingerprintInput,
      canaryToken = null,
    ) {
      const { identity, requestFingerprint } = parseOwnerCommandContext(
        identityInput,
        fingerprintInput,
      );
      const command =
        AdminUnsubscribeSubscriberCommandSchema.parse(commandInput);
      const expectedVersion = parsePostgresVersion(command.expectedVersion);
      return executeOwnerCommand(
        database,
        identity,
        [
          identity.userId,
          command.idempotencyKey,
          requestFingerprint,
          command.subscriberId,
          expectedVersion,
        ],
        {
          ...OWNER_SUBSCRIBER_UNSUBSCRIBE_CONTRACT,
          resourceId: command.subscriberId,
        },
        canaryToken,
      );
    },
  };
}

export const ownerSubscriberCommandRepository =
  createOwnerSubscriberCommandRepository();
