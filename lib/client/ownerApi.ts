import {
  AdminScheduleListResponseSchema,
  AdminSubscriberListResponseSchema,
  AdminVacationListResponseSchema,
  ApiErrorResponseSchema,
  CommandResultResponseSchema,
  ScheduleCountResponseSchema,
} from "@/lib/domain/schemas/index.ts";

let csrfToken: string | null = null;
const pendingCommandKeys = new Map<string, string>();
const MAX_PENDING_COMMAND_KEYS = 100;

export class OwnerApiError extends Error {
  readonly code: string;
  readonly requestId: string | null;
  readonly retryAfterSeconds: number | null;
  readonly status: number;

  constructor(
    status: number,
    code: string,
    requestId: string | null = null,
    retryAfterSeconds: number | null = null,
  ) {
    super(code);
    this.name = "OwnerApiError";
    this.code = code;
    this.requestId = requestId;
    this.retryAfterSeconds = retryAfterSeconds;
    this.status = status;
  }
}

function retryAfter(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

async function decodeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new OwnerApiError(response.status, "INVALID_RESPONSE");
  }
}

async function ownerFetch(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, init);
  } catch {
    throw new OwnerApiError(0, "NETWORK_ERROR");
  }
}

async function expectedJson<T>(
  response: Response,
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
): Promise<T> {
  const body = await decodeJson(response);
  if (!response.ok) {
    const parsed = ApiErrorResponseSchema.safeParse(body);
    const code = parsed.success ? parsed.data.code : "REQUEST_FAILED";
    if (
      response.status === 401 ||
      code === "OWNER_AUTHORIZATION_REQUIRED" ||
      code === "OWNER_SESSION_REQUIRED"
    ) {
      csrfToken = null;
      pendingCommandKeys.clear();
    }
    throw new OwnerApiError(
      response.status,
      code,
      parsed.success ? parsed.data.requestId : null,
      retryAfter(response),
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new OwnerApiError(response.status, "INVALID_RESPONSE");
  }
  return parsed.data as T;
}

const AuthResponseSchema = {
  safeParse(value: unknown) {
    const candidate = value as { code?: unknown; csrfToken?: unknown };
    const success =
      Boolean(candidate) &&
      ["OWNER_SESSION_ACTIVE", "OWNER_SESSION_CREATED"].includes(
        String(candidate.code),
      ) &&
      typeof candidate.csrfToken === "string" &&
      /^[A-Za-z0-9_-]{43}$/.test(candidate.csrfToken);
    return success
      ? {
          success: true,
          data: candidate as { code: string; csrfToken: string },
        }
      : { success: false };
  },
};

const LogoutResponseSchema = {
  safeParse(value: unknown) {
    const candidate = value as { code?: unknown };
    return candidate?.code === "OWNER_SESSION_ENDED"
      ? {
          success: true,
          data: candidate as { code: "OWNER_SESSION_ENDED" },
        }
      : { success: false };
  },
};

export async function loginOwner(email: string, password: string) {
  const response = await ownerFetch("/api/auth/login", {
    body: JSON.stringify({ email, password }),
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    method: "POST",
  });
  const result = await expectedJson(response, AuthResponseSchema);
  csrfToken = result.csrfToken;
  return result;
}

export async function getOwnerSession() {
  const response = await ownerFetch("/api/auth/session", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    method: "GET",
  });
  const result = await expectedJson(response, AuthResponseSchema);
  csrfToken = result.csrfToken;
  return result;
}

export async function logoutOwner() {
  const token = csrfToken ?? (await getOwnerSession()).csrfToken;
  const response = await ownerFetch("/api/auth/logout", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json", "X-CSRF-Token": token },
    method: "POST",
  });
  const result = await expectedJson(response, LogoutResponseSchema);
  csrfToken = null;
  pendingCommandKeys.clear();
  return result;
}

function appendValues(query: URLSearchParams, key: string, values?: string[]) {
  for (const value of values ?? []) query.append(key, value);
}

