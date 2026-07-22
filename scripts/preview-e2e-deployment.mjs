import { execFile as execFileCallback } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import {
  GIOIA_PREVIEW_BRANCH_HOST,
  GIOIA_VERCEL_ORG_ID,
  GIOIA_VERCEL_PROJECT_ID,
  parsePreviewDeploymentId,
} from "./preview-e2e-config.mjs";

const execFile = promisify(execFileCallback);
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const UNIQUE_DEPLOYMENT_HOST =
  /^gioia-beauty-[a-z0-9]+-victor-wejergang-petersens-projects\.vercel\.app$/u;
const EXPECTED_CONTEXT = "victor-wejergang-petersens-projects";
const EXPECTED_PROJECT = "gioia-beauty";
const EXPECTED_BRANCH = "refactor";
const EXPECTED_REMOTES = new Set([
  "git@github.com:victorwp288/gioia-beauty.git",
  "https://github.com/victorwp288/gioia-beauty.git",
]);

function parseJson(value, operation) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }
    return parsed;
  } catch {
    throw new Error(`${operation} returned invalid JSON`);
  }
}

function exactCommit(value) {
  if (typeof value !== "string" || !COMMIT_SHA.test(value)) {
    throw new Error("Preview E2E commit SHA is invalid");
  }
  return value;
}

async function command(execute, executable, args, options = {}) {
  const result = await execute(executable, args, {
    cwd: options.cwd,
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
    timeout: options.timeout ?? 30_000,
  });
  return String(result.stdout ?? "").trim();
}

function exactProjectLink(rootDirectory) {
  const root = realpathSync(rootDirectory);
  const linkPath = path.join(root, ".vercel", "project.json");
  const link = parseJson(readFileSync(linkPath, "utf8"), "Vercel project link");
  if (
    link.projectId !== GIOIA_VERCEL_PROJECT_ID ||
    link.orgId !== GIOIA_VERCEL_ORG_ID ||
    link.projectName !== EXPECTED_PROJECT ||
    Object.keys(link).sort().join("|") !== "orgId|projectId|projectName"
  ) {
    throw new Error("Vercel project link does not match Gioia Preview");
  }
}

export async function verifyPreviewGitState({
  cwd = process.cwd(),
  execute = execFile,
} = {}) {
  const [branch, head, remoteHead, remote, status] = await Promise.all([
    command(execute, "git", ["branch", "--show-current"], { cwd }),
    command(execute, "git", ["rev-parse", "HEAD"], { cwd }),
    command(execute, "git", ["rev-parse", "refs/remotes/origin/refactor"], {
      cwd,
    }),
    command(execute, "git", ["remote", "get-url", "origin"], { cwd }),
    command(execute, "git", ["status", "--porcelain"], { cwd }),
  ]);
  if (
    branch !== EXPECTED_BRANCH ||
    !COMMIT_SHA.test(head) ||
    remoteHead !== head ||
    !EXPECTED_REMOTES.has(remote) ||
    status !== ""
  ) {
    throw new Error(
      "Preview E2E requires the clean pushed refactor branch at exact HEAD",
    );
  }
  exactProjectLink(cwd);
  return head;
}

export function parsePreviewDeploymentEvidence({
  commitSha,
  inspectOutput,
  listOutput,
}) {
  const expectedCommit = exactCommit(commitSha);
  const inspection = parseJson(inspectOutput, "Vercel Preview inspection");
  const listing = parseJson(listOutput, "Vercel Preview listing");
  const deploymentId = parsePreviewDeploymentId(inspection.id);
  const aliases = Array.isArray(inspection.aliases) ? inspection.aliases : [];
  if (
    inspection.name !== EXPECTED_PROJECT ||
    ![null, "preview"].includes(inspection.target) ||
    inspection.readyState !== "READY" ||
    inspection.source !== "git" ||
    inspection.contextName !== EXPECTED_CONTEXT ||
    inspection.branchAlias !== GIOIA_PREVIEW_BRANCH_HOST ||
    inspection.meta?.githubCommitSha !== expectedCommit ||
    inspection.meta?.githubCommitRef !== EXPECTED_BRANCH ||
    typeof inspection.url !== "string" ||
    !UNIQUE_DEPLOYMENT_HOST.test(inspection.url) ||
    inspection.url === GIOIA_PREVIEW_BRANCH_HOST ||
    !aliases.includes(GIOIA_PREVIEW_BRANCH_HOST)
  ) {
    throw new Error("Stable branch alias did not resolve to an exact Preview");
  }
  if (
    listing.contextName !== EXPECTED_CONTEXT ||
    !Array.isArray(listing.deployments)
  ) {
    throw new Error("Vercel Preview listing is invalid");
  }
  const matches = listing.deployments.filter(
    (deployment) => deployment?.id === deploymentId,
  );
  if (matches.length !== 1) {
    throw new Error("Resolved Preview deployment is not in the exact listing");
  }
  const deployment = matches[0];
  if (
    deployment.name !== EXPECTED_PROJECT ||
    deployment.url !== inspection.url ||
    deployment.state !== "READY" ||
    ![null, undefined, "preview"].includes(deployment.target) ||
    deployment.meta?.githubCommitSha !== expectedCommit ||
    deployment.meta?.githubCommitRef !== EXPECTED_BRANCH
  ) {
    throw new Error("Resolved Preview deployment does not match refactor HEAD");
  }
  return Object.freeze({
    baseURL: `https://${inspection.url}/`,
    commitSha: expectedCommit,
    deploymentId,
  });
}

export async function resolvePreviewDeployment({
  commitSha,
  cwd = process.cwd(),
  execute = execFile,
}) {
  const expectedCommit = exactCommit(commitSha);
  const inspectOutput = await command(
    execute,
    "bunx",
    ["vercel@56.5.0", "inspect", GIOIA_PREVIEW_BRANCH_HOST, "--format=json"],
    { cwd },
  );
  const listOutput = await command(
    execute,
    "bunx",
    [
      "vercel@56.5.0",
      "list",
      EXPECTED_PROJECT,
      "--environment",
      "preview",
      "--status",
      "READY",
      "--meta",
      `githubCommitSha=${expectedCommit}`,
      "--limit",
      "100",
      "--format=json",
    ],
    { cwd },
  );
  return parsePreviewDeploymentEvidence({
    commitSha: expectedCommit,
    inspectOutput,
    listOutput,
  });
}
