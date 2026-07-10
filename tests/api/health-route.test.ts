import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import * as healthRoute from "@/app/api/health/route.ts";

describe("GET /api/health", () => {
  it("returns only a constant shallow-liveness response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("Health route must not perform network access");
    });
    const response = await healthRoute.GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is non-cacheable, non-indexable, and hardened", async () => {
    const response = await healthRoute.GET();

    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
  });

  it("exports a dynamic Node GET route", () => {
    expect(healthRoute.dynamic).toBe("force-dynamic");
    expect(healthRoute.runtime).toBe("nodejs");
    expect(healthRoute.GET).toEqual(expect.any(Function));
  });
});
