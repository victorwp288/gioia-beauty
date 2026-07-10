import { fileURLToPath } from "node:url";

import { runBookingConcurrencySuite } from "./booking-concurrency-suite.mjs";
import { withLocalRuntimeDatabase } from "./concurrency-harness.mjs";

export { runBookingConcurrencySuite } from "./booking-concurrency-suite.mjs";
export * from "./concurrency-assertions.mjs";
export * from "./concurrency-harness.mjs";
export * from "./concurrency-queries.mjs";
export * from "./concurrency-reconciliation.mjs";

async function main() {
  await withLocalRuntimeDatabase(runBookingConcurrencySuite);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `Concurrency test failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
