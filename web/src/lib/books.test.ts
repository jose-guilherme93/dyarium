import { describe, expect, it } from "vitest";
import {
  bookFileName,
  chapterGroups,
  chapterNumber,
  continueChapter,
  coverInk,
  orderedChapters,
} from "./books";
import type { Entry } from "../types";

function chapter(overrides: Partial<Entry>): Entry {
  return {
    id: "e",
    title: "",
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
    ...overrides,
  };
}

describe("ordem do livro", () => {
  it("ordena por posicao e agrupa partes", () => {
    const list = [
      chapter({ id: "c", chapter_kind: "chapter", chapter_position: 3072 }),
      chapter({ id: "p", chapter_kind: "part", chapter_position: 1024, title: "Parte I" }),
      chapter({ id: "a", chapter_kind: "chapter", chapter_position: 2048 }),
      chapter({ id: "b", chapter_kind: "chapter", chapter_position: 4096 }),
    ];
    expect(orderedChapters(list).map((item) => item.id)).toEqual(["p", "a", "c", "b"]);
    const groups = chapterGroups(list);
    expect(groups).toHaveLength(1);
    expect(groups[0].part?.id).toBe("p");
    expect(groups[0].items.map((item) => item.id)).toEqual(["a", "c", "b"]);
  });

  it("numera so capitulos, ignorando partes e front/back", () => {
    const list = [
      chapter({ id: "f", chapter_kind: "front", chapter_position: 1024 }),
      chapter({ id: "c1", chapter_kind: "chapter", chapter_position: 2048 }),
      chapter({ id: "p", chapter_kind: "part", chapter_position: 3072 }),
      chapter({ id: "c2", chapter_kind: "chapter", chapter_position: 4096 }),
    ];
    expect(chapterNumber(list, "c1")).toBe(1);
    expect(chapterNumber(list, "c2")).toBe(2);
    expect(chapterNumber(list, "p")).toBe(0);
  });

  it("continua no primeiro capitulo nao final", () => {
    const list = [
      chapter({ id: "c1", chapter_kind: "chapter", chapter_position: 1024, chapter_status: "done" }),
      chapter({ id: "c2", chapter_kind: "chapter", chapter_position: 2048, chapter_status: "draft" }),
      chapter({ id: "c3", chapter_kind: "chapter", chapter_position: 3072, chapter_status: "draft" }),
    ];
    expect(continueChapter(list)?.id).toBe("c2");
    expect(continueChapter([])).toBeNull();
  });

  it("escolhe texto legivel sobre a capa", () => {
    expect(coverInk("#2c4a63")).toBe("#f6f4ef");
    expect(coverInk("#EFE3A8")).toBe("#211e1a");
  });

  it("sanitiza o nome do arquivo mantendo acentos", () => {
    expect(bookFileName("O Nome do Vento", "book", "docx")).toBe("o-nome-do-vento-book.docx");
    expect(bookFileName("A/B: C?", "manuscript", "pdf")).toBe("ab-c-manuscript.pdf");
  });
});
