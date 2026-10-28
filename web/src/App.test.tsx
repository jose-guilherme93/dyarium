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

  it("rejeita token invalido e permanece na tela de acesso", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/api/v1/version")) {
          return { ok: false, status: 401, text: async () => JSON.stringify({ error: { message: "unauthorized" } }) };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({ entries: [] }) };
      }),
    );
    render(<App />);
    fireEvent.change(screen.getByLabelText("Token de acesso"), { target: { value: "errado" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Token invalido"));
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(localStorage.getItem("dyarium.token")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("limpa o token invalido ja salvo ao carregar", async () => {
    localStorage.setItem("dyarium.token", "errado");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/api/v1/version")) {
          return { ok: false, status: 401, text: async () => JSON.stringify({ error: { message: "unauthorized" } }) };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({ entries: [] }) };
      }),
    );
    render(<App />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Token invalido"));
    expect(localStorage.getItem("dyarium.token")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("entra quando o token e valido", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify(String(url).includes("/api/v1/version") ? { version: "test" } : { entries: [] }),
      })),
    );
    render(<App />);
    fireEvent.change(screen.getByLabelText("Token de acesso"), { target: { value: "bom" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => expect(screen.getByRole("navigation")).toBeInTheDocument());
    expect(localStorage.getItem("dyarium.token")).toBe("bom");
    vi.unstubAllGlobals();
  });
});

describe("App primeiro acesso", () => {
  it("mostra o wizard e guarda o token escolhido", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/setup/state")) {
          return { ok: true, status: 200, text: async () => JSON.stringify({ required: true }) };
        }
        if (url.endsWith("/setup") && init?.method === "POST") {
          return { ok: true, status: 200, text: async () => JSON.stringify({ status: "ok" }) };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({ entries: [] }) };
      }),
    );
    render(<App />);

    expect(await screen.findByText(/Bem-vindo/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Token de acesso"), {
      target: { value: "token-forte" },
    });
    fireEvent.change(screen.getByLabelText("Confirme o token"), {
      target: { value: "token-forte" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar token e entrar" }));

    await waitFor(() => expect(localStorage.getItem("dyarium.token")).toBe("token-forte"));
    vi.unstubAllGlobals();
  });
});
