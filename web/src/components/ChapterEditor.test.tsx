import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Entry, Notebook } from "../types";

const api = vi.hoisted(() => ({
  getEntry: vi.fn(),
  listNotes: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  listRevisions: vi.fn(),
  patchEntry: vi.fn(),
  deleteEntry: vi.fn(),
  getWritingRhythm: vi.fn(),
  getBookEntities: vi.fn(),
  listLinks: vi.fn(),
  createLink: vi.fn(),
  deleteLink: vi.fn(),
  analyze: vi.fn(),
}));

vi.mock("../api", () => ({ api, isConflict: () => false }));
// O BlockNote nao e o assunto do teste: a folha e a gaveta sao.
vi.mock("../editor/NotesEditor", () => ({
  NotesEditor: ({ onChange }: { onChange: (value: string) => void }) => (
    <div data-testid="chapter-body">
      <textarea
        aria-label="Corpo do capítulo"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  ),
}));
// O rascunho e IndexedDB; aqui interessa que ele seja escrito na hora certa.
const drafts = vi.hoisted(() => ({
  writeDraft: vi.fn(async () => {}),
  readDraft: vi.fn(async (): Promise<unknown> => undefined),
  clearDraft: vi.fn(async () => {}),
}));
vi.mock("../lib/bookDrafts", () => ({
  ...drafts,
  backupConflict: vi.fn(async () => {}),
  listDrafts: vi.fn(async () => []),
  cleanupConflictBackups: vi.fn(async () => {}),
}));

import { ChapterEditor } from "./ChapterEditor";

const book: Notebook = {
  id: "book1",
  name: "Serra",
  color: "",
  is_default: false,
  kind: "book",
  subtitle: "",
  author: "",
  synopsis: "",
  language: "pt-BR",
  goal_words: 2000,
  book_status: "drafting",
  page_size: "6x9",
  page_margin_mm: 19,
  body_px: 18,
  body_leading: 160,
  daily_goal_words: 500,
  deadline: "",
  entry_count: 2,
  chapter_count: 2,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

function chapter(overrides: Partial<Entry>): Entry {
  return {
    id: "e1",
    title: "Uma vida",
    status: "ready",
    source: "text",
    original_filename: "",
    content_type: "",
    size_bytes: 0,
    duration_seconds: 0,
    sha256: "",
    recorded_at: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    chapter_kind: "chapter",
    chapter_status: "revising",
    chapter_position: 1024,
    chapter_beats: "Chegada\nA carta",
    chapter_notes: "A avó fala pouco.",
    ...overrides,
  };
}

const current = chapter({});
const chapters = [current, chapter({ id: "e2", title: "O rio", chapter_position: 2048 })];

function renderChapter(overrides: Partial<Parameters<typeof ChapterEditor>[0]> = {}) {
  const props = {
    book,
    chapter: current,
    chapters,
    onBack: vi.fn(),
    onOpenChapter: vi.fn(),
    onCreateAfter: vi.fn(),
    onFocusChange: vi.fn(),
    onChanged: vi.fn(),
    onWordsSaved: vi.fn(),
    onDeleted: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ChapterEditor {...props} />) };
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
}

afterEach(() => {
  vi.useRealTimers();
  setOnline(true);
});

beforeEach(() => {
  vi.clearAllMocks();
  setOnline(true);
  api.getEntry.mockResolvedValue(current);
  api.listNotes.mockResolvedValue({ notes: [] });
  api.createNote.mockResolvedValue({ id: "n1", body_version: "v1" });
  api.updateNote.mockResolvedValue({ id: "n1", versions: { body: "v2" } });
  api.listRevisions.mockResolvedValue({ revisions: [] });
  api.patchEntry.mockResolvedValue({ status: "ok", versions: {} });
  api.getWritingRhythm.mockResolvedValue({
    today: 320,
    days: [],
    daily_goal: 500,
    deadline: "",
    goal_words: 2000,
  });
  api.getBookEntities.mockResolvedValue({ entities: [] });
  api.listLinks.mockResolvedValue({ links: [] });
  api.analyze.mockResolvedValue({ status: "queued" });
});

