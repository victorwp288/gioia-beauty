import { describe, expect, it, vi } from "vitest";

import {
  parsePreviewDeploymentEvidence,
  resolvePreviewDeployment,
} from "../../scripts/preview-e2e-deployment.mjs";

const COMMIT = "a".repeat(40);
const DEPLOYMENT_ID = `dpl_${"C".repeat(24)}`;
const UNIQUE_HOST =
  "gioia-beauty-wgh2rxupe-victor-wejergang-petersens-projects.vercel.app";
const ALIAS =
  "gioia-beauty-git-refactor-victor-wejergang-petersens-projects.vercel.app";

function inspection(overrides = {}) {
  return JSON.stringify({
    id: DEPLOYMENT_ID,
    name: "gioia-beauty",
    url: UNIQUE_HOST,
    target: null,
    readyState: "READY",
    source: "git",
    branchAlias: ALIAS,
    meta: { githubCommitSha: COMMIT, githubCommitRef: "refactor" },
    aliases: [ALIAS],
    contextName: "victor-wejergang-petersens-projects",
    ...overrides,
  });
}

function listing(overrides = {}) {
  return JSON.stringify({
    contextName: "victor-wejergang-petersens-projects",
    deployments: [
      {
        id: DEPLOYMENT_ID,
        name: "gioia-beauty",
        url: UNIQUE_HOST,
        state: "READY",
        target: null,
        meta: { githubCommitSha: COMMIT, githubCommitRef: "refactor" },
        ...overrides,
      },
    ],
  });
}

describe("Preview deployment evidence", () => {
  it("binds the stable branch alias to one READY unique deployment at HEAD", () => {
    expect(
      parsePreviewDeploymentEvidence({
        commitSha: COMMIT,
        inspectOutput: inspection(),
        listOutput: listing(),
      }),
    ).toEqual({
      baseURL: `https://${UNIQUE_HOST}/`,
      commitSha: COMMIT,
      deploymentId: DEPLOYMENT_ID,
    });
  });

  it("captures the immutable URL so later alias reassignment cannot redirect writes", () => {
    const resolved = parsePreviewDeploymentEvidence({
      commitSha: COMMIT,
      inspectOutput: inspection(),
      listOutput: listing(),
    });
    const reassignedId = `dpl_${"D".repeat(24)}`;
    const reassignedHost =
      "gioia-beauty-newhash-victor-wejergang-petersens-projects.vercel.app";
    const reassigned = parsePreviewDeploymentEvidence({
      commitSha: COMMIT,
      inspectOutput: inspection({
        id: reassignedId,
        url: reassignedHost,
      }),
      listOutput: listing({ id: reassignedId, url: reassignedHost }),
    });

    expect(JSON.parse(inspection()).branchAlias).toBe(
      JSON.parse(inspection({ id: reassignedId, url: reassignedHost }))
        .branchAlias,
    );
    expect(reassigned.baseURL).toBe(`https://${reassignedHost}/`);
    expect(resolved.baseURL).toBe(`https://${UNIQUE_HOST}/`);
    expect(resolved.baseURL).not.toBe(`https://${ALIAS}/`);
  });

  it.each([
    ["Production target", inspection({ target: "production" }), listing()],
    ["non-git source", inspection({ source: "cli" }), listing()],
    ["unstable alias", inspection({ aliases: [] }), listing()],
    ["wrong branch alias", inspection({ branchAlias: UNIQUE_HOST }), listing()],
    [
      "wrong inspected commit",
      inspection({
        meta: {
          githubCommitSha: "b".repeat(40),
          githubCommitRef: "refactor",
        },
      }),
      listing(),
    ],
    [
      "wrong commit",
      inspection(),
      listing({
        meta: { githubCommitSha: "b".repeat(40), githubCommitRef: "refactor" },
      }),
    ],
    [
      "wrong branch",
      inspection(),
      listing({ meta: { githubCommitSha: COMMIT, githubCommitRef: "main" } }),
    ],
    [
      "wrong deployment",
      inspection(),
      listing({ id: `dpl_${"D".repeat(24)}` }),
    ],
  ])("rejects %s", (_name, inspectOutput, listOutput) => {
    expect(() =>
      parsePreviewDeploymentEvidence({
        commitSha: COMMIT,
        inspectOutput,
        listOutput,
      }),
    ).toThrow(/Preview|deployment|HEAD/u);
  });

  it("uses only read-only Vercel inspection commands", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ stdout: inspection() })
      .mockResolvedValueOnce({ stdout: listing() });
    await expect(
      resolvePreviewDeployment({ commitSha: COMMIT, execute }),
    ).resolves.toMatchObject({ deploymentId: DEPLOYMENT_ID });
    expect(execute.mock.calls.map((call) => call[1].slice(0, 3))).toEqual([
      ["vercel@56.5.0", "inspect", ALIAS],
      ["vercel@56.5.0", "list", "gioia-beauty"],
    ]);
  });
});
