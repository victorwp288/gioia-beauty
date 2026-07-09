import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

function SyntheticBookingButton() {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <button type="button" onClick={() => setConfirmed(true)}>
      {confirmed ? "Confermato" : "Prenota"}
    </button>
  );
}

describe("Testing Library harness", () => {
  it("renders in jsdom and supports user interactions", async () => {
    const user = userEvent.setup();
    render(<SyntheticBookingButton />);

    await user.click(screen.getByRole("button", { name: "Prenota" }));

    expect(
      screen.getByRole("button", { name: "Confermato" }),
    ).toBeInTheDocument();
  });
});
