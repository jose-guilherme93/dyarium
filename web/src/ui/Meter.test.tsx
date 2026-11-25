import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Meter } from "./Meter";

describe("Meter", () => {
  it("expoe o valor atual como progressbar", () => {
    render(<Meter value={18} max={28} label="notas" />);

    const medidor = screen.getByRole("progressbar", { name: "notas" });
    expect(medidor).toHaveAttribute("aria-valuenow", "18");
    expect(medidor).toHaveAttribute("aria-valuemin", "0");
    expect(medidor).toHaveAttribute("aria-valuemax", "28");
  });

  it("usa max 100 quando nao vem max", () => {
    render(<Meter value={64} label="concluido" />);

    expect(screen.getByRole("progressbar", { name: "concluido" })).toHaveAttribute(
      "aria-valuemax",
      "100",
    );
  });
});
