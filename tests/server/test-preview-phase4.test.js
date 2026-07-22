import { describe, expect, it, vi } from "vitest";

import { runPreviewPhase4 } from "../../scripts/test-preview-phase4.mjs";

const COMMIT = "a".repeat(40);
const DEPLOYMENT_ID = `dpl_${"B".repeat(24)}`;
const BASE_URL =
  "https://gioia-beauty-synthetic-victor-wejergang-petersens-projects.vercel.app/";
const BRANCH_ALIAS_URL =
  "https://gioia-beauty-git-refactor-victor-wejergang-petersens-projects.vercel.app/";

function operations(overrides = {}) {
  return {
    createPrivateTemporaryDirectory: vi.fn(async () => "/tmp/preview-private"),
    createPreviewProtectionStorageState: vi.fn(
      async () => "/tmp/preview-private/state.json",
    ),
    executePlaywright: vi.fn(async () => undefined),
    parsePreviewE2eEnvironment: vi.fn(() => ({ baseURL: BASE_URL })),
    parseTestTargetConfig: vi.fn(() => ({ environment: "test" })),
    removePrivateTemporaryDirectory: vi.fn(async () => undefined),
    resolvePreviewDeployment: vi.fn(async () => ({
      baseURL: BASE_URL,
      branchAliasURL: BRANCH_ALIAS_URL,
      commitSha: COMMIT,
      deploymentId: DEPLOYMENT_ID,
    })),
    verifyPreviewGitState: vi.fn(async () => COMMIT),
    ...overrides,
  };
}

describe("Preview Phase 4 orchestrator", () => {
  it("binds a clean pushed HEAD to exact deployment evidence and private state", async () => {
    const actions = operations();
    const env = { APP_ENV: "operator" };
    await expect(
      runPreviewPhase4({ cwd: "/workspace", env, operations: actions }),
    ).resolves.toEqual({
      baseURL: BASE_URL,
      commitSha: COMMIT,
      deploymentId: DEPLOYMENT_ID,
    });

    expect(actions.parseTestTargetConfig).toHaveBeenCalledWith(env, {
      rootDirectory: "/workspace",
    });
    expect(actions.resolvePreviewDeployment).toHaveBeenCalledWith({
      commitSha: COMMIT,
      cwd: "/workspace",
    });
    expect(actions.createPreviewProtectionStorageState).toHaveBeenCalledWith({
      baseURL: BASE_URL,
      cwd: "/workspace",
      deploymentId: DEPLOYMENT_ID,
      temporaryDirectory: "/tmp/preview-private",
    });
    expect(actions.executePlaywright).toHaveBeenCalledWith({
      cwd: "/workspace",
      env: expect.objectContaining({
        PLAYWRIGHT_PREVIEW_BASE_URL: BASE_URL,
        PLAYWRIGHT_PREVIEW_COMMIT_SHA: COMMIT,
        PLAYWRIGHT_PREVIEW_DEPLOYMENT_ID: DEPLOYMENT_ID,
        PLAYWRIGHT_PREVIEW_STORAGE_STATE: "/tmp/preview-private/state.json",
      }),
    });
    expect(actions.removePrivateTemporaryDirectory).toHaveBeenCalledWith(
      "/tmp/preview-private",
    );
  });

  it("never gives the mutable branch alias to protection bootstrap or Playwright", async () => {
    const actions = operations();
    await runPreviewPhase4({ operations: actions });

    const protectionInput =
      actions.createPreviewProtectionStorageState.mock.calls[0][0];
    const playwrightInput = actions.executePlaywright.mock.calls[0][0];
    expect(protectionInput.baseURL).toBe(BASE_URL);
    expect(playwrightInput.env.PLAYWRIGHT_PREVIEW_BASE_URL).toBe(BASE_URL);
    expect(protectionInput.baseURL).not.toBe(BRANCH_ALIAS_URL);
    expect(playwrightInput.env.PLAYWRIGHT_PREVIEW_BASE_URL).not.toBe(
      BRANCH_ALIAS_URL,
    );
  });

  it("removes private state when Playwright fails", async () => {
    const failure = new Error("synthetic Playwright failure");
    const actions = operations({
      executePlaywright: vi.fn(async () => {
        throw failure;
      }),
    });
    await expect(runPreviewPhase4({ operations: actions })).rejects.toBe(
      failure,
    );
    expect(actions.removePrivateTemporaryDirectory).toHaveBeenCalledOnce();
  });

  it("does not inspect Vercel when TEST configuration fails closed", async () => {
    const failure = new Error("TEST configuration rejected");
    const actions = operations({
      parseTestTargetConfig: vi.fn(() => {
        throw failure;
      }),
    });
    await expect(runPreviewPhase4({ operations: actions })).rejects.toBe(
      failure,
    );
    expect(actions.verifyPreviewGitState).not.toHaveBeenCalled();
    expect(actions.resolvePreviewDeployment).not.toHaveBeenCalled();
    expect(actions.createPrivateTemporaryDirectory).not.toHaveBeenCalled();
  });

  it("reports cleanup failure instead of claiming acceptance", async () => {
    const actions = operations({
      removePrivateTemporaryDirectory: vi.fn(async () => {
        throw new Error("synthetic cleanup failure");
      }),
    });
    await expect(runPreviewPhase4({ operations: actions })).rejects.toThrow(
      "private state did not clean up",
    );
  });
});
