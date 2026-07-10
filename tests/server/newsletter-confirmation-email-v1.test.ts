import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  NEWSLETTER_CONFIRMATION_TEMPLATE_VERSION,
  NEWSLETTER_CONSENT_POLICY_VERSION,
  NewsletterConfirmationRendererConfigurationError,
  NewsletterConfirmationRendererInputError,
  NewsletterConfirmationRendererOperationalError,
  NewsletterConfirmationRenderSnapshotV1Schema,
  createNewsletterConfirmationEmailRendererV1,
} from "@/lib/server/email/newsletterConfirmationEmailV1.ts";

import {
  CLAIMS,
  PRIMARY_KEY,
  codec,
  issue,
} from "./newsletter-action-token-fixture.ts";

const RECIPIENT = "subscriber@example.test";
const NOW = new Date("2026-07-09T12:00:00.000Z");
const CONFIRMATION_URL = `https://www.gioiabeauty.net/newsletter/confirm#token=${issue()}`;

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    outboxId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    aggregateKind: "subscriber",
    aggregateId: CLAIMS.subscriberId,
    aggregateVersion: CLAIMS.subscriberVersion,
    recipientKind: "subscriber",
    recipientAddress: RECIPIENT,
    templateKind: "newsletter_confirmation",
    templateData: {
      policyVersion: NEWSLETTER_CONSENT_POLICY_VERSION,
      action: {
        version: 1,
        purpose: CLAIMS.purpose,
        tokenId: CLAIMS.tokenId,
        issuedAt: CLAIMS.issuedAt,
        expiresAt: CLAIMS.expiresAt,
        signingKeyId: PRIMARY_KEY.id,
      },
    },
    providerIdempotencyKey: `subscriber:${CLAIMS.subscriberId}:v7:confirmation`,
    attemptCount: 1,
    expectedVersion: 2,
    leaseExpiresAt: "2026-07-09T12:02:00.000Z",
    ...overrides,
  };
}

function setup(now = NOW) {
  const tokenCodec = codec();
  const issueToken = vi.fn(tokenCodec.issue.bind(tokenCodec));
  const verifyToken = vi.fn(tokenCodec.verify.bind(tokenCodec));
  return {
    issueToken,
    verifyToken,
    render: createNewsletterConfirmationEmailRendererV1({
      tokenCodec: { issue: issueToken, verify: verifyToken },
      now: () => new Date(now),
    }),
  };
}

function expectedMessage() {
  return {
    from: "Gioia Beauty <noreply@gioiabeauty.net>",
    to: [RECIPIENT],
    subject: "Conferma l’iscrizione alla newsletter – Gioia Beauty",
    html: [
      '<!doctype html><html lang="it"><body style="font-family:Arial,sans-serif;color:#211d1a">',
      '<h1 style="font-size:24px">Conferma la tua iscrizione</h1>',
      '<p style="margin:0 0 16px">Abbiamo ricevuto una richiesta di iscrizione alla newsletter di Gioia Beauty.</p>',
      `<p style="margin:0 0 16px"><a href="${CONFIRMATION_URL}" style="display:inline-block;padding:12px 18px;background:#211d1a;color:#fff;text-decoration:none">Conferma l’iscrizione</a></p>`,
      '<p style="margin:0 0 16px">Conferma entro 24 ore dalla richiesta.</p>',
      '<p style="margin:0 0 16px">Se non hai effettuato la richiesta, ignora questa email: l’iscrizione non verrà completata.</p>',
      '<p style="margin:0 0 16px">Puoi consultare l’<a href="https://www.gioiabeauty.net/policy">informativa sulla privacy</a>.</p>',
      '<p style="margin:0 0 16px">Non è possibile rispondere a questa email.</p>',
      "</body></html>",
    ].join(""),
    text: [
      "Conferma la tua iscrizione",
      "",
      "Abbiamo ricevuto una richiesta di iscrizione alla newsletter di Gioia Beauty.",
      "",
      "Conferma l’iscrizione:",
      CONFIRMATION_URL,
      "",
      "Conferma entro 24 ore dalla richiesta.",
      "",
      "Se non hai effettuato la richiesta, ignora questa email: l’iscrizione non verrà completata.",
      "",
      "Informativa sulla privacy: https://www.gioiabeauty.net/policy",
      "",
      "Non è possibile rispondere a questa email.",
    ].join("\n"),
  };
}

