import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ActivityLine, DayColumns, FolderPane, SessionPane } from "./ProjectNote";
import { buildIndex, findFolder, findSessionNode } from "../lib/useProjectsIndex";
import type { Entry, Note } from "../types";

const NOW = Date.parse("2026-11-16T12:00:00Z");

const entry = (id: string, title: string) => ({ id, title }) as unknown as Entry;

function v2Note(
  id: string,
  entryId: string,
  spec: {
    machine: string;
    path: string;
    session: string;
    state: "open" | "closed";
    date: string;
    time: string;
    closed?: string;
    summary?: string;
    items: Array<{ kind: string; title: string; commit?: string }>;
    updatedAt: string;
    title: string;
  },
): Note {
  const fence = JSON.stringify({
    v: 2,
    kind: "session",
    machine: spec.machine,
    path: spec.path,
    session: spec.session,
    state: spec.state,
    opened: `${spec.date}T${spec.time}:00Z`,
    ...(spec.closed ? { closed: spec.closed } : {}),
    date: spec.date,
    time: spec.time,
    ...(spec.summary ? { summary: spec.summary } : {}),
    items: spec.items.map((item) => ({ kind: item.kind, title: item.title, commit: item.commit })),
    commits: spec.items
      .filter((item) => item.commit)
      .map((item) => ({ hash: item.commit })),
  });
  const lines = [
    `## ${spec.date} ${spec.time} · ${spec.machine}`,
    spec.summary ?? "",
    ...spec.items.map(
      (item) => `- **${item.kind}** ${item.title}${item.commit ? ` · ${item.commit}` : ""}`,
    ),
    "```dyarium-json",
    fence,
    "```",
  ];
  return {
    id,
    entry_id: entryId,
    title: spec.title,
    content_markdown: lines.join("\n"),
    updated_at: spec.updatedAt,
  } as unknown as Note;
}

function fixture() {
  const entries = [entry("e-a", "syncwin")];
  const noteLists = [
    [
      v2Note("n1", "e-a", {
        machine: "work-notebook",
        path: "/home/joseti/projects/syncwin",
        session: "ses_a",
        state: "closed",
        date: "2026-11-12",
        time: "14:02",
        closed: "2026-11-13T10:15:00Z",
        summary: "Trocar o painel web por um html estatico escrito pelo roteador.",
        items: [
          { kind: "feat", title: "coletor pega uptime e carga", commit: "a1f3c9e" },
          { kind: "fix", title: "fuso errado nos rotulos", commit: "3c8b77f" },
          { kind: "feat", title: "reescreve o html a cada 5 minutos", commit: "d94f1a2" },
        ],
        updatedAt: "2026-11-13T10:15:00Z",
        title: "painel estatico no roteador",
      }),
      v2Note("n2", "e-a", {
        machine: "work-notebook",
        path: "/home/joseti/projects/syncwin",
        session: "ses_b",
        state: "open",
        date: "2026-11-16",
        time: "09:00",
        items: [],
        updatedAt: "2026-11-16T11:59:00Z",
        title: "migra o backup para o s3",
      }),
    ],
  ];
  return buildIndex(entries, noteLists, NOW);
}

describe("SessionPane: leitura da nota de sessao", () => {
  it("caminho em mono como titulo, nome como subtitulo, meta e resumo", () => {
    const index = fixture();
    const node = findSessionNode(index.tree, "work-notebook|/home/joseti/projects/syncwin|ses_a");
    expect(node).not.toBeNull();
    render(<SessionPane sessionNode={node!} onEdit={vi.fn()} />);

    const title = screen.getByRole("heading", { level: 1 });
    expect(title).toHaveTextContent("/home/joseti/projects/syncwin");
    expect(title.className).toContain("dy-display");
    expect(screen.getByText("painel estatico no roteador")).toBeInTheDocument();

    const meta = document.querySelector(".pjx-nmeta");
    expect(meta?.textContent).toContain("work-notebook");
    expect(meta?.textContent).toContain("14:02");
    expect(meta?.textContent).toContain("10:15");
    expect(meta?.textContent).toContain("3 itens");
    expect(meta?.textContent).toContain("3 commits");

    expect(
      screen.getByText("Trocar o painel web por um html estatico escrito pelo roteador."),
    ).toBeInTheDocument();
  });

  it("tabela de itens com kind mono neutro, titulo e commit curto; fence oculto", () => {
    const index = fixture();
    const node = findSessionNode(index.tree, "work-notebook|/home/joseti/projects/syncwin|ses_a");
    render(<SessionPane sessionNode={node!} onEdit={vi.fn()} />);

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText("coletor pega uptime e carga")).toBeInTheDocument();
    expect(within(table).getByText("a1f3c9e")).toBeInTheDocument();
    // kind e rotulo mono, nunca cor de kind.
    const kindCell = within(table).getAllByText("feat")[0].closest("td");
    expect(kindCell?.className).toContain("dy-mono");

    const text = document.body.textContent ?? "";
    expect(text).not.toContain("dyarium-json");
    expect(text).not.toContain('"v":2');
  });

  it("grafico de colunas no fim, com o valor no hover", () => {
    const index = fixture();
    const node = findSessionNode(index.tree, "work-notebook|/home/joseti/projects/syncwin|ses_a");
    const { container } = render(<SessionPane sessionNode={node!} onEdit={vi.fn()} />);

    const chart = container.querySelector('svg[aria-label="itens por dia"]') as Element;
    expect(chart).not.toBeNull();
    // Os itens da sessao v2 sao do dia da sessao: um slot preenchido.
    expect(container.querySelectorAll("rect.pjx-col:not(.pjx-col--empty)")).toHaveLength(1);
    expect(container.querySelector("rect.pjx-col")).not.toHaveClass("pjx-col--hollow");
    expect(chart.querySelector("title")?.textContent).toMatch(/12 nov · 3 itens/);
    // Sem eixo y numerico.
    expect(chart.querySelector("text")?.textContent).toContain("12 nov");
  });

  it("sessao aberta fecha a coluna do dia atual em contorno e o ultimo tempo e 'em curso'", () => {
    const index = fixture();
    const node = findSessionNode(index.tree, "work-notebook|/home/joseti/projects/syncwin|ses_b");
    expect(node?.session.state).toBe("open");
    const { container } = render(
      <DayColumns
        days={[
          { date: "2026-11-15", items: 2 },
          { date: "2026-11-16", items: 1 },
        ]}
        open
      />,
    );
    const columns = container.querySelectorAll("rect.pjx-col:not(.pjx-col--empty)");
    expect(columns).toHaveLength(2);
    expect(columns[1]).toHaveClass("pjx-col--hollow");
  });

  it("sessao aberta sem itens ainda: uma forma de slot, nao uma frase", () => {
    const index = fixture();
    const node = findSessionNode(index.tree, "work-notebook|/home/joseti/projects/syncwin|ses_b");
    const { container } = render(<SessionPane sessionNode={node!} onEdit={vi.fn()} />);

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const shape = container.querySelector(".pjx-slotshape");
    expect(shape).not.toBeNull();
    expect(shape?.querySelectorAll("span")).toHaveLength(3);
    // A faixa de tempo ainda diz "em curso".
    expect(document.querySelector(".pjx-nmeta")?.textContent).toContain("em curso");
  });

  it("Editar devolve a entry da nota ao App", () => {
    const index = fixture();
    const node = findSessionNode(index.tree, "work-notebook|/home/joseti/projects/syncwin|ses_a");
    const onEdit = vi.fn();
    render(<SessionPane sessionNode={node!} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: /Editar/ }));
    expect(onEdit).toHaveBeenCalledWith("e-a");
  });
});

