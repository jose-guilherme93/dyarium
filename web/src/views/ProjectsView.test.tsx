import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProjectsView } from "./ProjectsView";
import type { ProjectsViewProps } from "./ProjectsView";
import { buildIndex } from "../lib/useProjectsIndex";
import type { ProjectsNode } from "../lib/useProjectsIndex";
import type { Entry, Note } from "../types";

const NOW = Date.parse("2026-11-16T12:00:00Z");

const entry = (id: string, title: string, icon?: string) =>
  ({ id, title, icon }) as unknown as Entry;

const note = (id: string, entryId: string, body: string, updatedAt: string) =>
  ({
    id,
    entry_id: entryId,
    title: "Resumo",
    content_markdown: body,
    updated_at: updatedAt,
  }) as unknown as Note;

/** Itens classicos: blocos humanos/v1, a mesa da aba Itens. */
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
        "2026-11-07T15:00:00Z",
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
        "2026-11-05T09:00:00Z",
      ),
    ],
  },
];

function v2Note(id: string, entryId: string, spec: {
  machine: string;
  path: string;
  session: string;
  date: string;
  time: string;
  items: Array<{ kind: string; title: string; commit?: string }>;
  updatedAt: string;
  title: string;
}): Note {
  const fence = JSON.stringify({
    v: 2,
    kind: "session",
    machine: spec.machine,
    path: spec.path,
    session: spec.session,
    state: "closed",
    opened: `${spec.date}T${spec.time}:00Z`,
    closed: `${spec.date}T17:00:00Z`,
    date: spec.date,
    time: spec.time,
    summary: `resumo ${spec.session}`,
    items: spec.items,
    commits: spec.items
      .filter((item) => item.commit)
      .map((item) => ({ hash: item.commit })),
  });
  return {
    id,
    entry_id: entryId,
    title: spec.title,
    content_markdown: [
      `## ${spec.date} ${spec.time} · ${spec.machine}`,
      ...spec.items.map(
        (item) => `- **${item.kind}** ${item.title}${item.commit ? ` · ${item.commit}` : ""}`,
      ),
      "```dyarium-json",
      fence,
      "```",
    ].join("\n"),
    updated_at: spec.updatedAt,
  } as unknown as Note;
}

/** Sessoes v2 sobre a mesma mesa: pasta com 2 sessoes + caminho unico. */
const v2Rows = () => [
  {
    entry: entry("entry-s", "syncwin"),
    notes: [
      v2Note("vs-1", "entry-s", {
        machine: "work",
        path: "/home/joseti/projects/syncwin",
        session: "ses_1",
        date: "2026-11-14",
        time: "09:12",
        items: [
          { kind: "feat", title: "coletor de metricas", commit: "aaa1111" },
          { kind: "fix", title: "fuso dos rotulos", commit: "bbb2222" },
        ],
        updatedAt: "2026-11-14T17:00:00Z",
        title: "nota 1",
      }),
      v2Note("vs-2", "entry-s", {
        machine: "work",
        path: "/home/joseti/projects/syncwin",
        session: "ses_2",
        date: "2026-11-16",
        time: "10:00",
        items: [{ kind: "test", title: "casos do coletor" }],
        updatedAt: "2026-11-16T11:00:00Z",
        title: "nota 2",
      }),
      v2Note("vs-3", "entry-s", {
        machine: "work",
        path: "/home/joseti/projects/api",
        session: "ses_3",
        date: "2026-11-15",
        time: "11:20",
        items: [{ kind: "feat", title: "valida payload", commit: "ccc3333" }],
        updatedAt: "2026-11-15T12:00:00Z",
        title: "nota 3",
      }),
    ],
  },
];

function indexFrom(rows: Array<{ entry: Entry; notes: Note[] }>, now?: number) {
  return buildIndex(
    rows.map((row) => row.entry),
    rows.map((row) => row.notes),
    now,
  );
}

