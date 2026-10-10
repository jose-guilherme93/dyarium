import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "./App";

beforeEach(() => {
  localStorage.clear();
});

describe("App", () => {
  it("pede o token quando nao ha token salvo", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "dyarium" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Entrar" })).toBeInTheDocument();
  });

  it("mostra o estado vazio da lista quando autenticado", async () => {
    localStorage.setItem("dyarium.token", "token-de-teste");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ entries: [] }),
      })),
    );
    render(<App />);
    await waitFor(() => expect(screen.getByText("Nenhuma entrada ainda.")).toBeInTheDocument());
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
