import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BookSidebar } from "./BookSidebar";
import type { Entry, Notebook } from "../types";

const book: Notebook = {
  id: "nb",
  name: "O nome do vento",
  color: "",
  is_default: false,
  kind: "book",
  subtitle: "",
  author: "",
  synopsis: "",
  language: "",
  goal_words: 0,
  book_status: "drafting",
  entry_count: 0,
  chapter_count: 0,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

function chapter(overrides: Partial<Entry>): Entry {
  return {
    id: "e",
    title: "Capítulo",
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
    ...overrides,
  };
}

const chapters = [
  chapter({ id: "c1", title: "O mapa", chapter_position: 1024 }),
  chapter({ id: "p", title: "Parte I", chapter_kind: "part", chapter_position: 2048 }),
  chapter({ id: "c2", title: "A ponte", chapter_position: 3072, chapter_synopsis: "Kael atravessa." }),
];

describe("capitulos na sidebar", () => {
  it("agrupa por parte e abre o capitulo", () => {
    const onOpen = vi.fn();
    render(
      <BookSidebar
        book={book}
        chapters={chapters}
        loading={false}
        activeChapterId="c1"
        onOpen={onOpen}
        onCreate={() => {}}
        onReorder={() => {}}
      />,
    );
    expect(screen.getByText("O mapa")).toBeInTheDocument();
    expect(screen.getByText("Parte I")).toBeInTheDocument();
    expect(screen.getByText("A ponte")).toBeInTheDocument();
    expect(screen.getByText("Kael atravessa.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("A ponte"));
    expect(onOpen).toHaveBeenCalledWith("c2");
  });

  it("cria capitulo e mostra o estado vazio", () => {
    const onCreate = vi.fn();
    render(
      <BookSidebar
        book={book}
        chapters={[]}
        loading={false}
        activeChapterId={null}
        onOpen={() => {}}
        onCreate={onCreate}
        onReorder={() => {}}
      />,
    );
    expect(screen.getByText("Nenhum capítulo")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Começar o primeiro capítulo"));
    expect(onCreate).toHaveBeenCalledWith("chapter");
  });
});