describe("editor do capitulo", () => {
  it("abre na folha com o titulo e o ritmo do dia", async () => {
    renderChapter();
    expect(await screen.findByLabelText("Título do capítulo")).toHaveValue("Uma vida");
    expect(screen.getByText(/hoje 320 \/ 500/)).toBeInTheDocument();
    expect(screen.getByTestId("chapter-body")).toBeInTheDocument();
  });

  it("navega para o proximo capitulo e cria um depois deste", async () => {
    const { props } = renderChapter();
    await screen.findByLabelText("Título do capítulo");

    fireEvent.click(screen.getByRole("button", { name: "Próximo capítulo" }));
    expect(props.onOpenChapter).toHaveBeenCalledWith("e2");

    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    expect(props.onCreateAfter).toHaveBeenCalled();

    const onOpen = props.onOpenChapter as ReturnType<typeof vi.fn>;
    const calls = onOpen.mock.calls.length;
    fireEvent.keyDown(window, { key: "PageUp", ctrlKey: true });
    expect(onOpen).toHaveBeenCalledTimes(calls);
  });

  it("oferece a barra rica do escritor", async () => {
    renderChapter();
    await screen.findByLabelText("Título do capítulo");
    for (const name of [
      "Desfazer",
      "Refazer",
      "Negrito",
      "Itálico",
      "Sublinhado",
      "Riscado",
      "Lista com marcadores",
      "Lista numerada",
      "Link para nota",
      "Imagem",
      "Áudio",
      "Separador de cena",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Estilo do parágrafo")).toBeInTheDocument();
    expect(screen.getByLabelText("Alinhamento do parágrafo")).toBeInTheDocument();
  });

  it("mostra beats, anotacoes e referencias na gaveta e grava um beat novo", async () => {
    api.listLinks.mockResolvedValue({
      links: [
        {
          id: "l1",
          from_entry_id: "e1",
          to_entry_id: "",
          url: "https://example.com/mapa",
          label: "Mapa da serra",
          title: "",
          created_at: "2026-10-01T00:00:00Z",
        },
      ],
    });
    renderChapter();
    await screen.findByLabelText("Título do capítulo");

    fireEvent.click(screen.getByRole("button", { name: "Painel" }));
    expect(await screen.findByText("Mapa da serra")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rascunho" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Chegada")).toBeInTheDocument();

    fireEvent.click(screen.getByText("+ Beat"));
    fireEvent.change(screen.getByLabelText("Beat 3"), { target: { value: "Noite" } });
    fireEvent.blur(screen.getByLabelText("Beat 3"));

    await waitFor(() =>
      expect(api.patchEntry).toHaveBeenCalledWith("e1", {
        chapter_beats: "Chegada\nA carta\nNoite",
      }),
    );
  });

  it("sem analise, oferece analisar o capitulo em vez de fingir entidades", async () => {
    renderChapter();
    await screen.findByLabelText("Título do capítulo");
    fireEvent.click(screen.getByRole("button", { name: "Painel" }));
    fireEvent.click(screen.getByRole("button", { name: "Analisar capítulo" }));
    await waitFor(() => expect(api.analyze).toHaveBeenCalledWith("e1"));
  });

  it("grava o corpo sem pedir a lista de capitulos e informa a contagem", async () => {
    const { props } = renderChapter();
    const body = await screen.findByLabelText("Corpo do capítulo");

    fireEvent.change(body, { target: { value: "Uma frase com cinco palavras" } });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    await waitFor(() => expect(props.onWordsSaved).toHaveBeenCalledWith("e1", 5));
    expect(api.createNote).toHaveBeenCalledWith("e1", "Uma vida", "Uma frase com cinco palavras");
    expect(props.onChanged).not.toHaveBeenCalled();
  });

  it("salva o texto mais recente no tique de 60 s mesmo com o debounce reiniciado", async () => {
    vi.useFakeTimers();
    renderChapter();
    // Com timers falsos, deixa a carga inicial assentar sem `findBy`.
    await act(async () => {});
    const body = screen.getByLabelText("Corpo do capítulo");

    // Uma tecla a cada 500 ms: o debounce de 800 ms nunca dispara.
    for (let i = 0; i < 121; i += 1) {
      fireEvent.change(body, { target: { value: `palavra ${i}` } });
      await vi.advanceTimersByTimeAsync(500);
    }

    expect(api.createNote).toHaveBeenCalledTimes(1);
    expect(api.createNote.mock.calls[0][2]).toMatch(/^palavra 1\d\d$/);
  });

  it("sem rede guarda o rascunho e tenta de novo no tique seguinte", async () => {
    vi.useFakeTimers();
    setOnline(false);
    api.createNote
      .mockRejectedValueOnce(new Error("sem rede"))
      .mockResolvedValue({ id: "n1", body_version: "v1" });
    renderChapter();
    await act(async () => {});
    const body = screen.getByLabelText("Corpo do capítulo");

    fireEvent.change(body, { target: { value: "duas palavras" } });
    // O debounce tenta gravar e falha; o tique offline mantem o rascunho.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(drafts.writeDraft).toHaveBeenLastCalledWith(
      "e1",
      expect.objectContaining({ markdown: "duas palavras", state: "offline" }),
    );
    expect(api.createNote).toHaveBeenCalledTimes(1);

    setOnline(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.createNote).toHaveBeenCalledTimes(2);
    expect(api.createNote).toHaveBeenLastCalledWith("e1", "Uma vida", "duas palavras");
  });

  it("nao salva depois de desmontar", async () => {
    vi.useFakeTimers();
    api.createNote.mockRejectedValue(new Error("sem rede"));
    const { unmount } = renderChapter();
    await act(async () => {});
    const body = screen.getByLabelText("Corpo do capítulo");

    fireEvent.change(body, { target: { value: "texto pendente" } });
    unmount();
    await vi.advanceTimersByTimeAsync(60_000);

    // So a tentativa do debounce, que ja estava armada; o tique de fundo sumiu.
    expect(api.createNote).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+S grava na hora", async () => {
    vi.useFakeTimers();
    const { props } = renderChapter();
    await act(async () => {});
    const body = screen.getByLabelText("Corpo do capítulo");

    fireEvent.change(body, { target: { value: "salvar agora" } });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(api.createNote).toHaveBeenCalledWith("e1", "Uma vida", "salvar agora");
    expect(props.onWordsSaved).toHaveBeenCalledWith("e1", 2);
  });
});

