import type {
  CommandResultResponse,
  PublicAvailabilityResponse,
} from "@/lib/domain/schemas/responses.ts";
import { SERVICE_CATALOG } from "@/lib/domain/catalog/index.ts";
import {
  ApiErrorResponseWire,
  CommandResultResponseWire,
  PublicAvailabilityResponseWire,
  PublicNonEnumeratingAcceptedResponseWire,
} from "@/lib/client/wireValidators.ts";

export class ClientApiError extends Error {
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
    this.name = "ClientApiError";
    this.code = code;
    this.requestId = requestId;
    this.retryAfterSeconds = retryAfterSeconds;
    this.status = status;
  }
}

const AMBIGUOUS_COMMAND_CODES = new Set([
  "COMMAND_IN_PROGRESS",
  "HUMAN_VERIFICATION_REQUIRED",
  "INVALID_RESPONSE",
  "NETWORK_ERROR",
  "RATE_LIMITED",
  "REQUEST_FAILED",
  "SERVICE_UNAVAILABLE",
]);

const STALE_BOOKING_SELECTION_CODES = new Set([
  "DATE_CLOSED_FOR_VACATION",
  "SLOT_OUTSIDE_BUSINESS_HOURS",
  "SLOT_UNAVAILABLE",
]);

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function salonDateFromLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startMinutesFromTime(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new TypeError("Invalid time");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new TypeError("Invalid time");
  return hours * 60 + minutes;
}

export function timeFromStartMinutes(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 1_439) {
    throw new TypeError("Invalid start minutes");
  }
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(
    value % 60,
  ).padStart(2, "0")}`;
}

export function catalogSelection(serviceName: string, duration: number) {
  const service = SERVICE_CATALOG.services.find(
    (candidate) => candidate.active && candidate.nameIt === serviceName,
  );
  const variant = service?.variants.find(
    (candidate) =>
      candidate.active && candidate.serviceDurationMinutes === duration,
  );
  if (!service || !variant) return null;
  return {
    serviceId: service.id,
    variantId: variant.id,
    service,
    variant,
  };
}

export function catalogSelectionById(serviceId: string, variantId: string) {
  const service = SERVICE_CATALOG.services.find(
    (candidate) => candidate.active && candidate.id === serviceId,
  );
  const variant = service?.variants.find(
    (candidate) => candidate.active && candidate.id === variantId,
  );
  if (!service || !variant) return null;
  return { serviceId: service.id, variantId: variant.id, service, variant };
}

async function decodeResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ClientApiError(response.status, "INVALID_RESPONSE");
  }
}

function retryAfter(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds <= 86_400 ? seconds : null;
}

function humanChallengeHeaders(token: string | undefined): HeadersInit {
  if (token === undefined) return {};
  if (
    token.length < 1 ||
    new TextEncoder().encode(token).byteLength > 2_048 ||
    /[^\x21-\x7e]/u.test(token)
  ) {
    throw new TypeError("Invalid human challenge token");
  }
  return { "x-gioia-human-challenge": token };
}

async function expectedJson<T>(
  response: Response,
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
): Promise<T> {
  const body = await decodeResponse(response);
  if (!response.ok) {
    const parsed = ApiErrorResponseWire.safeParse(body);
    throw new ClientApiError(
      response.status,
      parsed.success ? parsed.data.code : "REQUEST_FAILED",
      parsed.success ? parsed.data.requestId : null,
      retryAfter(response),
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ClientApiError(response.status, "INVALID_RESPONSE");
  }
  return parsed.data as T;
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ClientApiError(0, "NETWORK_ERROR");
  }
  return expectedJson(response, schema);
}

export async function getPublicAvailability(
  input: { date: string; serviceId: string; variantId: string },
  signal?: AbortSignal,
): Promise<PublicAvailabilityResponse> {
  const query = new URLSearchParams(input);
  return requestJson(
    `/api/availability?${query}`,
    {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      method: "GET",
      signal,
    },
    PublicAvailabilityResponseWire,
  );
}

export async function createPublicBooking(
  input: {
    date: string;
    startMinutes: number;
    serviceId: string;
    variantId: string;
    clientName: string;
    clientEmail: string;
    clientPhone: string;
    clientNote: string | null;
  },
  idempotencyKey: string,
  humanChallengeToken?: string,
): Promise<CommandResultResponse> {
  return requestJson(
    "/api/bookings",
    {
      body: JSON.stringify(input),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        ...humanChallengeHeaders(humanChallengeToken),
      },
      method: "POST",
    },
    CommandResultResponseWire,
  );
}

export async function subscribeToNewsletter(
  email: string,
  idempotencyKey: string,
  humanChallengeToken?: string,
): Promise<{ code: "REQUEST_ACCEPTED" }> {
  return requestJson(
    "/api/newsletter/subscribe",
    {
      body: JSON.stringify({ email, consent: true }),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        ...humanChallengeHeaders(humanChallengeToken),
      },
      method: "POST",
    },
    PublicNonEnumeratingAcceptedResponseWire,
  );
}

export function shouldRetainPublicIdempotencyKey(error: unknown): boolean {
  if (!(error instanceof ClientApiError)) return true;
  return (
    error.status === 0 ||
    error.status >= 500 ||
    AMBIGUOUS_COMMAND_CODES.has(error.code)
  );
}

export function bookingErrorInvalidatesSelection(error: unknown): boolean {
  return (
    error instanceof ClientApiError &&
    STALE_BOOKING_SELECTION_CODES.has(error.code)
  );
}

export function publicErrorMessage(
  error: unknown,
  locale: string = "it",
): string {
  const english = locale === "en";
  if (!(error instanceof ClientApiError)) {
    return english
      ? "The service is unavailable. Please try again shortly."
      : "Il servizio non è disponibile. Riprova tra poco.";
  }
  if (["SLOT_UNAVAILABLE", "DATE_CLOSED_FOR_VACATION"].includes(error.code)) {
    return english
      ? "That time is no longer available. Please choose another."
      : "L’orario scelto non è più disponibile. Selezionane un altro.";
  }
  if (error.code === "RATE_LIMITED") {
    return english
      ? "You have made too many requests. Wait a few minutes and try again."
      : "Hai effettuato troppe richieste. Attendi qualche minuto e riprova.";
  }
  if (error.code === "HUMAN_VERIFICATION_REQUIRED") {
    return english
      ? "A security check is required before continuing. Please try again."
      : "È necessaria una verifica prima di continuare. Riprova tra poco.";
  }
  if (error.code === "MAINTENANCE_ACTIVE") {
    return english
      ? "Booking is temporarily paused. Contact the salon for assistance."
      : "Le prenotazioni sono temporaneamente sospese. Contatta il salone per assistenza.";
  }
  if (
    [
      "INVALID_REQUEST",
      "PUBLIC_CONTACT_INVALID",
      "PUBLIC_DATE_TOO_EARLY",
      "PUBLIC_DATE_TOO_LATE",
      "PUBLIC_LEAD_TIME_INVALID",
      "PUBLIC_SLOT_INVALID",
      "SLOT_ALIGNMENT_INVALID",
      "SLOT_OUTSIDE_BUSINESS_HOURS",
    ].includes(error.code)
  ) {
    return english
      ? "Check your details and select the date and time again."
      : "Controlla i dati inseriti e seleziona nuovamente data e orario.";
  }
  return english
    ? "The service is unavailable. Please try again shortly."
    : "Il servizio non è disponibile. Riprova tra poco.";
}