function renderView(
  overrides: Partial<ProjectsViewProps> = {},
  rows: Array<{ entry: Entry; notes: Note[] }> = dataRows(),
) {
  const onOpenEntry = vi.fn();
  const onSelectNode = vi.fn();
  const node: ProjectsNode = overrides.node ?? { kind: "all" };
  const result = render(
    <ProjectsView
      index={indexFrom(rows, NOW)}
      loading={false}
      error=""
      node={node}
      onSelectNode={onSelectNode}
      onOpenEntry={onOpenEntry}
      {...overrides}
    />,
  );
  return { onOpenEntry, onSelectNode, unmount: result.unmount };
}

beforeEach(() => {
  localStorage.clear();
});

describe("ProjectsView: Itens sobre o indice", () => {
  it("duas notas do caderno viram tabela com os itens e a contagem do rodape", async () => {
    const { onOpenEntry } = renderView();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("terminal do mapa em tres camadas")).toBeInTheDocument();
    expect(within(table).getByText("saldo calculado duas vezes ao importar csv")).toBeInTheDocument();
    expect(screen.getByText("3 itens · 2 projetos")).toBeInTheDocument();

    // Clique na linha abre a nota da entry correspondente.
    fireEvent.click(within(table).getByText("saldo calculado duas vezes ao importar csv"));
    await waitFor(() => expect(onOpenEntry).toHaveBeenCalledWith("entry-b"));
  });

  it("a ordenacao e do mais novo para o mais antigo", async () => {
    renderView();
    const table = await screen.findByRole("table");
    const body = table.querySelector("tbody") as HTMLTableSectionElement;
    expect(body.querySelector("tr")?.textContent).toContain("terminal do mapa em tres camadas");
  });

  it("filtrar por kind reduz as linhas; o funil esconde os chips", async () => {
    renderView();
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "fix" }));
    const table = screen.getByRole("table");
    expect(within(table).getByText("saldo calculado duas vezes ao importar csv")).toBeInTheDocument();
    expect(within(table).queryByText("terminal do mapa em tres camadas")).not.toBeInTheDocument();
    expect(screen.getByText("1 item · 1 projeto")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Mostrar filtros/i }));
    expect(screen.queryByRole("button", { name: "fix" })).toBeNull();
  });

  it("no de projeto v1 escopa a tabela e esconde a coluna Projeto", async () => {
    renderView({ node: { kind: "project", entryId: "entry-b" } }, dataRows());

    const table = await screen.findByRole("table");
    expect(within(table).getByText("saldo calculado duas vezes ao importar csv")).toBeInTheDocument();
    expect(within(table).queryByText("terminal do mapa em tres camadas")).not.toBeInTheDocument();
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).not.toContain("Projeto");
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

  it("alternar Tabela/Cartoes muda a variante", async () => {
    renderView();
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "Cartões" }));
    expect(screen.getByRole("button", { name: "Cartões" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Tabela" }));
    expect(screen.getByRole("button", { name: "Tabela" })).toHaveAttribute("aria-pressed", "true");
  });

  it("padrao abre em grade, largura cheia, densidade confortavel, 5 colunas opcionais", async () => {
    renderView();
    const table = await screen.findByRole("table");
    const container = table.closest(".pjx-vtable") as HTMLElement;
    expect(container).toHaveClass("grade");
    expect(container).toHaveAttribute("data-width", "full");
    expect(container).toHaveAttribute("data-density", "comfortable");
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Projeto", "Item", "Kind", "Data", "Commit", "Sessão"]);
  });

  it("as escolhas de tabela sobrevivem a um remount (localStorage)", async () => {
    const first = renderView();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /Personalizar/i }));
    fireEvent.click(screen.getByRole("button", { name: /Compacta/i }));
    let container = screen.getByRole("table").closest(".pjx-vtable") as HTMLElement;
    expect(container).toHaveAttribute("data-density", "compact");

    const saved = JSON.parse(localStorage.getItem("dyarium.projetos.tabela") || "{}");
    expect(saved.density).toBe("compact");

    first.unmount();
    // Reabre: o padrao volta a ser lido do storage.
    renderView();
    container = (await screen.findByRole("table")).closest(".pjx-vtable") as HTMLElement;
    expect(container).toHaveAttribute("data-density", "compact");
  });

  it("JSON invalido cai no padrao sem quebrar", async () => {
    localStorage.setItem("dyarium.projetos.tabela", "{{{");
    renderView();
    const container = (await screen.findByRole("table")).closest(".pjx-vtable") as HTMLElement;
    expect(container).toHaveClass("grade");
    expect(container).toHaveAttribute("data-density", "comfortable");
  });

  it("caderno sem nada: uma forma de slot, nao uma frase", async () => {
    renderView({ index: indexFrom([], NOW) });
    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("sem sessões");
    expect(status.querySelectorAll("span")).toHaveLength(4);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("so com projetos sem pasta: a mesa de Itens existe, sem estado vazio", async () => {
    renderView();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("saldo calculado duas vezes ao importar csv")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("kind na tabela e rotulo mono neutro, nunca badge colorido", async () => {
    renderView();
    const table = await screen.findByRole("table");
    const badge = within(table).getByText("fix").closest(".pjx-kb");
    expect(badge).not.toBeNull();
    expect(badge?.className).toContain("dy-mono");
    expect(badge?.className).not.toMatch(/feat|fix|perf|test|docs|chore/);
  });
});

describe("ProjectsView: painel de leitura do no", () => {
  it("no de sessao abre a nota: caminho, tabela e grafico no fim", async () => {
    renderView(
      { node: { kind: "session", id: "work|/home/joseti/projects/syncwin|ses_1" } },
      v2Rows(),
    );

    const pane = await screen.findByTestId("session-pane");
    expect(pane).toBeInTheDocument();
    expect(within(pane).getByRole("heading", { level: 1 })).toHaveTextContent(
      "/home/joseti/projects/syncwin",
    );
    expect(within(pane).getByText("coletor de metricas")).toBeInTheDocument();
    expect(pane.querySelector('svg[aria-label="itens por dia"]')).not.toBeNull();
    // O fence nao aparece.
    expect(pane.textContent).not.toContain("dyarium-json");

    // A aba Itens continua disponivel sobre o mesmo indice, escopada ao no.
    fireEvent.click(screen.getByRole("tab", { name: /Itens/i }));
    const table = await screen.findByRole("table");
    expect(within(table).getByText("coletor de metricas")).toBeInTheDocument();
    expect(within(table).queryByText("valida payload")).not.toBeInTheDocument();
  });

  it("no de pasta abre o agregado com a lista que devolve para a sessao", async () => {
    const { onSelectNode } = renderView(
      {
        node: { kind: "folder", machine: "work", path: "/home/joseti/projects/syncwin" },
      },
      v2Rows(),
    );

    const pane = await screen.findByTestId("folder-pane");
    // 3 sessoes? nao: a pasta tem 2; itens 3; commits 2.
    expect(pane.querySelector(".pjx-stats")?.textContent).toContain("2");
    expect(pane.querySelector('svg[aria-label="atividade por dia"]')).not.toBeNull();

    fireEvent.click(within(pane).getByRole("button", { name: /nota 1/ }));
    expect(onSelectNode).toHaveBeenCalledWith({
      kind: "session",
      id: "work|/home/joseti/projects/syncwin|ses_1",
    });
  });

  it("no de maquina nao tem painel: cai direto na tabela escopada", async () => {
    renderView({ node: { kind: "machine", machine: "work" } }, v2Rows());
    const table = await screen.findByRole("table");
    expect(screen.queryByRole("tab", { name: /Nota/ })).not.toBeInTheDocument();
    expect(within(table).getByText("coletor de metricas")).toBeInTheDocument();
    expect(within(table).getByText("valida payload")).toBeInTheDocument();
  });

  it("sessao v2 edita pela entry da nota", async () => {
    const { onOpenEntry } = renderView(
      { node: { kind: "session", id: "work|/home/joseti/projects/syncwin|ses_1" } },
      v2Rows(),
    );
    await screen.findByTestId("session-pane");
    fireEvent.click(screen.getByRole("button", { name: /Editar/ }));
    expect(onOpenEntry).toHaveBeenCalledWith("entry-s");
  });
});

describe("ProjectsView: coluna redimensionavel", () => {
  const colOf = (table: HTMLElement, key: string) =>
    table.querySelector(`col[data-col="${key}"]`) as HTMLTableColElement;

  const handleOf = (name: string) => screen.getByRole("separator", { name });

  it("arrastar a borda da coluna Kind muda a largura e grava no localStorage", async () => {
    renderView();
    const table = await screen.findByRole("table");
    const handle = handleOf("Redimensionar Kind");

    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 140, pointerId: 1 });
    expect(colOf(table, "kind").style.width).toBe("112px");

    fireEvent.pointerUp(handle, { clientX: 140, pointerId: 1 });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem("dyarium.projetos.tabela") || "{}");
      expect(saved.colWidths?.kind).toBe(112);
    });
  });

  it("a largura trava em 56px por baixo e em 640px por cima", async () => {
    renderView();
    const table = await screen.findByRole("table");
    const handle = handleOf("Redimensionar Kind");

    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 0, pointerId: 1 });
    expect(colOf(table, "kind").style.width).toBe("56px");
    fireEvent.pointerUp(handle, { clientX: 0, pointerId: 1 });

    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 1000, pointerId: 1 });
    expect(colOf(table, "kind").style.width).toBe("640px");
  });

  it("duplo clique devolve a coluna ao automatico", async () => {
    renderView();
    const table = await screen.findByRole("table");
    const handle = handleOf("Redimensionar Kind");

    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 160, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 160, pointerId: 1 });
    expect(colOf(table, "kind").style.width).toBe("132px");

    fireEvent.doubleClick(handle);
    expect(colOf(table, "kind").style.width).toBe("");
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem("dyarium.projetos.tabela") || "{}");
      expect(saved.colWidths?.kind).toBeUndefined();
    });
  });

  it("as setas no handle com foco mudam a largura em 8px", async () => {
    renderView();
    const table = await screen.findByRole("table");
    const handle = handleOf("Redimensionar Kind");
    handle.focus();

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(colOf(table, "kind").style.width).toBe("80px");

    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
    expect(colOf(table, "kind").style.width).toBe("112px");

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(colOf(table, "kind").style.width).toBe("104px");

    fireEvent.keyDown(handle, { key: "Home" });
    expect(colOf(table, "kind").style.width).toBe("");
  });

  it("largura salva em localStorage volta no remount; valor invalido e ignorado", async () => {
    localStorage.setItem(
      "dyarium.projetos.tabela",
      JSON.stringify({ colWidths: { kind: 200, data: -10, sess: "larga", commit: null } }),
    );
    renderView();

    const table = await screen.findByRole("table");
    expect(colOf(table, "kind").style.width).toBe("200px");
    expect(colOf(table, "data").style.width).toBe("");
    expect(colOf(table, "sess").style.width).toBe("");
    expect(colOf(table, "commit").style.width).toBe("");
  });

  it("toda coluna visivel tem handle, inclusive a Item e a ultima", async () => {
    renderView();
    const table = await screen.findByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers).toHaveLength(6);
    for (const header of headers) {
      expect(header.querySelector(".pjx-resize")).not.toBeNull();
    }
    expect(handleOf("Redimensionar Item")).toBeInTheDocument();
    expect(handleOf("Redimensionar Sessão")).toBeInTheDocument();
  });
});
