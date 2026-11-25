import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ProjectList } from "./ProjectList";
import { buildIndex, type ProjectsIndex, type ProjectsNode } from "../lib/useProjectsIndex";
import type { Entry, Note } from "../types";

const NOW = Date.parse("2026-11-16T12:00:00Z");

const entry = (id: string, title: string) => ({ id, title }) as unknown as Entry;

const note = (id: string, entryId: string, body: string, updatedAt: string, title = "Resumo") =>
  ({ id, entry_id: entryId, title, content_markdown: body, updated_at: updatedAt }) as unknown as Note;

function v2Body(opts: {
  machine: string;
  path: string;
  session: string;
  state: "open" | "closed";
  date: string;
  time: string;
  items?: Array<{ kind: string; title: string }>;
}): string {
  const items = opts.items ?? [{ kind: "feat", title: `item ${opts.session}` }];
  const fence = JSON.stringify({
    v: 2,
    kind: "session",
    machine: opts.machine,
    path: opts.path,
    session: opts.session,
    state: opts.state,
    opened: `${opts.date}T${opts.time}:00Z`,
    date: opts.date,
    time: opts.time,
    items,
    commits: [],
  });
  return ["```dyarium-json", fence, "```"].join("\n");
}

function v2Note(
  id: string,
  entryId: string,
  opts: Parameters<typeof v2Body>[0] & { updatedAt: string },
): Note {
  return note(id, entryId, v2Body(opts), opts.updatedAt, `item ${opts.session}`);
}

/** Pasta com 2 sessoes + caminho unico + mesmo caminho em outra maquina. */
function fixture(): ProjectsIndex {
  const entries = [entry("e-a", "syncwin"), entry("e-b", "caixa")];
  const noteLists = [
    [
      v2Note("n1", "e-a", {
        machine: "work",
        path: "/home/proj/syncwin",
        session: "s1",
        state: "closed",
        date: "2026-11-14",
        time: "09:12",
        updatedAt: "2026-11-14T17:00:00Z",
      }),
      v2Note("n2", "e-a", {
        machine: "work",
        path: "/home/proj/syncwin",
        session: "s2",
        state: "open",
        date: "2026-11-16",
        time: "10:00",
        updatedAt: "2026-11-16T11:59:00Z",
      }),
      v2Note("n3", "e-a", {
        machine: "work",
        path: "/home/proj/api",
        session: "s3",
        state: "open",
        date: "2026-11-15",
        time: "11:20",
        updatedAt: "2026-11-15T20:00:00Z",
      }),
      v2Note("n4", "e-a", {
        machine: "hp",
        path: "/home/proj/syncwin",
        session: "s4",
        state: "closed",
        date: "2026-11-13",
        time: "08:00",
        updatedAt: "2026-11-13T09:00:00Z",
      }),
    ],
    [
      note(
        "n5",
        "e-b",
        ["## 2026-11-05 09:00 · notebook", "- **fix** saldo duplicado · 4d5e6f7"].join("\n"),
        "2026-11-05T09:00:00Z",
        "resumo caixa",
      ),
    ],
  ];
  return buildIndex(entries, noteLists, NOW);
}

function renderList(overrides: Partial<{ index: ProjectsIndex | null; node: ProjectsNode }> = {}) {
  const index = overrides.index ?? fixture();
  const node = overrides.node ?? ({ kind: "all" } as ProjectsNode);
  const onSelect = vi.fn();
  const result = render(
    <ProjectList
      index={index}
      node={node}
      onSelect={onSelect}
      icons={{}}
      loading={false}
      error=""
    />,
  );
  return { onSelect, index, container: result.container };
}

beforeEach(() => {
  localStorage.clear();
});

