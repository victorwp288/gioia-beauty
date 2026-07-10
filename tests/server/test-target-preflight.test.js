import { describe, expect, it, vi } from "vitest";

import {
  GREENFIELD_TEST_CONFIRMATION,
  GREENFIELD_TEST_REPOSITORY,
  verifyGreenfieldTestPreflight,
} from "../../scripts/test-target-preflight.mjs";

const SHA = "b".repeat(40);
const RUN_ID = "29068500383";

function environment(overrides = {}) {
  return {
    GH_TOKEN: "synthetic-github-token",
    GITHUB_REPOSITORY: GREENFIELD_TEST_REPOSITORY,
    GIOIA_TEST_CI_RUN_ID: RUN_ID,
    GIOIA_TEST_COMMIT_SHA: SHA,
    GIOIA_TEST_CONFIRMATION: GREENFIELD_TEST_CONFIRMATION,
    ...overrides,
  };
}

function ciRun(overrides = {}) {
  return {
    id: Number(RUN_ID),
    conclusion: "success",
    event: "push",
    head_branch: "refactor",
    head_sha: SHA,
    name: "CI",
    path: ".github/workflows/ci.yml",
    repository: { full_name: GREENFIELD_TEST_REPOSITORY },
    status: "completed",
    ...overrides,
  };
}

function commandRunner(overrides = {}) {
  const values = {
    "git branch --show-current": "refactor\n",
    "git rev-parse HEAD": `${SHA}\n`,
    "git rev-parse refs/remotes/origin/refactor": `${SHA}\n`,
    "git status --porcelain=v1 --untracked-files=all": "",
    "git remote get-url origin":
      "https://github.com/victorwp288/gioia-beauty.git\n",
    [`gh api repos/${GREENFIELD_TEST_REPOSITORY}/actions/runs/${RUN_ID}`]:
      JSON.stringify(ciRun()),
    ...overrides,
  };
  return vi.fn(async (command, args) => {
    const key = [command, ...args].join(" ");
    if (!(key in values)) throw new Error(`unexpected command: ${key}`);
    return { stdout: values[key], stderr: "" };
  });
}

describe("greenfield TEST repository and CI preflight", () => {
  it("accepts only a clean refactor checkout with exact green push CI", async () => {
    const runCommand = commandRunner();
    await expect(
      verifyGreenfieldTestPreflight(environment(), {
        rootDirectory: "/synthetic/repository",
        runCommand,
      }),
    ).resolves.toEqual({ ciRunId: RUN_ID, commitSha: SHA });

    expect(runCommand).toHaveBeenCalledTimes(6);
    expect(runCommand.mock.calls.at(-1)[0]).toBe("gh");
    expect(runCommand.mock.calls.at(-1)[2]).toEqual({
      cwd: "/synthetic/repository",
      env: {
        CI: "true",
        GH_TOKEN: "synthetic-github-token",
        NO_COLOR: "1",
        TERM: "dumb",
      },
    });
    expect(JSON.stringify(runCommand.mock.calls)).not.toContain(
      "GIOIA_TEST_CONFIRMATION",
    );
  });

  it.each([
    ["GIOIA_TEST_COMMIT_SHA", "not-a-sha", "commit SHA"],
    ["GIOIA_TEST_CI_RUN_ID", "0", "CI run ID"],
    ["GIOIA_TEST_CONFIRMATION", "REBUILD-WRONG", "confirmation"],
    ["GITHUB_REPOSITORY", "attacker/repository", "repository"],
  ])("rejects non-exact operator input %s", async (key, value, message) => {
    await expect(
      verifyGreenfieldTestPreflight(environment({ [key]: value }), {
        runCommand: commandRunner(),
      }),
    ).rejects.toThrow(message);
  });

  it.each([
    ["git branch --show-current", "main\n"],
    ["git rev-parse HEAD", `${"a".repeat(40)}\n`],
    ["git rev-parse refs/remotes/origin/refactor", `${"a".repeat(40)}\n`],
    ["git status --porcelain=v1 --untracked-files=all", "?? unknown.txt\n"],
    ["git remote get-url origin", "https://github.com/attacker/repo.git\n"],
  ])("rejects repository drift from %s", async (command, value) => {
    await expect(
      verifyGreenfieldTestPreflight(environment(), {
        runCommand: commandRunner({ [command]: value }),
      }),
    ).rejects.toThrow("repository state is not exact");
  });

  it.each([
    { head_sha: "a".repeat(40) },
    { head_branch: "main" },
    { event: "pull_request" },
    { status: "in_progress", conclusion: null },
    { conclusion: "failure" },
    { path: ".github/workflows/attacker.yml" },
    { repository: { full_name: "attacker/repository" } },
  ])("rejects non-exact CI evidence %#", async (override) => {
    const key = `gh api repos/${GREENFIELD_TEST_REPOSITORY}/actions/runs/${RUN_ID}`;
    await expect(
      verifyGreenfieldTestPreflight(environment(), {
        runCommand: commandRunner({
          [key]: JSON.stringify(ciRun(override)),
        }),
      }),
    ).rejects.toThrow("exact green push run");
  });

  it("does not include operator inputs in command failures", async () => {
    const sensitive = "sensitive-value-not-for-output";
    const runCommand = vi.fn(async () => {
      throw new Error(sensitive);
    });
    await expect(
      verifyGreenfieldTestPreflight(environment(), { runCommand }),
    ).rejects.not.toThrow(sensitive);
  });
});
