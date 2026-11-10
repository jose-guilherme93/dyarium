import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
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

  it("nao oferece mais a tela de insights; ela vive no mapa", async () => {
    localStorage.setItem("dyarium.token", "token-de-teste");
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

    await waitFor(() => expect(screen.getByRole("navigation")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Insights" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mapa" })).toBeInTheDocument();
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

describe("App caderno MCP", () => {
  const mcpJson = (url: string) => {
    const u = String(url);
    if (u.includes("/api/v1/entries/entry-a/notes")) {
      return {
        notes: [
          {
            id: "n-1",
            entry_id: "entry-a",
            content_markdown: [
              "## 2026-11-07 14:58 · vps-dev",
              "- **feat** terminal do mapa em tres camadas · a1b2c3d",
            ].join("\n"),
          },
        ],
      };
    }
    if (u.includes("/api/v1/entries/entry-b/notes")) {
      return {
        notes: [
          {
            id: "n-2",
            entry_id: "entry-b",
            content_markdown: [
              "## 2026-11-05 09:00 · notebook",
              "- **fix** saldo calculado duas vezes ao importar csv",
            ].join("\n"),
          },
        ],
      };
    }
    if (u.includes("/api/v1/entries")) {
      return {
        entries: [
          { id: "entry-a", notebook_id: "nb-mcp", title: "dyarium", icon: "✒️" },
          { id: "entry-b", notebook_id: "nb-mcp", title: "caixa" },
        ],
      };
    }
    if (u.includes("/api/v1/notebooks")) {
      return {
        notebooks: [{ id: "nb-mcp", name: "Projetos", kind: "mcp", is_default: true }],
      };
    }
    return { entries: [] };
  };

  it("a lista da sidebar sao os projetos; abrir um escopa a area principal", async () => {
    localStorage.setItem("dyarium.token", "token-de-teste");
    localStorage.setItem("dyarium.notebook", "nb-mcp");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        statusText: "",
        headers: new Headers(),
        text: async () => JSON.stringify(mcpJson(String(url))),
      })),
    );
    render(<App />);

    // Sidebar: Todos + cada projeto no seu lugar, com a contagem. A busca e
    // dentro da sidebar: a tabela tambem contem o nome do projeto.
    const sidebar = await screen.findByRole("complementary", { name: /Navegação principal/ });
    const list = within(sidebar);
    const todos = await list.findByRole("button", { name: /^Todos/ });
    expect(todos).toHaveAttribute("aria-pressed", "true");
    const caixa = list.getByRole("button", { name: /caixa/ });
    expect(list.getByRole("button", { name: /dyarium/ })).toBeInTheDocument();

    // Sem projeto escolhido a tabela mostra os dois projetos e a coluna Projeto.
    const allTable = await screen.findByRole("table");
    expect(within(allTable).getAllByRole("columnheader").map((h) => h.textContent)).toContain(
      "Projeto",
    );
    expect(screen.getByText("2 itens · 2 projetos")).toBeInTheDocument();

    // Abrir um projeto escopa a area principal: so ele na tabela, sem a
    // coluna Projeto repetindo o nome que ja esta fixado na lista.
    fireEvent.click(caixa);
    const scoped = await screen.findByRole("table");
    expect(within(scoped).getByText("saldo calculado duas vezes ao importar csv")).toBeInTheDocument();
    expect(within(scoped).queryByText("terminal do mapa em tres camadas")).not.toBeInTheDocument();
    expect(within(scoped).getAllByRole("columnheader").map((h) => h.textContent)).not.toContain(
      "Projeto",
    );

    // Todos devolve a vista completa.
    fireEvent.click(list.getByRole("button", { name: /^Todos/ }));
    const back = await screen.findByRole("table");
    expect(within(back).getAllByRole("columnheader").map((h) => h.textContent)).toContain("Projeto");
    expect(screen.getByText("2 itens · 2 projetos")).toBeInTheDocument();
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
  });
});

describe("App eventos", () => {
  it("abre o stream de eventos depois do login e assina notebook.changed", async () => {
    const streams: { url: string; names: string[]; closed: boolean }[] = [];
    class FakeEventSource {
      url: string;
      names: string[] = [];
      closed = false;
      constructor(url: string) {
        this.url = url;
        streams.push(this);
      }
      addEventListener(name: string) {
        this.names.push(name);
      }
      close() {
        this.closed = true;
      }
    }
    vi.stubGlobal("EventSource", FakeEventSource);
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
    // O efeito do stream roda depois da primeira pintura; espere o EventSource
    // existir em vez de depender da ordem entre a pintura e o efeito.
    await waitFor(() =>
      expect(streams.find((item) => item.url.includes("token=bom"))).toBeDefined(),
    );
    const stream = streams.find((item) => item.url.includes("token=bom"));
    expect(stream?.names).toContain("notebook.changed");
    expect(stream?.names).toContain("entry.status");
  });
});
