import "server-only";

import { isCursorTokenKeyId } from "@/lib/domain/schemas/cursors.ts";

import { exactDataObject, exactDenseArray } from "./exactData.ts";

const MAXIMUM_CONFIGURED_KEYS = 3;
const SECRET_BYTES = 32;
const BASE64URL_256_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface PaginationCursorKeyConfiguration {
  id: string;
  secret: string;
}

export interface PaginationCursorCodecConfiguration {
  activeKeyId: string;
  keys: readonly PaginationCursorKeyConfiguration[];
}

export interface PaginationCursorKey {
  readonly id: string;
  readonly secret: Buffer;
}

export interface PaginationCursorKeyring {
  readonly activeKey: PaginationCursorKey;
  readonly keys: readonly PaginationCursorKey[];
}

export class PaginationCursorConfigurationError extends Error {
  constructor() {
    super("Pagination cursors are not configured");
    this.name = "PaginationCursorConfigurationError";
  }
}

function decodedSecret(value: unknown): Buffer | null {
  if (
    typeof value !== "string" ||
    !BASE64URL_256_PATTERN.test(value) ||
    value.trim() !== value ||
    value.includes("\0")
  ) {
    return null;
  }
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === SECRET_BYTES &&
    decoded.toString("base64url") === value
    ? Buffer.from(decoded)
    : null;
}

function decodeKeyring(value: unknown): PaginationCursorKeyring | null {
  const configuration = exactDataObject(value, ["activeKeyId", "keys"]);
  if (!configuration || !isCursorTokenKeyId(configuration.activeKeyId)) {
    return null;
  }
  const configuredKeys = exactDenseArray(
    configuration.keys,
    1,
    MAXIMUM_CONFIGURED_KEYS,
  );
  if (!configuredKeys) return null;

  const identifiers = new Set<string>();
  const keys: PaginationCursorKey[] = [];
  for (const candidate of configuredKeys) {
    const data = exactDataObject(candidate, ["id", "secret"]);
    if (!data || !isCursorTokenKeyId(data.id) || identifiers.has(data.id)) {
      return null;
    }
    const secret = decodedSecret(data.secret);
    if (!secret) return null;
    identifiers.add(data.id);
    Object.defineProperty(keys, String(keys.length), {
      value: Object.freeze({ id: data.id, secret }),
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  const frozenKeys = Object.freeze(keys);
  const activeKey = paginationCursorKeyWithId(
    frozenKeys,
    configuration.activeKeyId,
  );
  return activeKey ? Object.freeze({ activeKey, keys: frozenKeys }) : null;
}

export function decodePaginationCursorKeyring(
  configuration: unknown,
): PaginationCursorKeyring {
  try {
    const keyring = decodeKeyring(configuration);
    if (keyring) return keyring;
  } catch {
    // Collapse every hostile configuration shape to one fixed error.
  }
  throw new PaginationCursorConfigurationError();
}

export function paginationCursorKeyWithId(
  keyring: readonly PaginationCursorKey[],
  keyId: string,
): PaginationCursorKey | null {
  for (let index = 0; index < keyring.length; index += 1) {
    const key = keyring[index];
    if (key?.id === keyId) return key;
  }
  return null;
}
