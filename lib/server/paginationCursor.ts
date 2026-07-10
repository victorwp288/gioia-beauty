import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import {
  CURSOR_TOKEN_LIFETIME_MILLISECONDS,
  CursorFilterFingerprintSchema,
  MAXIMUM_CURSOR_TOKEN_WIRE_LENGTH,
  PaginationCursorScopeSchema,
  safeParsePaginationCursorTokenWire,
  type PaginationCursorPayload,
  type PaginationCursorPositionInput,
  type PaginationCursorScope,
  type PaginationCursorTokenWire,
} from "@/lib/domain/schemas/cursors.ts";

import { exactDataObject, exactDate } from "./exactData.ts";
import {
  decodePaginationCursorKeyring,
  paginationCursorKeyWithId,
  type PaginationCursorCodecConfiguration,
} from "./paginationCursorKeyring.ts";
import {
  buildPaginationCursorPayload,
  canonicalPaginationCursorPayload,
  encodePaginationCursorPayload,
  isPaginationCursorPageSizeValid,
  isPaginationCursorTimeValid,
  parseCanonicalPaginationCursorPayload,
  parseExactPaginationCursorPosition,
} from "./paginationCursorPayload.ts";

export {
  PaginationCursorConfigurationError,
  type PaginationCursorCodecConfiguration,
  type PaginationCursorKeyConfiguration,
} from "./paginationCursorKeyring.ts";

const MAC_CONTEXT = "gioia:pagination-cursor:v1\0";
const SIGNATURE_BYTES = 32;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
declare const authenticatedPaginationCursorBrand: unique symbol;

export interface IssuePaginationCursorInput {
  readonly position: PaginationCursorPositionInput;
  readonly filterFingerprint: string;
  readonly pageSize: number;
  readonly now: Date;
}

export interface VerifyPaginationCursorInput {
  readonly token: unknown;
  readonly expectedScope: PaginationCursorScope;
  readonly filterFingerprint: string;
  readonly pageSize: number;
  readonly now: Date;
}

export type AuthenticatedPaginationCursor =
  Readonly<PaginationCursorPayload> & {
    readonly [authenticatedPaginationCursorBrand]: true;
  };

export type PaginationCursorVerification =
  | Readonly<{ ok: true; cursor: AuthenticatedPaginationCursor }>
  | Readonly<{ ok: false; code: "INVALID_CURSOR" }>;

export interface PaginationCursorCodec {
  issue(input: IssuePaginationCursorInput): PaginationCursorTokenWire;
  verify(input: VerifyPaginationCursorInput): PaginationCursorVerification;
}

export class PaginationCursorInputError extends Error {
  constructor() {
    super("Pagination cursor input is invalid");
    this.name = "PaginationCursorInputError";
  }
}

const INVALID_CURSOR = Object.freeze({
  ok: false as const,
  code: "INVALID_CURSOR" as const,
});

function signature(header: string, payload: string, secret: Buffer): Buffer {
  return createHmac("sha256", secret)
    .update(`${MAC_CONTEXT}${header}.${payload}`, "utf8")
    .digest();
}

