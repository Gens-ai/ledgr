/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { TaxExportButton, taxExportHref } from "./tax-export-button";

describe("taxExportHref", () => {
  it("encodes year, kind and the group filter, omitting include mode", () => {
    expect(taxExportHref("totals", 2025, [], "include")).toBe("/api/export/tax-year?year=2025&kind=totals");
    expect(taxExportHref("transactions", 2025, ["g1", "g2"], "include")).toBe(
      "/api/export/tax-year?year=2025&kind=transactions&groups=g1%2Cg2",
    );
    expect(taxExportHref("totals", 2024, ["g1"], "exclude")).toBe(
      "/api/export/tax-year?year=2024&kind=totals&groups=g1&groupMode=exclude",
    );
  });
});

describe("TaxExportButton", () => {
  beforeAll(() => {
    // cmdk measures its list; jsdom has no ResizeObserver.
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    Element.prototype.scrollIntoView ??= () => {};
  });

  it("defaults to last year and offers both downloads", async () => {
    render(<TaxExportButton groups={[{ id: "g-biz", name: "Business" }]} currentYear={2026} />);
    fireEvent.click(screen.getByRole("button", { name: /Tax export/ }));

    const totals = await screen.findByRole("link", { name: /Category totals/ });
    expect(totals.getAttribute("href")).toBe("/api/export/tax-year?year=2025&kind=totals");
    fireEvent.click(screen.getByRole("option", { name: /Business/ }));
    expect(screen.getByRole("link", { name: /Transactions/ }).getAttribute("href")).toBe(
      "/api/export/tax-year?year=2025&kind=transactions&groups=g-biz",
    );
  });
});
