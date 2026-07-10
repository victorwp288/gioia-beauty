import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { auditClientServerBoundary } from "./client-server-boundary.ts";
import {
  cleanupFixtures,
  fixture,
  violationCodes,
} from "./client-boundary/test-fixture.ts";

afterEach(cleanupFixtures);

describe("client/server boundary graph", () => {
  it("keeps the real client graph and every database module inside the boundary", () => {
    expect(auditClientServerBoundary({ rootDir: process.cwd() })).toEqual([]);
  });

  it("pins the resolver assumptions used by the repository audit", () => {
    const tsconfig = JSON.parse(
      readFileSync(join(process.cwd(), "tsconfig.json"), "utf8"),
    ) as { compilerOptions?: { baseUrl?: unknown; paths?: unknown } };
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { imports?: unknown };

    expect(tsconfig.compilerOptions?.baseUrl).toBeUndefined();
    expect(tsconfig.compilerOptions?.paths).toEqual({ "@/*": ["./*"] });
    expect(packageJson.imports).toBeUndefined();
  });

  it("recognizes only a real directive prologue", () => {
    expect(
      violationCodes({
        "components/comment.jsx":
          '// "use client"\nimport "server-only";\nexport const x = 1;',
        "components/late.jsx":
          'const before = true;\n"use client";\nimport "server-only";',
        "components/real.jsx":
          '"use strict";\n"use client";\nimport "server-only";',
      }),
    ).toEqual(["FORBIDDEN_PACKAGE"]);
  });

  it.each([
    ["lib/client", "lib/client/browser.ts", "export const browser = true;"],
    [
      "client-only marker",
      "components/browser.ts",
      'import "client-only";\nexport const browser = true;',
    ],
  ])("treats %s modules as client roots", (_name, path, source) => {
    expect(
      violationCodes({ [path]: `${source}\nimport "server-only";` }),
    ).toEqual(["FORBIDDEN_PACKAGE"]);
  });

  it("discovers client roots outside the current application directories", () => {
    expect(
      violationCodes({
        "features/new-client.tsx": '"use client";\nimport "server-only";',
      }),
    ).toEqual(["FORBIDDEN_PACKAGE"]);
  });

  it.each([
    ["direct import", 'import "@/lib/server/secret";'],
    ["dynamic import", 'void import("@/lib/server/secret");'],
    ["require", 'require("@/lib/server/secret");'],
    ["require.resolve", 'require.resolve("@/lib/server/secret");'],
    ["computed require.resolve", 'require["resolve"]("@/lib/server/secret");'],
    ["module.require", 'module.require("@/lib/server/secret");'],
    ["computed module.require", 'module["require"]("@/lib/server/secret");'],
  ])("rejects a %s of a server module", (_name, edge) => {
    expect(
      violationCodes({
        "components/client.tsx": `"use client";\n${edge}`,
        "lib/server/secret.ts": 'import "server-only";\nexport const x = 1;',
      }),
    ).toContain("CLIENT_REACHES_SERVER_MODULE");
  });

  it("follows transitive index barrels and wildcard re-exports", () => {
    expect(
      violationCodes({
        "components/client.tsx": '"use client";\nimport "@/components/barrel";',
        "components/barrel/index.ts": 'export * from "../../shared/next";',
        "shared/next.ts": 'export { value } from "@/app/api/private/route";',
        "app/api/private/route.ts": "export const value = 1;",
      }),
    ).toContain("CLIENT_REACHES_API_ROUTE");
  });

  it("reports a deterministic client-root import chain", () => {
    const root = fixture({
      "components/client.tsx": '"use client";\nimport "./bridge";',
      "components/bridge.ts": 'export * from "@/lib/server/private";',
      "lib/server/private.ts": 'import "server-only";',
    });

    expect(auditClientServerBoundary({ rootDir: root })).toEqual([
      {
        code: "CLIENT_REACHES_SERVER_MODULE",
        module: "lib/server/private.ts",
        detail: "lib/server/private.ts",
        chain: [
          "components/client.tsx",
          "components/bridge.ts",
          "lib/server/private.ts",
        ],
      },
    ]);
  });

  it("traverses import cycles once without hanging", () => {
    expect(
      violationCodes({
        "components/client.tsx": '"use client";\nimport "./a";',
        "components/a.ts": 'import "./b";',
        "components/b.ts": 'import "./a";',
      }),
    ).toEqual([]);
  });

  it("allows imports and re-exports that are entirely type-only", () => {
    expect(
      violationCodes({
        "components/client.tsx":
          '"use client";\nimport type { Secret } from "@/lib/server/secret";\nexport { type Other } from "@/lib/server/other";',
        "lib/server/secret.ts":
          'import "server-only";\nexport interface Secret { value: string }',
        "lib/server/other.ts":
          'import "server-only";\nexport interface Other { value: string }',
      }),
    ).toEqual([]);
  });

  it("allows server components to import a safe client component", () => {
    expect(
      violationCodes({
        "app/page.tsx":
          'import Client from "@/components/client";\nexport default Client;',
        "components/client.tsx":
          '"use client";\nexport default function Client() { return <div />; }',
      }),
    ).toEqual([]);
  });
});
