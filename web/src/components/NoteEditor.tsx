import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PartialBlock } from "@blocknote/core";
import { api, isConflict } from "../api";
import { AudioTrack } from "./AudioTrack";
import { NotesEditor, type NotesEditorHandle } from "../editor/NotesEditor";
import { markdownToPlain, noteBlocksToMarkdown, normalizeLegacyAttachmentImages, audioAttachmentIds } from "../editor/blocknoteMarkdown";
import { markdownToNoteBlocks } from "../editor/markdownBlocks";
import { createAutosave, type Autosave } from "../lib/autosave";
import { formatBytes, formatDateTime, formatDuration } from "../lib/format";
import { patchNoteViewState, readNoteViewState } from "../lib/noteViewState";
import { useEscape } from "../lib/useEscape";
import type { Analysis, Attachment, Audio, EntityKind, Entry, Note, Notebook, Revision } from "../types";
import { Spinner, isBusy, statusLabel } from "./Status";
import { TagEditor } from "./TagEditor";
import { useToast } from "./Toasts";
import {
  ArchiveIcon,
  CheckIcon,
  CloseIcon,
  CodeIcon,
  ImageIcon,
  LinkIcon,
  MicIcon,
  MoreIcon,
  SparkIcon,
  TrashIcon,
} from "./icons";

interface NoteEditorProps {
  entryId: string;
  refreshKey: number;
  failureReason?: string;
  progress?: { stage: string; done: number; total: number };
  onChanged: () => void;
  onDeleted: () => void;
  onOpenEntity: (kind: EntityKind, name: string) => void;
  onOpenEntry: (id: string) => void;
  notebooks: Notebook[];
}

const FONTS = [
  { id: "default", label: "Padrão", preview: "inherit" },
  { id: "serif", label: "Serifada", preview: '"Newsreader", Georgia, serif' },
  { id: "mono", label: "Monoespaçada", preview: "var(--font-mono)" },
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

/** Tira do markdown o marcador do audio apagado (pilha ou modo cru). */
function withoutAudioMarker(markdown: string, attachmentId: string): string {
  const marker = `!audio[attachment:${attachmentId}]`;
  if (!markdown.includes(marker)) {
    return markdown;
  }
  return markdown
    .split("\n")
    .filter((line) => !line.includes(marker))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
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
      return "Transcrevendo o áudio...";
    case "analyzing":
      return "Analisando...";
    default:
      return "Processando...";
  }
}

