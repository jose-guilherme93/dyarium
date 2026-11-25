import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import { api } from "./api";
import type { ImportResult } from "./local/import";
import { registerNodeDatabase } from "./local/__fixtures__/nodeDb";
import { connectDrive, driveVaultRoot } from "./local/driveSession";
import { openDriveVault } from "./local/vaultCloud";

// O cofre no Drive nunca vai a rede: a sessao do Google e a abertura do cofre
// sao dubladas. O resto do modulo fica como esta (driveConfigured ainda
// responde ao VITE_GOOGLE_CLIENT_ID, que os testes ligam e desligam).
vi.mock("./local/driveSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./local/driveSession")>();
  return {
    ...actual,
    connectDrive: vi.fn(async () => undefined),
    driveVaultRoot: vi.fn(async () => undefined),
  };
});

vi.mock("./local/vaultCloud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./local/vaultCloud")>();
  return {
    ...actual,
    openDriveVault: vi.fn(),
  };
});

// A tarefa de importacao vive fora do React; no teste do App ela e um duble
// para o fim poder ser entregue na hora certa, sem rede nem banco.
const jobDuble = vi.hoisted(() => {
  const ouvintes = new Set<() => void>();
  let estado:
    | { status: "idle" }
    | { status: "running"; done: number; total: number }
    | { status: "done"; result: ImportResult }
    | { status: "error"; message: string } = { status: "idle" };
  return {
    estado: () => estado,
    assinar: (ouvinte: () => void) => {
      ouvintes.add(ouvinte);
      return () => {
        ouvintes.delete(ouvinte);
      };
    },
    definir: (novo: typeof estado) => {
      estado = novo;
      for (const ouvinte of [...ouvintes]) ouvinte();
    },
    limpar: () => {
      estado = { status: "idle" };
      ouvintes.clear();
    },
  };
});

vi.mock("./local/importJob", () => ({
  importJobState: () => jobDuble.estado(),
  subscribeImportJob: (ouvinte: () => void) => jobDuble.assinar(ouvinte),
  dismissImportJob: () => jobDuble.definir({ status: "idle" }),
  startServerImport: () => undefined,
}));

