import { gunzipSync } from "node:zlib";

import { PostHog } from "posthog-node";
import { describe, expect, it } from "vitest";

const TEST_TOKEN = "phc_0123456789abcdefghijklmnop";
const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
const RELEASE = `gioia-beauty@${"a".repeat(40)}`;

describe("PostHog SDK wire envelope", () => {
  it("serializes only the approved app fields plus known SDK metadata", async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const client = new PostHog(TEST_TOKEN, {
      host: "https://eu.i.posthog.com",
      persistence: "memory",
      flushAt: 1,
      flushInterval: 0,
      requestTimeout: 500,
      fetchRetryCount: 0,
      fetchRetryDelay: 0,
      disableRemoteConfig: true,
      disableSurveys: true,
      preloadFeatureFlags: false,
      sendFeatureFlagEvent: false,
      enableExceptionAutocapture: false,
      disableGeoip: true,
      fetch: async (url, options) => {
        if (!(options.body instanceof Blob)) {
          throw new Error("Expected the PostHog batch transport to use a Blob");
        }
        const compressed = Buffer.from(await options.body.arrayBuffer());
        requests.push({
          url,
          body: gunzipSync(compressed).toString("utf8"),
        });
        return {
          status: 200,
          text: async () => "",
          json: async () => ({}),
        };
      },
    });

    await client.captureImmediate({
      distinctId: REQUEST_ID,
      event: "server_route_completed",
      disableGeoip: true,
      properties: {
        v: 1,
        route: "public.booking",
        method: "POST",
        requestId: REQUEST_ID,
        status: 201,
        outcome: "success",
        durationMs: 17,
        environment: "preview",
        release: RELEASE,
        $process_person_profile: false,
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://eu.i.posthog.com/batch/");
    const envelope = JSON.parse(requests[0]!.body) as Record<string, unknown>;
    expect(Object.keys(envelope).sort()).toEqual([
      "api_key",
      "batch",
      "sent_at",
    ]);
    expect(envelope.api_key).toBe(TEST_TOKEN);
    expect(envelope.sent_at).toEqual(expect.any(String));

    const batch = envelope.batch as Array<Record<string, unknown>>;
    expect(batch).toHaveLength(1);
    expect(Object.keys(batch[0]!).sort()).toEqual([
      "distinct_id",
      "event",
      "library",
      "library_version",
      "properties",
      "timestamp",
      "type",
      "uuid",
    ]);
    expect(batch[0]).toMatchObject({
      distinct_id: REQUEST_ID,
      event: "server_route_completed",
      library: "posthog-node",
      library_version: "5.21.2",
      type: "capture",
      properties: {
        v: 1,
        route: "public.booking",
        method: "POST",
        requestId: REQUEST_ID,
        status: 201,
        outcome: "success",
        durationMs: 17,
        environment: "preview",
        release: RELEASE,
        $process_person_profile: false,
        $lib: "posthog-node",
        $lib_version: "5.21.2",
        $geoip_disable: true,
      },
    });
    expect(batch[0]?.timestamp).toEqual(expect.any(String));
    expect(batch[0]?.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(requests[0]!.body).not.toMatch(
      /email|phone|telephone|cookie|authorization|customer|notes|address/i,
    );
  });
});