describe("glifo de salvamento", () => {
  it("nenhum texto de salvamento fica visivel no cabeçalho", async () => {
    const { container } = renderChapter();
    await screen.findByLabelText("Título do capítulo");
    expect(container.querySelector(".save-state")).toBeNull();
    const visible = Array.from(container.querySelectorAll(".chapter-top *")).some(
      (el) =>
        el.children.length === 0 &&
        !el.classList.contains("sr-only") &&
        /salv|sem rede/i.test(el.textContent ?? ""),
    );
    expect(visible).toBe(false);
  });

  it("sem nada pendente, o glifo e o disco de Salvo com explicacao no titulo", async () => {
    renderChapter();
    await screen.findByLabelText("Título do capítulo");
    const glyph = screen.getByRole("img", { name: "Salvo" });
    expect(glyph.getAttribute("title")).toMatch(/Grava sozinho a cada 1 minuto/);
    expect(glyph.querySelector("svg")).not.toBeNull();
    // aria-live sem texto visivel
    const live = document.querySelector(".chapter-top .sr-only[aria-live='polite']");
    expect(live).not.toBeNull();
    expect(live?.textContent).toBe("Salvo");
  });

  it("durante a gravacao o arco gira e o rotulo e Salvando", async () => {
    vi.useFakeTimers();
    api.createNote.mockReturnValue(new Promise(() => {}));
    renderChapter();
    await act(async () => {});
    fireEvent.change(screen.getByLabelText("Corpo do capítulo"), { target: { value: "alpha beta" } });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const glyph = screen.getByRole("img", { name: "Salvando" });
    expect(glyph.querySelector("svg.save-glyph-spin")).not.toBeNull();
  });

  it("com alteracao ainda nao gravada o anel fica vazio e diz pendentes", async () => {
    vi.useFakeTimers();
    renderChapter();
    await act(async () => {});
    fireEvent.change(screen.getByLabelText("Corpo do capítulo"), { target: { value: "uma mudanca" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    const glyph = screen.getByRole("img", { name: "Alterações pendentes" });
    expect(glyph).toBeInTheDocument();
    expect(api.createNote).not.toHaveBeenCalled();
  });

  it("sem rede: anel tracejado e clicavel, e o clique tenta de novo", async () => {
    vi.useFakeTimers();
    setOnline(false);
    api.createNote.mockRejectedValueOnce(new Error("sem rede"));
    renderChapter();
    await act(async () => {});
    fireEvent.change(screen.getByLabelText("Corpo do capítulo"), { target: { value: "duas palavras" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    const btn = screen.getByRole("button", { name: "Sem rede" });
    expect(api.createNote).toHaveBeenCalledTimes(1);

    fireEvent.click(btn);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.createNote).toHaveBeenCalledTimes(2);
  });

  it("falha com rede ativa vira triangulo de erro clicavel", async () => {
    vi.useFakeTimers();
    api.createNote.mockRejectedValueOnce(new Error("500"));
    renderChapter();
    await act(async () => {});
    fireEvent.change(screen.getByLabelText("Corpo do capítulo"), { target: { value: "duas palavras" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    const btn = screen.getByRole("button", { name: "Erro ao salvar" });
    expect(btn.querySelector("svg path")).not.toBeNull();
    fireEvent.click(btn);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.createNote).toHaveBeenCalledTimes(2);
  });

  it("conflito mantem a faixa e nao tenta gravar sozinho", async () => {
    vi.useFakeTimers();
    drafts.readDraft.mockResolvedValueOnce({
      markdown: "texto local",
      baseVersion: "v1",
      noteId: "n1",
      updatedAt: 1,
      state: "conflict",
    });
    renderChapter();
    await act(async () => {});
    expect(screen.getByRole("img", { name: "Conflito ao salvar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sem rede|Erro ao salvar/ })).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(api.createNote).not.toHaveBeenCalled();
    expect(api.updateNote).not.toHaveBeenCalled();
  });
});
