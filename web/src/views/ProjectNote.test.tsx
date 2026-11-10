import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProjectNote } from "./ProjectNote";
vi.mock("../api", () => ({
  api: {
    getEntry: vi.fn(),
    listNotes: vi.fn(),
    updateEntry: vi.fn(),
  },
}));

import { api } from "../api";

const entry = (id: string, title: string, icon?: string) =>
  ({ id, title, icon }) as never;

const note = (id: string, entryId: string, body: string) =>
  ({ id, entry_id: entryId, title: "Resumo", content_markdown: body }) as never;

/** Data AAAA-MM-DD deslocada de hoje, para o range relativo do filtro. */
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const D0 = isoDaysAgo(0);
const D10 = isoDaysAgo(10);

/** Nota com duas sessoes: fence canonico na primeira, bloco humano com
 * :::details na segunda. Nenhum dos dois formatos deve aparecer cru. */
const twoSessions = () => {
  const fence = JSON.stringify({
    v: 1,
    project: "dyarium",
    date: D0,
    time: "14:58",
    host: "vps-dev",
    detail: "concise",
    summary: "Fechar a leitura da nota do projeto.",
    items: [
      {
        kind: "feat",
        title: "leitura da nota com tabela por kind",
        commit: "abc1234",
        url: "https://example.com/commit/abc1234",
      },
      {
        kind: "feat",
        title: "botoes de acao declarativos",
        commit: "def5678",
        url: "https://example.com/commit/def5678",
      },
      {
        kind: "fix",
        title: "fence oculto na leitura",
        commit: "0ldhash",
        url: "https://example.com/commit/0ldhash",
      },
    ],
    commits: [{ hash: "abc1234", message: "leitura", url: "https://example.com/commit/abc1234" }],
    links: [{ label: "docs", url: "https://example.com/docs" }],
  });
  return [
    note(
      "n-1",
      "entry-a",
      [
        `## ${D0} 14:58 · vps-dev`,
        "Fechar a leitura da nota do projeto.",
        "- **feat** leitura da nota com tabela por kind · [abc1234](https://example.com/commit/abc1234)",
        "- **feat** botoes de acao declarativos · [def5678](https://example.com/commit/def5678)",
        "- **fix** fence oculto na leitura · [0ldhash](https://example.com/commit/0ldhash)",
        ":::details",
        "Commits:",
        "- abc1234 — leitura https://example.com/commit/abc1234",
        ":::",
        "```dyarium-json",
        fence,
        "```",
      ].join("\n"),
    ),
    note(
      "n-2",
      "entry-a",
      [
        `## ${D10} 09:00 · notebook`,
        "Sessao anterior sem url nos commits.",
        "- **chore** limpar estilos soltos · 9999888",
        "- **docs** contrato do fence v1 · 7777666",
      ].join("\n"),
    ),
  ];
};

const setup = (
  notes: ReturnType<typeof twoSessions>,
  options?: { entryIcon?: string },
) => {
  vi.mocked(api.getEntry).mockResolvedValue(
    entry("entry-a", "dyarium", options?.entryIcon ?? "✒️"),
  );
  vi.mocked(api.listNotes).mockResolvedValue({ notes } as never);
  const onFilterItems = vi.fn();
  const onEdit = vi.fn();
  render(
    <ProjectNote
      entryId="entry-a"
      notebookName="Projetos"
      refreshKey={0}
      onFilterItems={onFilterItems}
      onEdit={onEdit}
    />,
  );
  return { onFilterItems, onEdit };
};

const clipboardDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, "clipboard") ??
  Object.getOwnPropertyDescriptor(navigator, "clipboard") ??
  null;

beforeEach(() => {
  vi.mocked(api.getEntry).mockReset();
  vi.mocked(api.listNotes).mockReset();
  vi.mocked(api.updateEntry).mockReset();
});

afterEach(() => {
  if (clipboardDescriptor) {
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  } else {
    delete (navigator as { clipboard?: unknown }).clipboard;
  }
  vi.useRealTimers();
});

