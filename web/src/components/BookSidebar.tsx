import { useState } from "react";
import { chapterGroups, chapterNumber, countLabel, formatWords } from "../lib/books";
import type { ChapterKind, Entry, Notebook } from "../types";

interface BookSidebarProps {
  book: Notebook;
  chapters: Entry[];
  loading: boolean;
  activeChapterId: string | null;
  onOpen: (id: string) => void;
  onCreate: (kind: ChapterKind) => void;
  onReorder: (sourceId: string, targetId: string) => void;
}

/** Numero ou letra que abre a linha do capitulo. */
function chapterMark(chapters: Entry[], chapter: Entry): string {
  if (chapter.chapter_kind === "chapter") return `Capítulo ${chapterNumber(chapters, chapter.id)}`;
  if (chapter.chapter_kind === "part") return "Parte";
  if (chapter.chapter_kind === "front") return "Frontispício";
  return "Posfácio";
}

/**
 * Lista de capitulos no mesmo lugar onde as notas ficariam. E o que faz o
 * caderno virar livro: a coluna esquerda passa a ser a estrutura da obra, na
 * mesma escala da lista de notas.
 */
export function BookSidebar({
  book,
  chapters,
  loading,
  activeChapterId,
  onOpen,
  onCreate,
  onReorder,
}: BookSidebarProps) {
  const [dragging, setDragging] = useState<string | null>(null);
  const groups = chapterGroups(chapters);
  const chapterCount = chapters.filter((chapter) => chapter.chapter_kind === "chapter").length;

  return (
    <div className="book-side">
      <div className="book-side-head">
        <span className="book-side-title">{book.name}</span>
        <span className="book-side-count">{countLabel(chapterCount, "capítulo", "capítulos")}</span>
      </div>

      <div className="book-side-list" role="list">
        {loading ? (
          <p className="muted book-side-empty">Carregando...</p>
        ) : chapters.length === 0 ? (
          <div className="book-side-empty">
            <p className="muted">Nenhum capítulo</p>
            <button type="button" className="button button--small" onClick={() => onCreate("chapter")}>
              Começar o primeiro capítulo
            </button>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.part?.id ?? "root"} className="book-side-group">
              {group.part ? (
                <button
                  type="button"
                  className="book-side-part"
                  draggable
                  onDragStart={() => setDragging(group.part!.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (dragging) onReorder(dragging, group.part!.id);
                    setDragging(null);
                  }}
                  onClick={() => onOpen(group.part!.id)}
                >
                  {group.part.title || "Parte"}
                </button>
              ) : null}
              {group.items.map((chapter) => (
                <div
                  key={chapter.id}
                  className="book-side-row-wrap"
                  draggable
                  onDragStart={() => setDragging(chapter.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (dragging) onReorder(dragging, chapter.id);
                    setDragging(null);
                  }}
                >
                  <button
                    type="button"
                    className={
                      chapter.id === activeChapterId
                        ? "book-side-row book-side-row--on"
                        : "book-side-row"
                    }
                    onClick={() => onOpen(chapter.id)}
                    aria-current={chapter.id === activeChapterId ? "page" : undefined}
                  >
                    <span className="book-side-row-head">
                      <span className="book-side-name">{chapter.title || "Sem título"}</span>
                      <i className="book-side-grip" aria-hidden="true">
                        ⋮⋮
                      </i>
                    </span>
                    <span className="book-side-meta">
                      {chapterMark(chapters, chapter)} · {formatWords(chapter.word_count ?? 0)} palavras
                      <i
                        className={"status-dot status-dot--" + (chapter.chapter_status || "draft")}
                        aria-label={chapter.chapter_status || "rascunho"}
                      />
                    </span>
                    {chapter.chapter_synopsis ? (
                      <span className="book-side-synopsis">{chapter.chapter_synopsis}</span>
                    ) : null}
                  </button>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      <button
        type="button"
        className="book-side-add"
        onClick={() => onCreate("chapter")}
        aria-label="Novo capítulo"
      >
        + Capítulo
      </button>
    </div>
  );
}
