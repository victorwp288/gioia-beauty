import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  OWNER_SCHEDULE_COMMAND_CONTRACTS,
  ownerCommandFailureKey,
} from "@/lib/server/database/ownerScheduleCommandContracts.ts";

describe("owner schedule command metadata", () => {
  it.each(Object.entries(OWNER_SCHEDULE_COMMAND_CONTRACTS))(
    "keeps %s fingerprint and SQL operation names identical",
    (_commandName, contract) => {
      expect(contract.fingerprintVersion).toBe(1);
      expect(contract.query).toContain(
        `from gioia_private.${contract.operation}(`,
      );
      expect(contract.query).toMatch(/\)\s+as command\s+limit 2\s*$/i);
      expect(new Set(contract.failures).size).toBe(contract.failures.length);
    },
  );

  it("represents the two status-transition failure pairs independently", () => {
    const failures =
      OWNER_SCHEDULE_COMMAND_CONTRACTS.setAppointmentStatus.failures;
    expect(failures).toContain(
      ownerCommandFailureKey(400, "STATUS_TRANSITION_INVALID"),
    );
    expect(failures).toContain(
      ownerCommandFailureKey(409, "STATUS_TRANSITION_INVALID"),
    );
  });
});
