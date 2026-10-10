import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import App from "./App";

describe("App", () => {
  it("renderiza o layout base e o estado vazio", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Entradas" })).toBeInTheDocument();
    expect(screen.getByText("Nenhuma entrada ainda.")).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  it("recolhe e reexibe o painel de contexto", () => {
    render(<App />);
    const panel = screen.getByRole("complementary", { name: "Painel de contexto" });
    expect(panel).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ocultar painel" }));
    expect(
      screen.queryByRole("complementary", { name: "Painel de contexto" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mostrar painel" }));
    expect(
      screen.getByRole("complementary", { name: "Painel de contexto" }),
    ).toBeInTheDocument();
  });
});
