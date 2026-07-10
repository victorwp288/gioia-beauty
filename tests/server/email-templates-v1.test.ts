import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { OutboxClaimItemSchema } from "@/lib/domain/schemas/index.ts";
import {
  OUTBOX_SCHEDULE_TEMPLATE_VERSION,
  UnsupportedOutboxTemplateError,
  renderOutboxEmailV1,
} from "@/lib/server/email/emailTemplatesV1.ts";

const OUTBOX_ID = "10000000-0000-4000-8000-000000000001";
const AGGREGATE_ID = "20000000-0000-4000-8000-000000000001";

function scheduleClaim(
  templateKind:
    | "booking_customer"
    | "booking_owner"
    | "cancellation_customer"
    | "cancellation_owner"
    | "reschedule_customer"
    | "reschedule_owner",
) {
  const recipientKind = templateKind.endsWith("_owner") ? "owner" : "customer";
  const templateData = {
    clientName: "Cliente <Test> & 'Co'",
    localDate: "2035-02-05",
    startMinutes: 600,
    serviceDurationMinutes: 60,
    serviceName: "Massaggio & Relax",
    variantName: "Relax <60>",
    ...(templateKind.startsWith("reschedule_")
      ? { oldLocalDate: "2035-02-04", oldStartMinutes: 540 }
      : {}),
  };
  return OutboxClaimItemSchema.parse({
    outboxId: OUTBOX_ID,
    aggregateKind: "schedule_entry",
    aggregateId: AGGREGATE_ID,
    aggregateVersion: 2,
    recipientKind,
    recipientAddress:
      recipientKind === "owner" ? "owner@example.test" : "client@example.test",
    templateKind,
    templateData,
    providerIdempotencyKey: `schedule:${AGGREGATE_ID}:v2:${recipientKind}`,
    attemptCount: 1,
    expectedVersion: 2,
    leaseExpiresAt: "2035-02-05T10:02:00.000Z",
  });
}

describe("immutable outbox schedule template v1", () => {
  it("keeps the version explicit and renders exact deterministic customer copy", () => {
    expect(OUTBOX_SCHEDULE_TEMPLATE_VERSION).toBe(1);
    const message = renderOutboxEmailV1(scheduleClaim("booking_customer"));

    expect(message).toEqual({
      from: "Gioia Beauty <noreply@gioiabeauty.net>",
      to: ["client@example.test"],
      subject: "Conferma appuntamento – Gioia Beauty",
      html:
        '<!doctype html><html lang="it"><body style="font-family:Arial,sans-serif;color:#211d1a">' +
        '<h1 style="font-size:24px">Gentile Cliente &lt;Test&gt; &amp; &#39;Co&#39;,</h1>' +
        '<p style="margin:0 0 16px">Il tuo appuntamento da Gioia Beauty è confermato.</p>' +
        '<ul style="padding-left:20px"><li>Servizio: Massaggio &amp; Relax — Relax &lt;60&gt;</li>' +
        "<li>Data: 05/02/2035</li><li>Orario: 10:00–11:00</li>" +
        "<li>Durata: 60 minuti</li></ul>" +
        '<p style="margin:0 0 16px">Non è possibile rispondere a questa email.</p>' +
        "</body></html>",
      text:
        "Gentile Cliente <Test> & 'Co',\n\n" +
        "Il tuo appuntamento da Gioia Beauty è confermato.\n\n" +
        "Servizio: Massaggio & Relax — Relax <60>\n" +
        "Data: 05/02/2035\nOrario: 10:00–11:00\n" +
        "Durata: 60 minuti\n\n" +
        "Non è possibile rispondere a questa email.",
    });
    expect(message.html).not.toContain("<Test>");
  });

  it.each([
    ["booking_customer", "Conferma appuntamento – Gioia Beauty"],
    ["booking_owner", "Nuova prenotazione – Gioia Beauty"],
    ["cancellation_customer", "Appuntamento cancellato – Gioia Beauty"],
    ["cancellation_owner", "Prenotazione cancellata – Gioia Beauty"],
    ["reschedule_customer", "Appuntamento riprogrammato – Gioia Beauty"],
    ["reschedule_owner", "Prenotazione riprogrammata – Gioia Beauty"],
  ] as const)("renders %s with fixed subject %s", (kind, subject) => {
    const first = renderOutboxEmailV1(scheduleClaim(kind));
    const second = renderOutboxEmailV1({
      ...scheduleClaim(kind),
      attemptCount: 4,
      expectedVersion: 8,
      leaseExpiresAt: "2035-02-05T10:12:00.000Z",
    });

    expect(first.subject).toBe(subject);
    expect(second).toEqual(first);
    if (kind.startsWith("reschedule_")) {
      expect(first.text).toContain("Data precedente: 04/02/2035");
      expect(first.text).toContain("Orario precedente: 09:00");
    }
  });

  it("refuses newsletter delivery until immutable action timing is claimable", () => {
    const newsletter = OutboxClaimItemSchema.parse({
      outboxId: OUTBOX_ID,
      aggregateKind: "subscriber",
      aggregateId: AGGREGATE_ID,
      aggregateVersion: 1,
      recipientKind: "subscriber",
      recipientAddress: "subscriber@example.test",
      templateKind: "newsletter_confirmation",
      templateData: { policyVersion: "newsletter-consent-v1" },
      providerIdempotencyKey: `subscriber:${AGGREGATE_ID}:v1:confirmation`,
      attemptCount: 1,
      expectedVersion: 2,
      leaseExpiresAt: "2035-02-05T10:02:00.000Z",
    });

    expect(() => renderOutboxEmailV1(newsletter)).toThrow(
      UnsupportedOutboxTemplateError,
    );
  });
});
