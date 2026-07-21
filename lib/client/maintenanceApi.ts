import { z } from "zod";

const MaintenanceStatusSchema = z
  .object({
    code: z.literal("MAINTENANCE_STATUS"),
    publicBookingEnabled: z.boolean(),
    ownerMutationsEnabled: z.boolean(),
    messageCode: z.enum([
      "OPERATIONS_OPEN",
      "MAINTENANCE_ACTIVE",
      "OWNER_RECONCILIATION_ACTIVE",
    ]),
  })
  .strict();

export type MaintenanceStatus = z.infer<typeof MaintenanceStatusSchema>;

export const PUBLIC_MAINTENANCE_MESSAGE =
  "Le prenotazioni online sono temporaneamente sospese per manutenzione. Nessun appuntamento è stato registrato. Riprova più tardi oppure contatta Gioia Beauty al +39 391 421 3634.";

export const OWNER_MAINTENANCE_MESSAGE =
  "Manutenzione attiva: le modifiche sono bloccate, ma le consultazioni restano disponibili. Registra le richieste nel registro manuale e attendi la fase di riconciliazione.";

export const MAINTENANCE_STATUS_UNAVAILABLE_MESSAGE =
  "Impossibile verificare lo stato del servizio. Le modifiche restano temporaneamente bloccate; riprova tra poco.";

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
  const parsed = MaintenanceStatusSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("INVALID_MAINTENANCE_STATUS");
  }
  return parsed.data;
}
