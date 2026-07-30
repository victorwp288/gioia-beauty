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

export type DatabaseRuntimeFailureStage = "connection" | "query";
export type DatabaseRuntimeFailureReason =
  "authentication" | "network" | "provider" | "tls" | "unknown";

export class DatabaseRuntimeError extends Error {
  readonly stage: DatabaseRuntimeFailureStage;
  readonly reason: DatabaseRuntimeFailureReason;

  constructor(
    stage: DatabaseRuntimeFailureStage,
    reason: DatabaseRuntimeFailureReason,
  ) {
    super("Database runtime failed");
    this.name = "DatabaseRuntimeError";
    this.stage = stage;
    this.reason = reason;
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPABASE_CA_FINGERPRINT =
  "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA";
const RUNTIME_LOGIN_ROLE = "app_runtime";
const RUNTIME_PROJECT_REF = "hzibzwhrwmljgjjdzspi";
const RUNTIME_POOLER_HOST = "aws-1-eu-central-2.pooler.supabase.com";

function classifyRuntimeFailure(error: unknown): DatabaseRuntimeFailureReason {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code).toUpperCase()
      : "";
  if (code === "28P01") return "authentication";
  if (
    ["08006", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT"].includes(
      code,
    )
  ) {
    return "network";
  }
  if (code === "EDBHANDLEREXITED") return "provider";
  if (code.startsWith("ERR_TLS_") || code.startsWith("CERT_")) return "tls";
  return "unknown";
}

function isLoopbackHostname(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

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
    const isLoopback = isLoopbackHostname(url.hostname);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      !url.pathname.slice(1)
    ) {
      throw new DatabaseConfigurationError();
    }
    if (!isLoopback) {
      const projectRef = env.SUPABASE_PROJECT_REF;
      const searchParameters = [...url.searchParams.entries()];
      if (
        projectRef !== RUNTIME_PROJECT_REF ||
        decodeURIComponent(url.username) !==
          `${RUNTIME_LOGIN_ROLE}.${projectRef}` ||
        !decodeURIComponent(url.password) ||
        url.hostname !== RUNTIME_POOLER_HOST ||
        url.port !== "6543" ||
        url.pathname !== "/postgres" ||
        searchParameters.length !== 1 ||
        searchParameters[0]?.[0] !== "sslmode" ||
        searchParameters[0]?.[1] !== "verify-full" ||
        url.hash !== ""
      ) {
        throw new DatabaseConfigurationError();
      }
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
  if (isLoopbackHostname(url.hostname)) {
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
    const canonicalSource = certificate.toString();
    if (
      !certificate.ca ||
      (source !== canonicalSource &&
        (!canonicalSource.endsWith("\n") ||
          source !== canonicalSource.slice(0, -1))) ||
      certificate.fingerprint256 !== SUPABASE_CA_FINGERPRINT ||
      Date.parse(certificate.validFrom) > Date.now() ||
      Date.parse(certificate.validTo) <= Date.now()
    ) {
      throw new Error();
    }
    return { ca: canonicalSource, rejectUnauthorized: true };
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
  let assumeLocalRuntimeRole = false;

  function getClient(): RuntimeSqlClient {
    if (!lazyClient) {
      const databaseUrl = requireDatabaseUrl(env);
      assumeLocalRuntimeRole = isLoopbackHostname(
        new URL(databaseUrl).hostname,
      );
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
    let enteredTransaction = false;
    try {
      return await getClient().begin(async (transaction) => {
        enteredTransaction = true;
        if (assumeLocalRuntimeRole) {
          await transaction.unsafe("set local role app_runtime");
        }
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
    } catch (error) {
      if (
        error instanceof DatabaseConfigurationError ||
        error instanceof DatabaseAuthorizationContextError
      ) {
        throw error;
      }
      throw new DatabaseRuntimeError(
        enteredTransaction ? "query" : "connection",
        classifyRuntimeFailure(error),
      );
    }
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
