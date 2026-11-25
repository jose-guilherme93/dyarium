import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NotebookSwitcher } from "./NotebookSwitcher";
import { ALL_NOTEBOOKS } from "../lib/notebooks";
import type { Notebook } from "../types";

function notebook(overrides: Partial<Notebook> & { id: string; name: string }): Notebook {
  return {
    color: "",
    is_default: false,
    kind: "notes",
    subtitle: "",
    author: "",
    synopsis: "",
    language: "pt-BR",
    goal_words: 0,
    book_status: "drafting",
    entry_count: 0,
    chapter_count: 0,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

const inbox = notebook({ id: "inbox", name: "Notas ao acaso", is_default: true, entry_count: 38 });
const sonhos = notebook({ id: "sonhos", name: "Caderno de sonhos", entry_count: 24 });
const livro = notebook({
  id: "livro1",
  name: "O silencio das tardes",
  kind: "book",
  entry_count: 999,
  chapter_count: 12,
  goal_words: 60000,
  words: 34210,
});
const cartinhas = notebook({
  id: "livro2",
  name: "Cartas que nao enviei",
  kind: "book",
  entry_count: 1,
  chapter_count: 1,
  goal_words: 0,
});

function setup(
  notebooks: Notebook[] = [inbox, sonhos, livro, cartinhas],
  activeId: string = inbox.id,
) {
  const props = {
    notebooks,
    activeId,
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onCreateBook: vi.fn(),
    onRename: vi.fn(),
    onBookSettings: vi.fn(),
    onDelete: vi.fn(),
  };
  render(<NotebookSwitcher {...props} />);
  return props;
}

const trigger = () => screen.getByRole("button", { name: "Escolher caderno" });
const open = () => fireEvent.click(trigger());

describe("seletor de cadernos", () => {
  it("o total de todas as notas exclui os livros", () => {
    setup();
    open();
    expect(screen.getByText("Todas")).toBeInTheDocument();
    const all = screen.getByRole("menuitemradio", { name: /Todas as notas/ });
    // 38 + 24: os 999 do livro nao entram.
    expect(all).toHaveTextContent("62");
    expect(all.textContent).not.toContain("999");
    expect(all).toHaveAttribute("aria-checked", "false");
  });

  it("marcadores: caps abreviado, rotulo completo e medidor so com meta", () => {
    setup();
    open();
    const row12 = screen.getByRole("menuitemradio", { name: /O silencio das tardes/ });
    expect(row12).toHaveTextContent("12 caps");
    const num12 = row12.querySelector(".notebook-menu-count") as HTMLElement;
    expect(num12).toHaveAttribute("title", "12 capítulos");
    expect(num12).toHaveAttribute("aria-label", "12 capítulos");
    expect(row12.querySelector(".notebook-menu-meter")).not.toBeNull();

    const row1 = screen.getByRole("menuitemradio", { name: /Cartas que nao enviei/ });
    expect(row1).toHaveTextContent("1 cap");
    const num1 = row1.querySelector(".notebook-menu-count") as HTMLElement;
    expect(num1).toHaveAttribute("title", "1 capítulo");
    expect(row1.querySelector(".notebook-menu-meter")).toBeNull();

    const nota = screen.getByRole("menuitemradio", { name: /Caderno de sonhos/ });
    expect(nota).toHaveTextContent("24");
    expect(nota).toHaveAttribute("aria-checked", "false");
  });

  it("a linha ativa traz aria-checked e o gatilho aria-expanded", () => {
    setup();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
    open();
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("menuitemradio", { name: /Notas ao acaso/ }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("sem livros, o rotulo Livros nao aparece", () => {
    setup([inbox, sonhos]);
    open();
    expect(screen.getByText("Cadernos")).toBeInTheDocument();
    expect(screen.queryByText("Livros")).not.toBeInTheDocument();
  });

  it("sem cadernos, o rotulo Cadernos nao aparece", () => {
    render(<NotebookSwitcher
      notebooks={[livro]}
      activeId={livro.id}
      onSelect={() => {}}
      onCreate={() => {}}
      onCreateBook={() => {}}
      onRename={() => {}}
      onBookSettings={() => {}}
      onDelete={() => {}}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Escolher caderno" }));
    expect(screen.getByText("Livros")).toBeInTheDocument();
    expect(screen.queryByText("Cadernos")).not.toBeInTheDocument();
  });

  // O rodape e um unico botao "Novo"; as opcoes de criacao vivem num submenu
  // flutuante ("Criar") que nao esconde nem substitui a lista.
  const novo = () => screen.getByRole("menuitem", { name: "Novo" });
  const submenuCriar = () => screen.getByRole("menu", { name: "Criar" });
  const opcaoCaderno = () =>
    within(submenuCriar()).getByRole("menuitem", { name: "Novo caderno" });
  const opcaoLivro = () =>
    within(submenuCriar()).getByRole("menuitem", { name: "Novo livro" });

  it("rodape tem um unico botao Novo com sinal de submenu", () => {
    setup();
    open();
    const foot = document.querySelector(".notebook-menu-foot") as HTMLElement;
    expect(foot.querySelectorAll("button")).toHaveLength(1);
    expect(novo()).toHaveAttribute("aria-haspopup", "menu");
    expect(novo()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu", { name: "Criar" })).toBeNull();
  });

  it("Novo abre um submenu com duas opcoes e mantem a lista no DOM", () => {
    const props = setup();
    open();
    fireEvent.click(novo());
    const sub = submenuCriar();
    const items = within(sub).getAllByRole("menuitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Novo caderno");
    expect(items[1]).toHaveTextContent("Novo livro");
    expect(novo()).toHaveAttribute("aria-expanded", "true");
    // a lista continua no DOM atras do submenu: rotulos e linhas intactos
    expect(screen.getByText("Cadernos")).toBeInTheDocument();
    expect(screen.getByText("Livros")).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Caderno de sonhos/ })).toBeInTheDocument();
    expect(screen.getByText("Todas")).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Todas as notas/ })).toBeInTheDocument();
    expect(props.onSelect).not.toHaveBeenCalled();
    // clicar de novo no Novo fecha o submenu e mantem o menu aberto
    fireEvent.click(novo());
    expect(screen.queryByRole("menu", { name: "Criar" })).toBeNull();
    expect(screen.getByRole("menuitemradio", { name: /Caderno de sonhos/ })).toBeInTheDocument();
    expect(screen.getByRole("menu", { name: "Escolher caderno" })).toBeInTheDocument();
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("escolher Novo caderno fecha tudo e chama onCreate", () => {
    const props = setup();
    open();
    fireEvent.click(novo());
    fireEvent.click(opcaoCaderno());
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    expect(props.onCreateBook).not.toHaveBeenCalled();
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu", { name: "Escolher caderno" })).toBeNull();
    expect(screen.queryByRole("menu", { name: "Criar" })).toBeNull();
  });

  it("escolher Novo livro fecha tudo e chama onCreateBook", () => {
    const props = setup();
    open();
    fireEvent.click(novo());
    fireEvent.click(opcaoLivro());
    expect(props.onCreateBook).toHaveBeenCalledTimes(1);
    expect(props.onCreate).not.toHaveBeenCalled();
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu", { name: "Escolher caderno" })).toBeNull();
    expect(screen.queryByRole("menu", { name: "Criar" })).toBeNull();
  });

  it("ArrowDown, Enter e Espaco no Novo abrem o submenu com foco na primeira", () => {
    const props = setup();
    open();
    novo().focus();
    fireEvent.keyDown(novo(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(opcaoCaderno());
    // a lista continua no DOM
    expect(screen.getByRole("menuitemradio", { name: /Caderno de sonhos/ })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    novo().focus();
    fireEvent.keyDown(novo(), { key: "Enter" });
    expect(document.activeElement).toBe(opcaoCaderno());
    fireEvent.keyDown(document.body, { key: "Escape" });
    novo().focus();
    fireEvent.keyDown(novo(), { key: " " });
    expect(document.activeElement).toBe(opcaoCaderno());
    // escolher a opcao cria e fecha tudo
    fireEvent.click(opcaoCaderno());
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu", { name: "Escolher caderno" })).toBeNull();
  });

  it("Escape esconde o submenu e devolve ao Novo; segundo Escape fecha o menu", () => {
    setup();
    open();
    fireEvent.click(novo());
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Criar" })).toBeNull();
    expect(screen.getByText("Cadernos")).toBeInTheDocument();
    expect(document.activeElement).toBe(novo());
    expect(screen.getByRole("menu", { name: "Escolher caderno" })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Escolher caderno" })).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("Tab fecha o submenu junto com o menu", () => {
    setup();
    open();
    fireEvent.click(novo());
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(screen.queryByRole("menu", { name: "Criar" })).toBeNull();
    expect(screen.queryByRole("menu", { name: "Escolher caderno" })).toBeNull();
  });

  it("pointerdown fora fecha o submenu junto com o menu", () => {
    setup();
    open();
    fireEvent.click(novo());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu", { name: "Criar" })).toBeNull();
    expect(screen.queryByRole("menu", { name: "Escolher caderno" })).toBeNull();
  });

  it("setas no submenu do Novo navegam com wrap", () => {
    setup();
    open();
    fireEvent.click(novo());
    const cad = opcaoCaderno();
    const liv = opcaoLivro();
    cad.focus();
    fireEvent.keyDown(cad, { key: "ArrowDown" });
    expect(document.activeElement).toBe(liv);
    fireEvent.keyDown(liv, { key: "ArrowDown" });
    expect(document.activeElement).toBe(cad);
    fireEvent.keyDown(cad, { key: "ArrowUp" });
    expect(document.activeElement).toBe(liv);
    fireEvent.keyDown(liv, { key: "Home" });
    expect(document.activeElement).toBe(cad);
    fireEvent.keyDown(cad, { key: "End" });
    expect(document.activeElement).toBe(liv);
  });

  it("submenu do caderno comum: Renomear, Modo escritor e Excluir", () => {
    const props = setup();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Ações de Caderno de sonhos" }));
    const pop = screen.getByRole("menu", { name: "Ações de Caderno de sonhos" });
    expect(within(pop).getByRole("menuitem", { name: "Renomear" })).toBeInTheDocument();
    expect(within(pop).getByRole("menuitem", { name: "Modo escritor" })).toBeInTheDocument();
    expect(within(pop).getByRole("menuitem", { name: "Excluir" })).toBeInTheDocument();
    expect(within(pop).queryByRole("menuitem", { name: "Configurações" })).toBeNull();
    fireEvent.click(within(pop).getByRole("menuitem", { name: "Renomear" }));
    expect(props.onRename).toHaveBeenCalledWith(expect.objectContaining({ id: "sonhos" }));
    expect(screen.queryByRole("menu", { name: "Escolher caderno" })).toBeNull();
  });

  it("submenu do livro: Configurações e Excluir, sem Modo escritor", () => {
    const props = setup();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Ações de O silencio das tardes" }));
    const pop = screen.getByRole("menu", { name: "Ações de O silencio das tardes" });
    expect(within(pop).getByRole("menuitem", { name: "Configurações" })).toBeInTheDocument();
    expect(within(pop).getByRole("menuitem", { name: "Excluir" })).toBeInTheDocument();
    expect(within(pop).queryByRole("menuitem", { name: "Modo escritor" })).toBeNull();
    expect(within(pop).queryByRole("menuitem", { name: "Renomear" })).toBeNull();
    fireEvent.click(within(pop).getByRole("menuitem", { name: "Excluir" }));
    expect(props.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "livro1" }));
  });

  it("padrao e MCP mantem o slot do '…' reservado mas inerte", () => {
    const mcp = notebook({ id: "mcp", name: "Projetos", kind: "mcp", entry_count: 3 });
    const { container } = render(<NotebookSwitcher
      notebooks={[inbox, mcp, sonhos]}
      activeId={sonhos.id}
      onSelect={() => {}}
      onCreate={() => {}}
      onCreateBook={() => {}}
      onRename={() => {}}
      onBookSettings={() => {}}
      onDelete={() => {}}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Escolher caderno" }));
    const inboxRow = screen.getByRole("menuitemradio", { name: /Notas ao acaso/ });
    expect(inboxRow.querySelector(".notebook-menu-more")).not.toBeNull();
    expect(within(inboxRow).queryByRole("button")).toBeNull();
    const mcpRow = screen.getByRole("menuitemradio", { name: /Projetos/ });
    expect(within(mcpRow).queryByRole("button")).toBeNull();
    expect(container).toBeTruthy();
  });

  it("ArrowDown no gatilho abre e foca a linha ativa", () => {
    setup();
    trigger().focus();
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    const row = screen.getByRole("menuitemradio", { name: /Notas ao acaso/ });
    expect(document.activeElement).toBe(row);
    expect(row).toHaveAttribute("aria-checked", "true");
  });

  it("setas envolvem; Home e End saltam às pontas", () => {
    setup();
    open();
    const primeiro = screen.getByRole("menuitemradio", { name: /Todas as notas/ });
    const ultimo = novo();
    primeiro.focus();
    fireEvent.keyDown(primeiro, { key: "ArrowUp" });
    expect(document.activeElement).toBe(ultimo);
    // ArrowDown no "Novo" abre o submenu em vez de voltar ao topo
    fireEvent.keyDown(ultimo, { key: "ArrowDown" });
    expect(document.activeElement).toBe(opcaoCaderno());
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.keyDown(ultimo, { key: "Home" });
    expect(document.activeElement).toBe(primeiro);
    fireEvent.keyDown(primeiro, { key: "End" });
    expect(document.activeElement).toBe(ultimo);
  });

  it("Enter na linha seleciona e fecha", () => {
    const props = setup();
    open();
    const row = screen.getByRole("menuitemradio", { name: /Caderno de sonhos/ });
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(props.onSelect).toHaveBeenCalledWith("sonhos");
    expect(screen.queryByRole("menu", { name: "Escolher caderno" })).toBeNull();
  });

  it("selecionar a linha ja ativa fecha sem efeito colateral", () => {
    const props = setup();
    open();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Notas ao acaso/ }));
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu", { name: "Escolher caderno" })).toBeNull();
  });

  it("Escape fecha e devolve o foco ao gatilho; Tab fecha", () => {
    setup();
    open();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Escolher caderno" })).toBeNull();
    expect(document.activeElement).toBe(trigger());

    open();
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(screen.queryByRole("menu", { name: "Escolher caderno" })).toBeNull();
  });

  it("Escape no submenu devolve o foco ao '…'", () => {
    setup();
    open();
    const mais = screen.getByRole("button", { name: "Ações de Caderno de sonhos" });
    fireEvent.click(mais);
    expect(screen.getByRole("menu", { name: "Ações de Caderno de sonhos" })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Ações de Caderno de sonhos" })).toBeNull();
    expect(screen.getByRole("menu", { name: "Escolher caderno" })).toBeInTheDocument();
    expect(document.activeElement).toBe(mais);
  });

  it("pointerdown fora fecha o menu", () => {
    setup();
    open();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu", { name: "Escolher caderno" })).toBeNull();
  });

  it("ArrowRight na linha abre o submenu com o foco no primeiro item", () => {
    setup();
    open();
    const row = screen.getByRole("menuitemradio", { name: /Caderno de sonhos/ });
    row.focus();
    fireEvent.keyDown(row, { key: "ArrowRight" });
    const pop = screen.getByRole("menu", { name: "Ações de Caderno de sonhos" });
    expect(document.activeElement).toBe(within(pop).getByRole("menuitem", { name: "Renomear" }));
  });

  it("Shift+F10 e ContextMenu abrem as acoes da linha", () => {
    setup();
    open();
    const row = screen.getByRole("menuitemradio", { name: /Caderno de sonhos/ });
    row.focus();
    fireEvent.keyDown(row, { key: "F10", shiftKey: true });
    expect(screen.getByRole("menu", { name: "Ações de Caderno de sonhos" })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    row.focus();
    fireEvent.keyDown(row, { key: "ContextMenu" });
    expect(screen.getByRole("menu", { name: "Ações de Caderno de sonhos" })).toBeInTheDocument();
  });

  it("linha sem acoes nao abre submenu pelo teclado", () => {
    setup();
    open();
    const row = screen.getByRole("menuitemradio", { name: /Notas ao acaso/ });
    row.focus();
    fireEvent.keyDown(row, { key: "ArrowRight" });
    fireEvent.keyDown(row, { key: "F10", shiftKey: true });
    expect(screen.queryByRole("menu", { name: /Ações/ })).toBeNull();
    expect(screen.getByRole("menu", { name: "Escolher caderno" })).toBeInTheDocument();
  });

  it("no submenu as setas navegam com wrap", () => {
    setup();
    open();
    const row = screen.getByRole("menuitemradio", { name: /Caderno de sonhos/ });
    row.focus();
    fireEvent.keyDown(row, { key: "ArrowRight" });
    const pop = screen.getByRole("menu", { name: "Ações de Caderno de sonhos" });
    const renomear = within(pop).getByRole("menuitem", { name: "Renomear" });
    const escritor = within(pop).getByRole("menuitem", { name: "Modo escritor" });
    const excluir = within(pop).getByRole("menuitem", { name: "Excluir" });
    fireEvent.keyDown(renomear, { key: "ArrowDown" });
    expect(document.activeElement).toBe(escritor);
    fireEvent.keyDown(escritor, { key: "ArrowDown" });
    expect(document.activeElement).toBe(excluir);
    fireEvent.keyDown(excluir, { key: "ArrowDown" });
    expect(document.activeElement).toBe(renomear);
    fireEvent.keyDown(renomear, { key: "ArrowUp" });
    expect(document.activeElement).toBe(excluir);
    // o Escape continua devolvendo o foco ao "…"
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Ações de Caderno de sonhos" })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Ações de Caderno de sonhos" }),
    );
  });

  it("abrir com o caderno ativo em Todas foca a linha marcada", () => {
    setup([inbox, sonhos, livro], ALL_NOTEBOOKS);
    open();
    expect(screen.getByRole("menuitemradio", { name: /Todas as notas/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(document.activeElement).toBe(
      screen.getByRole("menuitemradio", { name: /Todas as notas/ }),
    );
  });
});
