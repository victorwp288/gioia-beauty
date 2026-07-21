import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  directToastError: vi.fn(),
  getOwnerSubscribers: vi.fn(),
  notificationError: vi.fn(),
  notifyAsync: vi.fn(),
  runOwnerCommand: vi.fn(),
  showConfirmation: vi.fn(),
}));

vi.mock("react-toastify", () => ({
  toast: {
    error: mocks.directToastError,
    success: vi.fn(),
  },
}));

vi.mock("@/lib/client/ownerApi.ts", () => ({
  getOwnerSubscribers: mocks.getOwnerSubscribers,
  ownerErrorMessage: () => "Errore sintetico",
  runOwnerCommand: mocks.runOwnerCommand,
}));

vi.mock("@/context/NotificationContext", () => ({
  useNotification: () => ({
    notifyAsync: mocks.notifyAsync,
    showConfirmation: mocks.showConfirmation,
  }),
}));

import SubscriberList from "@/components/SubscriberList.jsx";

const subscriber = {
  id: "a6000000-0000-4000-8000-000000000002",
  email: "synthetic-subscriber@gioia.test",
  status: "active",
  subscribedAt: "2026-07-20T10:00:00.000Z",
  version: 1,
};

beforeEach(() => {
  mocks.getOwnerSubscribers.mockResolvedValue({
    items: [subscriber],
    nextCursor: null,
  });
  mocks.runOwnerCommand.mockRejectedValue(new Error("synthetic failure"));
  mocks.showConfirmation.mockResolvedValue("confirm");
  mocks.notifyAsync.mockImplementation(async (operation, messages) => {
    try {
      return await operation();
    } catch (error) {
      mocks.notificationError(messages.error(error));
      throw error;
    }
  });
});

describe("SubscriberList unsubscribe notifications", () => {
  it("does not emit a second toast when one unsubscribe fails", async () => {
    const user = userEvent.setup();
    render(<SubscriberList />);

    await user.click(await screen.findByRole("button", { name: "Disiscrivi" }));

    await waitFor(() => expect(mocks.runOwnerCommand).toHaveBeenCalledOnce());
    expect(mocks.notificationError).toHaveBeenCalledOnce();
    expect(mocks.directToastError).not.toHaveBeenCalled();
  });

  it("does not emit a second toast when bulk unsubscribe fails", async () => {
    const user = userEvent.setup();
    render(<SubscriberList />);

    await user.click(
      await screen.findByRole("checkbox", {
        name: `Seleziona ${subscriber.email}`,
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Disiscrivi selezionati" }),
    );

    await waitFor(() => expect(mocks.runOwnerCommand).toHaveBeenCalledOnce());
    expect(mocks.notificationError).toHaveBeenCalledOnce();
    expect(mocks.directToastError).not.toHaveBeenCalled();
  });

  it("keeps copy and selection readable while disabling unsubscribe mutations", async () => {
    const user = userEvent.setup();
    render(<SubscriberList mutationsDisabled />);

    const unsubscribe = await screen.findByRole("button", {
      name: "Disiscrivi",
    });
    expect(unsubscribe).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Copia questa email" }),
    ).toBeEnabled();

    await user.click(
      screen.getByRole("checkbox", { name: `Seleziona ${subscriber.email}` }),
    );
    expect(
      screen.getByRole("button", { name: "Disiscrivi selezionati" }),
    ).toBeDisabled();
    expect(mocks.runOwnerCommand).not.toHaveBeenCalled();
  });
});
