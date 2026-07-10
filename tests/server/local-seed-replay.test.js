import path from "node:path";

import { describe, expect, it } from "vitest";

import { localSeedPath } from "../../scripts/replay-local-seed.mjs";

describe("local synthetic seed replay", () => {
  it("resolves only the reviewed seed inside the selected repository", () => {
    const root = path.resolve("/tmp/synthetic-gioia-repository");
    expect(localSeedPath(root)).toBe(
      path.join(root, "supabase", "seeds", "00_synthetic.sql"),
    );
  });
});
