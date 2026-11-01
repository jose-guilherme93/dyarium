import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom(): never {
  throw new Error("quebrou");
}

describe("ErrorBoundary", () => {
  it("limpa o erro quando a tela muda", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { rerender } = render(
      <ErrorBoundary resetKey="mapa">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Algo deu errado")).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKey="configuracoes">
        <p>Configurações</p>
      </ErrorBoundary>,
    );
    expect(screen.queryByText("Algo deu errado")).not.toBeInTheDocument();
    expect(screen.getByText("Configurações")).toBeInTheDocument();
    spy.mockRestore();
  });
});
