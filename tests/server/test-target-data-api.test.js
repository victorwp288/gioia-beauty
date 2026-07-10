import { describe, expect, it } from "vitest";

import {
  runTestTargetDataApiProbes,
  TestTargetDataApiError,
} from "../../scripts/test-target-data-api.mjs";
import {
  TEST_TARGET_API_URL,
  TEST_TARGET_REF,
} from "../../scripts/test-target-config.mjs";

const PUBLIC_KEY = `sb_publishable_${"p".repeat(32)}`;

function testConfig(overrides = {}) {
  return {
    apiUrl: `${TEST_TARGET_API_URL}/`,
    environment: "test",
    projectRef: TEST_TARGET_REF,
    getPublishableKey: () => PUBLIC_KEY,
    ...overrides,
  };
}

function jsonResponse(status, value, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function successfulResponses(openApiStatus = 200) {
  const openApi =
    openApiStatus === 200
      ? jsonResponse(200, { openapi: "3.0.0", paths: {} })
      : jsonResponse(openApiStatus, { code: "OPENAPI_FORBIDDEN" });
  return [
    openApi,
    jsonResponse(404, { code: "PGRST205" }),
    jsonResponse(404, { code: "PGRST205" }),
    jsonResponse(406, { code: "PGRST106" }),
    jsonResponse(404, { code: "PGRST202" }),
    jsonResponse(406, { code: "PGRST106" }),
  ];
}

function queueFetch(responses, requests = []) {
  return async (url, options) => {
    requests.push({ url, options });
    const response = responses.shift();
    if (!response) throw new Error("unexpected request");
    return response;
  };
}

describe("greenfield TEST Data API boundary probes", () => {
  it("uses six bounded read-only requests and returns only safe diagnostics", async () => {
    const requests = [];
    const responses = successfulResponses();

    const result = await runTestTargetDataApiProbes(testConfig(), {
      fetchImpl: queueFetch(responses, requests),
    });

    expect(responses).toHaveLength(0);
    expect(result).toEqual({
      ok: true,
      projectRef: TEST_TARGET_REF,
      probes: [
        { name: "openapi", status: 200 },
        { name: "public-customer-table", status: 404 },
        { name: "public-business-table", status: 404 },
        { name: "private-customer-table", status: 406 },
        { name: "public-private-rpc", status: 404 },
        { name: "private-rpc", status: 406 },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(PUBLIC_KEY);
    expect(requests).toHaveLength(6);
    expect(requests.every(({ options }) => options.method === "GET")).toBe(
      true,
    );
    expect(requests.every(({ options }) => options.redirect === "error")).toBe(
      true,
    );
    expect(requests[1].url.searchParams.get("limit")).toBe("1");
    expect(requests[2].url.searchParams.get("limit")).toBe("1");
    expect(requests[3].options.headers.get("accept-profile")).toBe(
      "gioia_private",
    );
    expect(requests[5].options.headers.get("accept-profile")).toBe(
      "gioia_private",
    );
    for (const { url, options } of requests) {
      expect(url.origin).toBe(TEST_TARGET_API_URL);
      expect(options.credentials).toBe("omit");
      expect(options.headers.get("apikey")).toBe(PUBLIC_KEY);
      expect(options.headers.has("authorization")).toBe(false);
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it.each([401, 403])(
    "accepts the current OpenAPI %s denial while still checking resources",
    async (status) => {
      const responses = successfulResponses(status);

      const result = await runTestTargetDataApiProbes(testConfig(), {
        fetchImpl: queueFetch(responses),
      });

      expect(result.probes[0]).toEqual({ name: "openapi", status });
      expect(result.probes.slice(1).map((probe) => probe.status)).toEqual([
        404, 404, 406, 404, 406,
      ]);
    },
  );

  it("rejects any resource path in an available OpenAPI document", async () => {
    const leakedDocument = {
      openapi: "3.0.0",
      paths: { "/schedule_entries": { get: {} } },
      components: { schemas: { schedule_entries: { type: "object" } } },
    };
    const fetchImpl = queueFetch([jsonResponse(200, leakedDocument)]);

    await expect(
      runTestTargetDataApiProbes(testConfig(), { fetchImpl }),
    ).rejects.toMatchObject({
      code: "OPENAPI_EXPOSED_RESOURCE",
      probe: "openapi",
      status: 200,
    });
  });

  it("rejects successful direct reads and never includes response data in errors", async () => {
    const privateValue = "private-customer-value";
    const responses = successfulResponses();
    responses[1] = jsonResponse(200, [{ id: privateValue }]);

    let error;
    try {
      await runTestTargetDataApiProbes(testConfig(), {
        fetchImpl: queueFetch(responses),
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(TestTargetDataApiError);
    expect(error).toMatchObject({
      code: "UNEXPECTED_STATUS",
      probe: "public-customer-table",
      status: 200,
    });
    expect(error.message).not.toContain(privateValue);
    expect(JSON.stringify(error)).not.toContain(privateValue);
    expect(JSON.stringify(error)).not.toContain(PUBLIC_KEY);
  });

  it("rejects echoed credentials and oversized bodies with redacted errors", async () => {
    for (const response of [
      jsonResponse(403, { echoed: PUBLIC_KEY }),
      jsonResponse(403, { error: "sb_secret_synthetic-leak" }),
      jsonResponse(403, { error: "x" }, { "content-length": "32769" }),
      new Response("x".repeat(32_769), { status: 403 }),
    ]) {
      let error;
      try {
        await runTestTargetDataApiProbes(testConfig(), {
          fetchImpl: queueFetch([response]),
        });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(TestTargetDataApiError);
      expect(["SENSITIVE_RESPONSE", "RESPONSE_TOO_LARGE"]).toContain(
        error.code,
      );
      expect(error.message).not.toContain(PUBLIC_KEY);
      expect(JSON.stringify(error)).not.toContain(PUBLIC_KEY);
      expect(error.message).not.toContain("sb_secret_synthetic-leak");
    }
  });

  it("rejects non-TEST targets, invalid keys, and unbounded timeouts before fetch", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonResponse(404, {});
    };

    await expect(
      runTestTargetDataApiProbes(
        testConfig({ apiUrl: "https://attacker.invalid/" }),
        { fetchImpl },
      ),
    ).rejects.toMatchObject({ code: "UNSAFE_TARGET" });
    await expect(
      runTestTargetDataApiProbes(
        testConfig({ getPublishableKey: () => "legacy-anon-jwt" }),
        { fetchImpl },
      ),
    ).rejects.toMatchObject({ code: "INVALID_PUBLIC_KEY" });
    await expect(
      runTestTargetDataApiProbes(testConfig(), {
        fetchImpl,
        timeoutMs: 60_000,
      }),
    ).rejects.toMatchObject({ code: "INVALID_TIMEOUT" });
    expect(calls).toBe(0);
  });

  it("does not mistake gateway authentication failures for resource isolation", async () => {
    const responses = [
      jsonResponse(403, { code: "OPENAPI_FORBIDDEN" }),
      jsonResponse(401, { code: "INVALID_API_KEY" }),
    ];

    await expect(
      runTestTargetDataApiProbes(testConfig(), {
        fetchImpl: queueFetch(responses),
      }),
    ).rejects.toMatchObject({
      code: "UNEXPECTED_STATUS",
      probe: "public-customer-table",
      status: 401,
    });
  });

  it("aborts a stalled request within the configured bound", async () => {
    const fetchImpl = async (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("timed out")), {
          once: true,
        });
      });

    await expect(
      runTestTargetDataApiProbes(testConfig(), { fetchImpl, timeoutMs: 5 }),
    ).rejects.toMatchObject({
      code: "REQUEST_FAILED",
      probe: "openapi",
    });
  });

  it("maps transport failures to secret-safe errors", async () => {
    const transportSecret = "transport-secret-value";

    let error;
    try {
      await runTestTargetDataApiProbes(testConfig(), {
        fetchImpl: async () => {
          throw new Error(transportSecret);
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "REQUEST_FAILED",
      probe: "openapi",
    });
    expect(error.message).not.toContain(transportSecret);
    expect(JSON.stringify(error)).not.toContain(transportSecret);
  });
});
