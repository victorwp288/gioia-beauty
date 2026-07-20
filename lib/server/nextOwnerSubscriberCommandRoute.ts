import "server-only";

import { AdminUnsubscribeSubscriberBodySchema } from "@/lib/domain/schemas/index.ts";

import {
  ownerSubscriberCommandRepository,
  type OwnerSubscriberCommandRepository,
} from "./database/ownerSubscriberCommandRepository.ts";
import { OWNER_SUBSCRIBER_UNSUBSCRIBE_CONTRACT } from "./database/ownerScheduleCommandContracts.ts";
import {
  createNextOwnerCommandRoute,
  type NextOwnerCommandRouteDependencies,
} from "./nextOwnerCommandRoute.ts";

export interface NextOwnerSubscriberCommandRouteDependencies extends NextOwnerCommandRouteDependencies {
  readonly repository?: OwnerSubscriberCommandRepository;
}

export function createNextOwnerSubscriberUnsubscribeRoute(
  dependencies: NextOwnerSubscriberCommandRouteDependencies = {},
) {
  const {
    repository = ownerSubscriberCommandRepository,
    ...routeDependencies
  } = dependencies;
  return createNextOwnerCommandRoute(
    {
      bodySchema: AdminUnsubscribeSubscriberBodySchema,
      operation: OWNER_SUBSCRIBER_UNSUBSCRIBE_CONTRACT.operation,
      version: OWNER_SUBSCRIBER_UNSUBSCRIBE_CONTRACT.fingerprintVersion,
      execute: (identity, command, requestFingerprint, canaryToken) =>
        repository.unsubscribeSubscriber(
          identity,
          command,
          requestFingerprint,
          canaryToken,
        ),
    },
    routeDependencies,
  );
}
