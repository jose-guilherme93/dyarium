import { useCallback, useEffect, useRef, useState } from "react";
import type { Block, PartialBlock } from "@blocknote/core";
import { api } from "../api";
import { NotesEditor, mediaRefs, type MediaRef, type NotesEditorHandle } from "../editor/NotesEditor";
import { formatDateTime, formatDuration } from "../lib/format";
import type { Analysis, Attachment, Audio, EntityKind, Entry, Revision } from "../types";
import { Spinner, isBusy, statusLabel } from "./Status";
import { TagEditor } from "./TagEditor";
import { useToast } from "./Toasts";
import { CheckIcon, ChevronIcon, ImageIcon, LinkIcon, MicIcon, MoreIcon, PinIcon, PlusIcon, SparkIcon, TrashIcon } from "./icons";

interface NoteEditorProps {
  entryId: string;
  refreshKey: number;
  failureReason?: string;
  progress?: { stage: string; done: number; total: number };
  onChanged: () => void;
  onDeleted: () => void;
  onOpenEntity: (kind: EntityKind, name: string) => void;
  onOpenEntry: (id: string) => void;
  onCreateChild: (parentId: string) => void;
}

const FONTS = [
  { id: "default", label: "Padrao", preview: "inherit" },
  { id: "serif", label: "Serifada", preview: "var(--font-serif)" },
  { id: "mono", label: "Monoespacada", preview: "var(--font-mono)" },
];

function sentimentText(label?: string): string {
  switch (label) {
    case "positivo":
      return "Positivo";
    case "negativo":
      return "Negativo";
    case "neutro":
      return "Neutro";
    default:
      return "Sem rotulo";
  }
}

function processingText(
  progress: { stage: string; done: number; total: number } | undefined,
  status?: string,
): string {
  if (progress?.stage === "analyzing") {
    return progress.total > 1
      ? `Analisando... trecho ${Math.min(progress.done + 1, progress.total)} de ${progress.total}`
      : "Analisando...";
  }
  if (progress?.stage === "summarizing") {
    return "Gerando o resumo final...";
  }
  switch (status) {
    case "queued":
      return "Na fila...";
    case "transcribing":
      return "Transcrevendo o audio...";
    case "analyzing":
      return "Analisando...";
    default:
      return "Processando...";
  }
}

// blocksText concatenates every inline text of a BlockNote document.
function blocksText(value: unknown): string {
  let out = "";
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (typeof record.text === "string") {
        out += `${record.text} `;
      }
      for (const key of Object.keys(record)) {
        walk(record[key]);
      }
    }
  };
  walk(value);
  return out.replace(/\s+/g, " ").trim();
}

function wordsOf(document: unknown): string[] {
  return blocksText(document).toLowerCase().split(/\s+/).filter(Boolean);
}

// diffWords is a simple multiset diff: which words were added and removed
// between two versions of the document.
function diffWords(oldDoc: unknown, newDoc: unknown): { added: string[]; removed: string[] } {
  const oldWords = wordsOf(oldDoc);
  const newWords = wordsOf(newDoc);
  const count = (arr: string[]) => {
    const map = new Map<string, number>();
    for (const word of arr) {
      map.set(word, (map.get(word) ?? 0) + 1);
    }
    return map;
  };
  const oldCount = count(oldWords);
  const newCount = count(newWords);

  const added: string[] = [];
  const usedInNew = new Map<string, number>();
  for (const word of newWords) {
    const used = usedInNew.get(word) ?? 0;
    if (used < (oldCount.get(word) ?? 0)) {
      usedInNew.set(word, used + 1);
    } else {
      added.push(word);
    }
  }

  const removed: string[] = [];
  const usedInOld = new Map<string, number>();
  for (const word of oldWords) {
    const used = usedInOld.get(word) ?? 0;
    if (used < (newCount.get(word) ?? 0)) {
      usedInOld.set(word, used + 1);
    } else {
      removed.push(word);
    }
  }
  return { added: clean(added), removed: clean(removed) };
}

// clean keeps only meaningful tokens (letters/digits) and removes duplicates so
// the history reads like a simple diff.
function clean(words: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of words) {
    const token = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!token || seen.has(token)) {
      continue;
    }
    seen.add(token);
    out.push(token);
  }
  return out;
}

interface HistoryDay {
  day: string;
  added: string[];
  removed: string[];
}

function dayOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso.slice(0, 10);
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDay(day: string): string {
  const [year, month, dayNumber] = day.split("-");
  if (!year || !month || !dayNumber) {
    return day;
  }
  return `${dayNumber}/${month}/${year}`;
}

