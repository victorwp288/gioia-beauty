import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  OUTBOX_ACTIVATION_READINESS_CONTRACT_VERSION,
  OutboxActivationReadinessSchema,
  getOutboxActivationReadiness,
} from "@/lib/server/email/outboxActivationReadiness.ts";

const EXPECTED = {
  contractVersion: 1,
  gate: "outbox_worker_scheduler",
  ready: false,
  blockers: [
    {
      code: "CLAIM_DISPOSITIONS_UNPROVEN",
      requiredProof: "claim-dispositions-v2",
    },
    {
      code: "DEAD_LETTER_MONITOR_UNPROVEN",
      requiredProof: "dead-letter-monitor-v1",
    },
    {
      code: "RETRY_CUTOFF_UNPERSISTED",
      requiredProof: "provider-retry-window-v1",
    },
    {
      code: "NEWSLETTER_SNAPSHOT_UNVERSIONED",
      requiredProof: "newsletter-confirmation-snapshot-v1",
    },
    {
      code: "TEST_CHECKPOINT_UNPROVEN",
      requiredProof: "greenfield-test-37-v1",
    },
  ],
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

describe("inert outbox activation readiness v1", () => {
  it("returns the exact deterministic non-passable contract", () => {
    const first = getOutboxActivationReadiness();
    const second = getOutboxActivationReadiness();

    expect(OUTBOX_ACTIVATION_READINESS_CONTRACT_VERSION).toBe(1);
    expect(getOutboxActivationReadiness.length).toBe(0);
    expect(first).toBe(second);
    expect(first).toEqual(EXPECTED);
    expect(OutboxActivationReadinessSchema.safeParse(first).success).toBe(true);
    expect(new Set(first.blockers.map(({ code }) => code)).size).toBe(5);
  });

  it("deep-freezes every code-owned readiness value", () => {
    const readiness = getOutboxActivationReadiness();

    expect(Object.isFrozen(readiness)).toBe(true);
    expect(Object.isFrozen(readiness.blockers)).toBe(true);
    expect(readiness.blockers.every(Object.isFrozen)).toBe(true);
    expect(Reflect.set(readiness, "ready", true)).toBe(false);
    expect(Reflect.deleteProperty(readiness.blockers, "0")).toBe(false);
    expect(Reflect.set(readiness.blockers[0], "code", "FORGED")).toBe(false);
    expect(getOutboxActivationReadiness()).toEqual(EXPECTED);
  });

  it("cannot be changed by caller claims, hashes, environment, or PII", () => {
    const privateValue = "private-customer@example.test";
    const forgedCall = getOutboxActivationReadiness as unknown as (
      ...values: unknown[]
    ) => unknown;
    const result = forgedCall(
      {
        ready: true,
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
    { ...EXPECTED, ready: true },
    { ...EXPECTED, blockers: EXPECTED.blockers.slice(1) },
    {
      ...EXPECTED,
      blockers: [
        EXPECTED.blockers[1],
        EXPECTED.blockers[0],
        ...EXPECTED.blockers.slice(2),
      ],
    },
    {
      ...EXPECTED,
      blockers: [
        { ...EXPECTED.blockers[0], requiredProof: "claim-dispositions-v1" },
        ...EXPECTED.blockers.slice(1),
      ],
    },
    { ...EXPECTED, privateValue: "private-sentinel" },
    {
      ...EXPECTED,
      blockers: [
        { ...EXPECTED.blockers[0], extra: true },
        ...EXPECTED.blockers.slice(1),
      ],
    },
  ])("rejects malformed or widened readiness shape %#", (candidate) => {
    expect(OutboxActivationReadinessSchema.safeParse(candidate).success).toBe(
      false,
    );
  });

  it("stays inert while allowing only fail-closed Local/Test activation", () => {
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
    expect(importers).toEqual([]);
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
    const localTestRuntimePath = resolve(
      root,
      "lib/server/email/localTestOutboxRuntime.ts",
    );
    const cronRoutePath = resolve(root, "app/api/cron/outbox/route.ts");
    expect(activationSources.sort()).toEqual(
      [cronRoutePath, localTestRuntimePath].sort(),
    );
    expect(sourceFiles(resolve(root, "app/api/cron/outbox"))).toEqual([
      cronRoutePath,
    ]);

    const localTestRuntime = readFileSync(localTestRuntimePath, "utf8");
    expect(localTestRuntime).toContain(
      '!["local", "test"].includes(validation.appEnv ?? "")',
    );
    expect(localTestRuntime).toContain('env.EMAIL_TRANSPORT !== "fake"');
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
