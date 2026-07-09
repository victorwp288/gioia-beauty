import "server-only";

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
    },
  ) => RuntimeSqlClient;
}

export class DatabaseConfigurationError extends Error {
  constructor() {
    super("Database is not configured");
    this.name = "DatabaseConfigurationError";
  }
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
      lazyClient = clientFactory(requireDatabaseUrl(env), {
        prepare: false,
        max: 2,
        idle_timeout: 20,
        connect_timeout: 5,
        max_lifetime: 60,
        debug: false,
        onnotice: () => {},
        connection: { application_name: "gioia_public_api" },
      });
    }
    return lazyClient;
  }

  return {
    async transaction<T>(
      work: (transaction: RuntimeTransaction) => Promise<T>,
    ): Promise<T> {
      return getClient().begin(async (transaction) => {
        await transaction.unsafe("set local role app_runtime");
        await transaction.unsafe(
          "select set_config('statement_timeout', '8000', true), " +
            "set_config('lock_timeout', '3000', true)",
        );
        return work(transaction);
      });
    },
  };
}