describe("ProjectNote", () => {
  it("mostra as duas sessoes com a tabela por kind e os numeros certos", async () => {
    setup(twoSessions());

    const tables = await screen.findAllByRole("table");
    expect(tables).toHaveLength(2);

    // Cabecalhos discretos das duas sessoes: host e numero de itens.
    expect(screen.getAllByText(/vps-dev/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/notebook/).length).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent).toContain("3 itens");
    expect(document.body.textContent).toContain("2 itens");

    // Primeira sessao (a mais nova): feat 2/67%, fix 1/33%, total 3/100%.
    const first = tables[0];
    expect(within(first).getByText("feat")).toBeInTheDocument();
    expect(within(first).getByText("2")).toBeInTheDocument();
    expect(within(first).getByText("67%")).toBeInTheDocument();
    expect(within(first).getByText("33%")).toBeInTheDocument();
    expect(within(first).getByText("Total").closest("tr")?.textContent).toBe("Total3100%");

    // Segunda sessao: chore e docs, uma linha cada.
    const second = tables[1];
    expect(within(second).getByText("chore")).toBeInTheDocument();
    expect(within(second).getByText("docs")).toBeInTheDocument();
    expect(within(second).getByText("Total").closest("tr")?.textContent).toBe("Total2100%");

    // Itens visiveis como lista de leitura, com o commit mono.
    expect(screen.getByText("leitura da nota com tabela por kind")).toBeInTheDocument();
    expect(screen.getByText("limpar estilos soltos")).toBeInTheDocument();
    expect(screen.getByText("abc1234")).toBeInTheDocument();
  });

  it("fence dyarium-json e :::details nunca aparecem na leitura", async () => {
    setup(twoSessions());
    await screen.findAllByRole("table");

    const text = document.body.textContent ?? "";
    expect(text).not.toContain("dyarium-json");
    expect(text).not.toContain(":::details");
    expect(text).not.toContain("```");
    expect(text).not.toContain('"v":1');
    expect(text).not.toContain("## " + D0);
  });

  it("Filtrar itens dispara a callback com projeto e periodo da sessao", async () => {
    const { onFilterItems } = setup(twoSessions());
    await screen.findAllByRole("table");

    const filterButtons = screen.getAllByRole("button", { name: "Filtrar itens" });
    expect(filterButtons).toHaveLength(2);

    fireEvent.click(filterButtons[0]);
    await waitFor(() =>
      expect(onFilterItems).toHaveBeenCalledWith("dyarium", "7"),
    );

    fireEvent.click(filterButtons[1]);
    await waitFor(() =>
      expect(onFilterItems).toHaveBeenLastCalledWith("dyarium", "30"),
    );
  });

  it("Copiar link chama o clipboard, mostra o feedback e se desabilita sem url", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    setup(twoSessions());
    await screen.findAllByRole("table");

    const copyButtons = screen.getAllByRole("button", { name: /Copiar link/ });
    expect(copyButtons).toHaveLength(2);

    // Segunda sessao nao tem url em nenhum commit: pill desabilitado com title.
    expect(copyButtons[1]).toBeDisabled();
    expect(copyButtons[1]).toHaveAttribute("aria-disabled", "true");
    expect(copyButtons[1]).toHaveAttribute("title", "Sem link para copiar");

    vi.useFakeTimers();
    fireEvent.click(copyButtons[0]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(writeText).toHaveBeenCalledWith("https://example.com/commit/abc1234");
    expect(screen.getByText("Copiado")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(screen.queryByText("Copiado")).not.toBeInTheDocument();
  });

  it("Editar chama onEdit e o cabecalho mostra o icone e a meta do caderno", async () => {
    const { onEdit } = setup(twoSessions());
    await screen.findAllByRole("table");

    expect(
      screen.getByRole("heading", { level: 1, name: "dyarium" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("trocar ícone de dyarium")).toHaveTextContent("✒️");
    expect(screen.getByText("Projetos")).toBeInTheDocument();
    expect(screen.getByText("vps-dev")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("nota sem sessao mostra o estado vazio sem quebrar", async () => {
    vi.mocked(api.getEntry).mockResolvedValue(entry("entry-a", "projeto solto"));
    vi.mocked(api.listNotes).mockResolvedValue({
      notes: [note("n-1", "entry-a", "")],
    } as never);
    render(
      <ProjectNote
        entryId="entry-a"
        notebookName="Projetos"
        refreshKey={0}
        onFilterItems={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("Sem sessões registradas.")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
  });
});
