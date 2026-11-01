import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { PartialBlock } from "@blocknote/core";
import { api, isConflict } from "../api";
import { createAutosave, type Autosave } from "../lib/autosave";
import {
  backupConflict,
  clearDraft,
  readDraft,
  writeDraft,
  type ChapterDraft,
} from "../lib/bookDrafts";
import {
  beatsOf,
  bookBodyFont,
  bookPage,
  chapterNumber,
  formatWords,
  orderedChapters,
} from "../lib/books";
import { blocknoteMarkdownToBlocks, markdownToPlain } from "../editor/blocknoteMarkdown";
import { NotesEditor, type EditorFormat, type NotesEditorHandle } from "../editor/NotesEditor";
import { ImageIcon, LinkIcon, MicIcon } from "./icons";
import { groupLineRects, paginate } from "../lib/pagination";
import { useToast } from "./Toasts";
import type {
  BookEntity,
  ChapterStatus,
  Entry,
  Link,
  Note,
  Notebook,
  Revision,
  WritingRhythm,
} from "../types";

interface ChapterEditorProps {
  book: Notebook;
  chapter: Entry;
  chapters: Entry[];
  onBack: () => void;
  onOpenChapters?: () => void;
  onOpenChapter?: (id: string) => void;
  /** Cria o capitulo logo depois deste (Ctrl+Enter). */
  onCreateAfter?: () => void;
  onFocusChange?: (focus: boolean) => void;
  onChanged: () => void;
  onDeleted: () => void;
}

interface ConflictState {
  local: string;
  server: string;
  serverVersion: string;
  serverNoteId: string;
  showDiff: boolean;
}

const STATUS_ORDER: Array<{ value: Exclude<ChapterStatus, "">; label: string }> = [
  { value: "draft", label: "Rascunho" },
  { value: "revising", label: "Revisão" },
  { value: "done", label: "Final" },
];

function words(markdown: string): number {
  const plain = markdownToPlain(markdown);
  return plain ? plain.split(/\s+/).filter(Boolean).length : 0;
}

function diffSets(oldText: string, newText: string): { added: Set<string>; removed: Set<string> } {
  const tokens = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean);
  const count = (list: string[]) => {
    const map = new Map<string, number>();
    for (const token of list) map.set(token, (map.get(token) ?? 0) + 1);
    return map;
  };
  const oldCount = count(tokens(oldText));
  const newCount = count(tokens(newText));
  const added = new Set<string>();
  const removed = new Set<string>();
  for (const [token, value] of newCount) {
    if (value > (oldCount.get(token) ?? 0)) added.add(token);
  }
  for (const [token, value] of oldCount) {
    if (value > (newCount.get(token) ?? 0)) removed.add(token);
  }
  return { added, removed };
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function UndoGlyph() {
  return (
    <svg className="chapter-fmt-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 4 3 7l3 3" />
      <path d="M3 7h6a4 4 0 0 1 0 8H7" />
    </svg>
  );
}

function RedoGlyph() {
  return (
    <svg className="chapter-fmt-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="m10 4 3 3-3 3" />
      <path d="M13 7H7a4 4 0 0 0 0 8h2" />
    </svg>
  );
}

