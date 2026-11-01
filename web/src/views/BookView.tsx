import { useCallback, useEffect, useMemo, useState } from "react";
import { api, blobToDataURL, coverUrl } from "../api";
import { ChapterEditor } from "../components/ChapterEditor";
import { ExportDialog } from "../components/ExportDialog";
import { ReadingView } from "../components/ReadingView";
import {
  PAGE_SIZES,
  beatsOf,
  bookBodyFont,
  bookPage,
  chapterGroups,
  chapterNumber,
  continueChapter,
  countLabel,
  coverInk,
  estimatePages,
  formatWords,
  orderedChapters,
  pace,
  progress as clampProgress,
  weekdayInitial,
  wordsPerPage,
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
import type { ChapterKind, Entry, Notebook, WritingRhythm } from "../types";

interface BookViewProps {
  book: Notebook;
  chapters: Entry[];
  loading: boolean;
  activeChapterId: string | null;
  onOpenChapter: (id: string) => void;
  onCloseChapter: () => void;
  onCreateChapter: (kind: ChapterKind) => void;
  /** Cria um capitulo logo depois do atual (Ctrl+Enter no editor). */
  onCreateChapterAfter?: (currentId: string) => void;
  onReorderChapter?: (sourceId: string, targetId: string) => void;
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
  onCreateChapterAfter,
  onReorderChapter,
  onChanged,
  onOpenSettings,
}: BookViewProps) {
  const [reading, setReading] = useState<BookExportInput | null>(null);
  const [exportInput, setExportInput] = useState<BookExportInput | null>(null);
  const [pending, setPending] = useState<Array<[string, ChapterDraft]>>([]);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const [lastChapterId, setLastChapterId] = useState("");
  const [tab, setTab] = useState<"cover" | "structure">("cover");
  const [rhythm, setRhythm] = useState<WritingRhythm | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

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

  useEffect(() => {
    let active = true;
    void api
      .getWritingRhythm(book.id)
      .then((value) => {
        if (active) setRhythm(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [book.id, chapters.length, activeChapterId]);

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
  const page = bookPage(book);
  const dailyGoal = book.daily_goal_words ?? rhythm?.daily_goal ?? 0;
  const today = rhythm?.today ?? 0;
  const goalPace = pace(totalWords, goal, rhythm?.deadline ?? book.deadline ?? "");
  const groups = useMemo(() => chapterGroups(chapters), [chapters]);
  const statusCounts = { draft: 0, revising: 0, done: 0 };
  let beatsTotal = 0;
  for (const chapter of chapters) {
    if (chapter.chapter_kind === "part") continue;
    const key = (chapter.chapter_status || "draft") as keyof typeof statusCounts;
    if (key in statusCounts) statusCounts[key] += 1;
    beatsTotal += beatsOf(chapter).length;
  }
  const pagesEstimate = estimatePages(totalWords, page);
  const perPage = wordsPerPage(page);
  const rhythmDays = rhythm?.days ?? [];
  const rhythmMax = Math.max(1, ...rhythmDays.map((day) => day.words));
  const todayKey = rhythmDays[rhythmDays.length - 1]?.day ?? "";
  const lastWrite = book.last_entry_at
    ? new Date(book.last_entry_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
    : "";
  const statusLabel =
    book.book_status === "done" ? "final" : book.book_status === "revising" ? "revisão" : "rascunho";
  const bookType = bookBodyFont(book);
  const metaLine = [
    statusLabel,
    lastWrite ? `última escrita em ${lastWrite}` : "",
    `${PAGE_SIZES[page.size].short} · margem ${page.marginMm} mm`,
  ]
    .filter(Boolean)
    .join(" · ");

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
    let coverDataUrl: string | undefined;
    if (book.has_cover) {
      try {
        coverDataUrl = await blobToDataURL(await api.getCover(book.id));
      } catch {
        // sem capa legivel: o PDF segue com a pagina de titulo
      }
    }
    return { book, chapters: loaded, options: DEFAULT_EXPORT_OPTIONS, coverDataUrl };
  }, [book, chapters]);

  const openReading = async () => {
    setReading(await exportChapters());
  };
  const openExport = async () => {
    setExportInput(await exportChapters());
  };

  const progressRow = (
    <div className="book-progress-row">
      {goal > 0 ? (
        <>
          <span className="book-progress-numbers">
            {formatWords(totalWords)} / {formatWords(goal)} palavras
          </span>
          <span className="book-bar-track">
            <i style={{ width: `${percent}%` }} />
          </span>
          <span>{Math.round(percent)}%</span>
        </>
      ) : (
        <span className="book-progress-numbers">{formatWords(totalWords)} palavras</span>
      )}
      {dailyGoal > 0 ? (
        <span className="book-today" title="Palavras escritas hoje e a meta diária">
          hoje {formatWords(today)} / {formatWords(dailyGoal)}
          <i className="book-today-track">
            <b style={{ width: `${Math.min(100, (today / dailyGoal) * 100)}%` }} />
          </i>
        </span>
      ) : null}
      {goalPace ? (
        <span
          className="book-pace"
          title={
            (rhythm?.deadline || book.deadline)
              ? `Ritmo necessário até ${new Date(`${(rhythm?.deadline || book.deadline)}T12:00:00`).toLocaleDateString("pt-BR")}`
              : "Ritmo necessário para chegar ao prazo"
          }
        >
          {goalPace.remaining > 0
            ? `faltam ${formatWords(goalPace.remaining)} · ${formatWords(goalPace.perDay)}/dia`
            : "meta batida"}
        </span>
      ) : null}
    </div>
  );

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
            onOpenChapter={(id) => openChapter(id)}
            onCreateAfter={onCreateChapterAfter ? () => onCreateChapterAfter(active.id) : undefined}
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

          <div className="book-tabs" role="tablist" aria-label="Visões do livro">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "cover"}
              className={tab === "cover" ? "book-tab is-on" : "book-tab"}
              onClick={() => setTab("cover")}
            >
              Capa
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "structure"}
              className={tab === "structure" ? "book-tab is-on" : "book-tab"}
              onClick={() => setTab("structure")}
            >
              Estrutura
            </button>
          </div>

          {tab === "cover" ? (
            <>
              <div className="book-plate">
                <div
                  className={book.has_cover ? "book-plate-cover book-plate-cover--photo" : "book-plate-cover"}
                  style={{
                    aspectRatio: `${page.widthMm} / ${page.heightMm}`,
                    backgroundColor: book.color || "var(--color-accent)",
                    color: book.color ? coverInk(book.color) : "var(--color-bg)",
                  }}
                >
                  {book.has_cover ? (
                    <img
                      className="book-plate-cover-photo"
                      src={coverUrl(book.id, book.cover_updated_at)}
                      alt=""
                    />
                  ) : (
                    <>
                      <span className="book-plate-kind">Livro</span>
                      <span className="book-plate-cover-title" style={{ fontFamily: bookType.css }}>
                        {book.name}
                      </span>
                      <span className="book-plate-cover-foot">
                        {book.subtitle || book.author || ""}
                      </span>
                    </>
                  )}
                </div>

                <div className="book-plate-info">
                  <p className="book-plate-meta">{metaLine}</p>
                  <h2 className="book-plate-title" style={{ fontFamily: bookType.css }}>
                    {book.name}
                  </h2>
                  {book.author ? <p className="book-plate-byline">por {book.author}</p> : null}
                  {book.synopsis ? <p className="book-plate-synopsis">{book.synopsis}</p> : null}

                  <div className="book-plate-stats">
                    <div className="book-stat">
                      <b>{chapterCount}</b>
                      <span>{chapterCount === 1 ? "capítulo" : "capítulos"}</span>
                    </div>
                    <div className="book-stat">
                      <b>{partCount}</b>
                      <span>{partCount === 1 ? "parte" : "partes"}</span>
                    </div>
                    <div className="book-stat">
                      <b>{formatWords(totalWords)}</b>
                      <span>{totalWords === 1 ? "palavra" : "palavras"}</span>
                    </div>
                    <div className="book-stat" title={`Cerca de ${perPage} palavras por página`}>
                      <b>{totalWords > 0 ? `≈ ${formatWords(pagesEstimate)}` : "0"}</b>
                      <span>{pagesEstimate === 1 ? "página" : "páginas"}</span>
                    </div>
                  </div>

                  {goal > 0 ? (
                    <div className="book-plate-progress">
                      <span className="book-progress-numbers">
                        {formatWords(totalWords)} / {formatWords(goal)} palavras
                      </span>
                      <span className="book-bar-track">
                        <i style={{ width: `${percent}%` }} />
                      </span>
                      <span>{Math.round(percent)}%</span>
                      {goalPace ? (
                        <span
                          className="book-pace"
                          title={
                            rhythm?.deadline || book.deadline
                              ? `Ritmo necessário até ${new Date(`${rhythm?.deadline || book.deadline}T12:00:00`).toLocaleDateString("pt-BR")}`
                              : "Ritmo necessário para chegar ao prazo"
                          }
                        >
                          {goalPace.remaining > 0
                            ? `faltam ${formatWords(goalPace.remaining)} · ${formatWords(goalPace.perDay)}/dia`
                            : "meta batida"}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

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
                </div>
              </div>

              {!loading && chapters.length > 0 ? (
                <div className="book-plate-extras">
                  <section className="book-rhythm" aria-label="Ritmo dos últimos sete dias">
                    <div className="book-rhythm-head">
                      <span>Últimos 7 dias</span>
                      <b>
                        {dailyGoal > 0
                          ? `hoje ${formatWords(today)} / ${formatWords(dailyGoal)}`
                          : `hoje ${formatWords(today)}`}
                      </b>
                    </div>
                    <div className="book-rhythm-bars">
                      {rhythmDays.map((day) => (
                        <span
                          key={day.day}
                          className={day.day === todayKey ? "book-rhythm-day is-today" : "book-rhythm-day"}
                          title={`${new Date(`${day.day}T12:00:00`).toLocaleDateString("pt-BR")}: ${formatWords(day.words)} palavras`}
                        >
                          <span className="book-rhythm-track">
                            <i style={{ height: `${Math.max(2, (day.words / rhythmMax) * 100)}%` }} />
                          </span>
                          <span className="book-rhythm-day-label">{weekdayInitial(day.day)}</span>
                        </span>
                      ))}
                    </div>
                  </section>

                  <section className="book-status" aria-label="Estado dos capítulos">
                    <div className="book-rhythm-head">
                      <span>Capítulos</span>
                      <b>{beatsTotal > 0 ? countLabel(beatsTotal, "beat", "beats") : ""}</b>
                    </div>
                    <div className="book-status-row">
                      <i className="status-dot status-dot--draft" />
                      <b>{statusCounts.draft}</b>
                      <span>rascunho</span>
                    </div>
                    <div className="book-status-row">
                      <i className="status-dot status-dot--revising" />
                      <b>{statusCounts.revising}</b>
                      <span>revisão</span>
                    </div>
                    <div className="book-status-row">
                      <i className="status-dot status-dot--done" />
                      <b>{statusCounts.done}</b>
                      <span>finais</span>
                    </div>
                  </section>
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
            </>
          ) : (
            <>
              {progressRow}

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

              <div className="book-cards">
                {groups.map((group) => (
                  <div key={group.part?.id ?? "root"} className="book-card-group">
                    {group.part ? (
                      <button
                        type="button"
                        className="book-card book-card--part"
                        draggable
                        onDragStart={() => setDragging(group.part!.id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          if (dragging && onReorderChapter) onReorderChapter(dragging, group.part!.id);
                          setDragging(null);
                        }}
                        onClick={() => openChapter(group.part!.id)}
                      >
                        <span>Parte</span>
                        <b>{group.part.title || "Sem título"}</b>
                      </button>
                    ) : null}
                    {group.items.map((chapter) => (
                      <button
                        key={chapter.id}
                        type="button"
                        className="book-card"
                        draggable
                        onDragStart={() => setDragging(chapter.id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          if (dragging && onReorderChapter && dragging !== chapter.id) {
                            onReorderChapter(dragging, chapter.id);
                          }
                          setDragging(null);
                        }}
                        onClick={() => openChapter(chapter.id)}
                      >
                        <div className="book-card-top">
                          <span>
                            {chapter.chapter_kind === "chapter"
                              ? `${chapterNumber(chapters, chapter.id)}`
                              : chapter.chapter_kind === "front"
                                ? "F"
                                : "P"}
                          </span>
                          <i className="book-card-grip" aria-hidden="true">
                            ⋮⋮
                          </i>
                          <i
                            className={"status-dot status-dot--" + (chapter.chapter_status || "draft")}
                            aria-label={chapter.chapter_status || "rascunho"}
                          />
                        </div>
                        <span className="book-card-title">{chapter.title || "Sem título"}</span>
                        <span className="book-card-meta">
                          {formatWords(chapter.word_count ?? 0)} palavras
                          {beatsOf(chapter).length > 0 ? ` · ${countLabel(beatsOf(chapter).length, "beat", "beats")}` : ""}
                        </span>
                        {chapter.chapter_synopsis ? (
                          <span className="book-card-synopsis">{chapter.chapter_synopsis}</span>
                        ) : null}
                        {beatsOf(chapter).length > 0 ? (
                          <span className="book-card-beats" aria-label="Beats do capítulo">
                            {beatsOf(chapter)
                              .slice(0, 8)
                              .map((beat, beatIndex) => (
                                <i key={beatIndex} title={beat} />
                              ))}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ))}
                <button type="button" className="book-card book-card--add" onClick={() => onCreateChapter("chapter")}>
                  + Capítulo
                </button>
              </div>
            </>
          )}
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
