import {
  MaintenanceStatusWire,
  type MaintenanceStatus,
} from "@/lib/client/wireValidators.ts";

export type { MaintenanceStatus } from "@/lib/client/wireValidators.ts";

export const PUBLIC_MAINTENANCE_MESSAGE =
  "Le prenotazioni online sono temporaneamente sospese per manutenzione. Nessun appuntamento è stato registrato. Riprova più tardi oppure contatta Gioia Beauty al +39 391 421 3634.";

export const OWNER_MAINTENANCE_MESSAGE =
  "Manutenzione attiva: le modifiche sono bloccate, ma le consultazioni restano disponibili. Registra le richieste nel registro manuale e attendi la fase di riconciliazione.";

export const MAINTENANCE_STATUS_UNAVAILABLE_MESSAGE =
  "Impossibile verificare lo stato del servizio. Le modifiche restano temporaneamente bloccate; riprova tra poco.";

const ENGLISH_PUBLIC_MAINTENANCE_MESSAGE =
  "Online booking is temporarily paused for maintenance. No appointment has been recorded. Please try again later or contact Gioia Beauty on +39 391 421 3634.";

const ENGLISH_MAINTENANCE_STATUS_UNAVAILABLE_MESSAGE =
  "We could not verify the service status. Booking remains temporarily blocked; please try again shortly.";

export function publicMaintenanceMessage(locale: string = "it"): string {
  return locale === "en"
    ? ENGLISH_PUBLIC_MAINTENANCE_MESSAGE
    : PUBLIC_MAINTENANCE_MESSAGE;
}

export function maintenanceStatusUnavailableMessage(
  locale: string = "it",
): string {
  return locale === "en"
    ? ENGLISH_MAINTENANCE_STATUS_UNAVAILABLE_MESSAGE
    : MAINTENANCE_STATUS_UNAVAILABLE_MESSAGE;
}

export async function getMaintenanceStatus(
  signal?: AbortSignal,
): Promise<MaintenanceStatus> {
  const response = await fetch("/api/maintenance", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    method: "GET",
    signal,
  });
  if (!response.ok) {
    throw new Error("MAINTENANCE_STATUS_UNAVAILABLE");
  }
  const parsed = MaintenanceStatusWire.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("INVALID_MAINTENANCE_STATUS");
  }
  return parsed.data;
}
