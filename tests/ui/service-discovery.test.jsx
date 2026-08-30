import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import FullServiceCatalog from "@/components/services/FullServiceCatalog";
import ServicesContainer from "@/components/services/ServicesContainer";
import { SERVICE_CATALOG } from "@/lib/domain/catalog/index.ts";
import {
  ENGLISH_SERVICE_NAMES,
  SERVICE_DISCOVERY_CATEGORIES,
  assertCompleteServiceDiscovery,
} from "@/components/services/serviceDiscoveryContent.js";

describe("service discovery", () => {
  it("represents every active category and translates every active service", () => {
    expect(assertCompleteServiceDiscovery()).toEqual({
      categoriesComplete: true,
      servicesComplete: true,
    });
    expect(SERVICE_DISCOVERY_CATEGORIES).toHaveLength(12);
    expect(Object.keys(ENGLISH_SERVICE_NAMES)).toHaveLength(74);
  });

  it("renders a lightweight Italian homepage index with one link per category", () => {
    const { container } = render(<ServicesContainer />);

    expect(
      screen.getByRole("heading", { name: "Trova la cura giusta per te" }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll('a[href^="/servizi#"]')).toHaveLength(12);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(screen.queryByText(/extension/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/acconciatur/i)).not.toBeInTheDocument();
  });

  it("renders the complete English catalogue from canonical service identities", () => {
    const { container } = render(<FullServiceCatalog locale="en" />);

    expect(
      screen.getByRole("heading", { name: "Treatment catalogue" }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("details")).toHaveLength(12);
    expect(container.querySelectorAll("details li")).toHaveLength(
      SERVICE_CATALOG.services.length,
    );
    expect(
      screen.getByText("One-to-one basic make-up course"),
    ).toBeInTheDocument();
    expect(screen.getByText("Laser consultation")).toBeInTheDocument();
    expect(screen.queryByText(/lash extensions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/hairstyl/i)).not.toBeInTheDocument();
  });
});
