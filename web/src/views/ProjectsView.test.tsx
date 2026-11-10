import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProjectsView } from "./ProjectsView";
import type { ProjectsViewProps } from "./ProjectsView";
import { buildIndex } from "../lib/useProjectsIndex";
import type { Entry, Note } from "../types";

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

function indexFrom(rows: Array<{ entry: Entry; notes: Note[] }>) {
  return buildIndex(
    rows.map((row) => row.entry),
    rows.map((row) => row.notes),
  );
}

/** A vista nao busca mais nada: o App chama o hook e entrega o indice aqui. */
function renderView(overrides: Partial<ProjectsViewProps> = {}) {
  const onOpenEntry = vi.fn();
  const onChooseIcon = vi.fn();
  render(
    <ProjectsView
      index={indexFrom(dataRows())}
      loading={false}
      error=""
      selectedProject={null}
      icons={{}}
      onChooseIcon={onChooseIcon}
      onOpenEntry={onOpenEntry}
      {...overrides}
    />,
  );
  return { onOpenEntry, onChooseIcon };
}

beforeEach(() => {
  localStorage.clear();
});

describe("ProjectsView", () => {
  it("duas notas do caderno viram tabela com os itens e a contagem do rodape", async () => {
    const { onOpenEntry } = renderView();

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
    renderView({ index: indexFrom(rows) });

    const table = await screen.findByRole("table");
    const body = table.querySelector("tbody") as HTMLTableSectionElement;
    const first = body.querySelector("tr");
    expect(first?.textContent).toContain("terminal do mapa em tres camadas");
  });

  it("a barra de Itens nao tem chip de projeto: quem escolhe e a lista da sidebar", async () => {
    renderView();
    await screen.findByRole("table");

    expect(screen.queryByRole("button", { name: "caixa" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "dyarium" })).not.toBeInTheDocument();
    // Os chips de kind continuam na barra.
    expect(screen.getByRole("button", { name: "fix" })).toBeInTheDocument();
  });

  it("filtrar por kind reduz as linhas", async () => {
    renderView();

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "fix" }));

    const table = screen.getByRole("table");
    expect(within(table).getByText("saldo calculado duas vezes ao importar csv")).toBeInTheDocument();
    expect(within(table).queryByText("terminal do mapa em tres camadas")).not.toBeInTheDocument();
    expect(screen.getByText("1 item · 1 projeto")).toBeInTheDocument();
  });

  it("o funil esconde e mostra os chips de kind", async () => {
    renderView();
    await screen.findByRole("table");

    expect(screen.getByRole("button", { name: "fix" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Mostrar filtros/i }));
    expect(screen.queryByRole("button", { name: "fix" })).toBeNull();
    expect(screen.queryByRole("button", { name: "feat" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Mostrar filtros/i }));
    expect(screen.getByRole("button", { name: "fix" })).toBeTruthy();
  });

  it("projeto escolhido na lista escopa a tabela e esconde a coluna Projeto", async () => {
    renderView({ selectedProject: "caixa" });

    const table = await screen.findByRole("table");
    expect(within(table).getByText("saldo calculado duas vezes ao importar csv")).toBeInTheDocument();
    expect(within(table).queryByText("terminal do mapa em tres camadas")).not.toBeInTheDocument();
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).not.toContain("Projeto");
    expect(screen.getByText("1 item · 1 projeto")).toBeInTheDocument();
  });

  it("projeto escolhido expande so ele na aba Projetos", async () => {
    renderView({ selectedProject: "dyarium" });

    fireEvent.click(screen.getByRole("tab", { name: /Projetos/ }));

    const rows = (screen.getAllByRole("button", { name: /dyarium/ }) as HTMLElement[]).filter(
      (button) => button.hasAttribute("aria-expanded"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("aria-expanded", "true");
    // O resumo do projeto escolhido ja esta aberto, sem novo clique; o outro
    // projeto sumiu da aba.
    expect(screen.getByText(/vps-dev/)).toBeInTheDocument();
    expect(screen.queryByText("caixa")).not.toBeInTheDocument();
  });

  it("alternar Tabela/Cartoes muda a variante", async () => {
    renderView();

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
    renderView();

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
    renderView({
      index: indexFrom([
        { entry: entry("entry-vazio", "projeto solto"), notes: [note("n-3", "entry-vazio", "")] },
      ]),
    });

    await waitFor(() =>
      expect(screen.getByText("Sem sessões registradas.")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("padrao abre em grade, largura cheia, densidade confortavel, 5 colunas opcionais", async () => {
    renderView();

    const table = await screen.findByRole("table");
    const container = table.closest(".pj-vtable") as HTMLElement;
    expect(container).toHaveClass("ap-grade");
    expect(container).toHaveAttribute("data-width", "full");
    expect(container).toHaveAttribute("data-density", "comfortable");
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Projeto", "Item", "Kind", "Data", "Commit", "Sessão"]);
  });

  it("alternar densidade muda o atributo de densidade do container", async () => {
    renderView();

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
    renderView();

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
    renderView();

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
    const index = indexFrom(dataRows());
    const { unmount } = render(
      <ProjectsView
        index={index}
        loading={false}
        error=""
        selectedProject={null}
        icons={{}}
        onChooseIcon={vi.fn()}
        onOpenEntry={vi.fn()}
      />,
    );
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /Personalizar/i }));
    fireEvent.click(screen.getByRole("button", { name: /Compacta/i }));
    unmount();

    render(
      <ProjectsView
        index={index}
        loading={false}
        error=""
        selectedProject={null}
        icons={{}}
        onChooseIcon={vi.fn()}
        onOpenEntry={vi.fn()}
      />,
    );

    const table = await screen.findByRole("table");
    const container = table.closest(".pj-vtable") as HTMLElement;
    expect(container).toHaveAttribute("data-density", "compact");
  });

  it("JSON invalido cai no padrao sem quebrar", async () => {
    localStorage.setItem("dyarium.projetos.tabela", "{{{");
    renderView();

    const table = await screen.findByRole("table");
    const container = table.closest(".pj-vtable") as HTMLElement;
    expect(container).toHaveClass("ap-grade");
    expect(container).toHaveAttribute("data-density", "comfortable");
    expect(container).toHaveAttribute("data-width", "full");
  });

  it("Grade e zebra aplicam a classe certa no container", async () => {
    renderView();

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

  it("a lupa filtra os itens pelo texto digitado", async () => {
    renderView();
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: /Buscar itens/i }));
    const field = screen.getByRole("textbox", { name: /Buscar itens/i });
    fireEvent.change(field, { target: { value: "csv" } });

    expect(screen.getByRole("tab", { name: /Itens/i }).textContent).toContain("1");
    expect(screen.getAllByText(/saldo calculado duas vezes/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/terminal do mapa em tres camadas/)).toHaveLength(0);
  });
});
