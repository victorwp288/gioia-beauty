import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  OUTBOX_ACTIVATION_READINESS_CONTRACT_VERSION,
  OutboxActivationReadinessSchema,
  getOutboxActivationReadiness,
} from "@/lib/server/email/outboxActivationReadiness.ts";
import { GREENFIELD_SUPABASE_REF } from "@/config/environment.mjs";
import {
  GREENFIELD_REMOTE_PGTAP_FILES,
  GREENFIELD_REVIEWED_MANIFEST_SHA256,
  GREENFIELD_TARGET_VERSIONS,
  remotePgTapFiles,
} from "../../scripts/test-target-migrations.mjs";

const EXPECTED = {
  contractVersion: 2,
  gate: "outbox_worker_scheduler",
  scope: "non_production_test",
  ready: true,
  productionReady: false,
  proofs: [
    {
      code: "CLAIM_DISPOSITIONS_PROVEN",
      artifact: "claim-dispositions-v2",
    },
    {
      code: "DEAD_LETTER_MONITOR_PROVEN",
      artifact: "dead-letter-monitor-v1",
    },
    {
      code: "RETRY_CUTOFF_PROVEN",
      artifact: "provider-retry-window-v1",
    },
    {
      code: "NEWSLETTER_SNAPSHOT_PROVEN",
      artifact: "newsletter-confirmation-snapshot-v1",
    },
  ],
  testManifest: {
    artifact: "greenfield-test-reviewed-manifest-v2",
    projectRef: "hzibzwhrwmljgjjdzspi",
    reviewedManifestSha256:
      "24fb7a931352fa3c24cf0eef76ef56709da7183c40cc22583e1770da9e993c44",
    migrationCount: 67,
    pgtapFiles: 30,
    pgtapAssertions: 473,
  },
} as const;

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const PRODUCTION_DIRECTORIES = [
  "app",
  "components",
  "config",
  "context",
  "data",
  "hooks",
  "lib",
  "pages",
  "src",
] as const;

function sourceFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [entryPath] : [];
  });
}

function rootSourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name)),
    )
    .map((entry) => join(root, entry.name));
}

