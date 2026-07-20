import { describe, expect, it } from "vitest";

import { localSupabasePorts } from "../../scripts/local-supabase-ports.mjs";

describe("local Supabase port overrides", () => {
  it("defaults to the reviewed Supabase CLI ports", () => {
    expect(localSupabasePorts({})).toEqual({
      api: "54321",
      database: "54322",
    });
  });

  it("accepts only canonical explicit TCP ports", () => {
    expect(
      localSupabasePorts({
        GIOIA_LOCAL_SUPABASE_API_PORT: "56321",
        GIOIA_LOCAL_SUPABASE_DB_PORT: "56322",
      }),
    ).toEqual({ api: "56321", database: "56322" });

    for (const candidate of ["0", "06500", "65536", "54321/path", "abc"])
      expect(() =>
        localSupabasePorts({
          GIOIA_LOCAL_SUPABASE_API_PORT: candidate,
        }),
      ).toThrow("canonical local TCP port");
  });
});
