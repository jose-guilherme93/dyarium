import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ProjectList } from "./ProjectList";
import { aggregate, buildIndex } from "../lib/useProjectsIndex";
import type { Entry, Note } from "../types";

const entry = (id: string, title: string, icon?: string) =>
  ({ id, title, icon }) as unknown as Entry;

const note = (id: string, entryId: string, body: string) =>
  ({ id, entry_id: entryId, title: "Resumo", content_markdown: body }) as unknown as Note;

const rows = () => [
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
        ["## 2026-11-05 09:00 · notebook", "- **fix** saldo calculado duas vezes ao importar csv"].join("\n"),
      ),
    ],
  },
];

function fixture(list = rows()) {
  const index = buildIndex(
    list.map((row) => row.entry),
    list.map((row) => row.notes),
  );
  return { index, projects: aggregate(index) };
}

function renderList(overrides: Partial<ComponentProps<typeof ProjectList>> = {}) {
  const { index, projects } = fixture();
  const onSelect = vi.fn();
  render(
    <ProjectList
      projects={projects}
      totalCount={index.rows.length}
      selectedProject={null}
      onSelect={onSelect}
      icons={{}}
      loading={false}
      error=""
      {...overrides}
    />,
  );
  return { onSelect };
}

beforeEach(() => {
  localStorage.clear();
});

describe("ProjectList", () => {
  it("mostra Todos com o total e cada projeto com a sua contagem", () => {
    renderList();

    const todos = screen.getByRole("button", { name: /^Todos/ });
    expect(within(todos).getByText("3")).toBeInTheDocument();
    expect(todos).toHaveAttribute("aria-pressed", "true");

    const caixa = screen.getByRole("button", { name: /caixa/ });
    expect(within(caixa).getByText("1")).toBeInTheDocument();

    const dyarium = screen.getByRole("button", { name: /dyarium/ });
    expect(within(dyarium).getByText("2")).toBeInTheDocument();
    // O icone persistido na entry aparece na linha.
    expect(within(dyarium).getByText("✒️")).toBeInTheDocument();
  });

  it("clicar num projeto chama onSelect com o nome; Todos passa null", () => {
    const { onSelect } = renderList();

    fireEvent.click(screen.getByRole("button", { name: /caixa/ }));
    expect(onSelect).toHaveBeenLastCalledWith("caixa");

    fireEvent.click(screen.getByRole("button", { name: /^Todos/ }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("o estado selecionado marca a linha escolhida e devolve o Todos", () => {
    renderList();

    expect(screen.getByRole("button", { name: /dyarium/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // O App e dono da selecao: re-render com o projeto escolhido.
    renderList({ selectedProject: "dyarium" });
    const again = screen.getAllByRole("button", { name: /dyarium/ });
    expect(again[again.length - 1]).toHaveAttribute("aria-pressed", "true");
  });

  it("sem projetos diz que nao ha projeto nenhum", () => {
    const empty = buildIndex([], []);
    render(
      <ProjectList
        projects={[]}
        totalCount={0}
        selectedProject={null}
        onSelect={vi.fn()}
        icons={{}}
        loading={false}
        error=""
      />,
    );
    expect(screen.getByText("Nenhum projeto ainda.")).toBeInTheDocument();
    expect(empty.rows).toHaveLength(0);
  });

  it("enquanto carrega, nao mostra lista nem estado vazio", () => {
    renderList({ loading: true, projects: [] });
    expect(screen.queryByText("Nenhum projeto ainda.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /caixa/ })).not.toBeInTheDocument();
  });
});
