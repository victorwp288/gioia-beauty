import "server-only";

import { createPaginationCursorCodec } from "./paginationCursor.ts";
import {
  PaginationCursorConfigurationError,
  type PaginationCursorCodecConfiguration,
} from "./paginationCursorKeyring.ts";

const MAX_CONFIGURATION_BYTES = 4 * 1_024;
const LOCAL_TEST_CONFIGURATION: PaginationCursorCodecConfiguration =
  Object.freeze({
    activeKeyId: "local_1",
    keys: Object.freeze([
      Object.freeze({
        id: "local_1",
        secret: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      }),
    ]),
  });

type ServerEnvironment = Readonly<Record<string, string | undefined>>;

function parseConfiguredKeyring(value: string): unknown {
  if (
    value.trim() !== value ||
    value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > MAX_CONFIGURATION_BYTES
  ) {
    throw new PaginationCursorConfigurationError();
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new PaginationCursorConfigurationError();
  }
}

export function createRuntimePaginationCursorCodec(
  env: ServerEnvironment = process.env,
) {
  const configured = env.PAGINATION_CURSOR_KEYRING_JSON;
  if (configured !== undefined) {
    return createPaginationCursorCodec(
      parseConfiguredKeyring(configured) as PaginationCursorCodecConfiguration,
    );
  }
  if (env.APP_ENV === "local" || env.APP_ENV === "test") {
    return createPaginationCursorCodec(LOCAL_TEST_CONFIGURATION);
  }
  throw new PaginationCursorConfigurationError();
}
