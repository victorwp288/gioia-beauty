import "server-only";

import { X509Certificate } from "node:crypto";

import postgres from "postgres";

export type DatabaseRow = Record<string, unknown>;

export interface RuntimeTransaction {
  unsafe(
    query: string,
    parameters?: readonly unknown[],
  ): Promise<DatabaseRow[]>;
}

export interface RuntimeSqlClient {
  begin<T>(work: (transaction: RuntimeTransaction) => Promise<T>): Promise<T>;
}

export interface RuntimeDatabase {
  transaction<T>(
    work: (transaction: RuntimeTransaction) => Promise<T>,
  ): Promise<T>;
  ownerTransaction<T>(
    identity: OwnerTransactionIdentity,
    work: (transaction: RuntimeTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface OwnerTransactionIdentity {
  userId: string;
  sessionId: string;
}

export interface RuntimeDatabaseOptions {
  env?: Readonly<Record<string, string | undefined>>;
  client?: RuntimeSqlClient;
  clientFactory?: (
    databaseUrl: string,
    options: {
      prepare: false;
      max: number;
      idle_timeout: number;
      connect_timeout: number;
      max_lifetime: number;
      debug: false;
      onnotice: () => void;
      connection: { application_name: string };
      ssl?: { ca: string; rejectUnauthorized: true };
    },
  ) => RuntimeSqlClient;
}

export class DatabaseConfigurationError extends Error {
  constructor() {
    super("Database is not configured");
    this.name = "DatabaseConfigurationError";
  }
}

export class DatabaseAuthorizationContextError extends Error {
  constructor() {
    super("Database authorization context is invalid");
    this.name = "DatabaseAuthorizationContextError";
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPABASE_CA_FINGERPRINT =
  "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA";

function requireOwnerIdentity(
  identity: OwnerTransactionIdentity,
): OwnerTransactionIdentity {
  if (!UUID.test(identity.userId) || !UUID.test(identity.sessionId)) {
    throw new DatabaseAuthorizationContextError();
  }
  return identity;
}

function requireDatabaseUrl(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const value = env.SUPABASE_DATABASE_URL;
  if (!value || value.trim() !== value) throw new DatabaseConfigurationError();

  try {
    const url = new URL(value);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      !url.pathname.slice(1)
    ) {
      throw new DatabaseConfigurationError();
    }
  } catch {
    throw new DatabaseConfigurationError();
  }

  return value;
}

function remoteDatabaseTls(
  env: Readonly<Record<string, string | undefined>>,
  databaseUrl: string,
): { ca: string; rejectUnauthorized: true } | undefined {
  const url = new URL(databaseUrl);
  if (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]"
  ) {
    return undefined;
  }
  const source = env.SUPABASE_DATABASE_CA_CERTIFICATE;
  try {
    if (
      typeof source !== "string" ||
      url.searchParams.get("sslmode") !== "verify-full"
    ) {
      throw new Error();
    }
    const certificate = new X509Certificate(source);
    if (
      !certificate.ca ||
      source !== certificate.toString() ||
      certificate.fingerprint256 !== SUPABASE_CA_FINGERPRINT ||
      Date.parse(certificate.validFrom) > Date.now() ||
      Date.parse(certificate.validTo) <= Date.now()
    ) {
      throw new Error();
    }
    return { ca: source, rejectUnauthorized: true };
  } catch {
    throw new DatabaseConfigurationError();
  }
}

const defaultClientFactory = postgres as unknown as NonNullable<
  RuntimeDatabaseOptions["clientFactory"]
>;

export function createRuntimeDatabase({
  env = process.env,
  client,
  clientFactory = defaultClientFactory,
}: RuntimeDatabaseOptions = {}): RuntimeDatabase {
  let lazyClient = client;

  function getClient(): RuntimeSqlClient {
    if (!lazyClient) {
      const databaseUrl = requireDatabaseUrl(env);
      const ssl = remoteDatabaseTls(env, databaseUrl);
      lazyClient = clientFactory(databaseUrl, {
        prepare: false,
        max: 2,
        idle_timeout: 20,
        connect_timeout: 5,
        max_lifetime: 60,
        debug: false,
        onnotice: () => {},
        connection: { application_name: "gioia_public_api" },
        ...(ssl ? { ssl } : {}),
      });
    }
    return lazyClient;
  }

  async function transactionWithAuthContext<T>(
    actorUserId: string,
    sessionId: string,
    work: (transaction: RuntimeTransaction) => Promise<T>,
  ): Promise<T> {
    return getClient().begin(async (transaction) => {
      await transaction.unsafe("set local role app_runtime");
      await transaction.unsafe(
        "select set_config('request.jwt.claim.sub', $1, true), " +
          "set_config('request.jwt.claim.session_id', $2, true), " +
          "set_config('request.jwt.claims', '{}', true), " +
          "set_config('statement_timeout', '8000', true), " +
          "set_config('lock_timeout', '3000', true)",
        [actorUserId, sessionId],
      );
      return work(transaction);
    });
  }

  return {
    async transaction<T>(
      work: (transaction: RuntimeTransaction) => Promise<T>,
    ): Promise<T> {
      return await transactionWithAuthContext("", "", work);
    },
    async ownerTransaction<T>(
      identity: OwnerTransactionIdentity,
      work: (transaction: RuntimeTransaction) => Promise<T>,
    ): Promise<T> {
      const verifiedIdentity = requireOwnerIdentity(identity);
      return await transactionWithAuthContext(
        verifiedIdentity.userId,
        verifiedIdentity.sessionId,
        work,
      );
    },
  };
}
