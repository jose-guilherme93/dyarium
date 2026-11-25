import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Wave } from "./Wave";

const PEAKS = [0.2, 0.8, 0.4, 1, 0.1, 0.6];

describe("Wave", () => {
  it("desenha uma barra por amostra", () => {
    render(<Wave peaks={PEAKS} label="áudio da nota" />);
    expect(document.querySelectorAll(".dy-wave b")).toHaveLength(PEAKS.length);
  });

  it("marca como tocada a fracao pedida", () => {
    render(<Wave peaks={PEAKS} played={0.5} label="áudio da nota" />);
    expect(document.querySelectorAll(".dy-wave b[data-played]")).toHaveLength(3);
  });

  it("barra nao desce abaixo do minimo", () => {
    render(<Wave peaks={[0, 0.0001]} label="áudio da nota" />);
    const bars = document.querySelectorAll<HTMLElement>(".dy-wave b");
    expect(bars[0].style.height).toBe("2px");
  });

  it("tem nome acessivel", () => {
    render(<Wave peaks={PEAKS} label="onda do áudio" />);
    expect(screen.getByRole("img", { name: "onda do áudio" })).toBeInTheDocument();
  });

  it("sem amostras nao desenha barra", () => {
    render(<Wave peaks={[]} label="onda do áudio" />);
    expect(document.querySelectorAll(".dy-wave b")).toHaveLength(0);
  });
});
