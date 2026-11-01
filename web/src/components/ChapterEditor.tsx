import { useCallback, useEffect, useRef, useState } from "react";
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
import { chapterNumber, formatWords } from "../lib/books";
import { blocknoteMarkdownToBlocks, markdownToPlain } from "../editor/blocknoteMarkdown";
import { NotesEditor } from "../editor/NotesEditor";
import { useToast } from "./Toasts";
import type { ChapterStatus, Entry, Note, Notebook, Revision } from "../types";

interface ChapterEditorProps {
  book: Notebook;
  chapter: Entry;
  chapters: Entry[];
  onBack: () => void;
  onOpenChapters?: () => void;
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

/** Editor do capitulo: texto, imagem, autosave, rascunho offline e conflito. */
export function ChapterEditor({
  book,
  chapter,
  chapters,
  onBack,
  onOpenChapters,
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
  const [status, setStatus] = useState<Exclude<ChapterStatus, "">>(
    (chapter.chapter_status as Exclude<ChapterStatus, "">) || "draft",
  );
  const [editorEpoch, setEditorEpoch] = useState(0);

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
  if (!autosaveRef.current) {
    autosaveRef.current = createAutosave((value) => saveRef.current(value));
  }
  const latestMarkdown = useRef("");

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
      const [loaded, notes, draft] = await Promise.all([
        api.getEntry(chapter.id).catch(() => chapter),
        api.listNotes(chapter.id).catch(() => ({ notes: [] as Note[] })),
        readDraft(chapter.id),
      ]);
      if (!active) return;
      apply(loaded, notes.notes?.[0], draft);
      if (draft && draft.state !== "conflict") {
        autosaveRef.current?.schedule(draft.markdown);
      }
    })();
    return () => {
      active = false;
    };
  }, [chapter.id, apply]);

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
    return () => {
      active = false;
    };
  }, [panelOpen, noteId]);

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
    [entry.id, notify, onChanged, persistDraft, title],
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void autosaveRef.current?.flush();
      }
      if (event.key === "Escape") {
        if (conflict) return;
        if (focus) updateFocus(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [conflict, focus, updateFocus]);

  const saveTitle = async () => {
    const next = title.trim() || chapter.title;
    if (next === entry.title) return;
    try {
      const result = await api.patchEntry(entry.id, {
        title: next,
        versions: { title: titleVersionRef.current },
      });
      titleVersionRef.current = result.versions?.title ?? titleVersionRef.current;
      setEntry((current) => ({ ...current, title: next }));
      onChanged();
    } catch {
      notify("Não foi possível salvar o título.", "error");
    }
  };

  const patchChapter = async (patch: {
    chapter_status?: Exclude<ChapterStatus, "">;
    chapter_goal_words?: number;
    chapter_synopsis?: string;
  }) => {
    try {
      await api.patchEntry(entry.id, patch);
      setEntry((current) => ({ ...current, ...patch }));
      onChanged();
    } catch {
      notify("Não foi possível salvar o capítulo.", "error");
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
  const diff = conflict?.showDiff ? diffSets(conflict.server, conflict.local) : null;
  let partTitle = "";
  for (const item of [...chapters].sort(
    (left, right) => (left.chapter_position ?? 0) - (right.chapter_position ?? 0),
  )) {
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
              ? "salvo neste dispositivo"
              : saving === "offline"
                ? "sem rede"
                : saving === "conflict"
                  ? "conflito"
                  : draftState === "local"
                    ? "local"
                    : "salvo neste dispositivo"}
        </span>
        <span className="chapter-count">
          {formatWords(total)}
          {goalWords > 0 ? ` / ${formatWords(goalWords)}` : ""}
        </span>
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() => updateFocus(!focus)}
        >
          Foco
        </button>
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() => setPanelOpen((value) => !value)}
          aria-expanded={panelOpen}
        >
          Painel
        </button>
      </header>

      <div className={panelOpen && !focus ? "chapter-columns chapter-columns--panel" : "chapter-columns"}>
        <article className="chapter-page">
          <div className="chapter-overline">{overline}</div>
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
              entryId={entry.id}
              initialContent={initialBody}
              onChange={onChange}
              imageDefault="bw"
              onMediaAdded={onChanged}
            />
          ) : (
            <p className="muted">Carregando o capítulo...</p>
          )}
        </article>

        {panelOpen && !focus ? (
          <aside className="chapter-panel" aria-label="Painel do capítulo">
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
                rows={5}
                value={synopsis}
                placeholder="O que acontece neste capítulo"
                onChange={(event) => setSynopsis(event.target.value)}
                onBlur={() => void patchChapter({ chapter_synopsis: synopsis })}
              />
            </section>
            <section>
              <h3 className="panel-label">Versões</h3>
              {revisions.length === 0 ? (
                <p className="muted">Sem versões.</p>
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
                    return markdown.split(/(\s+)/).map((part, index) => {
                      const token = part.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
                      if (diff.added.has(token)) return <mark key={index}>{part}</mark>;
                      if (diff.removed.has(token)) return <del key={index}>{part}</del>;
                      return <span key={index}>{part}</span>;
                    });
                  })()}
                </div>
              ) : null}
            </section>
            <button
              type="button"
              className="button button--ghost"
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
                {conflict.local.split(/(\s+)/).map((part, index) => {
                  const token = part.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
                  if (diff.added.has(token)) return <mark key={index}>{part}</mark>;
                  if (diff.removed.has(token)) return <del key={index}>{part}</del>;
                  return <span key={index}>{part}</span>;
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