describe("FolderPane: leitura agregada da pasta", () => {
  it("numeros de sessoes, itens e commits, composicao e lista ordenada", () => {
    const index = fixture();
    const folder = findFolder(index.tree, "work-notebook", "/home/joseti/projects/syncwin");
    expect(folder).not.toBeNull();
    const onOpenSession = vi.fn();
    const { container } = render(<FolderPane folder={folder!} onOpenSession={onOpenSession} />);

    expect(container.querySelector(".pjx-stats")?.textContent).toContain("2");
    expect(container.querySelector(".pjx-stats")?.textContent).toContain("3");

    // Legenda de composicao: numero na frente, kind como esta, hairline no
    // meio. Sem plural: legenda nao e prosa.
    const legend = container.querySelector(".pjx-flegend")?.textContent ?? "";
    expect(legend).toContain("2 feat");
    expect(legend).toContain("·");
    expect(legend).not.toMatch(/feats|fixs|tests/);

    // Lista ordenada (mais nova primeiro) ligando de volta para cada sessao.
    const rows = screen.getAllByRole("button", { name: /migra o backup|painel estatico/ });
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("migra o backup"),
      expect.stringContaining("painel estatico"),
    ]);
    fireEvent.click(rows[1]);
    expect(onOpenSession).toHaveBeenCalledWith(
      "work-notebook|/home/joseti/projects/syncwin|ses_a",
    );
  });

  it("linha de atividade cobre o intervalo real com buraco de dias sem item", () => {
    const { container } = render(
      <ActivityLine
        days={[
          { date: "2026-11-12", items: 2 },
          { date: "2026-11-13", items: 1 },
          { date: "2026-11-14", items: 0 },
          { date: "2026-11-15", items: 0 },
          { date: "2026-11-16", items: 3 },
        ]}
      />,
    );
    const points = container.querySelectorAll("circle.pjx-pt");
    expect(points).toHaveLength(3);
    expect(container.querySelector("polyline")).not.toBeNull();
    const titles = Array.from(container.querySelectorAll("title")).map((t) => t.textContent);
    expect(titles).toContain("16 nov · 3 itens");
  });

  it("pasta com sessoes mas nenhum item: forma de slot, nunca frase", () => {
    const entries = [entry("e-b", "vazio")];
    const index = buildIndex(
      entries,
      [
        [
          v2Note("n1", "e-b", {
            machine: "work",
            path: "/srv/so",
            session: "s1",
            state: "open",
            date: "2026-11-16",
            time: "10:00",
            items: [],
            updatedAt: "2026-11-16T10:00:00Z",
            title: "sem nada ainda",
          }),
          v2Note("n2", "e-b", {
            machine: "work",
            path: "/srv/so",
            session: "s2",
            state: "closed",
            date: "2026-11-15",
            time: "10:00",
            items: [],
            updatedAt: "2026-11-15T10:00:00Z",
            title: "nem abriu direito",
          }),
        ],
      ],
      NOW,
    );
    const folder = findFolder(index.tree, "work", "/srv/so");
    const { container } = render(<FolderPane folder={folder!} onOpenSession={vi.fn()} />);
    expect(container.querySelector(".pjx-slotshape")).not.toBeNull();
    expect(container.querySelector(".pjx-stats")?.textContent).toContain("0");
    expect(screen.getAllByRole("button", { name: /sem nada ainda|nem abriu/ })).toHaveLength(2);
  });
});
