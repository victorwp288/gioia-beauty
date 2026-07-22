import { spawn } from "node:child_process";
import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parsePreviewE2eEnvironment } from "./preview-e2e-config.mjs";
import {
  resolvePreviewDeployment,
  verifyPreviewGitState,
} from "./preview-e2e-deployment.mjs";
import { createPreviewProtectionStorageState } from "./preview-e2e-protection.mjs";
import { parseTestTargetConfig } from "./test-target-config.mjs";

const TEMPORARY_PREFIX = "gioia-preview-e2e-";

async function createPrivateTemporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), TEMPORARY_PREFIX));
  await chmod(directory, 0o700);
  return realpath(directory);
}

async function removePrivateTemporaryDirectory(directory) {
  const resolvedParent = await realpath(path.dirname(directory));
  const expectedParent = await realpath(tmpdir());
  if (
    resolvedParent !== expectedParent ||
    !path.basename(directory).startsWith(TEMPORARY_PREFIX)
  ) {
    throw new Error("Preview E2E temporary directory is not exact");
  }
  await rm(directory, { force: true, recursive: true });
}

async function executePlaywright({ cwd, env }) {
  const executable = path.join(cwd, "node_modules", ".bin", "playwright");
  const args = [
    "test",
    "--config",
    "playwright.preview.config.ts",
    "--project",
    "phase4-public",
    "--project",
    "phase4-preview-hosted",
  ];
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      shell: false,
      stdio: "inherit",
    });
    child.once("error", () => {
      reject(new Error("Preview Playwright process did not start"));
    });
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) resolve();
      else reject(new Error("Preview Playwright acceptance failed"));
    });
  });
}

const DEFAULT_OPERATIONS = Object.freeze({
  createPrivateTemporaryDirectory,
  createPreviewProtectionStorageState,
  executePlaywright,
  parsePreviewE2eEnvironment,
  parseTestTargetConfig,
  removePrivateTemporaryDirectory,
  resolvePreviewDeployment,
  verifyPreviewGitState,
});

export async function runPreviewPhase4({
  cwd = process.cwd(),
  env = process.env,
  operations = DEFAULT_OPERATIONS,
} = {}) {
  operations.parseTestTargetConfig(env, { rootDirectory: cwd });
  const commitSha = await operations.verifyPreviewGitState({ cwd });
  const deployment = await operations.resolvePreviewDeployment({
    commitSha,
    cwd,
  });
  const temporaryDirectory = await operations.createPrivateTemporaryDirectory();
  let operationError;
  let result;
  try {
    const storageState = await operations.createPreviewProtectionStorageState({
      baseURL: deployment.baseURL,
      cwd,
      deploymentId: deployment.deploymentId,
      temporaryDirectory,
    });
    const childEnvironment = {
      ...env,
      PLAYWRIGHT_PREVIEW_BASE_URL: deployment.baseURL,
      PLAYWRIGHT_PREVIEW_COMMIT_SHA: deployment.commitSha,
      PLAYWRIGHT_PREVIEW_DEPLOYMENT_ID: deployment.deploymentId,
      PLAYWRIGHT_PREVIEW_STORAGE_STATE: storageState,
    };
    operations.parsePreviewE2eEnvironment(childEnvironment);
    await operations.executePlaywright({ cwd, env: childEnvironment });
    result = Object.freeze({
      baseURL: deployment.baseURL,
      commitSha: deployment.commitSha,
      deploymentId: deployment.deploymentId,
    });
  } catch (error) {
    operationError = error;
  }

  try {
    await operations.removePrivateTemporaryDirectory(temporaryDirectory);
  } catch {
    throw new Error("Preview E2E private state did not clean up");
  }
  if (operationError) throw operationError;
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await runPreviewPhase4();
    process.stdout.write(
      `Preview Phase 4 passed for ${result.deploymentId} at ${result.commitSha}.\n`,
    );
  } catch {
    process.stderr.write(
      "Preview Phase 4 failed closed; no Production target was used.\n",
    );
    process.exitCode = 1;
  }
}
