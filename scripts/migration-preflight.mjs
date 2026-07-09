import {
  evaluateMigrationPreflight,
  migrationConfirmation,
  parseMigrationArguments,
} from "../lib/server/migrationPreflight.mjs";

let options;
try {
  options = parseMigrationArguments(process.argv.slice(2));
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: error.message })}\n`,
  );
  process.exitCode = 2;
}

if (options) {
  const result = evaluateMigrationPreflight(options);
  const output = options.apply
    ? result
    : { ...result, applyConfirmation: migrationConfirmation(options) };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!result.ok) process.exitCode = 2;
}
