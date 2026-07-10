import "server-only";

const MAX_CONFIGURED_KEYS = 3;
const SECRET_BYTES = 32;
const BASE64URL_256_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MISSING_DATA_PROPERTY = Symbol("missing-data-property");

export const NEWSLETTER_ACTION_KEY_ID_PATTERN = /^[A-Za-z0-9_]{1,16}$/;

export interface NewsletterActionTokenKeyConfiguration {
  id: string;
  secret: string;
}

export interface NewsletterActionTokenCodecConfiguration {
  keys: readonly NewsletterActionTokenKeyConfiguration[];
}

export interface NewsletterActionTokenKey {
  readonly id: string;
  readonly secret: Buffer;
}

export class NewsletterActionTokenConfigurationError extends Error {
  constructor() {
    super("Newsletter action tokens are not configured");
    this.name = "NewsletterActionTokenConfigurationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function ownDataProperty(
  value: Record<string, unknown>,
  key: string,
): unknown | typeof MISSING_DATA_PROPERTY {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor
    ? descriptor.value
    : MISSING_DATA_PROPERTY;
}

function denseArrayDataValues(
  value: readonly unknown[],
): readonly unknown[] | null {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || !Object.hasOwn(value, "length")) {
    return null;
  }
  const values: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) return null;
    values.push(descriptor.value);
  }
  return values;
}

function decodedSecret(secret: unknown): Buffer {
  if (
    typeof secret !== "string" ||
    !BASE64URL_256_PATTERN.test(secret) ||
    secret.trim() !== secret ||
    secret.includes("\0")
  ) {
    throw new NewsletterActionTokenConfigurationError();
  }

  const decoded = Buffer.from(secret, "base64url");
  if (
    decoded.length !== SECRET_BYTES ||
    decoded.toString("base64url") !== secret
  ) {
    throw new NewsletterActionTokenConfigurationError();
  }
  return Buffer.from(decoded);
}

function decodeKeyring(
  configuration: unknown,
): readonly NewsletterActionTokenKey[] {
  if (!isRecord(configuration) || !hasExactKeys(configuration, ["keys"])) {
    throw new NewsletterActionTokenConfigurationError();
  }
  const configuredKeys = ownDataProperty(configuration, "keys");
  if (
    !Array.isArray(configuredKeys) ||
    configuredKeys.length < 1 ||
    configuredKeys.length > MAX_CONFIGURED_KEYS
  ) {
    throw new NewsletterActionTokenConfigurationError();
  }
  const configuredKeyValues = denseArrayDataValues(configuredKeys);
  if (!configuredKeyValues) throw new NewsletterActionTokenConfigurationError();

  const identifiers = new Set<string>();
  const keys: NewsletterActionTokenKey[] = [];
  for (const candidate of configuredKeyValues) {
    if (!isRecord(candidate) || !hasExactKeys(candidate, ["id", "secret"])) {
      throw new NewsletterActionTokenConfigurationError();
    }
    const id = ownDataProperty(candidate, "id");
    const secret = ownDataProperty(candidate, "secret");
    if (
      typeof id !== "string" ||
      !NEWSLETTER_ACTION_KEY_ID_PATTERN.test(id) ||
      identifiers.has(id) ||
      secret === MISSING_DATA_PROPERTY
    ) {
      throw new NewsletterActionTokenConfigurationError();
    }
    identifiers.add(id);
    keys.push(Object.freeze({ id, secret: decodedSecret(secret) }));
  }
  return Object.freeze(keys);
}

export function decodeNewsletterActionTokenKeyring(
  configuration: unknown,
): readonly NewsletterActionTokenKey[] {
  try {
    return decodeKeyring(configuration);
  } catch {
    throw new NewsletterActionTokenConfigurationError();
  }
}

export function newsletterActionTokenKeyWithId(
  keyring: readonly NewsletterActionTokenKey[],
  keyId: string,
): NewsletterActionTokenKey | null {
  for (let index = 0; index < keyring.length; index += 1) {
    const key = keyring[index];
    if (key?.id === keyId) return key;
  }
  return null;
}
