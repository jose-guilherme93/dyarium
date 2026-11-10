import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProjectsView } from "./ProjectsView";
import type { Entry, Note } from "../types";

vi.mock("../api", () => ({
  api: {
    listEntries: vi.fn(),
    listNotes: vi.fn(),
    updateEntry: vi.fn(),
  },
}));

import { api } from "../api";

const entry = (id: string, title: string, icon?: string) =>
  ({ id, title, icon }) as unknown as Entry;

const note = (id: string, entryId: string, body: string) =>
  ({ id, entry_id: entryId, title: "Resumo", content_markdown: body }) as unknown as Note;

const dataRows = () => [
  {
    entry: entry("entry-a", "dyarium", "✒️"),
    notes: [
      note(
        "n-1",
        "entry-a",
        [
          "## 2026-11-07 14:58 · vps-dev",
          "- **feat** terminal do mapa em tres camadas · a1b2c3d",
          "- **test** fisica do mapa com arrasto · c3d4e5f",
          ":::details",
          "Commits:",
          "- a1b2c3d terminal do mapa em tres camadas",
          ":::",
        ].join("\n"),
      ),
    ],
  },
  {
    entry: entry("entry-b", "caixa"),
    notes: [
      note(
        "n-2",
        "entry-b",
        [
          "## 2026-11-05 09:00 · notebook",
          "- **fix** saldo calculado duas vezes ao importar csv · 4d5e6f7",
        ].join("\n"),
      ),
    ],
  },
];

const setup = (rows: Array<{ entry: Entry; notes: Note[] }>) => {
  vi.mocked(api.listEntries).mockResolvedValue({
    entries: rows.map((row) => row.entry),
  } as never);
  rows.forEach((row) => {
    vi.mocked(api.listNotes).mockResolvedValueOnce({
      notes: row.notes,
    } as never);
  });
  const onOpenEntry = vi.fn();
  render(<ProjectsView notebookId="nb-mcp" refreshKey={0} onOpenEntry={onOpenEntry} />);
  return { onOpenEntry };
};

beforeEach(() => {
  vi.mocked(api.listEntries).mockReset();
  vi.mocked(api.listNotes).mockReset();
  vi.mocked(api.updateEntry).mockReset();
  localStorage.clear();
});