describe("non-production outbox activation readiness v2", () => {
  it("returns the exact deterministic TEST acceptance contract", () => {
    const first = getOutboxActivationReadiness();
    const second = getOutboxActivationReadiness();

    expect(OUTBOX_ACTIVATION_READINESS_CONTRACT_VERSION).toBe(2);
    expect(getOutboxActivationReadiness.length).toBe(0);
    expect(first).toBe(second);
    expect(first).toEqual(EXPECTED);
    expect(OutboxActivationReadinessSchema.safeParse(first).success).toBe(true);
    expect(new Set(first.proofs.map(({ code }) => code)).size).toBe(4);
    expect(first.productionReady).toBe(false);
  });

  it("deep-freezes every code-owned readiness value", () => {
    const readiness = getOutboxActivationReadiness();

    expect(Object.isFrozen(readiness)).toBe(true);
    expect(Object.isFrozen(readiness.proofs)).toBe(true);
    expect(readiness.proofs.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(readiness.testManifest)).toBe(true);
    expect(Reflect.set(readiness, "productionReady", true)).toBe(false);
    expect(Reflect.deleteProperty(readiness.proofs, "0")).toBe(false);
    expect(Reflect.set(readiness.proofs[0], "code", "FORGED")).toBe(false);
    expect(getOutboxActivationReadiness()).toEqual(EXPECTED);
  });

  it("cannot be changed by caller claims, hashes, environment, or PII", () => {
    const privateValue = "private-customer@example.test";
    const forgedCall = getOutboxActivationReadiness as unknown as (
      ...values: unknown[]
    ) => unknown;
    const result = forgedCall(
      {
        productionReady: true,
        evidence: "a".repeat(64),
        privateValue,
      },
      { process: { env: { OUTBOX_READY: "true" } } },
    );

    expect(result).toEqual(EXPECTED);
    expect(JSON.stringify(result)).not.toContain(privateValue);
    expect(JSON.stringify(result)).not.toContain("OUTBOX_READY");
  });

  it.each([
    { ...EXPECTED, productionReady: true },
    { ...EXPECTED, proofs: EXPECTED.proofs.slice(1) },
    {
      ...EXPECTED,
      proofs: [
        EXPECTED.proofs[1],
        EXPECTED.proofs[0],
        ...EXPECTED.proofs.slice(2),
      ],
    },
    {
      ...EXPECTED,
      proofs: [
        { ...EXPECTED.proofs[0], artifact: "claim-dispositions-v1" },
        ...EXPECTED.proofs.slice(1),
      ],
    },
    {
      ...EXPECTED,
      testManifest: { ...EXPECTED.testManifest, migrationCount: 63 },
    },
    { ...EXPECTED, privateValue: "private-sentinel" },
    {
      ...EXPECTED,
      proofs: [
        { ...EXPECTED.proofs[0], extra: true },
        ...EXPECTED.proofs.slice(1),
      ],
    },
  ])("rejects malformed or widened readiness shape %#", (candidate) => {
    expect(OutboxActivationReadinessSchema.safeParse(candidate).success).toBe(
      false,
    );
  });

  it("binds accepted evidence to the current reviewed TEST manifest", () => {
    const manifest = getOutboxActivationReadiness().testManifest;
    const suite = remotePgTapFiles();

    expect(manifest.projectRef).toBe(GREENFIELD_SUPABASE_REF);
    expect(manifest.reviewedManifestSha256).toBe(
      GREENFIELD_REVIEWED_MANIFEST_SHA256,
    );
    expect(manifest.migrationCount).toBe(GREENFIELD_TARGET_VERSIONS.length);
    expect(manifest.pgtapFiles).toBe(GREENFIELD_REMOTE_PGTAP_FILES.length);
    expect(manifest.pgtapAssertions).toBe(suite.assertions);
  });

  it("stays provider-free while gating one safe non-production composition", () => {
    const root = process.cwd();
    const modulePath = resolve(
      root,
      "lib/server/email/outboxActivationReadiness.ts",
    );
    const source = readFileSync(modulePath, "utf8");
    expect(source.startsWith('import "server-only";')).toBe(true);
    expect(source.split("\n").length).toBeLessThanOrEqual(180);
    for (const forbidden of [
      "process.env",
      "node:fs",
      "node:crypto",
      "fetch(",
      "Date.now",
      "Math.random",
      "setTimeout",
      "createRuntimeDatabase",
      "createEmailProvider",
      "createEmailOutboxRepository",
      "newsletterConfirmationEmailV1",
      "outboxWorkerInvocation",
    ]) {
      expect(source).not.toContain(forbidden);
    }

    const productionSources = [
      ...PRODUCTION_DIRECTORIES.flatMap((path) =>
        sourceFiles(resolve(root, path)),
      ),
      ...rootSourceFiles(root),
    ];
    const importers = productionSources
      .filter((path) => path !== modulePath)
      .filter((path) =>
        readFileSync(path, "utf8").includes("outboxActivationReadiness"),
      );
    const localTestRuntimePath = resolve(
      root,
      "lib/server/email/localTestOutboxRuntime.ts",
    );
    expect(importers).toEqual([localTestRuntimePath]);
    const compositionDefinitions = new Set(
      [
        "lib/server/database/emailOutboxRepository.ts",
        "lib/server/email/emailProvider.ts",
        "lib/server/email/outboxWorker.ts",
        "lib/server/email/outboxWorkerInvocation.ts",
      ].map((path) => resolve(root, path)),
    );
    const activationSources = productionSources
      .filter((path) => !compositionDefinitions.has(path))
      .filter((path) => {
        const text = readFileSync(path, "utf8");
        return [
          "createEmailOutboxRepository",
          "createEmailProvider",
          "createOutboxWorkerInvocationGetHandler",
          "createOutboxWorker",
        ].some((identifier) => text.includes(identifier));
      });
    const cronRoutePath = resolve(root, "app/api/cron/outbox/route.ts");
    expect(activationSources.sort()).toEqual(
      [cronRoutePath, localTestRuntimePath].sort(),
    );
    expect(sourceFiles(resolve(root, "app/api/cron/outbox"))).toEqual([
      cronRoutePath,
    ]);

    const localTestRuntime = readFileSync(localTestRuntimePath, "utf8");
    expect(localTestRuntime).toContain('validation.appEnv === "preview"');
    expect(localTestRuntime).toContain(
      "env.SUPABASE_PROJECT_REF === GREENFIELD_SUPABASE_REF",
    );
    expect(localTestRuntime).toContain('env.VERCEL_ENV === "preview"');
    expect(localTestRuntime).toContain('env.EMAIL_TRANSPORT !== "fake"');
    expect(localTestRuntime).toContain("readiness.productionReady");
    expect(localTestRuntime).toContain("createFakeEmailProvider()");
    expect(localTestRuntime).not.toContain("createEmailProvider(");

    const cronRoute = readFileSync(cronRoutePath, "utf8");
    expect(cronRoute).toContain("createLocalTestOutboxRuntime()");
    expect(cronRoute).toContain('apiErrorResponse(503, "SERVICE_UNAVAILABLE")');
    expect(existsSync(resolve(root, "vercel.json"))).toBe(false);

    const packageSource = readFileSync(resolve(root, "package.json"), "utf8");
    expect(packageSource).not.toMatch(
      /api\/cron\/outbox|outboxWorkerInvocation|outboxActivationReadiness/,
    );
    const workflowSources = sourceFiles(resolve(root, ".github/workflows"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(workflowSources).not.toMatch(/api\/cron\/outbox|outboxWorker/);
    expect(workflowSources).not.toMatch(/(?:^|\n)\s*schedule\s*:/);
  });
});
