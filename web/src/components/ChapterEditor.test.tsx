import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  NotesEditor: () => <div data-testid="chapter-body" />,
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
    onDeleted: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ChapterEditor {...props} />) };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getEntry.mockResolvedValue(current);
  api.listNotes.mockResolvedValue({ notes: [] });
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
});
