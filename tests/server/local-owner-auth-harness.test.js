import { describe, expect, it } from "vitest";

import {
  CookieJar,
  parseLocalRouteStatus,
} from "../../scripts/local-owner-auth-harness.mjs";

describe("local owner Auth route harness", () => {
  it("accepts only the disposable loopback Supabase target", () => {
    const parsed = parseLocalRouteStatus({
      API_URL: "http://127.0.0.1:54321",
      DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      PUBLISHABLE_KEY: "synthetic-local-publishable-key",
    });
    expect(parsed.apiUrl.href).toBe("http://127.0.0.1:54321/");
    expect(parsed.databaseUrl).toContain("127.0.0.1:54322/postgres");

    expect(() =>
      parseLocalRouteStatus({
        API_URL: "https://remote.example.test",
        DB_URL: "postgresql://postgres:secret@remote.example.test/postgres",
        PUBLISHABLE_KEY: "synthetic-local-publishable-key",
      }),
    ).toThrow("unsafe local API URL");
  });

  it("accepts explicit non-default loopback ports without relaxing the host", () => {
    const parsed = parseLocalRouteStatus(
      {
        API_URL: "http://localhost:56321",
        DB_URL: "postgresql://postgres:postgres@127.0.0.1:56322/postgres",
        PUBLISHABLE_KEY: "synthetic-local-publishable-key",
      },
      { api: "56321", database: "56322" },
    );
    expect(parsed.apiUrl.port).toBe("56321");
    expect(parsed.databaseUrl).toContain("127.0.0.1:56322/postgres");
  });

  it("tracks set and expired cookies without exposing values", () => {
    const jar = new CookieJar();
    jar.apply(
      new Response(null, {
        headers: {
          "set-cookie": "one=first; Path=/, two=second; Path=/",
        },
      }),
    );
    expect(jar.has("one")).toBe(true);
    expect(jar.has("two")).toBe(true);
    expect(jar.attributeSets("one")).toEqual([["path=/"]]);

    jar.apply(
      new Response(null, {
        headers: { "set-cookie": "one=; Max-Age=0; Path=/" },
      }),
    );
    expect(jar.has("one")).toBe(false);
    expect(jar.header()).toContain("two=second");
  });
});
