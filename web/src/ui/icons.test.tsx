import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Icon } from "./icons";

describe("Icon", () => {
  it("desenha o caminho declarado em docs/design/icons.json", () => {
    render(<Icon name="mic" />);
    const svg = document.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 14 14");
    expect(svg?.querySelector("path")?.getAttribute("d")).toContain("M5 3.5");
  });

  it("usa o tamanho de desenho e o traco dos tokens", () => {
    render(<Icon name="menu" />);
    const svg = document.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("14");
    expect(svg?.getAttribute("height")).toBe("14");
    expect(svg?.getAttribute("class")).toContain("dy-icon");
  });

  it("sem rotulo e decorativo para o leitor de tela", () => {
    render(<Icon name="menu" />);
    expect(document.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("com rotulo vira imagem nomeada", () => {
    render(<Icon name="search" label="buscar" />);
    expect(screen.getByRole("img", { name: "buscar" })).toBeInTheDocument();
  });

  it("icone preenchido nao herda stroke", () => {
    render(<Icon name="stop" />);
    expect(document.querySelector("path")?.getAttribute("fill")).toBe("currentColor");
    expect(document.querySelector("svg")?.getAttribute("data-fill")).toBe("true");
  });
});
