import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { runtimeMembership } from "./phase3-global-setup.ts";

const execFileAsync = promisify(execFile);
const LOCAL_GATEWAY = "supabase_kong_gioia-beauty-local";

async function refreshLocalGateway() {
  await execFileAsync("docker", ["restart", LOCAL_GATEWAY], {
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { stdout } = await execFileAsync(
      "docker",
      ["inspect", "--format", "{{.State.Health.Status}}", LOCAL_GATEWAY],
      { maxBuffer: 1024 * 1024, timeout: 5_000 },
    );
    if (stdout.trim() === "healthy") return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Local Supabase gateway did not become healthy after reset");
}

export default async function phase3GlobalTeardown() {
  await execFileAsync(
    path.join(process.cwd(), "node_modules", ".bin", "supabase"),
    ["db", "reset", "--local"],
    {
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000,
    },
  );
  await runtimeMembership(
    "revoke app_runtime from postgres granted by current_user",
  );
  await refreshLocalGateway();
}
