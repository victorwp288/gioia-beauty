import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getMaintenanceStatus: vi.fn() }));

vi.mock("@/lib/client/maintenanceApi.ts", () => ({
  getMaintenanceStatus: mocks.getMaintenanceStatus,
}));

import { useMaintenanceStatus } from "@/hooks/useMaintenanceStatus";

beforeEach(() => mocks.getMaintenanceStatus.mockReset());

function Probe() {
  const status = useMaintenanceStatus();
  return (
    <>
      <button disabled={!status.publicBookingEnabled}>public</button>
      <button disabled={!status.ownerMutationsEnabled}>owner</button>
      <output>
        {status.messageCode ?? (status.unavailable ? "unavailable" : "loading")}
      </output>
    </>
  );
}

describe("useMaintenanceStatus", () => {
  it("starts fail-closed and enables controls only after a valid open status", async () => {
    let resolveStatus;
    mocks.getMaintenanceStatus.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );
    render(<Probe />);
    expect(screen.getByRole("button", { name: "public" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "owner" })).toBeDisabled();

    resolveStatus({
      code: "MAINTENANCE_STATUS",
      messageCode: "OPERATIONS_OPEN",
      ownerMutationsEnabled: true,
      publicBookingEnabled: true,
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "public" })).toBeEnabled(),
    );
    expect(screen.getByRole("button", { name: "owner" })).toBeEnabled();
  });

  it("refreshes on focus so an active freeze disables stale controls", async () => {
    mocks.getMaintenanceStatus
      .mockResolvedValueOnce({
        code: "MAINTENANCE_STATUS",
        messageCode: "OPERATIONS_OPEN",
        ownerMutationsEnabled: true,
        publicBookingEnabled: true,
      })
      .mockResolvedValueOnce({
        code: "MAINTENANCE_STATUS",
        messageCode: "MAINTENANCE_ACTIVE",
        ownerMutationsEnabled: false,
        publicBookingEnabled: false,
      });
    render(<Probe />);
    await screen.findByText("OPERATIONS_OPEN");

    fireEvent.focus(window);

    await screen.findByText("MAINTENANCE_ACTIVE");
    expect(screen.getByRole("button", { name: "public" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "owner" })).toBeDisabled();
  });
});