describe("ProjectList: arvore do caderno de projetos", () => {
  it("no de maquina com total, pasta so para 2+ sessoes, linha solta para caminho unico", () => {
    renderList();

    const tree = screen.getByRole("tree");
    expect(within(tree).getByRole("treeitem", { name: /work/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    // Pasta projects/syncwin: o rotulo sao os dois ultimos segmentos, o
    // caminho completo fica no title.
    const folder = within(tree).getByRole("treeitem", {
      name: /proj\/syncwin/,
      expanded: true,
    });
    expect(folder).toHaveAttribute("title", "/home/proj/syncwin");
    expect(folder).toHaveAttribute("aria-expanded", "true");

    // /home/proj/api tem 1 sessao: nao vira pasta; e linha solta.
    expect(
      within(tree).queryAllByRole("treeitem", { name: /proj\/api/, expanded: true }),
    ).toHaveLength(0);
    const flat = within(tree).getByRole("treeitem", { name: /item s3/ });
    expect(flat).toHaveAttribute("title", "/home/proj/api");
    // A linha solta mostra os dois ultimos segmentos na segunda linha; o
    // caminho inteiro fica no title e no rotulo acessivel.
    expect(within(flat).getByText("proj/api")).toBeInTheDocument();
    expect(flat).toHaveAttribute("aria-label", expect.stringContaining("/home/proj/api"));
    // O caminho da linha solta e a celula que encolhe; a hora so aparece
    // quando a linha e larga o bastante (CSS); a contagem nunca encolhe.
    expect(flat.querySelector(".pjx-path")).not.toBeNull();
    expect(flat.querySelector(".pjx-time")).not.toBeNull();
    const nested = within(tree).getByRole("treeitem", { name: /item s2/ });
    expect(nested.querySelector(".pjx-time")).toBeNull();
    expect(nested.querySelector(".pjx-path")).toBeNull();
    expect(within(nested).getByText("10:00")).toBeInTheDocument();
  });

  it("o mesmo caminho em duas maquinas sao dois nos", () => {
    renderList();
    const tree = screen.getByRole("tree");
    expect(within(tree).getByRole("treeitem", { name: /work/ })).toBeInTheDocument();
    expect(within(tree).getByRole("treeitem", { name: /hp/ })).toBeInTheDocument();
    const rows = within(tree)
      .getAllByRole("treeitem")
      .filter((row) => row.getAttribute("title") === "/home/proj/syncwin");
    // Uma pasta na maquina work e uma sessao solta na maquina hp.
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("linha de sessao traz nome, hora, contagem, medidor de composicao e marca de estado", () => {
    renderList();
    const s2 = screen.getByRole("treeitem", { name: /item s2/ });
    expect(within(s2).getByText("10:00")).toBeInTheDocument();
    // Separador hairline entre hora e contagem, nunca numeros colados.
    expect(s2.querySelectorAll(".pjx-l2 .pjx-segd")).toHaveLength(1);
    expect(within(s2).getByText(/1 item/)).toBeInTheDocument();
    expect(s2.querySelector(".pjx-mbar")).not.toBeNull();
    // Aberta (atividade recente): anel vazio.
    expect(within(s2).getByRole("img", { name: "aberta" })).toBeInTheDocument();

    const s1 = screen.getByRole("treeitem", { name: /item s1/ });
    expect(within(s1).getByRole("img", { name: "fechada" })).toBeInTheDocument();

    // s3 ficou 12h+ sem atividade: anel com traco.
    const s3 = screen.getByRole("treeitem", { name: /item s3/ });
    expect(within(s3).getByRole("img", { name: "interrompida" })).toBeInTheDocument();
  });

  it("guias sao elementos com borda, nunca caracteres de desenho de caixa", () => {
    const { container } = renderList();
    const cells = container.querySelectorAll(".pjx-tcell");
    expect(cells.length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/[├└│─╭╰]/);
  });

  it("ligam a subtree: nivel continua em T e o ultimo no fecha em L", () => {
    renderList();

    // s2 e s1 sao as duas sessoes da pasta syncwin, na ordem da atividade.
    const s2 = screen.getByRole("treeitem", { name: /item s2/ });
    const s1 = screen.getByRole("treeitem", { name: /item s1/ });

    const s2cells = s2.querySelectorAll(".pjx-tcell");
    expect(s2cells).toHaveLength(2);
    expect(s2cells[0]).toHaveClass("pjx-tcell--v");
    expect(s2cells[1]).toHaveClass("pjx-tcell--T");

    const s1cells = s1.querySelectorAll(".pjx-tcell");
    expect(s1cells[1]).toHaveClass("pjx-tcell--L");
  });

  it("escolher um no entrega o no certo; Todos e o padrao", () => {
    const { onSelect } = renderList();

    fireEvent.click(screen.getByRole("treeitem", { name: /item s2/ }));
    expect(onSelect).toHaveBeenLastCalledWith({
      kind: "session",
      id: "work|/home/proj/syncwin|s2",
    });

    fireEvent.click(
      screen.getByRole("treeitem", { name: /proj\/syncwin/, expanded: true }),
    );
    expect(onSelect).toHaveBeenLastCalledWith({
      kind: "folder",
      machine: "work",
      path: "/home/proj/syncwin",
    });

    fireEvent.click(screen.getByRole("treeitem", { name: /^Todos/ }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "all" });
  });

  it("o no escolhido chega marcado na arvore", () => {
    renderList({ node: { kind: "session", id: "work|/home/proj/syncwin|s2" } });
    expect(screen.getByRole("treeitem", { name: /item s2/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("recolher a maquina esconde os filhos", () => {
    renderList();
    const machine = screen.getByRole("treeitem", { name: /work/ });
    // Aberta: a seta aponta para baixo (gira 90 graus); fechada, para a direita.
    expect(machine.querySelector(".pjx-chev")).toHaveClass("pjx-chev--open");
    fireEvent.click(machine);
    expect(machine.querySelector(".pjx-chev")).not.toHaveClass("pjx-chev--open");
    expect(machine).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("treeitem", { name: /item s2/ })).not.toBeInTheDocument();
    fireEvent.click(machine);
    expect(screen.getByRole("treeitem", { name: /item s2/ })).toBeInTheDocument();
  });

  it("projeto v1 mora no grupo `sem pasta`, aberto com um so projeto", () => {
    renderList();

    const header = screen.getByRole("treeitem", { name: /^sem pasta/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(header.textContent).toContain("1");
    // Sem icone de maquina, sem guia: o grupo nao e um no de arvore.
    expect(header.querySelector(".pjx-ico")).toBeNull();
    expect(header.querySelector(".pjx-tcol")).toBeNull();

    const v1 = screen.getByRole("treeitem", { name: /caixa/ });
    expect(within(v1).getByText("1 item")).toBeInTheDocument();
    expect(within(v1).getByText(/hoje|ontem|há \d+ dias/)).toBeInTheDocument();
    // O recuo espelha os filhos de maquina: uma celula de guia sem traco.
    expect(v1.querySelector(".pjx-tcol .pjx-tcell")).not.toBeNull();
  });

  it("com 2+ projetos o grupo vem recolhido; o clique abre e a linha escopa", () => {
    const entries = [entry("e-b", "caixa"), entry("e-c", "livro")];
    const noteLists = [
      [
        note(
          "n5",
          "e-b",
          ["## 2026-11-05 09:00 · notebook", "- **fix** saldo duplicado · 4d5e6f7"].join("\n"),
          "2026-11-05T09:00:00Z",
        ),
      ],
      [
        note(
          "n6",
          "e-c",
          ["## 2026-11-04 10:00 · notebook", "- **docs** capitulo tres · 5e6f7a8"].join("\n"),
          "2026-11-04T10:00:00Z",
        ),
      ],
    ];
    const index = buildIndex(entries, noteLists, NOW);
    const { onSelect } = renderList({ index });

    const header = screen.getByRole("treeitem", { name: /^sem pasta/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(header.textContent).toContain("2");
    expect(screen.queryByRole("treeitem", { name: /caixa/ })).not.toBeInTheDocument();

    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("treeitem", { name: /caixa/ }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "project", entryId: "e-b" });
  });

  it("a ordem da arvore e Todos, grupo sem pasta, e so depois as maquinas", () => {
    renderList();
    const names = screen
      .getAllByRole("treeitem")
      .map((row) => (row.getAttribute("aria-label") ?? row.textContent ?? "").trim());
    const iTodos = names.findIndex((n) => n.startsWith("Todos"));
    const iGroup = names.findIndex((n) => n.startsWith("sem pasta"));
    const iCaixa = names.findIndex((n) => n.includes("caixa"));
    const iMachine = names.findIndex((n) => /^hp/.test(n));
    expect(iTodos).toBe(0);
    expect(iGroup).toBe(iTodos + 1);
    expect(iCaixa).toBe(iGroup + 1);
    expect(iMachine).toBeGreaterThan(iCaixa);
  });

  it("estado vazio so sem maquinas e sem projetos v1", () => {
    const empty = buildIndex([], [], NOW);
    renderList({ index: empty });
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("sem sessões");
  });

  it("um projeto v1 sem sessoes v2 nao e caderno vazio", () => {
    renderList({
      index: buildIndex(
        [entry("e-b", "caixa")],
        [
          [
            note(
              "n5",
              "e-b",
              ["## 2026-11-05 09:00 · notebook", "- **fix** saldo duplicado · 4d5e6f7"].join("\n"),
              "2026-11-05T09:00:00Z",
            ),
          ],
        ],
        NOW,
      ),
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: /caixa/ })).toBeInTheDocument();
  });

  it("caderno sem sessoes mostra forma, nao frase", () => {
    const empty = buildIndex([], [], NOW);
    renderList({ index: empty });
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("sem sessões");
    expect(status.querySelector("svg")).not.toBeNull();
  });

  it("enquanto carrega sem indice, skeleton; com erro, erro acionavel", () => {
    render(
      <ProjectList
        index={null}
        node={{ kind: "all" }}
        onSelect={vi.fn()}
        icons={{}}
        loading
        error=""
      />,
    );
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();

    render(
      <ProjectList
        index={null}
        node={{ kind: "all" }}
        onSelect={vi.fn()}
        icons={{}}
        loading={false}
        error="sem rede"
      />,
    );
    expect(screen.getByText("sem rede")).toBeInTheDocument();
  });
});
