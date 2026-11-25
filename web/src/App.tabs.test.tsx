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

function aba(nome: string): HTMLElement {
  const lista = screen.getByRole("tablist", { name: "Notas abertas" });
  return within(lista).getByRole("tab", { name: nome });
}

function abrirPelaLista(sidebar: HTMLElement, titulo: string) {
  const linha = within(sidebar)
    .getAllByRole("button")
    .find((botao) => botao.querySelector(".note-row-title")?.textContent === titulo);
  if (!linha) throw new Error(`nota ${titulo} nao esta na lista`);
  fireEvent.click(linha);
}

function tituloAberto(): string {
  return (screen.getByLabelText("Título da nota") as HTMLTextAreaElement).value;
}

describe("App abas de notas", () => {
  it("abrir uma nota pela lista cria a aba e mostra o editor", async () => {
    const id = await criarNota("Primeira");
    const { sidebar } = await abrirApp();

    expect(screen.queryByRole("tablist", { name: "Notas abertas" })).not.toBeInTheDocument();
    abrirPelaLista(sidebar, "Primeira");

    expect(await screen.findByRole("tablist", { name: "Notas abertas" })).toBeInTheDocument();
    expect(aba("Primeira")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(tituloAberto()).toBe("Primeira"));
    expect(JSON.parse(localStorage.getItem(TABS_KEY) ?? "{}").tabs).toEqual([
      { id, title: "Primeira" },
    ]);
  });

  it("abrir de novo nao duplica, e trocar de aba mantem o editor", async () => {
    await criarNota("Primeira");
    await criarNota("Segunda");
    const { sidebar } = await abrirApp();

    abrirPelaLista(sidebar, "Primeira");
    abrirPelaLista(sidebar, "Segunda");
    abrirPelaLista(sidebar, "Primeira");

    const lista = screen.getByRole("tablist", { name: "Notas abertas" });
    expect(within(lista).getAllByRole("tab")).toHaveLength(2);

    fireEvent.click(aba("Segunda"));
    expect(aba("Segunda")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(tituloAberto()).toBe("Segunda"));
  });

  it("fechar a aba ativa ativa a vizinha da direita", async () => {
    await criarNota("Primeira");
    await criarNota("Segunda");
    await criarNota("Terceira");
    const { sidebar } = await abrirApp();

    abrirPelaLista(sidebar, "Primeira");
    abrirPelaLista(sidebar, "Segunda");
    abrirPelaLista(sidebar, "Terceira");
    fireEvent.click(aba("Segunda"));

    fireEvent.click(screen.getByRole("button", { name: "Fechar Segunda" }));

    expect(aba("Terceira")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(tituloAberto()).toBe("Terceira"));
  });

  it("fechar a ultima aba volta ao inicio", async () => {
    await criarNota("Primeira");
    const { sidebar } = await abrirApp();
    abrirPelaLista(sidebar, "Primeira");
    await screen.findByRole("tab", { name: "Primeira" });

    fireEvent.click(screen.getByRole("button", { name: "Fechar Primeira" }));

    expect(screen.queryByRole("tablist", { name: "Notas abertas" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Título da nota")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(TABS_KEY) ?? "{}").tabs).toEqual([]);
  });

  it("nota excluida fecha a aba dela", async () => {
    await criarNota("Primeira");
    await criarNota("Segunda");
    const { sidebar } = await abrirApp();
    abrirPelaLista(sidebar, "Primeira");
    abrirPelaLista(sidebar, "Segunda");
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const linha = within(sidebar)
      .getAllByRole("button")
      .find((botao) => botao.querySelector(".note-row-title")?.textContent === "Primeira")
      ?.closest(".note-row");
    fireEvent.contextMenu(linha as HTMLElement);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Apagar nota" }));

    await waitFor(() =>
      expect(
        within(screen.getByRole("tablist", { name: "Notas abertas" })).queryByRole("tab", {
          name: "Primeira",
        }),
      ).not.toBeInTheDocument(),
    );
    expect(aba("Segunda")).toHaveAttribute("aria-selected", "true");
  });

  it("nota arquivada tambem fecha a aba dela", async () => {
    await criarNota("Primeira");
    await criarNota("Segunda");
    const { sidebar } = await abrirApp();
    abrirPelaLista(sidebar, "Primeira");
    abrirPelaLista(sidebar, "Segunda");

    const linha = within(sidebar)
      .getAllByRole("button")
      .find((botao) => botao.querySelector(".note-row-title")?.textContent === "Primeira")
      ?.closest(".note-row");
    fireEvent.contextMenu(linha as HTMLElement);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Arquivar" }));

    await waitFor(() =>
      expect(
        within(screen.getByRole("tablist", { name: "Notas abertas" })).queryByRole("tab", {
          name: "Primeira",
        }),
      ).not.toBeInTheDocument(),
    );
    expect(aba("Segunda")).toHaveAttribute("aria-selected", "true");
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

    const lista = await screen.findByRole("tablist", { name: "Notas abertas" });
    expect(within(lista).queryByRole("tab", { name: "Fantasma" })).not.toBeInTheDocument();
    expect(aba("Valida")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(tituloAberto()).toBe("Valida"));
  });

  it("a aba aberta sobrevive ao recarregar", async () => {
    await criarNota("Primeira");
    const primeira = await abrirApp();
    abrirPelaLista(primeira.sidebar, "Primeira");
    await waitFor(() => expect(tituloAberto()).toBe("Primeira"));
    expect(screen.getByRole("tablist", { name: "Notas abertas" })).toBeInTheDocument();
    primeira.vista.unmount();

    await abrirApp();

    const lista = await screen.findByRole("tablist", { name: "Notas abertas" });
    expect(within(lista).getAllByRole("tab")).toHaveLength(1);
    await waitFor(() => expect(tituloAberto()).toBe("Primeira"));
  });
});