// buildHistory groups the note's revisions by day and returns one simple diff
// per day, so the history is not flooded with every autosave.
function buildHistory(revisions: Revision[], current: unknown): HistoryDay[] {
  if (revisions.length === 0) {
    return [];
  }
  // Chronological snapshots (oldest first): the state before each update, then
  // the current state.
  const states: Array<{ at: string; document: unknown }> = [];
  for (let i = revisions.length - 1; i >= 0; i--) {
    states.push({ at: revisions[i].created_at, document: revisions[i].document });
  }
  states.push({ at: new Date().toISOString(), document: current });

  const ranges = new Map<string, { oldest: number; newest: number }>();
  states.forEach((state, index) => {
    const day = dayOf(state.at);
    const range = ranges.get(day);
    if (!range) {
      ranges.set(day, { oldest: index, newest: index });
    } else {
      range.newest = index;
    }
  });

  return [...ranges.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, range]) => {
      const { added, removed } = diffWords(states[range.oldest].document, states[range.newest].document);
      return { day, added, removed };
    });
}

// NoteEditor is one note: a single document (text, audio, images interleaved)
// with an on-demand right-hand panel for properties and AI insights.
export function NoteEditor({
  entryId,
  refreshKey,
  failureReason,
  progress,
  onChanged,
  onDeleted,
  onOpenEntity,
  onOpenEntry,
  onCreateChild,
}: NoteEditorProps) {
  const { notify } = useToast();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [media, setMedia] = useState<MediaRef[]>([]);
  const [images, setImages] = useState<Attachment[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [initialBody, setInitialBody] = useState<PartialBlock[] | undefined>(undefined);
  const [bodyLoaded, setBodyLoaded] = useState(false);
  const [busy, setBusy] = useState<"analyze" | "retranscribe" | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const [asideOpen, setAsideOpen] = useState(false);
  const [asidePinned, setAsidePinned] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [fullWidth, setFullWidth] = useState<boolean>(() => {
    try {
      return localStorage.getItem("dyarium.noteWidth") === "full";
    } catch {
      return false;
    }
  });
  const [font, setFont] = useState<string>(() => {
    try {
      return localStorage.getItem("dyarium.noteFont") ?? "default";
    } catch {
      return "default";
    }
  });
  const noteIdRef = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const notesRef = useRef<NotesEditorHandle | null>(null);
  const mountedRefresh = useRef(refreshKey);

  // Grow the title textarea to fit its content (the title wraps like Notion).
  useEffect(() => {
    const el = titleRef.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 44)}px`;
  }, [title, entry]);

  const loadFull = useCallback(async () => {
    setError("");
    setBodyLoaded(false);
    noteIdRef.current = null;
    const [entryRes, analysisRes, notesRes, imagesRes] = await Promise.allSettled([
      api.getEntry(entryId),
      api.getAnalysis(entryId),
      api.listNotes(entryId),
      api.listAttachments(entryId),
    ]);
    if (entryRes.status !== "fulfilled") {
      setError(entryRes.reason instanceof Error ? entryRes.reason.message : "falha ao carregar a nota");
      return;
    }
    const loaded = entryRes.value;
    setEntry(loaded);
    setTitle(loaded.title || loaded.original_filename || "");
    setAnalysis(analysisRes.status === "fulfilled" ? analysisRes.value : null);
    const images = imagesRes.status === "fulfilled" ? imagesRes.value.attachments ?? [] : [];
    setImages(images);
    setMedia(mediaRefs(loaded, images));
    const note = notesRes.status === "fulfilled" ? notesRes.value.notes?.[0] : undefined;
    if (note) {
      noteIdRef.current = note.id;
      setNoteId(note.id);
      setInitialBody((note.document as PartialBlock[]) ?? undefined);
    } else {
      noteIdRef.current = null;
      setNoteId(null);
      setInitialBody(undefined);
    }
    setBodyLoaded(true);
  }, [entryId]);

  const loadLight = useCallback(async () => {
    const [entryRes, analysisRes, imagesRes] = await Promise.allSettled([
      api.getEntry(entryId),
      api.getAnalysis(entryId),
      api.listAttachments(entryId),
    ]);
    if (entryRes.status === "fulfilled") {
      setEntry(entryRes.value);
    }
    setAnalysis(analysisRes.status === "fulfilled" ? analysisRes.value : null);
    if (imagesRes.status === "fulfilled") {
      setImages(imagesRes.value.attachments ?? []);
    }
  }, [entryId]);

  useEffect(() => {
    void loadFull();
  }, [loadFull]);

  useEffect(() => {
    if (refreshKey === mountedRefresh.current) {
      return;
    }
    void loadLight();
  }, [refreshKey, loadLight]);

  // Load the note's revision history when the properties panel is open.
  useEffect(() => {
    if (!asideOpen || !noteId) {
      setRevisions([]);
      return;
    }
    let active = true;
    api
      .listRevisions(noteId)
      .then((result) => {
        if (active) {
          setRevisions(result.revisions ?? []);
        }
      })
      .catch(() => {
        if (active) {
          setRevisions([]);
        }
      });
    return () => {
      active = false;
    };
  }, [asideOpen, noteId]);

  const status = entry?.status;
  const running = isBusy(status);

  useEffect(() => {
    if (status === "ready" || status === "transcribed" || status === "enriched" || status === "failed") {
      setBusy(null);
    }
  }, [status]);

  const saveBody = useCallback(
    async (document: unknown) => {
      setSaving("saving");
      try {
        if (noteIdRef.current) {
          await api.updateNote(noteIdRef.current, "", document);
        } else {
          const created = await api.createNote(entryId, "", document);
          noteIdRef.current = created.id;
        }
        setSaving("saved");
        window.setTimeout(() => setSaving((value) => (value === "saved" ? "idle" : value)), 1500);
      } catch (err) {
        setSaving("idle");
        setError(err instanceof Error ? err.message : "falha ao salvar a nota");
        notify("Nao foi possivel salvar a nota", "error");
      }
    },
    [entryId, notify],
  );

  const handleBodyChange = useCallback(
    (blocks: Block[]) => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
      }
      saveTimer.current = window.setTimeout(() => void saveBody(blocks), 800);
    },
    [saveBody],
  );

  const saveTitle = async () => {
    if (!entry || title === entry.title) {
      return;
    }
    try {
      await api.patchEntry(entry.id, { title });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao salvar o titulo");
      notify("Nao foi possivel salvar o titulo", "error");
    }
  };

  const retranscribe = async () => {
    setBusy("retranscribe");
    setError("");
    try {
      await api.retranscribe(entryId);
      notify("Transcricao enfileirada", "info");
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha");
      notify("Nao foi possivel retranscrever", "error");
      setBusy(null);
    }
  };

  const analyze = async () => {
    setBusy("analyze");
    setError("");
    setAsideOpen(true);
    try {
      await api.analyze(entryId);
      notify("Analise iniciada", "info");
    } catch (err) {
      if (err instanceof Error && err.message.includes("desligada")) {
        notify("A analise esta desligada. Ative em Configuracao.", "error");
      } else {
        notify(err instanceof Error ? err.message : "falha ao analisar", "error");
      }
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!entry) {
      return;
    }
    if (!window.confirm("Apagar esta nota e os audios? Esta acao nao pode ser desfeita.")) {
      return;
    }
    try {
      await api.deleteEntry(entry.id);
      notify("Nota apagada", "success");
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao apagar");
      notify("Nao foi possivel apagar", "error");
    }
  };

  const chooseFont = (value: string) => {
    setFont(value);
    try {
      localStorage.setItem("dyarium.noteFont", value);
    } catch {
      // ignore storage errors
    }
  };

  const toggleFullWidth = () => {
    setFullWidth((value) => {
      const next = !value;
      try {
        localStorage.setItem("dyarium.noteWidth", next ? "full" : "default");
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  if (!entry) {
    return (
      <div className="note">
        <div className="note-doc">
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-block" />
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    );
  }

  const audios = entry.audios ?? [];
  const audioMap = new Map<string, Audio>(audios.map((audio) => [audio.id, audio]));
  const processing = running || busy !== null;
  const spokenText = audios.map((audio) => audio.transcript?.text ?? "").join(" ");
  const noteText = `${blocksText(initialBody)} ${spokenText}`.replace(/\s+/g, " ").trim();
  const words = noteText ? noteText.split(/\s+/).length : 0;
  const chars = noteText.length;
  const mediaBytes =
    audios.reduce((sum, audio) => sum + audio.size_bytes, 0) +
    images.reduce((sum, image) => sum + image.size_bytes, 0);
  const totalBytes = mediaBytes + new TextEncoder().encode(noteText).length;

  const history = buildHistory(revisions, initialBody);

  const insights = processing ? (
    <div className="analysis-loading">
      <div className="analysis-loading-head">
        <Spinner />
        <span>{processingText(progress, status)}</span>
      </div>
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line" style={{ width: "85%" }} />
    </div>
  ) : analysis ? (
    <div className="insights">
      <p>
        Sentimento: <strong>{sentimentText(analysis.sentiment_label)}</strong>{" "}
        <span className="muted">({Number(analysis.sentiment ?? 0).toFixed(2)})</span>
      </p>
      {analysis.summary && <p className="insight-summary">{analysis.summary}</p>}

      {analysis.themes && analysis.themes.length > 0 && (
        <div className="analysis-block">
          <h4>Temas</h4>
          <ul className="chips">
            {analysis.themes.map((theme) => (
              <li key={theme.name}>
                <button type="button" className="chip-button" onClick={() => onOpenEntity("theme", theme.name)}>
                  {theme.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {analysis.people_detail && analysis.people_detail.length > 0 && (
        <div className="analysis-block">
          <h4>Pessoas</h4>
          <ul className="chips">
            {analysis.people_detail.map((person) => (
              <li key={person.name}>
                <button type="button" className="chip-button" onClick={() => onOpenEntity("person", person.name)}>
                  {person.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {analysis.places_detail && analysis.places_detail.length > 0 && (
        <div className="analysis-block">
          <h4>Lugares</h4>
          <ul className="chips">
            {analysis.places_detail.map((place) => (
              <li key={place.name}>
                <button type="button" className="chip-button" onClick={() => onOpenEntity("place", place.name)}>
                  {place.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {analysis.key_moments && analysis.key_moments.length > 0 && (
        <div className="analysis-block">
          <h4>Momentos</h4>
          <ul className="moments">
            {analysis.key_moments.map((moment, index) => (
              <li key={index}>
                <span className="timestamp">{formatDuration(moment.start_ms / 1000)}</span>
                {moment.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  ) : (
    <p className="muted">Sem analise ainda.</p>
  );

  return (
    <div
      className={`note note-font--${font}${fullWidth ? " note--wide" : ""}${asideOpen ? " note--aside-open" : ""}${
        asidePinned ? " note--aside-pinned" : ""
      }`}
    >
      <div
        className="note-doc"
        onClick={() => {
          if (asideOpen && !asidePinned) {
            setAsideOpen(false);
          }
        }}
      >
        <div className="note-topbar">
          <span className="save-state muted">
            {saving === "saving" ? "salvando" : saving === "saved" ? "salvo" : ""}
          </span>
          <div className="note-head-actions">
            <button
              type="button"
              className="icon-button"
              onClick={() => notesRef.current?.addImage()}
              aria-label="Anexar imagem"
              title="Anexar imagem"
            >
              <ImageIcon size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => notesRef.current?.addAudio()}
              aria-label="Gravar ou enviar audio"
              title="Audio"
            >
              <MicIcon size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => notesRef.current?.openLink()}
              aria-label="Link para nota"
              title="Link para nota"
            >
              <LinkIcon size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => onCreateChild(entry.id)}
              aria-label="Nova subnota"
              title="Nova subnota"
            >
              <PlusIcon size={16} />
            </button>
            {audios.length > 0 && (
              <button type="button" onClick={() => void retranscribe()} disabled={busy === "retranscribe" || running}>
                {busy === "retranscribe" ? <Spinner /> : null} Retranscrever
              </button>
            )}
            <div className="note-options">
              <button
                type="button"
                className="icon-button"
                onClick={() => setOptionsOpen((value) => !value)}
                aria-label="Opcoes da nota"
                aria-expanded={optionsOpen}
              >
                <MoreIcon size={16} />
              </button>
              {optionsOpen && (
                <>
                  <div className="menu-backdrop" onClick={() => setOptionsOpen(false)} />
                  <div className="menu" role="menu">
                    <button
                      type="button"
                      className="menu-item"
                      role="menuitemcheckbox"
                      aria-checked={fullWidth}
                      onClick={toggleFullWidth}
                    >
                      <span>Largura total</span>
                      {fullWidth && <CheckIcon size={14} />}
                    </button>
                    <button
                      type="button"
                      className="menu-item"
                      role="menuitemcheckbox"
                      aria-checked={asideOpen}
                      onClick={() => {
                        setAsideOpen((value) => !value);
                        setOptionsOpen(false);
                      }}
                    >
                      <span>Propriedades e insights</span>
                      {asideOpen && <CheckIcon size={14} />}
                    </button>
                    <div className="menu-label">Fonte</div>
                    {FONTS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={option.id === font}
                        className={option.id === font ? "menu-item menu-item--active" : "menu-item"}
                        onClick={() => {
                          chooseFont(option.id);
                          setOptionsOpen(false);
                        }}
                      >
                        <span style={{ fontFamily: option.preview }}>{option.label}</span>
                        {option.id === font && <CheckIcon size={14} />}
                      </button>
                    ))}
                    <div className="menu-label">Nota</div>
                    <button
                      type="button"
                      className="menu-item menu-item--danger"
                      onClick={() => {
                        setOptionsOpen(false);
                        void remove();
                      }}
                    >
                      <span>Apagar nota</span>
                      <TrashIcon size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <textarea
          ref={titleRef}
          className="note-title"
          rows={1}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void saveTitle()}
          placeholder="Sem titulo"
          aria-label="Titulo da nota"
        />

        <p className="note-byline">
          <span>{formatDateTime(entry.recorded_at ?? entry.created_at)}</span>
          <span className="note-status">{statusLabel(status)}</span>
          {entry.duration_seconds > 0 && <span>{formatDuration(entry.duration_seconds)}</span>}
        </p>

        {failureReason && <div className="banner banner--error">Falha: {failureReason}</div>}
        {error && <p className="error">{error}</p>}

        <div className="note-body">
          {bodyLoaded && (
            <NotesEditor
              ref={notesRef}
              entryId={entry.id}
              initialContent={initialBody}
              media={media}
              audios={audioMap}
              onChange={handleBodyChange}
              onMediaAdded={() => {
                void loadLight();
                onChanged();
              }}
              onOpenEntry={onOpenEntry}
            />
          )}
        </div>
      </div>

      {asideOpen && (
        <aside className="note-aside" aria-label="Propriedades e insights">
          <div className="aside-actions">
            <strong className="aside-title">Propriedades</strong>
            <div className="aside-actions-buttons">
              <button
                type="button"
                className={asidePinned ? "icon-button icon-button--active" : "icon-button"}
                onClick={() => setAsidePinned((value) => !value)}
                aria-label={asidePinned ? "Desafixar propriedades" : "Fixar propriedades"}
                aria-pressed={asidePinned}
              >
                <PinIcon size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => setAsideOpen(false)}
                aria-label="Fechar propriedades"
              >
                <ChevronIcon size={16} />
              </button>
            </div>
          </div>

          <section className="aside-block">
            <h3>Detalhes</h3>
            <dl className="props">
              <dt>Criada</dt>
              <dd>{formatDateTime(entry.created_at)}</dd>
              <dt>Origem</dt>
              <dd>{entry.source === "text" ? "Texto" : "Audio"}</dd>
              <dt>Audios</dt>
              <dd>{audios.length}</dd>
              <dt>Palavras</dt>
              <dd>{words}</dd>
              <dt>Caracteres</dt>
              <dd>{chars}</dd>
              <dt>Tamanho</dt>
              <dd>
                {totalBytes} bytes ({(totalBytes / 1048576).toFixed(2)} MB)
              </dd>
              <dt>Status</dt>
              <dd>{statusLabel(status)}</dd>
            </dl>
            <div className="aside-tags">
              <TagEditor entryId={entry.id} onChanged={onChanged} />
            </div>
          </section>

          <section className="aside-block">
            <h3>Historico</h3>
            <p className="muted history-created">Criada em {formatDateTime(entry.created_at)}</p>
            {history.length === 0 ? (
              <p className="muted">Sem alteracoes registradas.</p>
            ) : (
              <ul className="history">
                {history.map((item, index) => (
                  <li key={index}>
                    <span className="history-when">{formatDay(item.day)}</span>
                    {item.added.length === 0 && item.removed.length === 0 ? (
                      <span className="muted">reorganizado</span>
                    ) : (
                      <>
                        {item.added.length > 0 && (
                          <p className="history-added">+ {item.added.slice(0, 40).join(" ")}</p>
                        )}
                        {item.removed.length > 0 && (
                          <p className="history-removed">- {item.removed.slice(0, 40).join(" ")}</p>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="aside-block">
            <div className="aside-block-head">
              <h3>Insights</h3>
              <button type="button" className="primary small" onClick={() => void analyze()} disabled={busy === "analyze" || running}>
                {busy === "analyze" ? <Spinner /> : <SparkIcon size={14} />} Analisar
              </button>
            </div>
            {insights}
          </section>
        </aside>
      )}

    </div>
  );
}

export default NoteEditor;
