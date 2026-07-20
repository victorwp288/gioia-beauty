import "server-only";

import { validateEnvironment } from "@/config/environment.mjs";
import { AdminRetryOutboxBodySchema } from "@/lib/domain/schemas/index.ts";

import {
  OWNER_OUTBOX_RETRY_CONTRACT,
  ownerOutboxRetryRepository,
  type OwnerOutboxRetryRepository,
} from "./database/ownerOutboxRetryRepository.ts";
import {
  createNextOwnerCommandRoute,
  type NextOwnerCommandRouteDependencies,
} from "./nextOwnerCommandRoute.ts";
import { apiErrorResponse } from "./publicApiResponse.ts";

export interface NextOwnerOutboxRetryRouteDependencies extends NextOwnerCommandRouteDependencies {
  readonly repository?: OwnerOutboxRetryRepository;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

interface RuntimeValidation {
  readonly ok: boolean;
  readonly appEnv: string | null;
}

export function ownerOutboxRetryRuntimeIsSafe(
  validation: RuntimeValidation,
  emailTransport: string | undefined,
) {
  return (
    validation.ok &&
    validation.appEnv !== null &&
    ["local", "test", "preview"].includes(validation.appEnv) &&
    emailTransport === "fake"
  );
}

function explicitEnvironmentDependenciesAreComplete(
  dependencies: NextOwnerOutboxRetryRouteDependencies,
) {
  return (
    dependencies.env === undefined ||
    (dependencies.repository !== undefined &&
      dependencies.createAuthContext !== undefined &&
      dependencies.getBindingSecret !== undefined)
  );
}

export function createNextOwnerOutboxRetryRoute(
  dependencies: NextOwnerOutboxRetryRouteDependencies = {},
) {
  const {
    repository = ownerOutboxRetryRepository,
    env = process.env,
    ...routeDependencies
  } = dependencies;
  const dependenciesAreBound =
    explicitEnvironmentDependenciesAreComplete(dependencies);
  const ownerRoute = createNextOwnerCommandRoute(
    {
      bodySchema: AdminRetryOutboxBodySchema,
      operation: OWNER_OUTBOX_RETRY_CONTRACT.operation,
      version: OWNER_OUTBOX_RETRY_CONTRACT.fingerprintVersion,
      execute: (identity, command, requestFingerprint, canaryToken) =>
        repository.retryOutbox(
          identity,
          command,
          requestFingerprint,
          canaryToken,
        ),
    },
    routeDependencies,
  );

  return async function POST(request: Request): Promise<Response> {
    if (
      !dependenciesAreBound ||
      !ownerOutboxRetryRuntimeIsSafe(
        validateEnvironment(env),
        env.EMAIL_TRANSPORT,
      )
    ) {
      return apiErrorResponse(503, "SERVICE_UNAVAILABLE");
    }
    return ownerRoute(request);
  };
}
