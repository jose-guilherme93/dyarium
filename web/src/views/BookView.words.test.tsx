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
  listEntriesCached: vi.fn(),
  listAllEntries: vi.fn(),
}));
vi.mock("../api", () => ({ api, isConflict: () => false }));
// O corpo e o que importa aqui: a folha do BlockNote nao.
vi.mock("../editor/NotesEditor", () => ({
  NotesEditor: ({ onChange }: { onChange: (value: string) => void }) => (
    <textarea
      aria-label="Corpo do capítulo"
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

import { BookView } from "./BookView";

const book: Notebook = {
  id: "nb_book",
  name: "O nome do vento",
  color: "#C7D8F2",
  is_default: false,
  kind: "book",
  subtitle: "",
  author: "Ana",
  synopsis: "",
  language: "pt-BR",
  goal_words: 1000,
  book_status: "drafting",
  entry_count: 1,
  chapter_count: 1,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

const active: Entry = {
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
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getEntry.mockResolvedValue(active);
  api.listNotes.mockResolvedValue({ notes: [] });
  api.createNote.mockResolvedValue({ id: "n1", body_version: "v1" });
  api.listRevisions.mockResolvedValue({ revisions: [] });
  api.patchEntry.mockResolvedValue({ status: "ok", versions: {} });
  api.getWritingRhythm.mockResolvedValue({
    today: 0,
    days: [],
    daily_goal: 0,
    deadline: "",
    goal_words: 0,
  });
  api.getBookEntities.mockResolvedValue({ entities: [] });
  api.listLinks.mockResolvedValue({ links: [] });
});

describe("casa do livro e o corpo do capitulo", () => {
  it("salvar o corpo avisa a contagem sem pedir a recarga da lista", async () => {
    const onChanged = vi.fn();
    const onWordsSaved = vi.fn();
    render(
      <BookView
        book={book}
        chapters={[active]}
        loading={false}
        activeChapterId="e1"
        onOpenChapter={vi.fn()}
        onCloseChapter={vi.fn()}
        onCreateChapter={vi.fn()}
        onChanged={onChanged}
        onWordsSaved={onWordsSaved}
        onOpenSettings={vi.fn()}
      />,
    );

    const body = await screen.findByLabelText("Corpo do capítulo");
    fireEvent.change(body, { target: { value: "duas palavras" } });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    await waitFor(() => expect(onWordsSaved).toHaveBeenCalledWith("e1", 2));
    expect(onChanged).not.toHaveBeenCalled();
  });
});