/** Revisao guardada no formato antigo (JSON de blocos), e não markdown. */
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
  // antes de cada gravacao e, por último, o estado atual.
  const states: Array<{ at: string; markdown: string }> = [];
  for (let i = revisions.length - 1; i >= 0; i--) {
    // Revisao em JSON do BlockNote (notas anteriores a conversao): não da para
    // comparar palavras com markdown, e poluir o histórico com `type: paragraph`
    // ajuda ninguem.
    if (isLegacyBlockJson(revisions[i].content_markdown)) {
      continue;
    }
    states.push({ at: revisions[i].created_at, markdown: markdownToPlain(revisions[i].content_markdown) });
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
 * `document` em JSON so aparece em nota ainda não convertida.
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
  notebooks,
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
  const [asideOpen, setAsideOpen] = useState(() => readNoteViewState(entryId).asideOpen);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [expandedAudios, setExpandedAudios] = useState<string[]>(() => readNoteViewState(entryId).expandedAudios);
  const viewStateRef = useRef(readNoteViewState(entryId));
  const docRef = useRef<HTMLDivElement | null>(null);
  const scrollRestoredRef = useRef(false);
  const bodyDirtyRef = useRef(false);
  const titleDirtyRef = useRef(false);
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
  const [rawOpen, setRawOpen] = useState(() => readNoteViewState(entryId).rawOpen);
  const [revisionsCursor, setRevisionsCursor] = useState<string | undefined>(undefined);
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

  const applyNoteData = useCallback(
    (loaded: Entry, analysisValue: Analysis | null, imagesValue: Attachment[], note: Note | undefined, applyBody: boolean) => {
      setEntry(loaded);
      if (!titleDirtyRef.current) {
        setTitle(loaded.title || loaded.original_filename || "");
      }
      setAnalysis(analysisValue);
      setImages(imagesValue);
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
      if (!applyBody) {
        return;
      }
      const stored = note?.content_markdown ?? "";
      // Corpo antigo pode ter a imagem como HTML (com o token do anexo na URL).
      // A visao crua mostra o markdown canonico e, se houve conversao, a nota e
      // regravada uma vez para o servidor voltar a ter a referencia `attachment:`.
      const markdown = normalizeLegacyAttachmentImages(stored);
      const filled = note ? noteBodyToBlocks(note) : undefined;
      setRawMarkdown(markdown);
      setInitialBody(filled);
      lastQueuedRef.current = markdown;
      setBodyLoaded(true);
      if (markdown !== stored) {
        autosaveRef.current?.schedule(markdown);
      }
    },
    [],
  );

  const loadFull = useCallback(async () => {
    setError("");
    setBodyLoaded(false);
    noteIdRef.current = null;

    // First paint comes from the local cache: reopening a note should not wait
    // for the network. The fresh copy is applied right after. Both start
    // together so a slow IndexedDB never delays the request.
    let freshApplied = false;
    let cachedShown = false;
    void Promise.all([
      api.getEntryCached(entryId),
      api.getAnalysisCached(entryId),
      api.listNotesCached(entryId),
      api.listAttachmentsCached(entryId),
    ]).then(([cachedEntry, cachedAnalysis, cachedNotes, cachedImages]) => {
      if (freshApplied || !cachedEntry) {
        return;
      }
      cachedShown = true;
      applyNoteData(
        cachedEntry,
        cachedAnalysis ?? null,
        cachedImages?.attachments ?? [],
        cachedNotes?.notes?.[0],
        !bodyDirtyRef.current,
      );
    });
    const [entryRes, analysisRes, notesRes, imagesRes] = await Promise.allSettled([
      api.getEntry(entryId),
      api.getAnalysis(entryId),
      api.listNotes(entryId),
      api.listAttachments(entryId),
    ]);
    freshApplied = true;
    if (entryRes.status !== "fulfilled") {
      if (!cachedShown) {
        setError(entryRes.reason instanceof Error ? entryRes.reason.message : "falha ao carregar a nota");
      }
      return;
    }
    applyNoteData(
      entryRes.value,
      analysisRes.status === "fulfilled" ? analysisRes.value : null,
      imagesRes.status === "fulfilled" ? imagesRes.value.attachments ?? [] : [],
      notesRes.status === "fulfilled" ? notesRes.value.notes?.[0] : undefined,
      !bodyDirtyRef.current,
    );
  }, [applyNoteData, entryId]);

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
      setRevisionsCursor(undefined);
      return;
    }
    let active = true;
    api
      .listRevisions(noteId)
      .then((result) => {
        if (active) {
          setRevisions(result.revisions ?? []);
          setRevisionsCursor(result.next_cursor);
        }
      })
      .catch(() => {
        if (active) {
          setRevisions([]);
          setRevisionsCursor(undefined);
        }
      });
    return () => {
      active = false;
    };
  }, [asideOpen, noteId]);

  const loadMoreRevisions = useCallback(() => {
    if (!noteId || !revisionsCursor) {
      return;
    }
    api
      .listRevisions(noteId, revisionsCursor)
      .then((result) => {
        setRevisions((current) => [...current, ...(result.revisions ?? [])]);
        setRevisionsCursor(result.next_cursor);
      })
      .catch(() => {
        // keep what is already on screen
      });
  }, [noteId, revisionsCursor]);

  // Preserve the ephemeral UI state across unmounting (view switch or note
  // switch). Content itself is cached; these are the bits React would lose.
  useEffect(() => {
    patchNoteViewState(entryId, { asideOpen });
  }, [asideOpen, entryId]);
  useEffect(() => {
    patchNoteViewState(entryId, { rawOpen });
  }, [rawOpen, entryId]);
  useEffect(() => {
    patchNoteViewState(entryId, { expandedAudios });
  }, [expandedAudios, entryId]);

  // Restore the scroll position once the document is on screen.
  useEffect(() => {
    if (!bodyLoaded || scrollRestoredRef.current) {
      return;
    }
    const el = docRef.current;
    if (!el) {
      return;
    }
    scrollRestoredRef.current = true;
    window.requestAnimationFrame(() => {
      el.scrollTop = viewStateRef.current.scrollTop;
    });
  }, [bodyLoaded]);

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
        if (isConflict(err) && noteIdRef.current) {
          // Outro aparelho gravou depois que esta aba abriu. Último a escrever
          // vence: o texto que o usuario acabou de digitar entra por cima, sem
          // dialogo. O corpo e reenviado sem versao de base.
          try {
            const saved = await api.updateNote(noteIdRef.current, text);
            bodyVersionRef.current = saved.versions?.body ?? bodyVersionRef.current;
            setSaving("saved");
            window.setTimeout(() => setSaving((value) => (value === "saved" ? "idle" : value)), 1500);
            return;
          } catch {
            // sem sorte no reenvio: mostra o erro generico abaixo
          }
        }
        setError(err instanceof Error ? err.message : "falha ao salvar a nota");
        notify("Não foi possível salvar a nota", "error");
      }
    },
    [entryId, notify],
  );

  useEffect(() => {
    saveBodyRef.current = saveBody;
  }, [saveBody]);

  /** "Manter o meu" não existe mais: a última gravacao vence, sem dialogo. */
  const handleBodyChange = useCallback((markdown: string) => {
    setRawMarkdown(markdown);
    // Ignora o evento de montagem e edicoes que não mudaram nada.
    if (markdown === lastQueuedRef.current) {
      return;
    }
    bodyDirtyRef.current = true;
    lastQueuedRef.current = markdown;
    autosaveRef.current?.schedule(markdown);
  }, []);

  /**
   * Apaga o audio de verdade: tira o bloco do corpo (persistindo o markdown) e
   * remove o anexo no servidor, junto com a transcricao. Sem isso, remover so o
   * marcador deixava o audio reaparecendo na pilha do topo, sem como apagar.
   */
  const deleteAudio = useCallback(
    async (audioId: string) => {
      if (
        !window.confirm(
          "Apagar este áudio? O áudio e a transcrição saem da nota e do servidor. Não dá para desfazer.",
        )
      ) {
        return;
      }
      try {
        // O corpo pode ter edicao pendente: grava antes de apagar o anexo.
        await autosaveRef.current?.flush();
        const markdownAfter = notesRef.current?.removeAudio(audioId);
        if (markdownAfter === undefined) {
          const next = withoutAudioMarker(rawMarkdown, audioId);
          if (next !== rawMarkdown) {
            handleBodyChange(next);
          }
        }
        await autosaveRef.current?.flush();
        await api.deleteAttachment(audioId);
        setEntry((current) =>
          current
            ? { ...current, audios: (current.audios ?? []).filter((audio) => audio.id !== audioId) }
            : current,
        );
        void loadLight();
        onChanged();
        notify("Áudio apagado", "success");
      } catch (err) {
        notify(err instanceof Error ? err.message : "Não foi possível apagar o áudio", "error");
      }
    },
    [handleBodyChange, loadLight, notify, onChanged, rawMarkdown],
  );

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
        // Titulo mudou em outro lugar: a última gravacao vence, entao reenvia
        // sem versao em vez de interromper o usuario com um dialogo.
        try {
          const saved = await api.patchEntry(entry.id, { title });
          titleVersionRef.current = saved.versions?.title ?? titleVersionRef.current;
          setEntry((current) => (current ? { ...current, title } : current));
          onChanged();
          return;
        } catch {
          // sem sorte no reenvio: mostra o erro generico abaixo
        }
      }
      setError(err instanceof Error ? err.message : "falha ao salvar o título");
      notify("Não foi possível salvar o título", "error");
    }
  }, [entry, title, onChanged, notify]);

  useEffect(() => {
    saveTitleRef.current = saveTitle;
  }, [saveTitle]);

  // Não perde a última digitacao (corpo e titulo) ao sair da nota, esconder a
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
      notify("Transcrição enfileirada", "info");
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha");
      notify("Não foi possível retranscrever", "error");
      setBusy(null);
    }
  };

  const analyze = async () => {
    setBusy("analyze");
    setError("");
    setAsideOpen(true);
    try {
      await api.analyze(entryId);
      notify("Análise iniciada", "info");
    } catch (err) {
      if (err instanceof Error && err.message.includes("desligada")) {
        notify("A análise esta desligada. Ative em Configuração.", "error");
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
    if (!window.confirm("Apagar esta nota e os áudios? Esta ação não pode ser desfeita.")) {
      return;
    }
    try {
      await api.deleteEntry(entry.id);
      notify("Nota apagada", "success");
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao apagar");
      notify("Não foi possível apagar", "error");
    }
  };

  useEscape(optionsOpen, () => setOptionsOpen(false));

  const toggleArchived = async () => {
    if (!entry) return;
    const next = !entry.archived;
    try {
      await api.patchEntry(entry.id, { archived: next });
      setEntry((current) => (current ? { ...current, archived: next } : current));
      notify(next ? "Nota arquivada" : "Nota desarquivada", "success");
      onChanged();
    } catch {
      notify("Não foi possível arquivar a nota.", "error");
    } finally {
      setOptionsOpen(false);
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

  const audios = entry?.audios ?? [];
  const audioMap = new Map<string, Audio>(audios.map((audio) => [audio.id, audio]));
  // O audio que tem marcador no corpo ja aparece no lugar em que o app o mostra;
  // so a pilha (notas antigas e audios enviados pelo dashboard) fica no topo.
  const bodyAudioIds = useMemo(() => audioAttachmentIds(rawMarkdown), [rawMarkdown]);
  const stackAudios = audios.filter((audio) => !bodyAudioIds.has(audio.id));
  const processing = running || busy !== null;
  // Derived numbers walk the whole document. They used to be recomputed on
  // every keystroke and every SSE event; memoizing keeps typing cheap.
  const spokenText = useMemo(
    () => audios.map((audio) => audio.transcript?.text ?? "").join(" "),
    [audios],
  );
  // O texto da nota para as métricas sai do markdown vivo, não do corpo que veio
  // do servidor: antes os numeros ficavam em 0 ate reabrir a nota, mesmo com o
  // texto todo na tela.
  const noteText = useMemo(
    () => `${markdownToPlain(rawMarkdown)} ${spokenText}`.replace(/\s+/g, " ").trim(),
    [rawMarkdown, spokenText],
  );
  const words = useMemo(
    () => (noteText ? noteText.split(/\s+/).filter(Boolean).length : 0),
    [noteText],
  );
  const chars = noteText.length;
  const mediaBytes = useMemo(
    () =>
      audios.reduce((sum, audio) => sum + audio.size_bytes, 0) +
      images.reduce((sum, image) => sum + image.size_bytes, 0),
    [audios, images],
  );
  const totalBytes = useMemo(
    () => mediaBytes + new TextEncoder().encode(noteText).length,
    [mediaBytes, noteText],
  );

  // History is a word diff over every revision: only build it when the panel
  // that shows it is open.
  const history = useMemo(
    () => (asideOpen ? buildHistory(revisions, initialBody) : []),
    [asideOpen, revisions, initialBody],
  );

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
      {typeof analysis.comprehension === "number" && analysis.comprehension >= 0 && (
        <p className="insight-comprehension">
          Compreensão lógica: <strong>{analysis.comprehension}/100</strong>{" "}
          <span className="muted">
            {analysis.comprehension_source === "review"
              ? `estimativa do texto transcrito; ${analysis.revised_segments ?? 0} trecho(s) melhorado(s) pela IA`
              : "estimativa do modelo sobre o texto lido, sem revisão da transcrição"}
          </span>
        </p>
      )}
      {((analysis.stutter_rate ?? 0) > 0 || (analysis.hesitation_rate ?? 0) > 0) && (
        <p className="muted insight-disfluency">
          Fala: gagueira {Number(analysis.stutter_rate ?? 0).toFixed(1)} e hesitação{" "}
          {Number(analysis.hesitation_rate ?? 0).toFixed(1)} por 100 palavras
        </p>
      )}
      {/* A prosa e legenda das metricas: duas frases no maximo. O resumo so
          aparece quando nao ha leitura (analises antigas). */}
      {(analysis.reading || analysis.summary) && (
        <p className="insight-reading">{analysis.reading || analysis.summary}</p>
      )}

      {analysis.sections && analysis.sections.length > 1 && (
        <div className="analysis-block">
          <h4>Seções</h4>
          {analysis.sections.map((section, index) => (
            <details key={`${section.heading}-${index}`} className="insight-section">
              <summary>
                {section.heading || "Nota"}
                <span className="muted">
                  {" "}
                  {sentimentText(section.sentiment?.label ?? "")}
                </span>
              </summary>
              {(section.reading || section.summary) && (
                <p>{section.reading || section.summary}</p>
              )}
            </details>
          ))}
        </div>
      )}

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
    <p className="muted">Sem análise ainda.</p>
  );

  return (
    <div
      className={`note note-font--${font}${fullWidth ? " note--wide" : ""}${asideOpen ? " note--aside-open" : ""}`}
    >
      <div
        className="note-doc"
        ref={docRef}
        onScroll={(event) => {
          viewStateRef.current.scrollTop = event.currentTarget.scrollTop;
          patchNoteViewState(entryId, { scrollTop: event.currentTarget.scrollTop });
        }}
      >
        <div className="note-topbar">
          <span className="save-state muted" aria-live="polite">
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
              onClick={() => notesRef.current?.openLink()}
              aria-label="Link para nota"
              title="Link para nota"
            >
              <LinkIcon size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => notesRef.current?.addAudio()}
              aria-label="Enviar áudio"
              title="Enviar áudio"
            >
              <MicIcon size={16} />
            </button>
            <span className="head-sep" aria-hidden />
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
              className={asideOpen ? "icon-button icon-button--active" : "icon-button"}
              onClick={() => setAsideOpen((value) => !value)}
              aria-pressed={asideOpen}
              aria-label={asideOpen ? "Fechar propriedades" : "Abrir propriedades"}
              title="Propriedades e insights"
            >
              <SparkIcon size={16} />
            </button>
            <div className="note-options">
              <button
                type="button"
                className="icon-button"
                onClick={() => setOptionsOpen((value) => !value)}
                aria-label="Mais opções da nota"
                aria-expanded={optionsOpen}
                title="Mais opções"
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
                      aria-checked={asideOpen}
                      onClick={() => {
                        setAsideOpen((value) => !value);
                        setOptionsOpen(false);
                      }}
                    >
                      <span>Propriedades e insights</span>
                      {asideOpen && <CheckIcon size={14} />}
                    </button>
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
                    {audios.length > 0 && (
                      <button
                        type="button"
                        className="menu-item"
                        role="menuitem"
                        disabled={busy === "retranscribe" || running}
                        onClick={() => {
                          setOptionsOpen(false);
                          void retranscribe();
                        }}
                      >
                        <span>Transcrever novamente</span>
                        {busy === "retranscribe" ? <Spinner /> : <MicIcon size={14} />}
                      </button>
                    )}
                    <button
                      type="button"
                      className="menu-item"
                      role="menuitem"
                      onClick={() => void toggleArchived()}
                    >
                      <span>{entry.archived ? "Desarquivar nota" : "Arquivar nota"}</span>
                      <ArchiveIcon size={14} />
                    </button>
                    <button
                      type="button"
                      role="menuitem"
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
          onChange={(event) => {
            titleDirtyRef.current = true;
            setTitle(event.target.value);
          }}
          onBlur={() => void saveTitle()}
          placeholder="Sem título"
          aria-label="Título da nota"
        />

        <p className="note-byline">
          <span>{formatDateTime(entry.recorded_at ?? entry.created_at)}</span>
          <span className={status === "failed" ? "note-status note-status--failed" : "note-status"}>{statusLabel(status)}</span>
          {entry.archived && <span className="note-archived">Arquivada</span>}
          {entry.duration_seconds > 0 && <span>{formatDuration(entry.duration_seconds)}</span>}
        </p>

        {failureReason && <div className="banner banner--error">Falha: {failureReason}</div>}
        {error && <p className="error">{error}</p>}

        {/* Audios sem marcador no corpo (notas antigas e os enviados por aqui)
            ficam na pilha do topo. */}
        {stackAudios.length > 0 ? (
          <div className="audio-stack">
            {stackAudios.map((audio) => (
              <AudioTrack
                key={audio.id}
                audio={audio}
                entryId={entry.id}
                initialExpanded={expandedAudios.includes(audio.id)}
                initialTime={viewStateRef.current.audioTimes[audio.id] ?? 0}
                onExpandedChange={(expanded) => {
                  setExpandedAudios((current) =>
                    expanded
                      ? current.includes(audio.id) ? current : [...current, audio.id]
                      : current.filter((id) => id !== audio.id),
                  );
                }}
                onDelete={() => void deleteAudio(audio.id)}
              />
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
                onDeleteAudio={(id) => void deleteAudio(id)}
              />
            ))}
        </div>
      </div>

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
                title="Fechar propriedades"
              >
                <CloseIcon size={15} />
              </button>
            </div>
          </div>

          <section className="aside-block">
            <h3>Caderno</h3>
            <select
              className="notebook-select"
              value={entry.notebook_id ?? ""}
              aria-label="Caderno da nota"
              onChange={(event) => {
                const next = event.target.value;
                if (!next || next === entry.notebook_id) return;
                void api
                  .patchEntry(entry.id, { notebook_id: next })
                  .then(() => {
                    setEntry((current) => (current ? { ...current, notebook_id: next } : current));
                    onChanged();
                  })
                  .catch(() => notify("Não foi possível mover a nota.", "error"));
              }}
            >
              {notebooks.map((notebook) => (
                <option key={notebook.id} value={notebook.id}>
                  {notebook.name}
                </option>
              ))}
            </select>
          </section>

          <section className="aside-block">
            <h3>Detalhes</h3>
            <dl className="props">
              <dt>Criada</dt>
              <dd>{formatDateTime(entry.created_at)}</dd>
              <dt>Origem</dt>
              <dd>{entry.source === "text" ? "Texto" : "Áudio"}</dd>
              <dt>Áudios</dt>
              <dd>{audios.length}</dd>
              <dt>Palavras</dt>
              <dd>{words}</dd>
              <dt>Caracteres</dt>
              <dd>{chars}</dd>
              <dt>Tamanho</dt>
              <dd title={`${totalBytes} bytes`}>{formatBytes(totalBytes)}</dd>
              <dt>Status</dt>
              <dd>{statusLabel(status)}</dd>
            </dl>
            <div className="aside-tags">
              <TagEditor entryId={entry.id} onChanged={onChanged} />
            </div>
          </section>

          <section className="aside-block">
            <h3>Histórico</h3>
            <p className="muted history-created">Criada em {formatDateTime(entry.created_at)}</p>
            {history.length === 0 ? (
              <p className="muted">Sem alterações registradas.</p>
            ) : (
              <ul className="history">
                {history.map((item, index) => (
                  <li key={index}>
                    <span className="history-when">{formatDay(item.day)}</span>
                    {item.added.length === 0 && item.removed.length === 0 ? (
                      <span className="muted">reorganizado</span>
                    ) : (
                      <span className="history-counts">
                        {item.added.length > 0 && (
                          <span className="history-added">+{item.added.length}</span>
                        )}
                        {item.removed.length > 0 && (
                          <span className="history-removed">−{item.removed.length}</span>
                        )}
                        <span className="muted">palavras</span>
                      </span>
                    )}
                    {item.added.length > 0 && (
                      <span className="history-excerpt">
                        {item.added.slice(0, 10).join(" ")}
                        {item.added.length > 10 ? "…" : ""}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {revisionsCursor && (
              <button type="button" className="transcript-toggle" onClick={loadMoreRevisions}>
                Carregar mais
              </button>
            )}
          </section>

          <section className="aside-block">
            <div className="aside-block-head">
              <h3>Insights</h3>
              <button type="button" className="primary small" onClick={() => void analyze()} disabled={busy === "analyze" || running}>
                {busy === "analyze" ? <Spinner /> : <SparkIcon size={14} />} Analisar
              </button>
            </div>
            {failureReason && !processing && !analysis ? (
              <div className="analysis-failure">
                <p className="error">{failureReason}</p>
                <button type="button" className="primary small" onClick={() => void analyze()} disabled={busy === "analyze"}>
                  Tentar de novo
                </button>
              </div>
            ) : (
              insights
            )}
          </section>
        </aside>
      )}

    </div>
  );
}

export default NoteEditor;
