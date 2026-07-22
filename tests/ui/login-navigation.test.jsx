import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loginOwner: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
    refresh: mocks.refresh,
    replace: mocks.replace,
  }),
}));

vi.mock("next/image", () => ({
  default: ({ alt }) => <span aria-label={alt} role="img" />,
}));

vi.mock("@/lib/client/ownerApi.ts", () => ({
  loginOwner: mocks.loginOwner,
  OwnerApiError: class OwnerApiError extends Error {},
  ownerErrorMessage: () => "Errore sintetico",
}));

import Login from "@/app/login/page.jsx";

beforeEach(() => {
  mocks.loginOwner.mockResolvedValue({
    code: "OWNER_SESSION_CREATED",
    csrfToken: "x".repeat(43),
  });
});

describe("owner login navigation", () => {
  it("performs one replacement after authentication without racing a refresh", async () => {
    const user = userEvent.setup();
    render(<Login />);

    await user.type(
      screen.getByRole("textbox", { name: "Indirizzo email" }),
      "owner@gioia.test",
    );
    await user.type(screen.getByLabelText("Password"), "Synthetic-password-1!");
    await user.click(screen.getByRole("button", { name: /^Accedi/u }));

    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledExactlyOnceWith("/dashboard"),
    );
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
