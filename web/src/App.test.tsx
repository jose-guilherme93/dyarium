import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    await waitFor(() => expect(screen.getByText("Nenhuma nota ainda.")).toBeInTheDocument());
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("mostra o wizard de primeiro acesso quando o servidor pede setup", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/setup/state")) {
          return { ok: true, status: 200, text: async () => JSON.stringify({ required: true }) };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({}) };
      }),
    );
    render(<App />);
    expect(await screen.findByText(/Bem-vindo/)).toBeInTheDocument();
    expect(screen.getByLabelText("Confirme o token")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("recolhe e reabre o menu lateral", async () => {
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
    await waitFor(() => expect(screen.getByRole("navigation")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Ocultar menu" }));
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mostrar menu" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mostrar menu" }));
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("cria nota escrita com titulo vazio", async () => {
    localStorage.setItem("dyarium.token", "token-de-teste");
    const posts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.includes("/setup/state")) {
          return { ok: true, status: 200, text: async () => JSON.stringify({ required: false }) };
        }
        if (method === "POST" && url.endsWith("/api/v1/entries")) {
          posts.push(String(init?.body ?? ""));
          return { ok: true, status: 201, text: async () => JSON.stringify({ id: "en_novo", title: "" }) };
        }
        if (url.endsWith("/api/v1/entries")) {
          return { ok: true, status: 200, text: async () => JSON.stringify({ entries: [] }) };
        }
        return { ok: false, status: 404, text: async () => JSON.stringify({}) };
      }),
    );
    render(<App />);
    await waitFor(() => expect(screen.getByText("Nenhuma nota ainda.")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Nova nota" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(JSON.parse(posts[0])).toEqual({ title: "" });
    vi.unstubAllGlobals();
  });
});
