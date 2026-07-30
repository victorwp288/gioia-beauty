import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { GREENFIELD_TARGET_VERSIONS } from "../../scripts/test-target-migrations.mjs";

const privacy = readFileSync(resolve("docs/PRIVACY-OPERATIONS.md"), "utf8");
const processors = readFileSync(resolve("docs/PROCESSORS.md"), "utf8");
const masterplan = readFileSync(resolve("docs/MASTERPLAN.md"), "utf8");

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex, start).toBeGreaterThanOrEqual(0);
  expect(endIndex, end).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("privacy package launch gates", () => {
  it("keeps every retention decision explicit and unapproved", () => {
    const decisions = section(
      privacy,
      "## Pending decision register",
      "## Field and artifact matrix",
    );
    const ids = [
      ...Array.from(
        { length: 17 },
        (_value, index) => `RET-${String(index + 1).padStart(2, "0")}`,
      ),
      "RET-HOLD",
    ];

    for (const id of ids) {
      expect(decisions).toMatch(
        new RegExp("^\\| `" + id + "`\\s+\\| `PENDING` \\|", "m"),
      );
    }
    expect(decisions.match(/^\| `RET-[^`]+`\s+\| `PENDING` \|/gm)).toHaveLength(
      ids.length,
    );
    expect(decisions).toContain("None is approved");
    expect(privacy).toContain("engineering proposals only");
  });

  it("covers every canonical classification and disposition", () => {
    for (const code of [
      "P1_DIRECT",
      "P2_FREE_TEXT",
      "P3_BEHAVIORAL",
      "P4_PSEUDONYM",
      "P5_DERIVED",
      "S1_CREDENTIAL",
      "E1_CONSENT",
      "O1_LINKED_OPERATIONAL",
      "U1_UNKNOWN",
    ]) {
      expect(privacy).toContain(`\`${code}\``);
    }
    for (let index = 1; index <= 10; index += 1) {
      expect(privacy).toContain(`\`D${index}_`);
    }
  });

  it("separates restricted source reads, PII restores, and destruction", () => {
    expect(privacy).toContain("Reading the source is `[PROD-READ]`");
    expect(privacy).toContain(
      "creating/restoring the PII-bearing clone is separately `[PROD-DATA]`",
    );
    expect(privacy).toContain(
      "later destruction is `[DESTRUCTIVE]`. Each needs exact approval",
    );
  });

  it("inventories current stores, transients, providers, exports, and copies", () => {
    for (const store of [
      "booking_policy.admin_notification_email",
      "schedule_entries.client_name",
      "vacations.reason",
      "schedule_day_locks.local_date",
      "newsletter_subscribers.email",
      "email_outbox.recipient_address",
      "email_webhook_events.provider_event_id",
      "command_requests.principal_scope_hash",
      "domain_change_log.aggregate_id",
      "migration_runs",
      "migration_records",
      "migration_quarantine",
      "owner_accounts.user_id",
      "owner_sessions.session_id",
      "Firestore `customers`",
      "Firestore `newsletter_subscribers`",
      "Firestore `vacations`",
      "Firestore `settings` / `analytics`",
      "Firebase Auth owner identities",
      "Firebase Analytics telemetry",
      "Firebase Storage buckets/objects",
      "Legacy appointment/query caches",
      "Browser storage",
      "Legacy browser `/export`",
      "Approved owner/subject access package",
      "Raw migration export/before-image/recovery copy",
      "Resend message/recipient/provider copies",
      "Vercel request/function logs",
      "Supabase database/Auth operational copies",
      "Firestore recovery backup/export",
      "Supabase PITR/managed backups",
      "Encrypted logical export",
      "Restricted recovery clone",
    ]) {
      expect(privacy).toContain(store);
    }
    expect(privacy).toContain(
      "Durable concurrency mutex state, not subject-linked data",
    );
    expect(privacy).toContain("not a privacy purge");
  });

  it("keeps all acceptance evidence open and preserves migration ordering", () => {
    const acceptance = section(
      privacy,
      "## Acceptance checklist",
      "The Phase 3 privacy checklist item remains unchecked",
    );

    expect(acceptance).not.toMatch(/^- \[[xX]\]/m);
    expect(privacy).toContain(
      "The current reviewed source manifest and direct-runtime follow-up",
    );
    expect(GREENFIELD_TARGET_VERSIONS.length).toBeGreaterThan(0);
    expect(privacy).toContain("have not been applied");
    expect(privacy).toContain("The Phase 2 TEST checkpoint is still open");
    expect(privacy).toMatch(
      /only after the applicable\s+owner, legal, and provider decisions/,
    );
    expect(privacy).not.toContain("already-reserved **migration 38");
    expect(privacy).toContain("privacy checklist item remains unchecked");
    expect(masterplan).toContain(
      "- [ ] **`[LOCAL]` / `[TEST]`** Complete the pre-cutover privacy package:",
    );
    expect(privacy).toContain("do not collect or enter health");
    expect(privacy).toContain("Evidence separation and minimization");
    expect(privacy).toContain("Backup restore replay gate");
    expect(privacy).toContain("protected subject-case ledger");
    expect(privacy).toContain("remains personal data");
    const evidence = section(
      privacy,
      "## Evidence separation and minimization",
      "## Backup restore replay gate",
    );
    expect(evidence).toContain("`P4_PSEUDONYM`/`P5_DERIVED`");
    expect(evidence).toContain("No current privacy artifact has that proof");
    const operationalAllowlist = section(
      evidence,
      "may contain only:",
      "This artifact must not contain",
    );
    for (const forbidden of [
      "name",
      "email",
      "phone",
      "note",
      "request body",
      "raw IP",
      "token",
      "secret",
      "source record value",
      "case ID",
      "plan hash",
      "selector",
    ]) {
      expect(operationalAllowlist).not.toContain(forbidden);
    }
  });

  it("registers every active, authorized, planned, and browser-third-party service", () => {
    for (const heading of [
      "### Vercel",
      "### Supabase",
      "### Firebase / Google",
      "### Resend",
      "### GitHub / GitHub Actions",
      "### Sentry",
      "### PostHog",
      "### Vercel bot controls",
    ]) {
      expect(processors).toContain(heading);
    }
    for (const surface of [
      "OpenStreetMap tile servers",
      "unpkg.com",
      "Vercel Analytics / Speed Insights",
      "Firebase Analytics",
      "Tailwind UI / Unsplash",
      "Google Drive service link",
      "Google Maps, Instagram, Payhip",
    ]) {
      expect(processors).toContain(surface);
    }
    expect(processors).toContain("Customer data, raw exports, access packages");
    expect(processors).toContain("Only\n  `refactor` Preview");
    expect(processors).toContain("Production is unconfigured");
    expect(processors).toContain("Free plan advertises one-year");
    expect(processors).toContain(
      "Storage is configured and initialized, but no",
    );
    expect(processors).toContain(
      "Storage bucket/object existence and consumers",
    );
    expect(processors).toContain("## Activation checklist");
    expect(processors).toContain("## Decommission checklist");
  });

  it.each([
    {
      path: "README.md",
      targets: ["./docs/PRIVACY-OPERATIONS.md", "./docs/PROCESSORS.md"],
    },
    {
      path: "docs/ENVIRONMENTS.md",
      targets: ["./PRIVACY-OPERATIONS.md", "./PROCESSORS.md"],
    },
    {
      path: "docs/PRODUCTION-SAFETY.md",
      targets: ["./PRIVACY-OPERATIONS.md", "./PROCESSORS.md"],
    },
    {
      path: "docs/OPERATIONS.md",
      targets: ["./PRIVACY-OPERATIONS.md", "./PROCESSORS.md"],
    },
  ])("links both canonical registers from $path", ({ path, targets }) => {
    const source = readFileSync(resolve(path), "utf8");

    for (const target of targets) {
      expect(source).toMatch(
        new RegExp(`\\[[^\\]]+\\]\\(${target.replaceAll(".", "\\.")}\\)`),
      );
      expect(existsSync(resolve(dirname(path), target))).toBe(true);
    }
  });

  it("gives every core service a status plus an unresolved gate", () => {
    const headings = [
      "Vercel",
      "Supabase",
      "Firebase / Google",
      "Resend",
      "GitHub / GitHub Actions",
      "Sentry",
    ];

    for (let index = 0; index < headings.length; index += 1) {
      const start = `### ${headings[index]}`;
      const end =
        index + 1 < headings.length
          ? `### ${headings[index + 1]}`
          : "## Browser third parties";
      const entry = section(processors, start, end);
      expect(entry).toContain("- **Status:**");
      expect(entry).toContain("- **Repository evidence:**");
      expect(entry).toMatch(/- \*\*(?:Pending|Activation gates):\*\*/);
    }
  });
});