describe("ProjectsView", () => {
  it("duas notas do caderno viram tabela com os itens e a contagem do rodape", async () => {
    const { onOpenEntry } = setup(dataRows());

    const table = await screen.findByRole("table");
    expect(within(table).getByText("terminal do mapa em tres camadas")).toBeInTheDocument();
    expect(within(table).getByText("fisica do mapa com arrasto")).toBeInTheDocument();
    expect(within(table).getByText("saldo calculado duas vezes ao importar csv")).toBeInTheDocument();
    expect(screen.getByText("3 itens · 2 projetos")).toBeInTheDocument();

    // Clique na linha abre a nota da entry correspondente.
    fireEvent.click(within(table).getByText("saldo calculado duas vezes ao importar csv"));
    await waitFor(() => expect(onOpenEntry).toHaveBeenCalledWith("entry-b"));
  });

  it("a ordenacao e do mais novo para o mais antigo, e item sem commit nao estoura a coluna", async () => {
    const rows = dataRows();
    rows[1].notes = [
      note(
        "n-2",
        "entry-b",
        [
          "## 2026-11-05 09:00 · notebook",
          "- **fix** item solto sem commit ·",
        ].join("\n"),
      ),
    ];
    setup(rows);

    const table = await screen.findByRole("table");
    const body = table.querySelector("tbody") as HTMLTableSectionElement;
    const first = body.querySelector("tr");
    expect(first?.textContent).toContain("terminal do mapa em tres camadas");
  });

  it("filtrar por kind reduz as linhas", async () => {
    setup(dataRows());

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "fix" }));

    const table = screen.getByRole("table");
    expect(within(table).getByText("saldo calculado duas vezes ao importar csv")).toBeInTheDocument();
    expect(within(table).queryByText("terminal do mapa em tres camadas")).not.toBeInTheDocument();
    expect(screen.getByText("1 item · 1 projeto")).toBeInTheDocument();
  });

  it("alternar Tabela/Cartoes muda a variante", async () => {
    setup(dataRows());

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Cartões" }));

    expect(screen.getByRole("button", { name: "Cartões" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const cards = screen.getByText("· 7 nov · vps-dev").closest("section")?.parentElement;
    expect(cards).not.toHaveAttribute("hidden");
    const table = screen.getByRole("table", { hidden: true }).closest("div");
    expect(table).toHaveAttribute("hidden");

    fireEvent.click(screen.getByRole("button", { name: "Tabela" }));
    expect(screen.getByRole("button", { name: "Tabela" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("expandir projeto mostra as sessoes e o bloco Detalhes tecnicos", async () => {
    setup(dataRows());

    fireEvent.click(await screen.findByRole("tab", { name: /Projetos/ }));

    // O row do projeto e o unico destes botoes com aria-expanded (o de dentro
    // e o seletor de emoji).
    const row = (screen.getAllByRole("button", { name: /dyarium/ }) as HTMLElement[]).find(
      (button) => button.hasAttribute("aria-expanded"),
    ) as HTMLElement;
    expect(row).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");

    const pane = screen.getByLabelText("Vistas de projetos").closest(".pj-root") as HTMLElement;
    await waitFor(() =>
      expect(within(pane).getByText(/vps-dev/)).toBeInTheDocument(),
    );
    // Sessao desenhada: data, host e numero de itens.
    expect(within(pane).getByText("2")).toBeInTheDocument();
    expect(within(pane).getByText("Detalhes técnicos")).toBeInTheDocument();
  });

  it("nota sem sessao nenhuma mostra estado vazio sem quebrar", async () => {
    setup([
      { entry: entry("entry-vazio", "projeto solto"), notes: [note("n-3", "entry-vazio", "")] },
    ]);

    await waitFor(() =>
      expect(screen.getByText("Sem sessões registradas.")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("padrao abre em grade, largura cheia, densidade confortavel, 5 colunas opcionais", async () => {
    setup(dataRows());

    const table = await screen.findByRole("table");
    const container = table.closest(".pj-vtable") as HTMLElement;
    expect(container).toHaveClass("ap-grade");
    expect(container).toHaveAttribute("data-width", "full");
    expect(container).toHaveAttribute("data-density", "comfortable");
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Projeto", "Item", "Kind", "Data", "Commit", "Sessão"]);
  });

  it("alternar densidade muda o atributo de densidade do container", async () => {
    setup(dataRows());

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /Personalizar/i }));

    fireEvent.click(screen.getByRole("button", { name: /Compacta/i }));
    let container = screen.getByRole("table").closest(".pj-vtable") as HTMLElement;
    expect(container).toHaveAttribute("data-density", "compact");

    fireEvent.click(screen.getByRole("button", { name: /Ampla/i }));
    container = screen.getByRole("table").closest(".pj-vtable") as HTMLElement;
    expect(container).toHaveAttribute("data-density", "wide");
  });

  it("desmarcar Commit remove a coluna do cabecalho e das linhas; minimo de 3 opcionais", async () => {
    setup(dataRows());

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /Personalizar/i }));

    const commitBox = screen.getByRole("checkbox", { name: /Commit/i });
    fireEvent.click(commitBox);

    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).not.toContain("Commit");

    // Tenta desmarcar ate sobrar menos de 3: deve parar em 3.
    const boxes = screen.getAllByRole("checkbox");
    for (const box of boxes) {
      if ((box as HTMLInputElement).checked) fireEvent.click(box);
    }
    const stillChecked = screen.getAllByRole("checkbox").filter(
      (box) => (box as HTMLInputElement).checked,
    ).length;
    expect(stillChecked).toBeGreaterThanOrEqual(3);
  });

  it("Restaurar volta ao padrao depois de mudar tudo", async () => {
    setup(dataRows());

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /Personalizar/i }));

    fireEvent.click(screen.getByRole("button", { name: /Contida/i }));
    fireEvent.click(screen.getByRole("button", { name: /Compacta/i }));
    fireEvent.click(screen.getByRole("button", { name: /Zebra/i }));
    const commitBox = screen.getByRole("checkbox", { name: /Commit/i });
    fireEvent.click(commitBox);

    fireEvent.click(screen.getByRole("button", { name: /Restaurar/i }));

    const container = screen.getByRole("table").closest(".pj-vtable") as HTMLElement;
    expect(container).toHaveClass("ap-grade");
    expect(container).toHaveAttribute("data-width", "full");
    expect(container).toHaveAttribute("data-density", "comfortable");
    const headers = within(screen.getByRole("table")).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toContain("Commit");
  });

  it("as escolhas sobrevivem a um remount (localStorage)", async () => {
    const rows = dataRows();
    vi.mocked(api.listEntries).mockResolvedValue({ entries: rows.map((r: any) => r.entry) } as never);
    rows.forEach((row: any) => vi.mocked(api.listNotes).mockResolvedValueOnce({ notes: row.notes } as never));

    const { unmount } = render(<ProjectsView notebookId="nb-mcp" refreshKey={0} onOpenEntry={vi.fn()} />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /Personalizar/i }));
    fireEvent.click(screen.getByRole("button", { name: /Compacta/i }));
    unmount();

    // remount
    vi.mocked(api.listEntries).mockResolvedValue({ entries: rows.map((r: any) => r.entry) } as never);
    rows.forEach((row: any) => vi.mocked(api.listNotes).mockResolvedValueOnce({ notes: row.notes } as never));
    render(<ProjectsView notebookId="nb-mcp" refreshKey={1} onOpenEntry={vi.fn()} />);

    const table = await screen.findByRole("table");
    const container = table.closest(".pj-vtable") as HTMLElement;
    expect(container).toHaveAttribute("data-density", "compact");
  });

  it("JSON invalido cai no padrao sem quebrar", async () => {
    localStorage.setItem("dyarium.projetos.tabela", "{{{");
    setup(dataRows());

    const table = await screen.findByRole("table");
    const container = table.closest(".pj-vtable") as HTMLElement;
    expect(container).toHaveClass("ap-grade");
    expect(container).toHaveAttribute("data-density", "comfortable");
    expect(container).toHaveAttribute("data-width", "full");
  });

  it("Grade e zebra aplicam a classe certa no container", async () => {
    setup(dataRows());

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /Personalizar/i }));

    fireEvent.click(screen.getByRole("button", { name: /Zebra/i }));
    let container = screen.getByRole("table").closest(".pj-vtable") as HTMLElement;
    expect(container).toHaveClass("ap-zebra");

    fireEvent.click(screen.getByRole("button", { name: /Linhas/i }));
    container = screen.getByRole("table").closest(".pj-vtable") as HTMLElement;
    expect(container).not.toHaveClass("ap-zebra");
    expect(container).toHaveClass("ap-lines");
  });
});

