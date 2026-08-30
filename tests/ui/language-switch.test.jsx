import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/servizi" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

import LanguageSwitch from "@/components/layout/LanguageSwitch";

describe("public language switch", () => {
  it("keeps visitors on the matching services catalog", () => {
    navigation.pathname = "/servizi";
    const { rerender } = render(<LanguageSwitch locale="it" />);

    expect(screen.getByRole("link", { name: "English" })).toHaveAttribute(
      "href",
      "/en/services",
    );

    navigation.pathname = "/en/services";
    rerender(<LanguageSwitch locale="en" />);

    expect(screen.getByRole("link", { name: "Italiano" })).toHaveAttribute(
      "href",
      "/servizi",
    );
  });
});
