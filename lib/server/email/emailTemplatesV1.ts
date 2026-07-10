import "server-only";

import {
  OutboxClaimItemSchema,
  type OutboxClaimItem,
  type RescheduleOutboxTemplateData,
  type ScheduleOutboxTemplateData,
} from "@/lib/domain/schemas/index.ts";

import { EmailMessageSchema, type EmailMessage } from "./emailProvider.ts";

const FROM = "Gioia Beauty <noreply@gioiabeauty.net>" as const;

// These renderers are the immutable v1 interpretation of the current database
// template kinds. Changing their bytes requires a new persisted template kind.
export const OUTBOX_SCHEDULE_TEMPLATE_VERSION = 1 as const;
export const SCHEDULE_OUTBOX_TEMPLATE_KINDS = [
  "booking_customer",
  "booking_owner",
  "cancellation_customer",
  "cancellation_owner",
  "reschedule_customer",
  "reschedule_owner",
] as const;

export class UnsupportedOutboxTemplateError extends Error {
  readonly errorCode = "NEWSLETTER_TEMPLATE_NOT_READY" as const;

  constructor() {
    super("Outbox template cannot be rendered by this worker version");
    this.name = "UnsupportedOutboxTemplateError";
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(localDate: string): string {
  const [year, month, day] = localDate.split("-");
  return `${day}/${month}/${year}`;
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function scheduleLines(data: ScheduleOutboxTemplateData): string[] {
  return [
    `Servizio: ${data.serviceName} — ${data.variantName}`,
    `Data: ${formatDate(data.localDate)}`,
    `Orario: ${formatMinutes(data.startMinutes)}–${formatMinutes(data.startMinutes + data.serviceDurationMinutes)}`,
    `Durata: ${data.serviceDurationMinutes} minuti`,
  ];
}

function oldScheduleLines(data: RescheduleOutboxTemplateData): string[] {
  return [
    `Data precedente: ${formatDate(data.oldLocalDate)}`,
    `Orario precedente: ${formatMinutes(data.oldStartMinutes)}`,
  ];
}

function paragraph(value: string): string {
  return `<p style="margin:0 0 16px">${escapeHtml(value)}</p>`;
}

function renderHtml(heading: string, introduction: string, lines: string[]) {
  const details = lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  return [
    '<!doctype html><html lang="it"><body style="font-family:Arial,sans-serif;color:#211d1a">',
    `<h1 style="font-size:24px">${escapeHtml(heading)}</h1>`,
    paragraph(introduction),
    `<ul style="padding-left:20px">${details}</ul>`,
    paragraph("Non è possibile rispondere a questa email."),
    "</body></html>",
  ].join("");
}

function renderText(heading: string, introduction: string, lines: string[]) {
  return [
    heading,
    "",
    introduction,
    "",
    ...lines,
    "",
    "Non è possibile rispondere a questa email.",
  ].join("\n");
}

function copyForClaim(
  item: Exclude<OutboxClaimItem, { aggregateKind: "subscriber" }>,
) {
  switch (item.templateKind) {
    case "booking_customer":
      return {
        subject: "Conferma appuntamento – Gioia Beauty",
        heading: `Gentile ${item.templateData.clientName},`,
        introduction: "Il tuo appuntamento da Gioia Beauty è confermato.",
        lines: scheduleLines(item.templateData),
      };
    case "booking_owner":
      return {
        subject: "Nuova prenotazione – Gioia Beauty",
        heading: "Nuova prenotazione",
        introduction: `${item.templateData.clientName} ha prenotato un appuntamento.`,
        lines: scheduleLines(item.templateData),
      };
    case "cancellation_customer":
      return {
        subject: "Appuntamento cancellato – Gioia Beauty",
        heading: `Gentile ${item.templateData.clientName},`,
        introduction: "Il tuo appuntamento da Gioia Beauty è stato cancellato.",
        lines: scheduleLines(item.templateData),
      };
    case "cancellation_owner":
      return {
        subject: "Prenotazione cancellata – Gioia Beauty",
        heading: "Prenotazione cancellata",
        introduction: `L’appuntamento di ${item.templateData.clientName} è stato cancellato.`,
        lines: scheduleLines(item.templateData),
      };
    case "reschedule_customer":
      return {
        subject: "Appuntamento riprogrammato – Gioia Beauty",
        heading: `Gentile ${item.templateData.clientName},`,
        introduction:
          "Il tuo appuntamento da Gioia Beauty è stato riprogrammato.",
        lines: [
          ...oldScheduleLines(item.templateData),
          ...scheduleLines(item.templateData),
        ],
      };
    case "reschedule_owner":
      return {
        subject: "Prenotazione riprogrammata – Gioia Beauty",
        heading: "Prenotazione riprogrammata",
        introduction: `L’appuntamento di ${item.templateData.clientName} è stato riprogrammato.`,
        lines: [
          ...oldScheduleLines(item.templateData),
          ...scheduleLines(item.templateData),
        ],
      };
  }
}

export function renderOutboxEmailV1(input: OutboxClaimItem): EmailMessage {
  const item = OutboxClaimItemSchema.parse(input);
  if (item.templateKind === "newsletter_confirmation") {
    throw new UnsupportedOutboxTemplateError();
  }

  const copy = copyForClaim(item);
  return EmailMessageSchema.parse({
    from: FROM,
    to: [item.recipientAddress],
    subject: copy.subject,
    html: renderHtml(copy.heading, copy.introduction, copy.lines),
    text: renderText(copy.heading, copy.introduction, copy.lines),
  });
}

export const scheduleEmailRenderersV1 = {
  booking_customer: renderOutboxEmailV1,
  booking_owner: renderOutboxEmailV1,
  cancellation_customer: renderOutboxEmailV1,
  cancellation_owner: renderOutboxEmailV1,
  reschedule_customer: renderOutboxEmailV1,
  reschedule_owner: renderOutboxEmailV1,
} as const;
