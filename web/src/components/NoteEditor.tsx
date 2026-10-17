import { useCallback, useEffect, useRef, useState } from "react";
import type { PartialBlock } from "@blocknote/core";
import { api, isConflict, type ConflictField } from "../api";
import { AudioTrack } from "./AudioTrack";
import { NotesEditor, type NotesEditorHandle } from "../editor/NotesEditor";
import { markdownToPlain, noteBlocksToMarkdown } from "../editor/blocknoteMarkdown";
import { markdownToNoteBlocks } from "../editor/markdownBlocks";
import { createAutosave, type Autosave } from "../lib/autosave";
import { formatDateTime, formatDuration } from "../lib/format";
import type { Analysis, Attachment, Audio, EntityKind, Entry, Note, Revision } from "../types";
import { Spinner, isBusy, statusLabel } from "./Status";
import { TagEditor } from "./TagEditor";
import { useToast } from "./Toasts";
import { CheckIcon, ChevronIcon, CodeIcon, ImageIcon, LinkIcon, MicIcon, MoreIcon, PlusIcon, SparkIcon, TrashIcon } from "./icons";

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

/** Revisao guardada no formato antigo (JSON de blocos), e nao markdown. */
function isLegacyBlockJson(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("[") && trimmed.endsWith("]");
}

// blocksToMarkdownText is the body as plain text, for counting and diffing. The
// blocks come from the markdown, so the round-trip goes through the same
// conversion the editor shows (and never through BlockNote JSON).
function blocksToMarkdownText(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return markdownToPlain(noteBlocksToMarkdown(value as Record<string, unknown>[]));
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

// diffWords is a simple multiset diff: which words were added and removed
// between two versions of the body.
function diffWords(oldText: string, newText: string): { added: string[]; removed: string[] } {
  const wordsOf = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean);
  const oldWords = wordsOf(oldText);
  const newWords = wordsOf(newText);
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
  // Instantaneos do corpo em markdown, do mais antigo para o mais novo: o estado
  // antes de cada gravacao e, por ultimo, o estado atual.
  const states: Array<{ at: string; markdown: string }> = [];
  for (let i = revisions.length - 1; i >= 0; i--) {
    // Revisao em JSON do BlockNote (notas anteriores a conversao): nao da para
    // comparar palavras com markdown, e poluir o historico com `type: paragraph`
    // ajuda ninguem.
    if (isLegacyBlockJson(revisions[i].content_markdown)) {
      continue;
    }
    states.push({ at: revisions[i].created_at, markdown: revisions[i].content_markdown });
  }
  states.push({ at: new Date().toISOString(), markdown: blocksToMarkdownText(current) });

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
      const { added, removed } = diffWords(states[range.oldest].markdown, states[range.newest].markdown);
      return { day, added, removed };
    });
}

/**
 * Corpo da nota como blocos do editor. O markdown e o formato canonico; o
 * `document` em JSON so aparece em nota ainda nao convertida.
 */
