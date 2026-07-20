import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260720152718_phase3_outbox_newsletter_runtime_corrections.sql",
  ),
  "utf8",
);
const signingSemanticsSource = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260720162911_phase3_signing_key_verification_semantics.sql",
  ),
  "utf8",
);
const issuanceHorizonSource = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260720163713_phase3_newsletter_issuance_horizon.sql",
  ),
  "utf8",
);

describe("phase 3 runtime corrective migration", () => {
  it("persists renderer outcomes without opening a provider window", () => {
    expect(source).toContain("complete_email_outbox_pre_provider_failure");
    expect(source).toContain("outbox.first_provider_attempt_at is null");
    expect(source).toContain("'OUTBOX_TEMPLATE_INVALID', false");
    expect(source).toContain("'OUTBOX_RENDERER_UNAVAILABLE', true");
  });

  it("records known provider success after an authorized attempt", () => {
    const success = source.slice(
      source.indexOf("complete_email_outbox_success"),
      source.indexOf("confirm_public_newsletter"),
    );
    expect(success).toContain("outbox.first_provider_attempt_at is not null");
    expect(success).not.toContain(
      "outbox.provider_retry_deadline_at > pg_catalog.statement_timestamp()",
    );
  });

  it("issues an active-version unsubscribe token during confirmation", () => {
    expect(source).toContain("'newsletter_unsubscribe', v_key.key_id");
    expect(source).toContain("v_subscriber.version, 'newsletter_unsubscribe'");
    expect(source).toContain("v_now + interval '30 days'");
  });

  it("canonicalizes token timestamps and enforces signing-key retention", () => {
    expect(source).toContain("date_trunc('milliseconds', new.issued_at)");
    expect(source).toContain("new.expires_at + interval '30 days'");
    expect(source).toContain("NEWSLETTER_CONFIGURATION_UNAVAILABLE");
  });

  it("allows confirmation reset only with a fresh pending consent cycle", () => {
    expect(source).toContain(
      "old.status in ('unsubscribed', 'bounced') and new.status = 'pending'",
    );
    expect(source).toContain(
      "row(old.consent_at, old.consent_source, old.consent_policy_version)",
    );
  });
});

describe("phase 3 signing-key verification semantics", () => {
  it("verifies the referenced retained key independently of issuance", () => {
    expect(signingSemanticsSource).toContain(
      "signing_key.key_id = p_signing_key_id",
    );
    expect(signingSemanticsSource).toContain(
      "signing_key.verify_until >= v_now",
    );
    expect(signingSemanticsSource).toContain(
      "v_verification_key.key_id is not null",
    );
  });

  it("keeps fresh issuance on the enabled key through exact token expiry", () => {
    const issuanceGuard = signingSemanticsSource.slice(
      signingSemanticsSource.indexOf(
        "canonicalize_newsletter_action_token_times",
      ),
      signingSemanticsSource.indexOf("confirm_public_newsletter"),
    );
    expect(issuanceGuard).toContain("signing_key.issue_enabled");
    expect(issuanceGuard).toContain(
      "v_verify_until < new.expires_at + interval '30 days'",
    );
    expect(signingSemanticsSource).toContain(
      "signing_key.verify_until >= v_now + interval '30 days'",
    );
    expect(signingSemanticsSource).toContain(
      "'newsletter_unsubscribe', v_issue_key.key_id",
    );
    expect(issuanceHorizonSource).toContain(
      "signing_key.verify_until >= v_now + interval '31 days'",
    );
  });
});
