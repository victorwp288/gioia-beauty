import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const guardedPost = vi.hoisted(() => vi.fn());
const createGuardedRoute = vi.hoisted(() => vi.fn(() => guardedPost));

vi.mock("@/lib/server/nextOwnerOutboxRetryRoute.ts", () => ({
  createNextOwnerOutboxRetryRoute: createGuardedRoute,
}));

describe("owner outbox retry route wiring", () => {
  it("exports one dynamic Node POST from the guarded factory", async () => {
    vi.resetModules();
    const route = await import("@/app/api/admin/outbox/retry/route.ts");

    expect(route.dynamic).toBe("force-dynamic");
    expect(route.runtime).toBe("nodejs");
    expect(createGuardedRoute).toHaveBeenCalledOnce();
    expect(createGuardedRoute).toHaveBeenCalledWith();
    expect(route.POST).toBe(guardedPost);
  });
});
