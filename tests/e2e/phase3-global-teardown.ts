import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { runtimeMembership } from "./phase3-global-setup.ts";

const execFileAsync = promisify(execFile);

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
}