beforeEach(async () => {
  localStorage.clear();
  jobDuble.limpar();
  // Sem token o app usa o cofre do navegador; no teste ele e em memoria.
  await registerNodeDatabase();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("App", () => {
  it("primeira visita apresenta o produto e pergunta onde o cofre mora", async () => {
    // Sem client id o botao do Google aparece desligado, como no protótipo.
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "");
    render(<App />);
    // Sem servidor e sem cofre escolhido, a tela de apresentacao vem primeiro.
    await waitFor(() => expect(screen.getByRole("button", { name: /Continuar com Google/ })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Continuar com Google/ })).toBeDisabled();
    // No jsdom nao existe seletor de pasta: a tela oferece o modo sem pasta.
    expect(
      screen.getByRole("button", { name: /(Usar só neste navegador|Seguir neste navegador)/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Nenhuma nota ainda.")).not.toBeInTheDocument();
  });

  it("abre o cofre local quando nao ha servidor nem token", async () => {
    localStorage.setItem("dyarium.onboarded", "1");
    render(<App />);
    // Site estatico: nenhuma tela de token, o banco do navegador assume.
    await waitFor(() => expect(screen.getByText("Nenhuma nota ainda.")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Entrar" })).not.toBeInTheDocument();
  });

  it("com conta ja usada, o primeiro gesto renova o Google em silencio", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id-de-teste");
    localStorage.setItem("dyarium.onboarded", "1");
    localStorage.setItem("dyarium.drive", "1");
    render(<App />);
    await waitFor(() => expect(screen.getByText("Nenhuma nota ainda.")).toBeInTheDocument());
    vi.mocked(connectDrive).mockClear();

    fireEvent.pointerDown(document.body);

    await waitFor(() => expect(connectDrive).toHaveBeenCalledWith({ silent: true }));
  });

  it("VITE_LOCAL_ONLY ignora o token guardado e nem pergunta pelo servidor", async () => {
    // Dev com a API de pe: a flag prende o app ao cofre do navegador, senao o
    // portao do token esconde o caminho que se quer testar.
    vi.stubEnv("VITE_LOCAL_ONLY", "1");
    localStorage.setItem("dyarium.onboarded", "1");
    localStorage.setItem("dyarium.token", "token-de-teste");
    const fetchSpy = vi.fn(async (url: string) => {
      void url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ entries: [] }),
        text: async () => JSON.stringify({ entries: [] }),
        headers: { get: () => "application/json" },
      };
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<App />);
    await waitFor(() => expect(screen.getByText("Nenhuma nota ainda.")).toBeInTheDocument());
    expect(screen.queryByLabelText("Token de acesso")).not.toBeInTheDocument();
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("/setup/state"))).toBe(false);
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

  it("o trilho fica de pe com a sidebar aberta e sozinho quando ela recolhe", async () => {
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

    const rail = await screen.findByRole("navigation", { name: "Trilho" });
    const sidebar = await screen.findByRole("complementary", {
      name: /Navegação principal/,
    });

    // A sidebar aberta nao repete a conta nem as telas do trilho: a navegacao
    // global e uma so, e o avatar continua no pe do trilho.
    expect(within(sidebar).queryByRole("button", { name: "Conta" })).not.toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: "Conta" })).toBeInTheDocument();
    for (const nome of ["Mapa", "Estatísticas", "Calendário", "Configurações", "Sair"]) {
      expect(within(rail).getByRole("button", { name: nome })).toBeInTheDocument();
    }

    // Recolher desmonta a sidebar e deixa o trilho; expandir traz de volta.
    fireEvent.click(within(rail).getByRole("button", { name: "Recolher menu" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: /Navegação principal/ }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("navigation", { name: "Trilho" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expandir menu" }));
    expect(
      await screen.findByRole("complementary", { name: /Navegação principal/ }),
    ).toBeInTheDocument();
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
    const campo = await waitFor(() => screen.getByLabelText("Token de acesso"));
    fireEvent.change(campo, { target: { value: "errado" } });
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
    const campo = await waitFor(() => screen.getByLabelText("Token de acesso"));
    fireEvent.change(campo, { target: { value: "bom" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => expect(screen.getByRole("navigation")).toBeInTheDocument());
    expect(localStorage.getItem("dyarium.token")).toBe("bom");
    vi.unstubAllGlobals();
  });
});

describe("App conta no trilho", () => {
  it("o avatar do pe do trilho abre o menu acima dele e fecha com Escape", async () => {
    localStorage.setItem("dyarium.onboarded", "1");
    render(<App />);

    const rail = await screen.findByRole("navigation", { name: "Trilho" });
    const gatilho = within(rail).getByRole("button", { name: "Conta" });
    expect(gatilho).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(gatilho);

    const menu = await screen.findByRole("menu", { name: "Conta Google" });
    expect(gatilho).toHaveAttribute("aria-expanded", "true");
    // O menu nasce encostado na borda do trilho: nao cobre a navegacao.
    expect(menu).toHaveStyle({ left: "34px", width: "238px" });
    // O avatar continua na tela, no pe do trilho.
    expect(within(rail).getByRole("button", { name: "Conta" })).toBeInTheDocument();

    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("menu", { name: "Conta Google" })).not.toBeInTheDocument(),
    );
    expect(gatilho).toHaveAttribute("aria-expanded", "false");
  });

  it("sem conta o avatar usa o glifo de pessoa em vez de interrogação", async () => {
    localStorage.setItem("dyarium.onboarded", "1");
    render(<App />);

    const rail = await screen.findByRole("navigation", { name: "Trilho" });
    const gatilho = within(rail).getByRole("button", { name: "Conta" });
    expect(gatilho.querySelector(".account-avatar-glyph")).not.toBeNull();
    expect(gatilho.textContent).not.toContain("?");
    expect(gatilho.querySelector(".account-state-mark--none")).not.toBeNull();
  });

  it("com marca e perfil, o reload abre o cache e so tenta o Google em silencio", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id-de-teste");
    localStorage.setItem("dyarium.drive", "1");
    localStorage.setItem(
      "dyarium.account",
      JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", picture: "" }),
    );
    // Sem `dyarium.onboarded`: a marca e o perfil ja provam que a conta existe.
    render(<App />);

    await waitFor(() => expect(screen.getByText("Nenhuma nota ainda.")).toBeInTheDocument());
    expect(
      screen.queryByRole("button", { name: /Continuar com Google/ }),
    ).not.toBeInTheDocument();

    vi.mocked(connectDrive).mockClear();
    fireEvent.pointerDown(document.body);

    await waitFor(() => expect(connectDrive).toHaveBeenCalledWith({ silent: true }));
    // Nenhum caminho automatico pede tela do Google: so o silencioso.
    expect(
      vi.mocked(connectDrive).mock.calls.every(([opcoes]) => opcoes?.silent === true),
    ).toBe(true);
  });

  it("com conta salva e sessao vencida, o avatar pede reconexao", async () => {
    localStorage.setItem("dyarium.onboarded", "1");
    localStorage.setItem(
      "dyarium.account",
      JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", picture: "" }),
    );
    render(<App />);

    const rail = await screen.findByRole("navigation", { name: "Trilho" });
    const gatilho = within(rail).getByRole("button", { name: "Conta" });
    expect(gatilho.querySelector(".account-state-mark--expired")).not.toBeNull();

    fireEvent.click(gatilho);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Conectar/ }));
    expect(screen.queryByRole("menu", { name: "Conta Google" })).not.toBeInTheDocument();
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

    // Sidebar: arvore de projetos. Sem sessoes v2, os projetos v1 mora no
    // grupo `sem pasta`, que comeca recolhido com 2+ projetos; "Todos" marca
    // o escopo inteiro.
    const sidebar = await screen.findByRole("complementary", { name: /Navegação principal/ });
    const list = within(sidebar);
    const todos = await list.findByRole("treeitem", { name: /^Todos/ });
    expect(todos).toHaveAttribute("aria-selected", "true");
    const group = list.getByRole("treeitem", { name: /^sem pasta/ });
    expect(group).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(group);
    expect(group).toHaveAttribute("aria-expanded", "true");
    const caixa = list.getByRole("treeitem", { name: /caixa/ });
    expect(list.getByRole("treeitem", { name: /dyarium/ })).toBeInTheDocument();

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
    fireEvent.click(list.getByRole("treeitem", { name: /^Todos/ }));
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
    const campo = await waitFor(() => screen.getByLabelText("Token de acesso"));
    fireEvent.change(campo, { target: { value: "bom" } });
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

describe("App cofre no Drive", () => {
  const aberto = {
    restored: {
      created: 400,
      updated: 0,
      skipped: 0,
      notebooks: { created: 0, updated: 0, skipped: 0 },
      analyses: 0,
      settings: false,
      attachments: { restored: 218, skipped: 0 },
      source: "backup" as const,
    },
    synced: null,
    summary: { notes: 400, attachments: 218, bytes: 13_000_000 },
  };

  beforeEach(() => {
    vi.mocked(openDriveVault).mockResolvedValue(aberto);
    vi.mocked(connectDrive).mockResolvedValue(undefined as never);
    vi.mocked(driveVaultRoot).mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.mocked(openDriveVault).mockReset();
    vi.mocked(connectDrive).mockReset();
    vi.mocked(driveVaultRoot).mockReset();
  });

  it("abre o cofre do Drive restaurando e sincronizando numa chamada so", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-de-teste");

    // Duas paradas para a tela ser lida no meio do caminho: o estado
    // intermediario tem que ser visivel, nao so o fim.
    let liberaLeitura!: () => void;
    const leitura = new Promise<void>((resolve) => {
      liberaLeitura = resolve;
    });
    let liberaContagem!: () => void;
    const contagem = new Promise<void>((resolve) => {
      liberaContagem = resolve;
    });

    vi.mocked(openDriveVault).mockImplementation(async (_root, options) => {
      options?.onStage?.("lendo");
      await leitura;
      options?.onStage?.("aplicando");
      options?.onProgress?.({ done: 338, total: 400 });
      await contagem;
      return aberto;
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Continuar com Google/ }));

    // A tela de carregamento ocupa o lugar da apresentacao e nomeia a etapa,
    // sem tocar na rede real.
    expect(await screen.findByText("lendo o cofre")).toBeInTheDocument();
    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    expect(connectDrive).toHaveBeenCalled();
    // Uma chamada so: o bug era escolher entre restaurar e sincronizar.
    expect(openDriveVault).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        onStage: expect.any(Function),
        onProgress: expect.any(Function),
      }),
    );

    liberaLeitura();
    expect(await screen.findByText("338")).toBeInTheDocument();
    expect(screen.getByText(/de 400 notas/)).toBeInTheDocument();

    liberaContagem();
    expect(await screen.findByText("pronto")).toBeInTheDocument();

    // "pronto" fica na tela ~1,2 s antes de o cofre abrir.
    await waitFor(() => expect(screen.getByText("Nenhuma nota ainda.")).toBeInTheDocument(), {
      timeout: 4000,
    });
    expect(screen.queryByText("pronto")).not.toBeInTheDocument();
    expect(localStorage.getItem("dyarium.onboarded")).toBe("1");
    // A marca local deixa a linha de reconectar valer no proximo reload.
    expect(localStorage.getItem("dyarium.drive")).toBe("1");
  });

  it("erro no Drive volta para a primeira tela com a linha de erro", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-de-teste");
    vi.mocked(openDriveVault).mockRejectedValue(new Error("Drive 403 sem permissao"));
    // O FirstRun registra a causa no console; no teste isso e so ruido.
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Continuar com Google/ }));

    const erro = await screen.findByRole("alert");
    expect(erro).toHaveTextContent("Sem permissão no Drive");
    // Nada de app nem de "pronto": o cofre nao abriu.
    expect(screen.queryByText("Carregando…")).not.toBeInTheDocument();
    expect(screen.queryByText("pronto")).not.toBeInTheDocument();
    expect(localStorage.getItem("dyarium.onboarded")).toBeNull();
    expect(screen.getByRole("button", { name: /Continuar com Google/ })).toBeInTheDocument();

    log.mockRestore();
  });
});

describe("App importacao do servidor", () => {
  it("quando a tarefa termina, a lista recarrega", async () => {
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
    const listar = vi.spyOn(api, "listEntriesCached");

    render(<App />);
    await waitFor(() => expect(screen.getByRole("navigation")).toBeInTheDocument());
    await waitFor(() => expect(listar.mock.calls.length).toBeGreaterThan(0));
    const antes = listar.mock.calls.length;

    // A tarefa terminou (o dialogo ja fechou ha tempo): o App ouve a assinatura
    // e recarrega a lista, como o antigo `onImported` fazia.
    act(() => {
      jobDuble.definir({
        status: "done",
        result: {
          created: 419,
          updated: 0,
          trashed: 0,
          failed: 0,
          total: 419,
          notebooks: 0,
          covers: 0,
          coversFailed: 0,
          audios: 12,
          audiosFailed: 0,
          transcripts: 0,
          transcriptsFailed: 0,
          analyses: 0,
          analysesFailed: 0,
        },
      });
    });

    await waitFor(() => expect(listar.mock.calls.length).toBeGreaterThan(antes));
    listar.mockRestore();
    vi.unstubAllGlobals();
  });
});
