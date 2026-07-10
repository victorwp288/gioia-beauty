import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { auditClientServerBoundary } from "./client-server-boundary.ts";
import {
  cleanupFixtures,
  fixture,
  violationCodes,
} from "./client-boundary/test-fixture.ts";

afterEach(cleanupFixtures);

describe("client/server boundary resolution", () => {
  it("allows existing static assets as terminal imports", () => {
    expect(
      violationCodes({
        "components/client.tsx":
          '"use client";\nimport logo from "@/images/logo.png";\nimport "./style.css";\nexport default logo;',
        "components/style.css": ".safe {}",
        "images/logo.png": "synthetic",
      }),
    ).toEqual([]);
  });

  it.each([
    ["lib/server/secret.json", "CLIENT_REACHES_SERVER_MODULE"],
    ["app/api/private/style.css", "CLIENT_REACHES_API_ROUTE"],
  ] as const)("rejects a terminal client import from %s", (path, code) => {
    expect(
      violationCodes({
        "components/client.tsx": `"use client";\nimport value from "@/${path}";\nexport default value;`,
        [path]: "synthetic",
      }),
    ).toEqual([code]);
  });

  it.each([
    'import "/absolute/server";',
    'import "file:///tmp/server.js";',
    'import "https://example.invalid/module.js";',
    'import "data:text/javascript,export default 1";',
    'import "C:\\\\outside\\\\server.js";',
    'import "C:/outside/server.js";',
    'import "./module?raw";',
    'import "./module#fragment";',
  ])("rejects unsafe import framing: %s", (edge) => {
    expect(
      violationCodes({
        "components/client.tsx": `"use client";\n${edge}`,
      }),
    ).toEqual(["UNSAFE_IMPORT_SPECIFIER"]);
  });

  it("rejects ambiguous extensionless local imports", () => {
    expect(
      violationCodes({
        "components/client.tsx": '"use client";\nimport "./dependency";',
        "components/dependency.js": "export const value = 1;",
        "components/dependency.ts": "export const value = 2;",
      }),
    ).toEqual(["AMBIGUOUS_LOCAL_IMPORT"]);
  });

  it("rejects case-mismatched local imports on every filesystem", () => {
    expect(
      violationCodes({
        "components/client.tsx": '"use client";\nimport "./safe";',
        "components/Safe.ts": "export const safe = true;",
      }),
    ).toEqual(["UNRESOLVED_LOCAL_IMPORT"]);
  });

  it("follows TypeScript source substitution for an explicit .js import", () => {
    expect(
      violationCodes({
        "components/client.tsx": '"use client";\nimport "./bridge.js";',
        "components/bridge.ts": 'import "server-only";',
      }),
    ).toEqual(["FORBIDDEN_PACKAGE"]);
  });

  it("traverses imported source from an excluded discovery root", () => {
    expect(
      violationCodes({
        "components/client.tsx": '"use client";\nimport "@/scripts/generated";',
        "scripts/generated.ts": 'import "server-only";',
      }),
    ).toEqual(["FORBIDDEN_PACKAGE"]);
  });

  it.each(["ts", "mts", "cts"])(
    "requires every .%s database module to lead with server-only",
    (extension) => {
      expect(
        violationCodes({
          "lib/server/database/good.ts":
            '// comments are harmless\nimport "server-only";\nexport const good = true;',
          [`lib/server/database/late.${extension}`]:
            'import { z } from "zod";\nimport "server-only";',
        }),
      ).toEqual(["DATABASE_MODULE_MISSING_SERVER_ONLY"]);
    },
  );

  it("rejects malformed client source instead of trusting a partial AST", () => {
    expect(
      violationCodes({
        "components/client.tsx": '"use client";\nimport {',
      }),
    ).toEqual(["SOURCE_PARSE_ERROR"]);
  });

  it("fails closed before root classification on malformed source", () => {
    expect(
      violationCodes({
        "components/malformed.ts": "export const value = ;",
      }),
    ).toEqual(["SOURCE_PARSE_ERROR"]);
  });

  it("rejects source symlinks without following them", () => {
    const root = fixture({
      "shared/client.tsx": '"use client";\nexport const value = true;',
    });
    mkdirSync(join(root, "components"), { recursive: true });
    symlinkSync("../shared/client.tsx", join(root, "components/client.tsx"));

    expect(
      auditClientServerBoundary({ rootDir: root }).map(({ code }) => code),
    ).toEqual(["SOURCE_SYMLINK"]);
  });

  it.each(["mjs", "cjs", "mts", "cts"])(
    "parses client-reachable .%s modules",
    (extension) => {
      expect(
        violationCodes({
          "components/client.tsx": `"use client";\nimport "./dependency.${extension}";`,
          [`components/dependency.${extension}`]: 'import "server-only";',
        }),
      ).toEqual(["FORBIDDEN_PACKAGE"]);
    },
  );

  it("parses JSX and TSX dependencies", () => {
    expect(
      violationCodes({
        "components/client.tsx":
          '"use client";\nimport View from "./view.jsx";\nexport default function Client() { return <View />; }',
        "components/view.jsx":
          'import "server-only";\nexport default function View() { return <div />; }',
      }),
    ).toEqual(["FORBIDDEN_PACKAGE"]);
  });
});
