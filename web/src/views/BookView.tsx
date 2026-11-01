import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { ChapterEditor } from "../components/ChapterEditor";
import { ExportDialog } from "../components/ExportDialog";
import { ReadingView } from "../components/ReadingView";
import {
  chapterNumber,
  continueChapter,
  countLabel,
  coverInk,
  formatWords,
  orderedChapters,
  progress as clampProgress,
} from "../lib/books";
import {
  clearDraft,
  cleanupConflictBackups,
  listDrafts,
  type ChapterDraft,
} from "../lib/bookDrafts";
import {
  DEFAULT_EXPORT_OPTIONS,
  type BookExportInput,
  type ExportChapter,
} from "../lib/bookExport";
import { markdownToPlain } from "../editor/blocknoteMarkdown";
import { SettingsIcon } from "../components/icons";
import type { ChapterKind, Entry, Notebook } from "../types";

interface BookViewProps {
  book: Notebook;
  chapters: Entry[];
  loading: boolean;
  activeChapterId: string | null;
  onOpenChapter: (id: string) => void;
  onCloseChapter: () => void;
  onCreateChapter: (kind: ChapterKind) => void;
  onChanged: () => void;
  onOpenSettings: () => void;
}

/** Casa do livro e workspace de escrita. Os capitulos ficam na sidebar. */
export function BookView({
  book,
  chapters,
  loading,
  activeChapterId,
  onOpenChapter,
  onCloseChapter,
  onCreateChapter,
  onChanged,
  onOpenSettings,
}: BookViewProps) {
  const [reading, setReading] = useState<BookExportInput | null>(null);
  const [exportInput, setExportInput] = useState<BookExportInput | null>(null);
  const [pending, setPending] = useState<Array<[string, ChapterDraft]>>([]);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const [lastChapterId, setLastChapterId] = useState("");

  useEffect(() => {
    try {
      setLastChapterId(localStorage.getItem(`dyarium.book.${book.id}.chapter`) ?? "");
    } catch {
      setLastChapterId("");
    }
  }, [book.id]);

  useEffect(() => {
    void cleanupConflictBackups();
  }, []);

  const loadPending = useCallback(async () => {
    const drafts = await listDrafts();
    const ids = new Set(chapters.map((chapter) => chapter.id));
    setPending(drafts.filter(([entryId]) => ids.has(entryId)));
  }, [chapters]);

  useEffect(() => {
    void loadPending();
    const timer = window.setInterval(() => void loadPending(), 30000);
    return () => window.clearInterval(timer);
  }, [loadPending]);

  const active = chapters.find((chapter) => chapter.id === activeChapterId) ?? null;
  const totalWords = useMemo(
    () => chapters.reduce((sum, chapter) => sum + (chapter.word_count ?? 0), 0),
    [chapters],
  );
  const chapterCount = chapters.filter((chapter) => chapter.chapter_kind === "chapter").length;
  const partCount = chapters.filter((chapter) => chapter.chapter_kind === "part").length;
  const goal = book.goal_words > 0 ? book.goal_words : 0;
  const percent = goal > 0 ? clampProgress((totalWords / goal) * 100) : 0;
  const next = continueChapter(chapters, lastChapterId);

  const openChapter = (id: string) => {
    setFocus(false);
    setLastChapterId(id);
    try {
      localStorage.setItem(`dyarium.book.${book.id}.chapter`, id);
    } catch {
      // sem localStorage: "continuar" usa o primeiro nao final
    }
    onOpenChapter(id);
  };

  const exportChapters = useCallback(async (): Promise<BookExportInput> => {
    const selected = orderedChapters(chapters);
    const loaded: ExportChapter[] = await Promise.all(
      selected.map(async (chapter) => {
        try {
          const notes = await api.listNotes(chapter.id);
          const markdown = notes.notes?.[0]?.content_markdown ?? "";
          const plain = markdownToPlain(markdown);
          return {
            entry: chapter,
            markdown,
            words: plain ? plain.split(/\s+/).filter(Boolean).length : 0,
          };
        } catch {
          return { entry: chapter, markdown: "", words: 0 };
        }
      }),
    );
    return { book, chapters: loaded, options: DEFAULT_EXPORT_OPTIONS };
  }, [book, chapters]);

  const openReading = async () => {
    setReading(await exportChapters());
  };
  const openExport = async () => {
    setExportInput(await exportChapters());
  };

  if (active) {
    return (
      <div className={focus ? "book-view book-view--focus" : "book-view"}>
        <main className="book-main book-main--writing">
          <ChapterEditor
            key={active.id}
            book={book}
            chapter={active}
            chapters={chapters}
            onBack={() => {
              setFocus(false);
              onCloseChapter();
            }}
            onFocusChange={setFocus}
            onChanged={onChanged}
            onDeleted={() => {
              onCloseChapter();
              onChanged();
            }}
          />
        </main>

        <ReadingView open={reading !== null} input={reading} onClose={() => setReading(null)} />
        <ExportDialog open={exportInput !== null} input={exportInput} onClose={() => setExportInput(null)} />
      </div>
    );
  }

  return (
    <div className="book-view">
      <main className="book-main">
        <div className="book-home">
          <div className="book-topbar">
            <span className="book-crumb">Livros / {book.name}</span>
            <span className="spacer" />
            {pending.length > 0 ? (
              <button type="button" className="pending-link" onClick={() => setPendingOpen(true)}>
                {countLabel(pending.length, "pendente", "pendentes")}
              </button>
            ) : null}
            <button type="button" className="button button--ghost button--small" onClick={() => void openReading()}>
              Ler
            </button>
            <button
              type="button"
              className="button button--primary button--small"
              onClick={() => void openExport()}
            >
              Exportar
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={onOpenSettings}
              aria-label="Configurações do livro"
              title="Configurações do livro"
            >
              <SettingsIcon size={14} />
            </button>
          </div>

          <div className="book-head">
            <div
              className="book-cover"
              style={{
                backgroundColor: book.color || "var(--color-accent)",
                ...(book.color ? { color: coverInk(book.color) } : {}),
              }}
            >
              <span>{book.subtitle || "Livro"}</span>
              <b>{book.name}</b>
              <span>{book.author || ""}</span>
            </div>
            <div className="book-head-info">
              <h2 className="book-title">{book.name}</h2>
              <p className="book-sub">
                {book.subtitle ? `${book.subtitle} · ` : ""}
                {book.book_status === "done"
                  ? "final"
                  : book.book_status === "revising"
                    ? "revisão"
                    : "rascunho"}
              </p>
              {book.author ? <p className="book-author">por {book.author}</p> : null}
              {book.synopsis ? <p className="book-synopsis">{book.synopsis}</p> : null}
              <div className="book-chips">
                <span className="chip chip--static">{countLabel(chapterCount, "capítulo", "capítulos")}</span>
                <span className="chip chip--static">{countLabel(partCount, "parte", "partes")}</span>
                <span className="chip chip--static">{countLabel(totalWords, "palavra", "palavras")}</span>
                {goal > 0 ? <span className="chip chip--static">meta {formatWords(goal)}</span> : null}
              </div>
            </div>
          </div>

          {goal > 0 ? (
            <div className="book-progress-row">
              <span>
                {formatWords(totalWords)} / {formatWords(goal)}
              </span>
              <span className="book-bar-track">
                <i style={{ width: `${percent}%` }} />
              </span>
              <span>{Math.round(percent)}%</span>
            </div>
          ) : (
            <div className="book-progress-row book-progress-row--plain">
              <span>{formatWords(totalWords)} palavras</span>
            </div>
          )}

          {next ? (
            <button type="button" className="book-continue" onClick={() => openChapter(next.id)}>
              <i className={"status-dot status-dot--" + (next.chapter_status || "draft")} />
              <span>
                Continuar no <b>Capítulo {chapterNumber(chapters, next.id)} · {next.title || "Sem título"}</b>
              </span>
              <span className="book-continue-arrow" aria-hidden="true">
                →
              </span>
            </button>
          ) : null}

          {loading ? (
            <p className="muted book-empty">Carregando...</p>
          ) : chapters.length === 0 ? (
            <div className="book-empty">
              <p className="muted">Nenhum capítulo</p>
              <button type="button" className="button" onClick={() => onCreateChapter("chapter")}>
                Começar o primeiro capítulo
              </button>
            </div>
          ) : null}

          <div className="book-add-row">
            <button type="button" onClick={() => onCreateChapter("chapter")}>
              + Capítulo
            </button>
            <button type="button" onClick={() => onCreateChapter("part")}>
              + Parte
            </button>
            <button type="button" onClick={() => onCreateChapter("front")}>
              + Frontispício
            </button>
            <button type="button" onClick={() => onCreateChapter("back")}>
              + Posfácio
            </button>
          </div>
        </div>
      </main>

      <ReadingView open={reading !== null} input={reading} onClose={() => setReading(null)} />
      <ExportDialog open={exportInput !== null} input={exportInput} onClose={() => setExportInput(null)} />

      {pendingOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPendingOpen(false)}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Capítulos pendentes">
            <h2 className="modal-title">Pendentes</h2>
            <ul className="pending-list">
              {pending.map(([entryId, draft]) => {
                const chapter = chapters.find((item) => item.id === entryId);
                return (
                  <li key={entryId}>
                    <button
                      type="button"
                      className="pending-row"
                      onClick={() => {
                        setPendingOpen(false);
                        openChapter(entryId);
                      }}
                    >
                      <span>{chapter?.title || "Sem título"}</span>
                      <span className="pending-state">{draft.state}</span>
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Descartar rascunho"
                      onClick={async () => {
                        await clearDraft(entryId);
                        await loadPending();
                      }}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
