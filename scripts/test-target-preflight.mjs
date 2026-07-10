import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { TEST_TARGET_REF } from "./test-target-config.mjs";

const execFileAsync = promisify(execFile);

export const GREENFIELD_TEST_REPOSITORY = "victorwp288/gioia-beauty";
export const GREENFIELD_TEST_BRANCH = "refactor";
export const GREENFIELD_TEST_CONFIRMATION = `REBUILD-${TEST_TARGET_REF}-TWICE`;

const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const RUN_ID_PATTERN = /^[1-9][0-9]{5,19}$/u;
const EXPECTED_REMOTE = new Set([
  `https://github.com/${GREENFIELD_TEST_REPOSITORY}`,
  `https://github.com/${GREENFIELD_TEST_REPOSITORY}.git`,
]);

function requiredOperatorInputs(env) {
  const commitSha = env.GIOIA_TEST_COMMIT_SHA;
  const ciRunId = env.GIOIA_TEST_CI_RUN_ID;
  if (!COMMIT_PATTERN.test(commitSha ?? "")) {
    throw new Error("Greenfield TEST commit SHA must be exact");
  }
  if (!RUN_ID_PATTERN.test(ciRunId ?? "")) {
    throw new Error("Greenfield TEST CI run ID must be exact");
  }
  if (env.GIOIA_TEST_CONFIRMATION !== GREENFIELD_TEST_CONFIRMATION) {
    throw new Error("Greenfield TEST rebuild confirmation is missing");
  }
  if (env.GITHUB_REPOSITORY !== GREENFIELD_TEST_REPOSITORY) {
    throw new Error("Greenfield TEST GitHub repository is not exact");
  }
  return { ciRunId, commitSha };
}

async function defaultRunCommand(command, args, options) {
  try {
    return await execFileAsync(command, args, {
      ...options,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
    });
  } catch {
    throw new Error("Greenfield TEST preflight command failed");
  }
}

function commandEnvironment(env) {
  return Object.fromEntries(
    [
      ["CI", "true"],
      ["GH_TOKEN", env.GH_TOKEN],
      ["GITHUB_TOKEN", env.GITHUB_TOKEN],
      ["HOME", env.HOME],
      ["NO_COLOR", "1"],
      ["PATH", env.PATH],
      ["TERM", "dumb"],
      ["TMPDIR", env.TMPDIR],
    ].filter(([, value]) => typeof value === "string" && value.length > 0),
  );
}

async function output(runCommand, command, args, rootDirectory, env) {
  let result;
  try {
    result = await runCommand(command, args, {
      cwd: rootDirectory,
      env: commandEnvironment(env),
    });
  } catch {
    throw new Error("Greenfield TEST preflight command failed");
  }
  if (!result || typeof result.stdout !== "string") {
    throw new Error("Greenfield TEST preflight returned invalid output");
  }
  return result.stdout.trim();
}

async function verifyRepository({ commitSha, env, rootDirectory, runCommand }) {
  const commands = [
    ["git", ["branch", "--show-current"]],
    ["git", ["rev-parse", "HEAD"]],
    ["git", ["rev-parse", "refs/remotes/origin/refactor"]],
    ["git", ["status", "--porcelain=v1", "--untracked-files=all"]],
    ["git", ["remote", "get-url", "origin"]],
  ];
  const [branch, head, remoteHead, status, remote] = await Promise.all(
    commands.map(([command, args]) =>
      output(runCommand, command, args, rootDirectory, env),
    ),
  );
  if (
    branch !== GREENFIELD_TEST_BRANCH ||
    head !== commitSha ||
    remoteHead !== commitSha ||
    status !== "" ||
    !EXPECTED_REMOTE.has(remote)
  ) {
    throw new Error("Greenfield TEST repository state is not exact");
  }
}

function parseCiRun(source) {
  try {
    const value = JSON.parse(source);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error();
    }
    return value;
  } catch {
    throw new Error("Greenfield TEST CI evidence is invalid");
  }
}

async function verifyCi({
  ciRunId,
  commitSha,
  env,
  rootDirectory,
  runCommand,
}) {
  const source = await output(
    runCommand,
    "gh",
    ["api", `repos/${GREENFIELD_TEST_REPOSITORY}/actions/runs/${ciRunId}`],
    rootDirectory,
    env,
  );
  const run = parseCiRun(source);
  if (
    String(run.id) !== ciRunId ||
    run.head_sha !== commitSha ||
    run.head_branch !== GREENFIELD_TEST_BRANCH ||
    run.event !== "push" ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    run.name !== "CI" ||
    run.path !== ".github/workflows/ci.yml" ||
    run.repository?.full_name !== GREENFIELD_TEST_REPOSITORY
  ) {
    throw new Error("Greenfield TEST CI run is not an exact green push run");
  }
}

export async function verifyGreenfieldTestPreflight(
  env,
  { rootDirectory = process.cwd(), runCommand = defaultRunCommand } = {},
) {
  const { ciRunId, commitSha } = requiredOperatorInputs(env);
  await verifyRepository({
    commitSha,
    env,
    rootDirectory,
    runCommand,
  });
  await verifyCi({ ciRunId, commitSha, env, rootDirectory, runCommand });
  return Object.freeze({ ciRunId, commitSha });
}
