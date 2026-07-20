import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const post = vi.hoisted(() => vi.fn());
const createRoute = vi.hoisted(() => vi.fn(() => post));
const observeRoute = vi.hoisted(() =>
  vi.fn((_route: string, _method: string, handler: unknown) => handler),
);

vi.mock("@/lib/server/nextOwnerSubscriberCommandRoute.ts", () => ({
  createNextOwnerSubscriberUnsubscribeRoute: createRoute,
}));
vi.mock("@/lib/server/observability/runtime", () => ({
  observeServerRoute: observeRoute,
}));

describe("owner subscriber unsubscribe route wiring", () => {
  it("exports one dynamic Node POST from the owner command factory", async () => {
    vi.resetModules();
    const route =
      await import("@/app/api/admin/subscribers/unsubscribe/route.ts");

    expect(route.dynamic).toBe("force-dynamic");
    expect(route.runtime).toBe("nodejs");
    expect(createRoute).toHaveBeenCalledOnce();
    expect(observeRoute).toHaveBeenCalledWith(
      "admin.subscribers.unsubscribe",
      "POST",
      post,
    );
    expect(route.POST).toBe(post);
  });
});