function decodedSignature(value: string): Buffer | null {
  if (!SIGNATURE_PATTERN.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === SIGNATURE_BYTES &&
    decoded.toString("base64url") === value
    ? decoded
    : null;
}

function issueToken(
  input: IssuePaginationCursorInput,
  keyring: ReturnType<typeof decodePaginationCursorKeyring>,
): PaginationCursorTokenWire {
  const snapshot = exactDataObject(input, [
    "position",
    "filterFingerprint",
    "pageSize",
    "now",
  ]);
  if (!snapshot) throw new PaginationCursorInputError();
  const position = parseExactPaginationCursorPosition(snapshot.position);
  const fingerprint = CursorFilterFingerprintSchema.safeParse(
    snapshot.filterFingerprint,
  );
  const now = exactDate(snapshot.now);
  if (
    !position ||
    !fingerprint.success ||
    !isPaginationCursorPageSizeValid(position.scope, snapshot.pageSize) ||
    !now
  ) {
    throw new PaginationCursorInputError();
  }
  const payloadClaims = buildPaginationCursorPayload(
    position,
    fingerprint.data,
    snapshot.pageSize,
    now.toISOString(),
    new Date(now.getTime() + CURSOR_TOKEN_LIFETIME_MILLISECONDS).toISOString(),
  );
  if (!payloadClaims) throw new PaginationCursorInputError();
  const payload = encodePaginationCursorPayload(payloadClaims);
  const header = `c1-${keyring.activeKey.id}`;
  const tag = signature(header, payload, keyring.activeKey.secret).toString(
    "base64url",
  );
  const token = `${header}.${payload}.${tag}`;
  if (token.length > MAXIMUM_CURSOR_TOKEN_WIRE_LENGTH) {
    throw new PaginationCursorInputError();
  }
  const wire = safeParsePaginationCursorTokenWire(token);
  if (!wire) throw new PaginationCursorInputError();
  return wire.token;
}

function verifyToken(
  input: VerifyPaginationCursorInput,
  keyring: ReturnType<typeof decodePaginationCursorKeyring>,
): PaginationCursorVerification {
  const snapshot = exactDataObject(input, [
    "token",
    "expectedScope",
    "filterFingerprint",
    "pageSize",
    "now",
  ]);
  if (!snapshot) return INVALID_CURSOR;
  const expectedScope = PaginationCursorScopeSchema.safeParse(
    snapshot.expectedScope,
  );
  const fingerprint = CursorFilterFingerprintSchema.safeParse(
    snapshot.filterFingerprint,
  );
  const now = exactDate(snapshot.now);
  if (
    !expectedScope.success ||
    !fingerprint.success ||
    !isPaginationCursorPageSizeValid(expectedScope.data, snapshot.pageSize) ||
    !now
  ) {
    return INVALID_CURSOR;
  }
  const wire = safeParsePaginationCursorTokenWire(snapshot.token);
  if (!wire) return INVALID_CURSOR;
  const actual = decodedSignature(wire.encodedSignature);
  const key = paginationCursorKeyWithId(keyring.keys, wire.keyId);
  if (!actual || !key) return INVALID_CURSOR;
  const expected = signature(wire.header, wire.encodedPayload, key.secret);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return INVALID_CURSOR;
  }
  const payload = parseCanonicalPaginationCursorPayload(wire.encodedPayload);
  if (
    !payload ||
    !isPaginationCursorTimeValid(payload, now) ||
    payload.scope !== expectedScope.data ||
    payload.filterFingerprint !== fingerprint.data ||
    payload.pageSize !== snapshot.pageSize
  ) {
    return INVALID_CURSOR;
  }
  const cursor = canonicalPaginationCursorPayload(
    payload,
  ) as AuthenticatedPaginationCursor;
  return Object.freeze({ ok: true as const, cursor });
}

/**
 * Authenticates a bounded keyset position and its exact query context. Cursors
 * are intentionally replayable until expiry and provide no authorization or
 * confidentiality; callers must authorize the owner and keep PII out of them.
 */
export function createPaginationCursorCodec(
  configuration: PaginationCursorCodecConfiguration,
): Readonly<PaginationCursorCodec> {
  const keyring = decodePaginationCursorKeyring(configuration);
  return Object.freeze({
    issue(input: IssuePaginationCursorInput): PaginationCursorTokenWire {
      try {
        return issueToken(input, keyring);
      } catch {
        throw new PaginationCursorInputError();
      }
    },
    verify(input: VerifyPaginationCursorInput): PaginationCursorVerification {
      try {
        return verifyToken(input, keyring);
      } catch {
        return INVALID_CURSOR;
      }
    },
  });
}