async function ownerGet<T>(
  path: string,
  query: URLSearchParams,
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
): Promise<T> {
  const response = await ownerFetch(`${path}?${query}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    method: "GET",
  });
  return expectedJson(response, schema);
}

export function getOwnerSchedule(input: {
  fromDate: string;
  toDate: string;
  statuses?: string[];
  kind?: "appointment" | "block";
  pageSize?: number;
  cursor?: string;
}) {
  const query = new URLSearchParams({
    fromDate: input.fromDate,
    toDate: input.toDate,
    pageSize: String(input.pageSize ?? 100),
  });
  if (input.kind) query.set("kind", input.kind);
  if (input.cursor) query.set("cursor", input.cursor);
  appendValues(query, "status", input.statuses);
  return ownerGet(
    "/api/admin/schedule",
    query,
    AdminScheduleListResponseSchema,
  );
}

export function getOwnerScheduleCount(input: {
  fromDate: string;
  toDate: string;
  statuses?: string[];
  kind?: "appointment" | "block";
}) {
  const query = new URLSearchParams({
    fromDate: input.fromDate,
    toDate: input.toDate,
  });
  if (input.kind) query.set("kind", input.kind);
  appendValues(query, "status", input.statuses);
  return ownerGet(
    "/api/admin/schedule/count",
    query,
    ScheduleCountResponseSchema,
  );
}

export function getOwnerVacations(input: {
  fromDate: string;
  toDate: string;
  cursor?: string;
}) {
  const query = new URLSearchParams({
    fromDate: input.fromDate,
    toDate: input.toDate,
    pageSize: "100",
  });
  if (input.cursor) query.set("cursor", input.cursor);
  return ownerGet(
    "/api/admin/vacations",
    query,
    AdminVacationListResponseSchema,
  );
}

export function getOwnerSubscribers(input: {
  statuses?: string[];
  cursor?: string;
}) {
  const query = new URLSearchParams({ pageSize: "100" });
  if (input.cursor) query.set("cursor", input.cursor);
  appendValues(query, "status", input.statuses);
  return ownerGet(
    "/api/admin/subscribers",
    query,
    AdminSubscriberListResponseSchema,
  );
}

export async function runOwnerCommand(
  path: string,
  body: Record<string, unknown>,
  suppliedIdempotencyKey?: string,
) {
  const token = csrfToken ?? (await getOwnerSession()).csrfToken;
  const serializedBody = JSON.stringify(body);
  const commandFingerprint = `${path}:${serializedBody}`;
  let idempotencyKey = suppliedIdempotencyKey;
  if (!idempotencyKey) {
    idempotencyKey = pendingCommandKeys.get(commandFingerprint);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      if (pendingCommandKeys.size >= MAX_PENDING_COMMAND_KEYS) {
        const oldest = pendingCommandKeys.keys().next().value;
        if (oldest) pendingCommandKeys.delete(oldest);
      }
      pendingCommandKeys.set(commandFingerprint, idempotencyKey);
    }
  }
  const request = {
    body: serializedBody,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "X-CSRF-Token": token,
    },
    method: "POST",
  } satisfies RequestInit;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await ownerFetch(path, request);
      const result = await expectedJson(response, CommandResultResponseSchema);
      if (!suppliedIdempotencyKey)
        pendingCommandKeys.delete(commandFingerprint);
      return result;
    } catch (error) {
      const ambiguous =
        error instanceof OwnerApiError &&
        (error.status === 0 ||
          error.status >= 500 ||
          error.code === "COMMAND_IN_PROGRESS");
      if (!ambiguous) {
        if (!suppliedIdempotencyKey)
          pendingCommandKeys.delete(commandFingerprint);
        throw error;
      }
      if (attempt === 1) throw error;
    }
  }
  throw new OwnerApiError(503, "SERVICE_UNAVAILABLE");
}

export async function downloadOwnerScheduleCsv(input: {
  fromDate: string;
  toDate: string;
  includeNotes: boolean;
}) {
  const query = new URLSearchParams({
    fromDate: input.fromDate,
    toDate: input.toDate,
    format: "csv",
    includeNotes: String(input.includeNotes),
    pageSize: "500",
  });
  const response = await ownerFetch(`/api/admin/schedule/export?${query}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "text/csv" },
    method: "GET",
  });
  if (!response.ok) {
    await expectedJson(response, CommandResultResponseSchema);
  }
  const nextCursor = response.headers.get("x-next-cursor");
  if (nextCursor) {
    throw new OwnerApiError(422, "EXPORT_RANGE_TOO_LARGE");
  }
  return {
    blob: await response.blob(),
    rowCount: Number(response.headers.get("x-export-row-count") ?? "0"),
  };
}

export function ownerErrorMessage(error: unknown): string {
  if (!(error instanceof OwnerApiError)) {
    return "Operazione non disponibile. Riprova tra poco.";
  }
  if (error.code === "VERSION_CONFLICT") {
    return "Il dato è stato modificato in un’altra scheda. La vista verrà aggiornata.";
  }
  if (
    error.code === "OWNER_SESSION_REQUIRED" ||
    error.code === "OWNER_AUTHORIZATION_REQUIRED"
  ) {
    return "La sessione è scaduta. Accedi nuovamente.";
  }
  if (error.code === "MAINTENANCE_ACTIVE") {
    return "Le modifiche sono temporaneamente sospese; la consultazione resta disponibile.";
  }
  if (error.code === "RATE_LIMITED") {
    return "Troppe richieste. Attendi un minuto e riprova.";
  }
  if (error.code === "EXPORT_RANGE_TOO_LARGE") {
    return "L’intervallo contiene più di 500 righe. Riduci le date dell’esportazione.";
  }
  return "Operazione non disponibile. Riprova tra poco.";
}
