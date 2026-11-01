import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Entry, Notebook } from "../types";

const api = vi.hoisted(() => ({
  listNotes: vi.fn(),
  getEntry: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  listRevisions: vi.fn(),
  deleteEntry: vi.fn(),
  patchEntry: vi.fn(),
  getWritingRhythm: vi.fn(),
  getBookEntities: vi.fn(),
  listLinks: vi.fn(),
  createLink: vi.fn(),
  deleteLink: vi.fn(),
  analyze: vi.fn(),
}));
vi.mock("../api", () => ({ api }));

import { BookView } from "./BookView";

const book: Notebook = {
  id: "nb_book",
  name: "O nome do vento",
  color: "#C7D8F2",
  is_default: false,
  kind: "book",
  subtitle: "Volume I",
  author: "Ana",
  synopsis: "",
  language: "pt-BR",
  goal_words: 1000,
  book_status: "drafting",
  entry_count: 2,
  chapter_count: 2,
  words: 400,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

function chapter(overrides: Partial<Entry>): Entry {
  return {
    id: "e1",
    title: "A ponte",
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
    chapter_status: "draft",
    chapter_position: 1024,
    word_count: 120,
    ...overrides,
  };
}

const chapters = [
  chapter({ id: "e1", title: "A ponte", chapter_position: 1024 }),
  chapter({ id: "e2", title: "O rio", chapter_position: 2048, chapter_status: "done" }),
];

function renderBook(overrides: Partial<Parameters<typeof BookView>[0]> = {}) {
  const props = {
    book,
    chapters,
    loading: false,
    activeChapterId: null,
    onOpenChapter: vi.fn(),
    onCloseChapter: vi.fn(),
    onCreateChapter: vi.fn(),
    onChanged: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<BookView {...props} />) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  api.listNotes.mockResolvedValue({ notes: [] });
  api.getEntry.mockResolvedValue(chapters[0]);
  api.listRevisions.mockResolvedValue({ revisions: [] });
  api.patchEntry.mockResolvedValue({ status: "ok", versions: {} });
  api.getWritingRhythm.mockResolvedValue({
    today: 320,
    days: [{ day: "2026-10-01", words: 320 }],
    daily_goal: 500,
    deadline: "",
    goal_words: 1000,
  });
  api.getBookEntities.mockResolvedValue({ entities: [] });
  api.listLinks.mockResolvedValue({ links: [] });
  api.analyze.mockResolvedValue({ status: "queued" });
});

describe("casa do livro", () => {
  it("mostra capa, contagens e o continuar", async () => {
    renderBook();
    expect(screen.getAllByText("O nome do vento").length).toBeGreaterThan(0);
    expect(screen.getByText("capítulos")).toBeInTheDocument();
    expect(screen.getByText("palavras")).toBeInTheDocument();
    const continueButton = await screen.findByRole("button", {
      name: /Continuar no.*A ponte/,
    });
    expect(continueButton).toBeInTheDocument();
  });

  it("continua no primeiro capitulo nao final", () => {
    const { props } = renderBook();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Continuar no.*A ponte/,
      }),
    );
    expect(props.onOpenChapter).toHaveBeenCalledWith("e1");
  });

  it("cria capitulo mesmo quando o livro esta vazio", () => {
    const { props } = renderBook({ chapters: [] });
    fireEvent.click(screen.getByText("Começar o primeiro capítulo"));
    expect(props.onCreateChapter).toHaveBeenCalledWith("chapter");
  });

  it("mostra a estrutura em cartoes e abre pelo cartao", async () => {
    const { props } = renderBook();
    fireEvent.click(screen.getByRole("tab", { name: "Estrutura" }));
    expect(screen.getByText("O rio")).toBeInTheDocument();
    expect(screen.getAllByText(/120 palavras/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("O rio"));
    expect(props.onOpenChapter).toHaveBeenCalledWith("e2");
  });

  it("mostra a ficha, as paginas estimadas e o ritmo dos dias", async () => {
    renderBook();
    expect(screen.getByText("páginas")).toBeInTheDocument();
    expect(screen.getByText("Últimos 7 dias")).toBeInTheDocument();
    expect(screen.getByText("finais")).toBeInTheDocument();
  });

  it("mostra o ritmo do dia na casa", async () => {
    renderBook();
    await waitFor(() => expect(screen.getByText(/hoje 320 \/ 500/)).toBeInTheDocument());
  });

  it("mostra o capitulo ativo no editor", async () => {
    renderBook({ activeChapterId: "e1" });
    await waitFor(() => expect(screen.getByLabelText("Título do capítulo")).toHaveValue("A ponte"));
    expect(screen.getByLabelText("Título do capítulo")).toBeInTheDocument();
  });
});
