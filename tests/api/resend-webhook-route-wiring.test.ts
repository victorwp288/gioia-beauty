import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import * as route from "@/app/api/webhooks/resend/route.ts";

describe("Resend webhook route wiring", () => {
  it("uses the Node runtime and remains disabled in the Test environment", async () => {
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.maxDuration).toBe(15);
    expect(route.POST).toEqual(expect.any(Function));

    const response = await route.POST(
      new Request("https://example.test/api/webhooks/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });
});
