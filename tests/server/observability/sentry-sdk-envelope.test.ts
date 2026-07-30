import * as Sentry from "@sentry/node";
import { describe, expect, it, vi } from "vitest";

import { sanitizeSentryEvent } from "@/lib/server/observability/providerRuntime.ts";
import type { ProviderConfiguration } from "@/lib/server/observability/providerConfiguration.ts";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: vi.fn() }));

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
const RELEASE = `gioia-beauty@${"a".repeat(40)}`;
const CONFIGURATION: ProviderConfiguration = Object.freeze({
  environment: "preview",
  release: RELEASE,
  sentryDsn: "https://0123456789abcdef@o123456.ingest.de.sentry.io/1234567",
  posthogProjectToken: "phc_0123456789abcdefghijklmnop",
  posthogHost: "https://eu.i.posthog.com",
});

describe("Sentry SDK wire envelope", () => {
  it("serializes only the fixed surrogate plus known SDK metadata", async () => {
    const envelopes: unknown[] = [];
    const client = Sentry.initWithoutDefaultIntegrations({
      dsn: CONFIGURATION.sentryDsn,
      environment: CONFIGURATION.environment,
      release: CONFIGURATION.release,
      skipOpenTelemetrySetup: true,
      registerEsmLoaderHooks: false,
      enableLogs: false,
      sendClientReports: false,
      includeLocalVariables: false,
      beforeSend: (event) => sanitizeSentryEvent(event, CONFIGURATION),
      transport: () => ({
        send: async (envelope) => {
          envelopes.push(envelope);
          return { statusCode: 200 };
        },
        flush: async () => true,
      }),
    });
    if (!client) throw new Error("Expected a Sentry client");
    const poison =
      "Mario mario@example.test +39 333 123 4567 Bearer abc " +
      "cookie=secret postgresql://user:password@example.test/gioia";
    const scope = new Sentry.Scope();
    scope.setTags({ route: "public.booking", method: "POST", poison });
    scope.setExtra("requestId", REQUEST_ID);
    scope.setExtra("poison", poison);

    client.captureException(new Error(poison), {}, scope);
    await client.flush(500);

    expect(envelopes).toHaveLength(1);
    const serialized = JSON.stringify(envelopes);
    expect(serialized).not.toContain(poison);
    expect(serialized).not.toContain("mario@example.test");
    expect(serialized).not.toContain("postgresql://");

    const wireEnvelopes = JSON.parse(serialized) as Array<
      [
        Record<string, unknown>,
        Array<[Record<string, unknown>, Record<string, unknown>]>,
      ]
    >;
    const envelope = wireEnvelopes[0] as [
      Record<string, unknown>,
      Array<[Record<string, unknown>, Record<string, unknown>]>,
    ];
    expect(envelope[0]).toMatchObject({
      event_id: expect.any(String),
      sent_at: expect.any(String),
      sdk: { name: "sentry.javascript.node", version: "10.69.0" },
    });
    const event = envelope[1][0]?.[1];
    expect(event).toMatchObject({
      event_id: expect.any(String),
      timestamp: expect.any(Number),
      platform: "node",
      level: "error",
      logger: "gioia.observability",
      environment: "preview",
      release: RELEASE,
      tags: { route: "public.booking", method: "POST" },
      extra: { requestId: REQUEST_ID },
      fingerprint: ["UNEXPECTED_SERVER_ERROR", "public.booking", "POST"],
      exception: {
        values: [
          {
            type: "UnexpectedServerError",
            value: "UNEXPECTED_SERVER_ERROR",
          },
        ],
      },
      sdk: {
        name: "sentry.javascript.node",
        version: "10.69.0",
        integrations: [],
        packages: [{ name: "npm:@sentry/node", version: "10.69.0" }],
      },
    });
    expect(Object.keys(event ?? {}).sort()).toEqual([
      "environment",
      "event_id",
      "exception",
      "extra",
      "fingerprint",
      "level",
      "logger",
      "platform",
      "release",
      "sdk",
      "tags",
      "timestamp",
    ]);
    await client.close(500);
  });
});
