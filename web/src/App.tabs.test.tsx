import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import { api } from "./api";
import { registerNodeDatabase } from "./local/__fixtures__/nodeDb";
import { DEFAULT_NOTEBOOK_ID } from "./lib/notebooks";
import { TABS_KEY } from "./lib/tabs";

beforeEach(async () => {
  localStorage.clear();
  await registerNodeDatabase();
  // O editor de corpo consulta o tema do sistema; no jsdom isso falta.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function criarNota(titulo: string): Promise<string> {
  const entry = await api.createEntry(titulo, null, DEFAULT_NOTEBOOK_ID);
  return entry.id;
}

async function abrirApp(esperando = "Primeira"): Promise<{
  vista: ReturnType<typeof render>;
  sidebar: HTMLElement;
}> {
  localStorage.setItem("dyarium.onboarded", "1");
  const vista = render(<App />);
  const sidebar = await screen.findByRole("complementary", { name: /Navegação principal/ });
  await within(sidebar).findByText(esperando);
  return { vista, sidebar };
}

function barra(): HTMLElement | null {
  return screen.queryByRole("tablist", { name: "Notas abertas" });
}

function aba(nome: string): HTMLElement {
  const lista = barra();
  if (!lista) throw new Error("a barra de abas nao esta na tela");
  return within(lista).getByRole("tab", { name: nome });
}

function abasAbertas(): string[] {
  const lista = barra();
  return lista ? within(lista).getAllByRole("tab").map((item) => item.textContent ?? "") : [];
}

function abasGravadas(): { id: string; title: string }[] {
  const bruto = JSON.parse(localStorage.getItem(TABS_KEY) ?? "{}") as {
    tabs?: { id: string; title: string }[];
  };
  return bruto.tabs ?? [];
}

function linhaDaNota(sidebar: HTMLElement, titulo: string): HTMLElement {
  const linha = within(sidebar)
    .getAllByRole("button")
    .find((botao) => botao.querySelector(".note-row-title")?.textContent === titulo)
    ?.closest(".note-row");
  if (!linha) throw new Error(`nota ${titulo} nao esta na lista`);
  return linha as HTMLElement;
}

function abrirPelaLista(sidebar: HTMLElement, titulo: string) {
  const abrir = within(linhaDaNota(sidebar, titulo)).getByRole("button");
  fireEvent.click(abrir);
}

/** O unico gesto que cria aba: o menu de contexto da nota. */
async function abrirEmNovaAba(sidebar: HTMLElement, titulo: string) {
  fireEvent.contextMenu(linhaDaNota(sidebar, titulo), { clientX: 40, clientY: 60 });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Abrir em nova aba" }));
}

async function apagarPelaLista(sidebar: HTMLElement, titulo: string) {
  fireEvent.contextMenu(linhaDaNota(sidebar, titulo), { clientX: 40, clientY: 60 });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Apagar nota" }));
}

function tituloAberto(): string {
  return (screen.getByLabelText("Título da nota") as HTMLTextAreaElement).value;
}

describe("App abas de notas", () => {
  it("clique normal abre em visão única, sem criar aba", async () => {
    await criarNota("Primeira");
    const { sidebar } = await abrirApp();

    abrirPelaLista(sidebar, "Primeira");

    await waitFor(() => expect(tituloAberto()).toBe("Primeira"));
    expect(barra()).toBeNull();
    expect(abasGravadas()).toEqual([]);
  });

  it("Abrir em nova aba sem nota aberta deixa a nota sozinha e sem barra", async () => {
    await criarNota("Primeira");
    const { sidebar } = await abrirApp();

    await abrirEmNovaAba(sidebar, "Primeira");

    await waitFor(() => expect(tituloAberto()).toBe("Primeira"));
    // Uma aba so nao mostra a barra: e so o editor.
    expect(barra()).toBeNull();
    await waitFor(() => expect(abasGravadas().map((tab) => tab.title)).toEqual(["Primeira"]));
  });

  it("com nota aberta, Abrir em nova aba põe a aberta primeiro e a escolhida ativa", async () => {
    const primeira = await criarNota("Primeira");
    const segunda = await criarNota("Segunda");
    const { sidebar } = await abrirApp();

    abrirPelaLista(sidebar, "Primeira");
    await waitFor(() => expect(tituloAberto()).toBe("Primeira"));
    await abrirEmNovaAba(sidebar, "Segunda");

    await screen.findByRole("tablist", { name: "Notas abertas" });
    await waitFor(() => expect(abasAbertas()).toEqual(["Primeira", "Segunda"]));
    expect(aba("Segunda")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(tituloAberto()).toBe("Segunda"));
    expect(abasGravadas().map((tab) => tab.id)).toEqual([primeira, segunda]);
  });

  it("Abrir em nova aba de uma nota que já é aba só ativa, sem duplicar", async () => {
    await criarNota("Primeira");
    await criarNota("Segunda");
    const { sidebar } = await abrirApp();

    abrirPelaLista(sidebar, "Primeira");
    await waitFor(() => expect(tituloAberto()).toBe("Primeira"));
    await abrirEmNovaAba(sidebar, "Segunda");
    await screen.findByRole("tablist", { name: "Notas abertas" });
    fireEvent.click(aba("Segunda"));

    await abrirEmNovaAba(sidebar, "Primeira");

    expect(abasAbertas()).toEqual(["Primeira", "Segunda"]);
    expect(aba("Primeira")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(tituloAberto()).toBe("Primeira"));
  });

  it("clique normal fecha as abas e volta ao editor da nota escolhida", async () => {
    await criarNota("Primeira");
    await criarNota("Segunda");
    await criarNota("Terceira");
    const { sidebar } = await abrirApp();

    abrirPelaLista(sidebar, "Primeira");
    await waitFor(() => expect(tituloAberto()).toBe("Primeira"));
    await abrirEmNovaAba(sidebar, "Segunda");
    await screen.findByRole("tablist", { name: "Notas abertas" });

    abrirPelaLista(sidebar, "Terceira");

    await waitFor(() => expect(tituloAberto()).toBe("Terceira"));
    expect(barra()).toBeNull();
    expect(abasGravadas()).toEqual([]);
  });

  it("trocar de aba mantém as outras e o editor", async () => {
    await criarNota("Primeira");
    await criarNota("Segunda");
    const { sidebar } = await abrirApp();

    abrirPelaLista(sidebar, "Primeira");
    await waitFor(() => expect(tituloAberto()).toBe("Primeira"));
    await abrirEmNovaAba(sidebar, "Segunda");
    await screen.findByRole("tablist", { name: "Notas abertas" });

    fireEvent.click(aba("Primeira"));
    expect(aba("Primeira")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(tituloAberto()).toBe("Primeira"));
    expect(abasAbertas()).toEqual(["Primeira", "Segunda"]);
  });

  it("fechar a aba ativa ativa a vizinha da direita", async () => {
    await criarNota("Primeira");
    await criarNota("Segunda");
    await criarNota("Terceira");
    const { sidebar } = await abrirApp();

    abrirPelaLista(sidebar, "Primeira");
    await waitFor(() => expect(tituloAberto()).toBe("Primeira"));
    await abrirEmNovaAba(sidebar, "Segunda");
    await abrirEmNovaAba(sidebar, "Terceira");
    await screen.findByRole("tablist", { name: "Notas abertas" });
    fireEvent.click(aba("Segunda"));

    fireEvent.click(screen.getByRole("button", { name: "Fechar Segunda" }));

    expect(aba("Terceira")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(tituloAberto()).toBe("Terceira"));
  });

  it("fechar até sobrar uma esconde a barra e mantém a nota", async () => {
    await criarNota("Primeira");
    await criarNota("Segunda");
    await criarNota("Terceira");
    const { sidebar } = await abrirApp();

    abrirPelaLista(sidebar, "Primeira");
    await waitFor(() => expect(tituloAberto()).toBe("Primeira"));
    await abrirEmNovaAba(sidebar, "Segunda");
    await abrirEmNovaAba(sidebar, "Terceira");
    await screen.findByRole("tablist", { name: "Notas abertas" });

    // Fechando a ativa (Terceira) quem assume é a da esquerda.
    fireEvent.click(screen.getByRole("button", { name: "Fechar Terceira" }));
    expect(abasAbertas()).toEqual(["Primeira", "Segunda"]);
    await waitFor(() => expect(tituloAberto()).toBe("Segunda"));

    fireEvent.click(screen.getByRole("button", { name: "Fechar Segunda" }));
    // A barra sai de cena, o editor continua na nota que sobrou.
    await waitFor(() => expect(barra()).toBeNull());
    await waitFor(() => expect(tituloAberto()).toBe("Primeira"));
    expect(abasGravadas().map((tab) => tab.title)).toEqual(["Primeira"]);
  });

  it("fechar a última aba volta ao início", async () => {
    await criarNota("Primeira");
    await criarNota("Segunda");
    const { sidebar } = await abrirApp();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    abrirPelaLista(sidebar, "Primeira");
    await waitFor(() => expect(tituloAberto()).toBe("Primeira"));
    await abrirEmNovaAba(sidebar, "Segunda");
    await screen.findByRole("tablist", { name: "Notas abertas" });

    // Fechar uma das duas some com a barra e mantém a outra. Sem barra, a
    // última sai pelo caminho da nota apagada.
    await apagarPelaLista(sidebar, "Primeira");
    await waitFor(() => expect(barra()).toBeNull());
    await waitFor(() => expect(tituloAberto()).toBe("Segunda"));

    await apagarPelaLista(sidebar, "Segunda");

    await waitFor(() => expect(screen.queryByLabelText("Título da nota")).not.toBeInTheDocument());
    expect(screen.getByRole("region", { name: "início" })).toBeInTheDocument();
    expect(abasGravadas()).toEqual([]);
  });

  it("nota excluida fecha a aba dela", async () => {
    await criarNota("Primeira");
    await criarNota("Segunda");
    await criarNota("Terceira");
    const { sidebar } = await abrirApp();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    abrirPelaLista(sidebar, "Primeira");
    await waitFor(() => expect(tituloAberto()).toBe("Primeira"));
    await abrirEmNovaAba(sidebar, "Segunda");
    await abrirEmNovaAba(sidebar, "Terceira");
    await screen.findByRole("tablist", { name: "Notas abertas" });

    fireEvent.contextMenu(linhaDaNota(sidebar, "Primeira"), { clientX: 40, clientY: 60 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Apagar nota" }));

    await waitFor(() => expect(abasAbertas()).toEqual(["Segunda", "Terceira"]));
    expect(aba("Terceira")).toHaveAttribute("aria-selected", "true");
  });

  it("nota arquivada tambem fecha a aba dela", async () => {
    await criarNota("Primeira");
    await criarNota("Segunda");
    await criarNota("Terceira");
    const { sidebar } = await abrirApp();

    abrirPelaLista(sidebar, "Primeira");
    await waitFor(() => expect(tituloAberto()).toBe("Primeira"));
    await abrirEmNovaAba(sidebar, "Segunda");
    await abrirEmNovaAba(sidebar, "Terceira");
    await screen.findByRole("tablist", { name: "Notas abertas" });

    fireEvent.contextMenu(linhaDaNota(sidebar, "Primeira"), { clientX: 40, clientY: 60 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Arquivar" }));

    await waitFor(() => expect(abasAbertas()).toEqual(["Segunda", "Terceira"]));
    expect(aba("Terceira")).toHaveAttribute("aria-selected", "true");
  });

  it("restauracao descarta id que nao existe mais", async () => {
    const id = await criarNota("Valida");
    localStorage.setItem(
      TABS_KEY,
      JSON.stringify({
        tabs: [
          { id: "sumiu", title: "Fantasma" },
          { id, title: "Valida" },
        ],
        activeId: "sumiu",
      }),
    );

    await abrirApp("Valida");

    // Sobrou uma aba só: a barra não aparece e a nota restaurada abre.
    await waitFor(() => expect(tituloAberto()).toBe("Valida"));
    expect(barra()).toBeNull();
    expect(abasGravadas().map((tab) => tab.id)).toEqual([id]);
  });

  it("a mesa com duas abas sobrevive ao recarregar", async () => {
    await criarNota("Primeira");
    await criarNota("Segunda");
    const primeira = await abrirApp();
    abrirPelaLista(primeira.sidebar, "Primeira");
    await waitFor(() => expect(tituloAberto()).toBe("Primeira"));
    await abrirEmNovaAba(primeira.sidebar, "Segunda");
    await screen.findByRole("tablist", { name: "Notas abertas" });
    primeira.vista.unmount();

    await abrirApp();

    await screen.findByRole("tablist", { name: "Notas abertas" });
    expect(abasAbertas()).toEqual(["Primeira", "Segunda"]);
    await waitFor(() => expect(tituloAberto()).toBe("Segunda"));
  });
});