/** Editor do capitulo: folha do livro, autosave, rascunho offline e painel. */
export function ChapterEditor({
  book,
  chapter,
  chapters,
  onBack,
  onOpenChapters,
  onOpenChapter,
  onCreateAfter,
  onFocusChange,
  onChanged,
  onDeleted,
}: ChapterEditorProps) {
  const { notify } = useToast();
  const [entry, setEntry] = useState<Entry>(chapter);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [initialBody, setInitialBody] = useState<PartialBlock[] | undefined>(undefined);
  const [bodyLoaded, setBodyLoaded] = useState(false);
  const [markdown, setMarkdown] = useState("");
  const [title, setTitle] = useState(chapter.title);
  const [draftState, setDraftState] = useState<ChapterDraft["state"] | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "offline" | "conflict">("idle");
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [revisionDiff, setRevisionDiff] = useState<Revision | null>(null);
  const [synopsis, setSynopsis] = useState(chapter.chapter_synopsis ?? "");
  const [goalWords, setGoalWords] = useState(chapter.chapter_goal_words ?? 0);
  const [beats, setBeats] = useState<string[]>(beatsOf(chapter));
  const [notes, setNotes] = useState(chapter.chapter_notes ?? "");
  const [status, setStatus] = useState<Exclude<ChapterStatus, "">>(
    (chapter.chapter_status as Exclude<ChapterStatus, "">) || "draft",
  );
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [links, setLinks] = useState<Link[]>([]);
  const [refURL, setRefURL] = useState("");
  const [refLabel, setRefLabel] = useState("");
  const [refBusy, setRefBusy] = useState(false);
  const [entities, setEntities] = useState<BookEntity[]>([]);
  const [rhythm, setRhythm] = useState<WritingRhythm | null>(null);
  const [pageTotal, setPageTotal] = useState(1);
  const sheetRef = useRef<HTMLElement | null>(null);

  const updateFocus = useCallback(
    (value: boolean) => {
      setFocus(value);
      onFocusChange?.(value);
    },
    [onFocusChange],
  );

  const noteIdRef = useRef<string | null>(null);
  const bodyVersionRef = useRef("");
  const titleVersionRef = useRef("");
  const mountedRef = useRef("");
  const dirtyRef = useRef(false);
  const conflictRef = useRef(false);
  const saveRef = useRef<(value: unknown) => Promise<void>>(async () => {});
  const autosaveRef = useRef<Autosave | null>(null);
  const editorRef = useRef<NotesEditorHandle | null>(null);
  const rhythmAt = useRef(0);
  const chapterIDRef = useRef(chapter.id);
  if (!autosaveRef.current) {
    autosaveRef.current = createAutosave((value) => saveRef.current(value));
  }
  const latestMarkdown = useRef("");

  const refreshRhythm = useCallback(
    (force = false) => {
      if (!force && Date.now() - rhythmAt.current < 4000) return;
      rhythmAt.current = Date.now();
      void api
        .getWritingRhythm(book.id)
        .then((value) => {
          if (chapterIDRef.current === chapter.id) setRhythm(value);
        })
        .catch(() => undefined);
    },
    [book.id, chapter.id],
  );

  useEffect(() => {
    chapterIDRef.current = chapter.id;
  }, [chapter.id]);

  const persistDraft = useCallback(
    (value: string, state: ChapterDraft["state"]) => {
      const draft: ChapterDraft = {
        markdown: value,
        baseVersion: bodyVersionRef.current,
        noteId: noteIdRef.current ?? "",
        updatedAt: Date.now(),
        state,
      };
      setDraftState(state);
      void writeDraft(entry.id, draft);
    },
    [entry.id],
  );

  const apply = useCallback(
    (loaded: Entry, note: Note | undefined, draft: ChapterDraft | undefined) => {
      setEntry(loaded);
      setTitle(loaded.title ?? "");
      titleVersionRef.current = loaded.versions?.title ?? "";
      // Sem rede o corpo pode nao vir, mas o rascunho guarda a identidade da
      // nota: sem ela a primeira gravacao criaria uma segunda nota.
      const effectiveNoteId = note?.id ?? draft?.noteId ?? null;
      noteIdRef.current = effectiveNoteId;
      setNoteId(effectiveNoteId);
      bodyVersionRef.current = note?.body_version ?? draft?.baseVersion ?? "";
      const server = note?.content_markdown ?? "";
      const chosen = draft?.markdown ?? server;
      mountedRef.current = chosen;
      latestMarkdown.current = chosen;
      setMarkdown(chosen);
      setInitialBody(chosen ? blocknoteMarkdownToBlocks(chosen) : undefined);
      setBodyLoaded(true);
      if (draft) {
        setDraftState(draft.state);
        if (draft.state === "conflict") {
          conflictRef.current = true;
          setSaving("conflict");
        }
      } else {
        setDraftState(null);
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const [loaded, notesList, draft] = await Promise.all([
        api.getEntry(chapter.id).catch(() => chapter),
        api.listNotes(chapter.id).catch(() => ({ notes: [] as Note[] })),
        readDraft(chapter.id),
      ]);
      if (!active) return;
      apply(loaded, notesList.notes?.[0], draft);
      if (draft && draft.state !== "conflict") {
        autosaveRef.current?.schedule(draft.markdown);
      }
    })();
    return () => {
      active = false;
    };
  }, [chapter.id, apply]);

  useEffect(() => {
    refreshRhythm(true);
  }, [refreshRhythm]);

  useEffect(() => {
    let active = true;
    void api
      .getBookEntities(book.id)
      .then((result) => {
        if (active) setEntities(result.entities ?? []);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [book.id]);

  useEffect(() => {
    if (!panelOpen) {
      setRevisions([]);
      return;
    }
    let active = true;
    if (noteId) {
      api
        .listRevisions(noteId)
        .then((result) => {
          if (active) setRevisions(result.revisions ?? []);
        })
        .catch(() => undefined);
    }
    void api
      .listLinks(entry.id)
      .then((result) => {
        if (active) setLinks(result.links ?? []);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [panelOpen, noteId, entry.id]);

  const saveBody = useCallback(
    async (value: unknown) => {
      const text = String(value ?? "");
      if (conflictRef.current) return;
      setSaving("saving");
      try {
        if (noteIdRef.current) {
          const saved = await api.updateNote(noteIdRef.current, text, bodyVersionRef.current);
          bodyVersionRef.current = saved.versions?.body ?? bodyVersionRef.current;
        } else {
          const created = await api.createNote(entry.id, title, text);
          noteIdRef.current = created.id;
          setNoteId(created.id);
          bodyVersionRef.current = created.body_version ?? "";
        }
        mountedRef.current = text;
        dirtyRef.current = false;
        setSaving("saved");
        setDraftState(null);
        await clearDraft(entry.id);
        refreshRhythm();
        window.setTimeout(() => setSaving((current) => (current === "saved" ? "idle" : current)), 1500);
        onChanged();
      } catch (err) {
        if (isConflict(err) && noteIdRef.current) {
          // No livro o conflito nunca e resolvido em silencio: o texto local e o
          // do servidor ficam os dois recuperaveis.
          conflictRef.current = true;
          setSaving("conflict");
          persistDraft(text, "conflict");
          try {
            const latest = await api.listNotes(entry.id);
            const server = latest.notes?.[0];
            setConflict({
              local: text,
              server: server?.content_markdown ?? "",
              serverVersion: server?.body_version ?? "",
              serverNoteId: server?.id ?? "",
              showDiff: false,
            });
          } catch {
            setConflict({
              local: text,
              server: "",
              serverVersion: "",
              serverNoteId: "",
              showDiff: false,
            });
          }
          return;
        }
        setSaving("offline");
        persistDraft(text, "offline");
        notify("Sem rede. O capítulo está guardado neste navegador.", "error");
      }
    },
    [entry.id, notify, onChanged, persistDraft, refreshRhythm, title],
  );

  useEffect(() => {
    saveRef.current = saveBody;
  }, [saveBody]);

  const onChange = useCallback(
    (value: string) => {
      latestMarkdown.current = value;
      setMarkdown(value);
      if (value === mountedRef.current) return;
      dirtyRef.current = true;
      persistDraft(value, navigator.onLine ? "local" : "offline");
      autosaveRef.current?.schedule(value);
    },
    [persistDraft],
  );

  // Grava o pendente ao esconder ou fechar a aba. O autosave cobre o resto.
  useEffect(() => {
    const flush = () => {
      if (dirtyRef.current) {
        void autosaveRef.current?.flush();
      }
    };
    const hide = () => {
      if (dirtyRef.current && latestMarkdown.current) {
        persistDraft(latestMarkdown.current, navigator.onLine ? "local" : "offline");
      }
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [persistDraft]);

  // Reproducao da fila: ao voltar a rede e a cada 30 s enquanto houver pendencia.
  useEffect(() => {
    const retry = () => {
      if (conflictRef.current || !dirtyRef.current) return;
      void autosaveRef.current?.flush();
    };
    const online = () => {
      setSaving("idle");
      retry();
    };
    window.addEventListener("online", online);
    const timer = window.setInterval(() => {
      if (navigator.onLine) retry();
    }, 30000);
    return () => {
      window.removeEventListener("online", online);
      window.clearInterval(timer);
    };
  }, []);

  const page = bookPage(book);

  const measurePages = useCallback(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const start = sheet.querySelector(".chapter-overline");
    const end = sheet.querySelector(".bn-editor");
    if (!start || !end) return;
    const textHeight = page.heightPx - page.marginPx * 2;
    if (textHeight <= 0) return;
    // Com as quebras antigas escondidas, a medida volta ao fluxo continuo: as
    // linhas por pagina nao dependem do espaco ja inserido entre as folhas.
    sheet.classList.add("is-measuring-pages");
    try {
      const range = document.createRange();
      range.setStartBefore(start);
      range.setEndAfter(end);
      const raw = Array.from(range.getClientRects())
        .filter((rect) => rect.width > 1 && rect.height > 1 && rect.height < 160)
        .map((rect) => ({ top: rect.top, bottom: rect.bottom }));
      const lines = groupLineRects(raw);
      const breaks = lines.length > 0 ? paginate(lines, textHeight) : [];
      editorRef.current?.setPageBreaks(breaks, textHeight);
      setPageTotal(breaks.length + 1);
    } finally {
      sheet.classList.remove("is-measuring-pages");
    }
  }, [page.heightPx, page.marginPx, page.widthPx, page.bodyPx, page.leading, book.body_font]);

  // A quebra e medida depois da pintura: mudou o texto, a fonte carregou ou a
  // janela mudou de tamanho, a linha de cada pagina e recalculada.
  useEffect(() => {
    if (!bodyLoaded) return;
    let timer = 0;
    const run = () => {
      timer = 0;
      measurePages();
    };
    const schedule = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(run, 240);
    };
    schedule();
    window.addEventListener("resize", schedule);
    void document.fonts?.ready.then(schedule).catch(() => undefined);
    return () => {
      window.removeEventListener("resize", schedule);
      if (timer) window.clearTimeout(timer);
    };
  }, [bodyLoaded, markdown, measurePages]);

  const ordered = useMemo(() => orderedChapters(chapters), [chapters]);
  const index = ordered.findIndex((item) => item.id === entry.id);
  const previous = index > 0 ? ordered[index - 1] : null;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void autosaveRef.current?.flush();
        return;
      }
      if (mod && event.key === "Enter") {
        event.preventDefault();
        onCreateAfter?.();
        return;
      }
      if (mod && event.key === "PageDown") {
        event.preventDefault();
        if (next && onOpenChapter) onOpenChapter(next.id);
        return;
      }
      if (mod && event.key === "PageUp") {
        event.preventDefault();
        if (previous && onOpenChapter) onOpenChapter(previous.id);
        return;
      }
      if (event.key === "Escape") {
        if (conflict) return;
        if (focus) updateFocus(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [conflict, focus, next, previous, onCreateAfter, onOpenChapter, updateFocus]);

  const saveTitle = async () => {
    const nextTitle = title.trim() || chapter.title;
    if (nextTitle === entry.title) return;
    try {
      const result = await api.patchEntry(entry.id, {
        title: nextTitle,
        versions: { title: titleVersionRef.current },
      });
      titleVersionRef.current = result.versions?.title ?? titleVersionRef.current;
      setEntry((current) => ({ ...current, title: nextTitle }));
      onChanged();
    } catch {
      notify("Não foi possível salvar o título.", "error");
    }
  };

  const patchChapter = async (patch: {
    chapter_status?: Exclude<ChapterStatus, "">;
    chapter_goal_words?: number;
    chapter_synopsis?: string;
    chapter_beats?: string;
    chapter_notes?: string;
  }) => {
    try {
      await api.patchEntry(entry.id, patch);
      setEntry((current) => ({ ...current, ...patch }));
      onChanged();
    } catch {
      notify("Não foi possível salvar o capítulo.", "error");
    }
  };

  const commitBeats = (list: string[]) => {
    setBeats(list);
    void patchChapter({ chapter_beats: list.join("\n") });
  };

  const addReference = async () => {
    const url = refURL.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) {
      notify("Referência precisa de um endereço http ou https.", "error");
      return;
    }
    setRefBusy(true);
    try {
      const created = await api.createLink(entry.id, {
        url,
        label: refLabel.trim() || domainOf(url),
      });
      setLinks((current) => [...current, created]);
      setRefURL("");
      setRefLabel("");
    } catch {
      notify("Não foi possível salvar a referência.", "error");
    } finally {
      setRefBusy(false);
    }
  };

  const removeReference = async (id: string) => {
    try {
      await api.deleteLink(id);
      setLinks((current) => current.filter((link) => link.id !== id));
    } catch {
      notify("Não foi possível remover a referência.", "error");
    }
  };

  const analyzeChapter = async () => {
    try {
      await api.analyze(entry.id);
      notify("Capítulo enviado para análise.", "info");
    } catch {
      notify("Não foi possível analisar o capítulo.", "error");
    }
  };

  const keepMine = async () => {
    if (!conflict) return;
    try {
      const saved = await api.updateNote(conflict.serverNoteId || noteIdRef.current || "", conflict.local);
      bodyVersionRef.current = saved.versions?.body ?? bodyVersionRef.current;
      mountedRef.current = conflict.local;
      conflictRef.current = false;
      dirtyRef.current = false;
      setConflict(null);
      setSaving("saved");
      setDraftState(null);
      await clearDraft(entry.id);
      onChanged();
    } catch {
      notify("Não foi possível gravar o seu texto.", "error");
    }
  };

  const useServer = async () => {
    if (!conflict) return;
    await backupConflict(entry.id, {
      markdown: conflict.local,
      noteId: noteIdRef.current ?? "",
      createdAt: Date.now(),
    });
    const server = conflict.server;
    bodyVersionRef.current = conflict.serverVersion;
    mountedRef.current = server;
    latestMarkdown.current = server;
    setMarkdown(server);
    setInitialBody(server ? blocknoteMarkdownToBlocks(server) : undefined);
    setEditorEpoch((value) => value + 1);
    conflictRef.current = false;
    dirtyRef.current = false;
    setConflict(null);
    setSaving("idle");
    setDraftState(null);
    await clearDraft(entry.id);
  };

  const total = words(markdown);
  const bookType = bookBodyFont(book);
  const diff = conflict?.showDiff ? diffSets(conflict.server, conflict.local) : null;
  const sheetStyle = {
    "--sheet-width": `${page.widthPx}px`,
    "--sheet-min": `${page.heightPx}px`,
    "--sheet-margin": `${page.marginPx}px`,
    "--page-margin": `${page.marginPx}px`,
    "--sheet-body": `${page.bodyPx}px`,
    "--sheet-leading": String(page.leading),
    "--book-font": bookType.css,
  } as CSSProperties;

  let partTitle = "";
  for (const item of ordered) {
    if (item.chapter_kind === "part") partTitle = item.title;
    if (item.id === entry.id) break;
  }
  const overline =
    chapter.chapter_kind === "chapter"
      ? `Capítulo ${chapterNumber(chapters, entry.id)}${partTitle ? ` · ${partTitle}` : ""}`
      : chapter.chapter_kind === "part"
        ? "Parte"
        : chapter.chapter_kind === "front"
          ? "Frontispício"
          : "Posfácio";

  const applyFormat = (action: EditorFormat) => editorRef.current?.format(action);
  const dailyGoal = book.daily_goal_words ?? rhythm?.daily_goal ?? 0;
  const today = rhythm?.today ?? 0;

  return (
    <div className={focus ? "chapter-workspace chapter-workspace--focus" : "chapter-workspace"}>
      <header className="chapter-top">
        <button type="button" className="button button--ghost button--small" onClick={onBack} aria-label="Voltar ao livro" title="Voltar">
          ←
        </button>
        {onOpenChapters ? (
          <button
            type="button"
            className="button button--ghost button--small chapter-mobile-only"
            onClick={onOpenChapters}
          >
            Capítulos
          </button>
        ) : null}
        <span className="chapter-book-title">{book.name}</span>
        <span className={"save-state save-state--" + saving} aria-live="polite">
          <i className="save-dot" />
          {saving === "saving"
            ? "salvando"
            : saving === "saved"
              ? "salvo"
              : saving === "offline"
                ? "sem rede"
                : saving === "conflict"
                  ? "conflito"
                  : draftState === "local"
                    ? "local"
                    : "salvo"}
        </span>
        <span className="spacer" />
        {dailyGoal > 0 ? (
          <span className="chapter-today" title="Palavras escritas hoje e a meta diária do livro">
            hoje {formatWords(today)} / {formatWords(dailyGoal)}
            <i className="chapter-meter">
              <b style={{ width: `${Math.min(100, (today / dailyGoal) * 100)}%` }} />
            </i>
          </span>
        ) : null}
        <span className="chapter-count">
          {formatWords(total)}
          {goalWords > 0 ? ` / ${formatWords(goalWords)}` : ""} palavras
          <span className="chapter-pages-count">
            {" · "}
            {pageTotal} {pageTotal === 1 ? "página" : "páginas"}
          </span>
        </span>
        <span className="chapter-nav">
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => previous && onOpenChapter?.(previous.id)}
            disabled={!previous}
            aria-label="Capítulo anterior"
            title="Capítulo anterior"
          >
            ‹
          </button>
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => next && onOpenChapter?.(next.id)}
            disabled={!next}
            aria-label="Próximo capítulo"
            title="Próximo capítulo"
          >
            ›
          </button>
        </span>
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() => updateFocus(!focus)}
          aria-pressed={focus}
        >
          Foco
        </button>
        <button
          type="button"
          className="button button--ghost button--small chapter-panel-toggle"
          onClick={() => setPanelOpen((value) => !value)}
          aria-expanded={panelOpen}
        >
          Painel
        </button>
      </header>

      <div className="chapter-fmt" role="toolbar" aria-label="Formatação do capítulo">
        <button type="button" onClick={() => applyFormat("undo")} aria-label="Desfazer" title="Desfazer (Ctrl+Z)">
          <UndoGlyph />
        </button>
        <button type="button" onClick={() => applyFormat("redo")} aria-label="Refazer" title="Refazer (Ctrl+Shift+Z)">
          <RedoGlyph />
        </button>
        <i className="chapter-fmt-rule" />

        <select
          className="chapter-style"
          aria-label="Estilo do parágrafo"
          value=""
          onChange={(event) => {
            if (event.target.value) applyFormat(event.target.value as EditorFormat);
          }}
        >
          <option value="">Estilo</option>
          <option value="body">Corpo</option>
          <option value="section">Seção</option>
          <option value="subtitle">Subtítulo</option>
          <option value="quote">Citação</option>
        </select>
        <i className="chapter-fmt-rule" />

        <button type="button" className="chapter-fmt-bold" onClick={() => applyFormat("bold")} aria-label="Negrito" title="Negrito (Ctrl+B)">
          B
        </button>
        <button type="button" className="chapter-fmt-italic" onClick={() => applyFormat("italic")} aria-label="Itálico" title="Itálico (Ctrl+I)">
          I
        </button>
        <button type="button" className="chapter-fmt-underline" onClick={() => applyFormat("underline")} aria-label="Sublinhado" title="Sublinhado (Ctrl+U)">
          U
        </button>
        <button type="button" className="chapter-fmt-strike" onClick={() => applyFormat("strike")} aria-label="Riscado" title="Riscado">
          S
        </button>
        <i className="chapter-fmt-rule" />

        <button type="button" className="chapter-fmt-list" onClick={() => applyFormat("bullet")} aria-label="Lista com marcadores" title="Lista com marcadores">
          •
        </button>
        <button type="button" className="chapter-fmt-list" onClick={() => applyFormat("numbered")} aria-label="Lista numerada" title="Lista numerada">
          1.
        </button>
        <i className="chapter-fmt-rule" />

        <select
          className="chapter-align"
          aria-label="Alinhamento do parágrafo"
          value=""
          onChange={(event) => {
            if (event.target.value) applyFormat(event.target.value as EditorFormat);
          }}
        >
          <option value="">Alinhar</option>
          <option value="align-left">Esquerda</option>
          <option value="align-center">Centro</option>
          <option value="align-right">Direita</option>
          <option value="align-justify">Justificar</option>
        </select>
        <i className="chapter-fmt-rule" />

        <button type="button" onClick={() => editorRef.current?.openLink()} aria-label="Link para nota" title="Link para outra nota">
          <LinkIcon size={14} />
        </button>
        <button type="button" onClick={() => editorRef.current?.addImage()} aria-label="Imagem" title="Inserir imagem">
          <ImageIcon size={14} />
        </button>
        <button type="button" onClick={() => editorRef.current?.addAudio()} aria-label="Áudio" title="Inserir áudio">
          <MicIcon size={14} />
        </button>
        <i className="chapter-fmt-rule" />

        <button type="button" className="chapter-fmt-scene" onClick={() => applyFormat("scene")} aria-label="Separador de cena" title="Separador de cena">
          ***
        </button>
      </div>

      <div className="chapter-columns">
        <div className="chapter-scroll">
          <article className="chapter-sheet" style={sheetStyle} ref={sheetRef}>
          <p className="chapter-overline">{overline}</p>
          <input
            className="chapter-title"
            value={title}
            aria-label="Título do capítulo"
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void saveTitle();
                event.currentTarget.blur();
              }
            }}
          />
            {bodyLoaded ? (
              <NotesEditor
                key={editorEpoch}
                ref={editorRef}
                entryId={entry.id}
                initialContent={initialBody}
                onChange={onChange}
                imageDefault="bw"
                hideSideMenu
                onMediaAdded={onChanged}
              />
            ) : (
              <p className="muted">Carregando o capítulo...</p>
            )}
          </article>
        </div>

        {panelOpen && !focus ? (
          <aside className="chapter-drawer" aria-label="Painel do capítulo">
            <div className="chapter-drawer-head">
              <strong>
                {chapter.chapter_kind === "chapter" ? `Capítulo ${chapterNumber(chapters, entry.id)}` : overline}
                {title.trim() ? ` · ${title.trim()}` : ""}
              </strong>
              <button
                type="button"
                className="icon-button"
                onClick={() => setPanelOpen(false)}
                aria-label="Fechar painel"
              >
                ×
              </button>
            </div>

            <section>
              <h3 className="panel-label">Status</h3>
              <div className="chapter-statuses" role="group" aria-label="Status do capítulo">
                {STATUS_ORDER.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={status === option.value ? "chapter-status-option is-on" : "chapter-status-option"}
                    aria-pressed={status === option.value}
                    onClick={() => {
                      setStatus(option.value);
                      void patchChapter({ chapter_status: option.value });
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h3 className="panel-label">Meta</h3>
              <input
                type="number"
                min={0}
                className="panel-input"
                value={goalWords || ""}
                placeholder="sem meta"
                aria-label="Meta de palavras do capítulo"
                onChange={(event) => setGoalWords(Math.max(0, Number(event.target.value) || 0))}
                onBlur={() => void patchChapter({ chapter_goal_words: goalWords })}
              />
              {goalWords > 0 ? (
                <div className="book-progress-row book-progress-row--chapter">
                  <span className="book-bar-track">
                    <i style={{ width: `${Math.min(100, (total / goalWords) * 100)}%` }} />
                  </span>
                  <span>{Math.round(Math.min(100, (total / goalWords) * 100))}%</span>
                </div>
              ) : null}
            </section>

            <section>
              <h3 className="panel-label">Sinopse</h3>
              <textarea
                className="panel-input"
                rows={3}
                value={synopsis}
                placeholder="O que acontece neste capítulo"
                onChange={(event) => setSynopsis(event.target.value)}
                onBlur={() => void patchChapter({ chapter_synopsis: synopsis })}
              />
            </section>

            <section>
              <h3 className="panel-label">Beats</h3>
              {beats.length === 0 ? null : (
                <ul className="chapter-beats">
                  {beats.map((beat, beatIndex) => (
                    <li key={beatIndex}>
                      <i className="beat-dot" />
                      <input
                        value={beat}
                        aria-label={`Beat ${beatIndex + 1}`}
                        onChange={(event) => {
                          const list = [...beats];
                          list[beatIndex] = event.target.value;
                          setBeats(list);
                        }}
                        onBlur={() => commitBeats(beats.filter((item) => item.trim()))}
                      />
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remover beat ${beatIndex + 1}`}
                        onClick={() => commitBeats(beats.filter((_, i) => i !== beatIndex))}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                className="chapter-add-beat"
                onClick={() => {
                  setBeats((current) => [...current, ""]);
                }}
              >
                + Beat
              </button>
            </section>

            <section>
              <h3 className="panel-label">Anotações</h3>
              <textarea
                className="panel-input"
                rows={4}
                value={notes}
                placeholder="Ideias, pesquisa e lembretes deste capítulo"
                onChange={(event) => setNotes(event.target.value)}
                onBlur={() => void patchChapter({ chapter_notes: notes })}
              />
            </section>

            <section>
              <h3 className="panel-label">Referências</h3>
              {links.filter((link) => !link.to_entry_id).length === 0 ? (
                <p className="muted panel-empty">Nenhuma referência.</p>
              ) : (
                <ul className="chapter-refs">
                  {links
                    .filter((link) => !link.to_entry_id)
                    .map((link) => (
                      <li key={link.id}>
                        <a href={link.url} target="_blank" rel="noreferrer noopener">
                          <span>{link.label || domainOf(link.url)}</span>
                          <i>{domainOf(link.url)}</i>
                        </a>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Remover referência"
                          onClick={() => void removeReference(link.id)}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                </ul>
              )}
              <div className="chapter-ref-form">
                <input
                  className="panel-input"
                  value={refURL}
                  placeholder="https://"
                  aria-label="Endereço da referência"
                  onChange={(event) => setRefURL(event.target.value)}
                />
                <input
                  className="panel-input"
                  value={refLabel}
                  placeholder="Rótulo"
                  aria-label="Rótulo da referência"
                  onChange={(event) => setRefLabel(event.target.value)}
                />
                <button type="button" className="button button--ghost button--small" onClick={() => void addReference()} disabled={refBusy}>
                  Adicionar
                </button>
              </div>
            </section>

            <section>
              <h3 className="panel-label">Aparece em</h3>
              {entities.length === 0 ? (
                <div className="panel-empty">
                  <p className="muted">A análise ainda não leu este livro.</p>
                  <button type="button" className="button button--ghost button--small" onClick={() => void analyzeChapter()}>
                    Analisar capítulo
                  </button>
                </div>
              ) : (
                <div className="chapter-entities">
                  {entities.slice(0, 12).map((entity) => (
                    <span key={`${entity.kind}-${entity.name}`} className={`entity-chip entity-chip--${entity.kind}`}>
                      <b>{entity.name}</b> · {entity.mentions}
                    </span>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="panel-label">Versões</h3>
              {revisions.length === 0 ? (
                <p className="muted panel-empty">Sem versões.</p>
              ) : (
                <ul className="chapter-versions">
                  {revisions.slice(0, 12).map((revision) => (
                    <li key={revision.id}>
                      <button
                        type="button"
                        className="chapter-version"
                        onClick={() =>
                          setRevisionDiff((current) => (current?.id === revision.id ? null : revision))
                        }
                        aria-expanded={revisionDiff?.id === revision.id}
                      >
                        <span>{new Date(revision.created_at).toLocaleString("pt-BR")}</span>
                        <span className="muted">
                          {formatWords(words(revision.content_markdown))} palavras
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {revisionDiff ? (
                <div className="revision-diff" aria-label="Diferença da versão">
                  {(() => {
                    const diff = diffSets(revisionDiff.content_markdown, markdown);
                    return markdown.split(/(\s+)/).map((part, partIndex) => {
                      const token = part.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
                      if (diff.added.has(token)) return <mark key={partIndex}>{part}</mark>;
                      if (diff.removed.has(token)) return <del key={partIndex}>{part}</del>;
                      return <span key={partIndex}>{part}</span>;
                    });
                  })()}
                </div>
              ) : null}
            </section>

            <button
              type="button"
              className="button button--ghost chapter-delete"
              onClick={async () => {
                if (!window.confirm("Excluir este capítulo? Ele vai para a Lixeira.")) return;
                try {
                  await api.deleteEntry(entry.id);
                  await clearDraft(entry.id);
                  onDeleted();
                } catch {
                  notify("Não foi possível excluir o capítulo.", "error");
                }
              }}
            >
              Excluir capítulo
            </button>
          </aside>
        ) : null}
      </div>

      {conflict ? (
        <div className="conflict-sheet" role="dialog" aria-modal="true" aria-label="Conflito de edição">
          <div className="conflict-card">
            <h3 className="modal-title">O capítulo mudou em outro lugar</h3>
            <div className="conflict-cols">
              <div>
                <span className="panel-label">Seu texto</span>
                <strong>{formatWords(words(conflict.local))} palavras</strong>
              </div>
              <div>
                <span className="panel-label">Servidor</span>
                <strong>{formatWords(words(conflict.server))} palavras</strong>
              </div>
            </div>
            {conflict.showDiff && diff ? (
              <p className="conflict-diff">
                {conflict.local.split(/(\s+)/).map((part, partIndex) => {
                  const token = part.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
                  if (diff.added.has(token)) return <mark key={partIndex}>{part}</mark>;
                  if (diff.removed.has(token)) return <del key={partIndex}>{part}</del>;
                  return <span key={partIndex}>{part}</span>;
                })}
              </p>
            ) : null}
            <div className="modal-actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setConflict((current) => (current ? { ...current, showDiff: !current.showDiff } : current))}
              >
                Ver diferenças
              </button>
              <button type="button" className="button button--ghost" onClick={() => void useServer()}>
                Usar o do servidor
              </button>
              <button type="button" className="button" onClick={() => void keepMine()}>
                Manter o meu
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