function noteBodyToBlocks(note: Note): PartialBlock[] | undefined {
  const markdown = note.content_markdown;
  if (typeof markdown === "string" && markdown.trim() !== "") {
    const blocks = markdownToNoteBlocks(markdown);
    return blocks.length > 0 ? blocks : undefined;
  }
  const legacy = note.document as PartialBlock[] | undefined;
  return Array.isArray(legacy) && legacy.length > 0 ? legacy : undefined;
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
  const noteTitleRef = useRef("");
  // Versoes lidas do servidor (ver docs/api.md): a gravacao so passa se a
  // versao do campo continuar igual.
  const bodyVersionRef = useRef("");
  const titleVersionRef = useRef("");
  // Markdown cru: fonte da verdade e a segunda visualizacao da nota.
  const [rawMarkdown, setRawMarkdown] = useState("");
  const [rawOpen, setRawOpen] = useState(false);
  // Conflito em aberto: o servidor recusou e o usuario escolhe.
  const [conflict, setConflict] = useState<{ fields: ConflictField[]; mine: string } | null>(null);
  const lastQueuedRef = useRef<string>("");
  const saveBodyRef = useRef<(document: unknown) => Promise<void>>(async () => {});
  const saveTitleRef = useRef<() => Promise<void>>(async () => {});
  const autosaveRef = useRef<Autosave | null>(null);
  if (!autosaveRef.current) {
    autosaveRef.current = createAutosave((document) => saveBodyRef.current(document));
  }
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
    const note = notesRes.status === "fulfilled" ? notesRes.value.notes?.[0] : undefined;
    const filled = note ? noteBodyToBlocks(note) : undefined;
    if (note) {
      noteIdRef.current = note.id;
      setNoteId(note.id);
      noteTitleRef.current = note.title ?? "";
    } else {
      noteIdRef.current = null;
      setNoteId(null);
      noteTitleRef.current = "";
    }
    // A versao do corpo lida agora: e o que o servidor compara na proxima
    // gravacao, para recusar o que mudou no celular em vez de sobrescrever.
    bodyVersionRef.current = note?.body_version ?? "";
    titleVersionRef.current = loaded.versions?.title ?? "";
    const markdown = note?.content_markdown ?? "";
    setRawMarkdown(markdown);
    setInitialBody(filled);
    lastQueuedRef.current = markdown;
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
    async (markdown: unknown) => {
      const text = String(markdown ?? "");
      setSaving("saving");
      try {
        const noteTitle = noteTitleRef.current;
        if (noteIdRef.current) {
          const saved = await api.updateNote(noteIdRef.current, text, bodyVersionRef.current);
          bodyVersionRef.current = saved.versions?.body ?? bodyVersionRef.current;
        } else {
          const created = await api.createNote(entryId, noteTitle, text);
          noteIdRef.current = created.id;
          setNoteId(created.id);
          bodyVersionRef.current = created.body_version ?? "";
        }
        setSaving("saved");
        window.setTimeout(() => setSaving((value) => (value === "saved" ? "idle" : value)), 1500);
      } catch (err) {
        setSaving("idle");
        if (isConflict(err)) {
          // O corpo mudou no celular: nada foi gravado. A escolha e do usuario.
          setConflict({ fields: err.fields, mine: text });
          return;
        }
        setError(err instanceof Error ? err.message : "falha ao salvar a nota");
        notify("Nao foi possivel salvar a nota", "error");
      }
    },
    [entryId, notify],
  );

  useEffect(() => {
    saveBodyRef.current = saveBody;
  }, [saveBody]);

  /** "Manter o meu": reenvia por cima, sem versao (a decisao ja foi do usuario). */
  const keepMine = useCallback(async () => {
    const pending = conflict;
    setConflict(null);
    if (!pending) return;
    if (pending.fields.includes("title")) {
      await api.patchEntry(entryId, { title: pending.mine }).catch(() => undefined);
    }
    if (pending.fields.includes("body")) {
      await api.updateNote(noteIdRef.current ?? "", pending.mine).catch(() => undefined);
    }
    await loadFull();
    onChanged();
  }, [conflict, entryId, loadFull, onChanged]);

  /** "Ficar com o de la": recarrega a nota do servidor, descartando o local. */
  const takeTheirs = useCallback(async () => {
    setConflict(null);
    await loadFull();
    onChanged();
  }, [loadFull, onChanged]);

  const handleBodyChange = useCallback((markdown: string) => {
    setRawMarkdown(markdown);
    // Ignora o evento de montagem e edicoes que nao mudaram nada.
    if (markdown === lastQueuedRef.current) {
      return;
    }
    lastQueuedRef.current = markdown;
    autosaveRef.current?.schedule(markdown);
  }, []);

  /**
   * Alterna entre o editor formatado e o markdown cru. Ao voltar, o editor
   * remonta com o conteudo inicial: ele precisa ser o markdown editado aqui,
   * senao a proxima tecla gravaria o corpo antigo por cima da edicao.
   */
  const toggleRaw = useCallback(() => {
    if (rawOpen) {
      const blocks = markdownToNoteBlocks(rawMarkdown);
      setInitialBody(blocks.length > 0 ? blocks : undefined);
      lastQueuedRef.current = rawMarkdown;
    }
    setRawOpen(!rawOpen);
  }, [rawMarkdown, rawOpen]);

  const saveTitle = useCallback(async () => {
    if (!entry || title === entry.title) {
      return;
    }
    try {
      const saved = await api.patchEntry(entry.id, {
        title,
        versions: { title: titleVersionRef.current },
      });
      titleVersionRef.current = saved.versions?.title ?? titleVersionRef.current;
      setEntry((current) => (current ? { ...current, title } : current));
      onChanged();
    } catch (err) {
      if (isConflict(err)) {
        setConflict({ fields: err.fields, mine: title });
        return;
      }
      setError(err instanceof Error ? err.message : "falha ao salvar o titulo");
      notify("Nao foi possivel salvar o titulo", "error");
    }
  }, [entry, title, onChanged, notify]);

  useEffect(() => {
    saveTitleRef.current = saveTitle;
  }, [saveTitle]);

  // Nao perde a ultima digitacao (corpo e titulo) ao sair da nota, esconder a
  // aba ou fechar a pagina.
  useEffect(() => {
    const flushAll = () => {
      void autosaveRef.current?.flush();
      void saveTitleRef.current();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushAll();
      }
    };
    window.addEventListener("pagehide", flushAll);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushAll);
      document.removeEventListener("visibilitychange", onVisibility);
      flushAll();
    };
  }, []);

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
      className={`note note-font--${font}${fullWidth ? " note--wide" : ""}${asideOpen ? " note--aside-open" : ""}`}
    >
      <div className="note-doc">
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
              className={rawOpen ? "icon-button icon-button--active" : "icon-button"}
              onClick={toggleRaw}
              aria-pressed={rawOpen}
              aria-label={rawOpen ? "Ver nota formatada" : "Ver markdown"}
              title={rawOpen ? "Ver nota formatada" : "Ver markdown"}
            >
              <CodeIcon size={16} />
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

        {/* A pilha de audios fica no topo da nota, fora do corpo: o corpo e
            texto (markdown) e nao carrega mais player. */}
        {audios.length > 0 ? (
          <div className="audio-stack">
            {audios.map((audio) => (
              <AudioTrack key={audio.id} audio={audio} />
            ))}
          </div>
        ) : null}

        <div className="note-body">
          {bodyLoaded &&
            (rawOpen ? (
              <div className="note-raw">
                <p className="note-raw-hint">
                  Markdown da nota: e o mesmo texto que o app le. O que for alterado aqui substitui o corpo.
                </p>
                <textarea
                  className="note-raw-area"
                  value={rawMarkdown}
                  spellCheck={false}
                  onChange={(event) => handleBodyChange(event.target.value)}
                  aria-label="Markdown da nota"
                />
              </div>
            ) : (
              <NotesEditor
                ref={notesRef}
                entryId={entry.id}
                initialContent={initialBody}
                audios={audioMap}
                onChange={handleBodyChange}
                onMediaAdded={() => {
                  void loadLight();
                  onChanged();
                }}
                onOpenEntry={onOpenEntry}
              />
            ))}
        </div>
      </div>

      {conflict ? (
        <div className="conflict-backdrop" role="dialog" aria-modal="true" aria-label="Nota mudou no celular">
          <div className="conflict-card">
            <h3>A nota mudou no celular</h3>
            <p>
              {conflict.fields.includes("body")
                ? "O texto desta nota mudou no celular depois que voce abriu aqui."
                : "O titulo desta nota mudou no celular depois que voce abriu aqui."}
            </p>
            <p className="conflict-hint">O que voce digitou aqui nao foi enviado. O que decide?</p>
            <div className="conflict-actions">
              <button type="button" className="button" onClick={() => void keepMine()}>
                <span>Manter o meu</span>
                <small>Substitui o que esta no celular</small>
              </button>
              <button type="button" className="button" onClick={() => void takeTheirs()}>
                <span>Ficar com o de la</span>
                <small>Troca pelo que esta no celular</small>
              </button>
              <button type="button" className="button button--ghost" onClick={() => setConflict(null)}>
                Decidir depois
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {asideOpen && (
        <aside className="note-aside" aria-label="Propriedades e insights">
          <div className="aside-actions">
            <strong className="aside-title">Propriedades</strong>
            <div className="aside-actions-buttons">
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
