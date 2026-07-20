import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupFixtures,
  violationCodes,
} from "./client-boundary/test-fixture.ts";

afterEach(cleanupFixtures);

describe("client/server boundary policy", () => {
  it.each([
    "@supabase/ssr",
    "@supabase/supabase-js",
    "firebase",
    "firebase/app",
    "firebase/auth",
    "firebase/firestore",
    "firebase/storage",
    "server-only",
    "postgres/cf",
    "resend",
    "svix/webhooks",
    "firebase-admin/app",
    "next/cache",
    "next/headers",
    "next/server",
    "next/cache.js",
    "next/headers.js",
    "next/server.js",
    "node:crypto",
    "node:test",
    "node:test/reporters",
    "sharp",
    "fs/promises",
  ])("rejects privileged package %s", (specifier) => {
    expect(
      violationCodes({
        "components/client.tsx": `"use client";\nimport ${JSON.stringify(specifier)};`,
      }),
    ).toEqual(["FORBIDDEN_PACKAGE"]);
  });

  it.each([
    ["unresolved", 'import "./missing";', "UNRESOLVED_LOCAL_IMPORT"],
    ["path escape", 'import "../../../outside";', "IMPORT_ESCAPES_ROOT"],
    ["dynamic import", "void import(target);", "DYNAMIC_IMPORT_SPECIFIER"],
    ["dynamic require", "require(target);", "DYNAMIC_IMPORT_SPECIFIER"],
  ] as const)("fails closed for %s", (_name, edge, expected) => {
    expect(
      violationCodes({
        "components/client.tsx": `"use client";\nconst target = "./safe";\n${edge}`,
        "components/safe.ts": "export const safe = true;",
      }),
    ).toContain(expected);
  });

  it.each([
    ["aliased require", "const loader = require;", "DYNAMIC_MODULE_LOADER"],
    [
      "aliased require.resolve",
      "const resolveModule = require.resolve;",
      "DYNAMIC_MODULE_LOADER",
    ],
    [
      "aliased module.require",
      "const loader = module.require;",
      "DYNAMIC_MODULE_LOADER",
    ],
    ["eval", 'eval("server-only");', "DYNAMIC_CODE_EXECUTION"],
    ["Function", 'new Function("return 1");', "DYNAMIC_CODE_EXECUTION"],
    [
      "computed global eval",
      'globalThis["eval"]("server-only");',
      "DYNAMIC_CODE_EXECUTION",
    ],
    ["aliased eval", "const run = eval;", "DYNAMIC_CODE_EXECUTION"],
    ["aliased Function", "const Ctor = Function;", "DYNAMIC_CODE_EXECUTION"],
    [
      "computed global require",
      'const loader = globalThis["require"];',
      "DYNAMIC_MODULE_LOADER",
    ],
    [
      "computed global createRequire",
      'const loader = globalThis["createRequire"];',
      "DYNAMIC_CODE_EXECUTION",
    ],
  ] as const)("rejects %s", (_name, source, expected) => {
    expect(
      violationCodes({
        "components/client.tsx": `"use client";\n${source}`,
      }),
    ).toContain(expected);
  });

  it("allows matching object-property names that are not global references", () => {
    expect(
      violationCodes({
        "components/client.tsx": [
          '"use client";',
          "const policy = { require: true, process: true, module: true, eval: true, Function: true };",
          "const object = {};",
          "void object.require; void object.process; void object.module; void object.eval; void object.Function;",
          "const callable = object instanceof Function;",
          'const view = <div process="safe" require="safe" />;',
          "void callable; void view;",
          "export default policy;",
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  it.each([
    "const globals = globalThis;",
    "const browser = window;",
    "const { process: runtime } = globalThis;",
    "const { eval: run, require: load } = window;",
    "consume(self);",
  ])("rejects global-object aliasing: %s", (source) => {
    expect(
      violationCodes({
        "components/client.tsx": `"use client";\nconst consume = () => undefined;\n${source}`,
      }),
    ).toContain("GLOBAL_OBJECT_ALIAS");
  });

  it("allows direct browser members and typeof probes", () => {
    expect(
      violationCodes({
        "components/client.tsx": [
          '"use client";',
          'export const browser = typeof window !== "undefined";',
          "export const storage = window.localStorage;",
          "export const origin = globalThis.location.origin;",
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  it("allows only reviewed static environment reads", () => {
    expect(
      violationCodes({
        "components/client.tsx": [
          '"use client";',
          "export const mode = process.env.NODE_ENV;",
          "export const api = process.env.NEXT_PUBLIC_API_URL;",
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  it.each([
    "process.env.SUPABASE_DATABASE_URL",
    "process.env.BOOKING_HMAC_SECRET",
    "process.env.OWNER_SESSION_HMAC_SECRET",
    "process.env.RESEND_API_KEY",
    "process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
    "process.env.NEXT_PUBLIC_UNREVIEWED_VALUE",
    'process.env["NEXT_PUBLIC_API_URL"]',
    'process["env"].NEXT_PUBLIC_API_URL',
    "const { NEXT_PUBLIC_API_URL } = process.env",
    "const environment = process.env",
    "const environment = process",
    "globalThis.process.env.NEXT_PUBLIC_API_URL",
    'globalThis["process"].env.NEXT_PUBLIC_API_URL',
    'window["process"].env.NEXT_PUBLIC_API_URL',
    "process?.env.NEXT_PUBLIC_API_URL",
    "process.env?.NEXT_PUBLIC_API_URL",
    'process.env.NEXT_PUBLIC_API_URL = "changed"',
    "delete process.env.NEXT_PUBLIC_API_URL",
    "import.meta.env.NEXT_PUBLIC_API_URL",
    'import.meta["env"].NEXT_PUBLIC_API_URL',
  ])("rejects non-public or non-static environment access: %s", (access) => {
    expect(
      violationCodes({
        "components/client.tsx": `"use client";\nexport const value = (() => { ${access}; return true; })();`,
      }),
    ).toContain("FORBIDDEN_ENV_ACCESS");
  });
});