describe("immutable newsletter confirmation email v1", () => {
  it("renders one exact deterministic Italian transactional message", () => {
    const fixture = setup();
    const renderInput = snapshot();
    const expected = expectedMessage();

    expect(NEWSLETTER_CONFIRMATION_TEMPLATE_VERSION).toBe(1);
    expect(fixture.render(renderInput)).toEqual(expected);
    expect(fixture.render(renderInput)).toEqual(expected);
    expect(renderInput).toEqual(snapshot());
    expect(fixture.issueToken).toHaveBeenCalledTimes(2);
    expect(fixture.issueToken).toHaveBeenNthCalledWith(1, {
      claims: CLAIMS,
      signingKeyId: PRIMARY_KEY.id,
      now: NOW,
    });
    expect(fixture.verifyToken).toHaveBeenCalledTimes(2);
    expect(expected.html.split(CONFIRMATION_URL)).toHaveLength(2);
    expect(expected.text.split(CONFIRMATION_URL)).toHaveLength(2);
    for (const body of [expected.html, expected.text]) {
      expect(body).not.toContain(RECIPIENT);
      expect(body).not.toContain(CLAIMS.subscriberId);
      expect(body).not.toContain(NEWSLETTER_CONSENT_POLICY_VERSION);
    }
  });

  it("canonicalizes the immutable envelope before signing", () => {
    const fixture = setup();
    const parsed = NewsletterConfirmationRenderSnapshotV1Schema.parse({
      ...snapshot(),
      aggregateId: CLAIMS.subscriberId.toUpperCase(),
      recipientAddress: `  ${RECIPIENT.toUpperCase()}  `,
      templateData: {
        ...snapshot().templateData,
        action: {
          ...snapshot().templateData.action,
          tokenId: CLAIMS.tokenId.toUpperCase(),
          issuedAt: "2026-07-09T12:00:00.000+02:00",
          expiresAt: "2026-07-10T12:00:00.000+02:00",
        },
      },
    });

    expect(parsed.aggregateId).toBe(CLAIMS.subscriberId);
    expect(parsed.recipientAddress).toBe(RECIPIENT);
    expect(fixture.render(parsed)).toEqual(fixture.render(snapshot()));
  });

  it("ignores retry metadata and valid render-time drift", () => {
    const early = setup(new Date(CLAIMS.issuedAt)).render(snapshot());
    const late = setup(new Date("2026-07-10T09:59:59.999Z")).render(
      snapshot({
        attemptCount: 20,
        expectedVersion: 2_147_483_647,
        leaseExpiresAt: "2026-07-10T10:01:59.999Z",
      }),
    );
    expect(late).toEqual(early);
  });

  it.each([
    ["at expiry", new Date(CLAIMS.expiresAt)],
    ["after expiry", new Date("2026-07-10T10:00:00.001Z")],
    ["future issue", new Date("2026-07-09T09:54:59.999Z")],
    ["invalid clock", new Date(Number.NaN)],
  ])("refuses an unusable action snapshot %s", (_label, now) => {
    const fixture = setup(now);
    expect(() => fixture.render(snapshot())).toThrow(
      NewsletterConfirmationRendererOperationalError,
    );
    expect(fixture.verifyToken).not.toHaveBeenCalled();
  });

  it.each([
    [
      "unknown policy",
      { templateData: { ...snapshot().templateData, policyVersion: "future" } },
    ],
    ["wrong aggregate", { aggregateKind: "schedule_entry" }],
    ["wrong recipient", { recipientKind: "customer" }],
    ["wrong template", { templateKind: "booking_customer" }],
    ["extra envelope field", { privateValue: "private-sentinel" }],
    [
      "wrong purpose",
      {
        templateData: {
          ...snapshot().templateData,
          action: {
            ...snapshot().templateData.action,
            purpose: "newsletter_unsubscribe",
          },
        },
      },
    ],
    [
      "short lifetime",
      {
        templateData: {
          ...snapshot().templateData,
          action: {
            ...snapshot().templateData.action,
            expiresAt: "2026-07-10T09:59:59.999Z",
          },
        },
      },
    ],
    [
      "long lifetime",
      {
        templateData: {
          ...snapshot().templateData,
          action: {
            ...snapshot().templateData.action,
            expiresAt: "2026-07-10T10:00:00.001Z",
          },
        },
      },
    ],
  ])("fails closed on %s", (_label, change) => {
    const fixture = setup();
    expect(() => fixture.render(snapshot(change))).toThrow(
      NewsletterConfirmationRendererInputError,
    );
    expect(fixture.issueToken).not.toHaveBeenCalled();
  });

  it("rejects invalid or mismatched signed actions without reflection", () => {
    const realCodec = codec();
    const privateValue = "private-invalid-token";
    const invalidRender = createNewsletterConfirmationEmailRendererV1({
      tokenCodec: {
        issue: vi.fn(() => privateValue),
        verify: realCodec.verify.bind(realCodec),
      },
      now: () => NOW,
    });
    const otherToken = issue({
      ...CLAIMS,
      subscriberId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    });
    const mismatchRender = createNewsletterConfirmationEmailRendererV1({
      tokenCodec: {
        issue: vi.fn(() => otherToken),
        verify: realCodec.verify.bind(realCodec),
      },
      now: () => NOW,
    });

    for (const [render, secret] of [
      [invalidRender, privateValue],
      [mismatchRender, otherToken],
    ] as const) {
      let error: unknown;
      try {
        render(snapshot());
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(
        NewsletterConfirmationRendererOperationalError,
      );
      expect(String(error)).not.toContain(secret);
    }
  });

  it("classifies an unavailable snapshotted signing key as operational", () => {
    const fixture = setup();
    const privateKeyId = "missing_key";
    let error: unknown;
    try {
      fixture.render(
        snapshot({
          templateData: {
            ...snapshot().templateData,
            action: {
              ...snapshot().templateData.action,
              signingKeyId: privateKeyId,
            },
          },
        }),
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(
      NewsletterConfirmationRendererOperationalError,
    );
    expect(String(error)).not.toContain(privateKeyId);
  });

  it("fails configuration before accepting render input", () => {
    for (const configuration of [
      { tokenCodec: undefined, now: () => NOW },
      { tokenCodec: {}, now: () => NOW },
      { tokenCodec: { issue: vi.fn(), verify: vi.fn() }, now: undefined },
    ]) {
      expect(() =>
        createNewsletterConfirmationEmailRendererV1(configuration as never),
      ).toThrow(NewsletterConfirmationRendererConfigurationError);
    }
  });
});
