import { useCallback, useEffect, useRef, useState } from "react";
import type { Block, PartialBlock } from "@blocknote/core";
import { api, audioUrl } from "../api";
import { NotesEditor } from "../editor/NotesEditor";
import { formatDateTime, formatDuration } from "../lib/format";
import type { Analysis, EntityKind, Entry, Transcript } from "../types";
import { AudioPlayer, type AudioPlayerHandle } from "./AudioPlayer";
import { ImageGallery } from "./ImageGallery";
import { Spinner, isBusy, statusLabel } from "./Status";
import { useToast } from "./Toasts";
import { SparkIcon, TrashIcon } from "./icons";

interface NoteEditorProps {
  entryId: string;
  refreshKey: number;
  failureReason?: string;
  progress?: { stage: string; done: number; total: number };
  onChanged: () => void;
  onDeleted: () => void;
  onOpenEntity: (kind: EntityKind, name: string) => void;
}

function processingText(
  progress: { stage: string; done: number; total: number } | undefined,
  status?: string,
): string {
  if (progress?.stage === "analyzing") {
    return progress.total > 1
      ? `Analisando com a IA... trecho ${Math.min(progress.done + 1, progress.total)} de ${progress.total}`
      : "Analisando com a IA...";
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
      return "Analisando com a IA...";
    default:
      return "Processando...";
  }
}

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

// NoteEditor is the note view: one continuous page with the written text, the
// audio and its transcription, images and, on the right, the AI insights.
export function NoteEditor({
  entryId,
  refreshKey,
  failureReason,
  progress,
  onChanged,
  onDeleted,
  onOpenEntity,
}: NoteEditorProps) {
  const { notify } = useToast();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [title, setTitle] = useState("");
  const [initialBody, setInitialBody] = useState<PartialBlock[] | undefined>(undefined);
  const [bodyLoaded, setBodyLoaded] = useState(false);
  const [busy, setBusy] = useState<"analyze" | "retranscribe" | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const noteIdRef = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const playerRef = useRef<AudioPlayerHandle | null>(null);
  const transcriptRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const mountedRefresh = useRef(refreshKey);

  // Full load: everything the page needs, fetched in parallel.
  const loadFull = useCallback(async () => {
    setError("");
    setBodyLoaded(false);
    noteIdRef.current = null;
    const [entryRes, transcriptRes, analysisRes, notesRes] = await Promise.allSettled([
      api.getEntry(entryId),
      api.getTranscript(entryId),
      api.getAnalysis(entryId),
      api.listNotes(entryId),
    ]);
    if (entryRes.status !== "fulfilled") {
      setError(entryRes.reason instanceof Error ? entryRes.reason.message : "falha ao carregar a nota");
      return;
    }
    setEntry(entryRes.value);
    setTitle(entryRes.value.title || entryRes.value.original_filename || "");
    setTranscript(transcriptRes.status === "fulfilled" ? transcriptRes.value : null);
    setAnalysis(analysisRes.status === "fulfilled" ? analysisRes.value : null);
    const note = notesRes.status === "fulfilled" ? notesRes.value.notes?.[0] : undefined;
    if (note) {
      noteIdRef.current = note.id;
      setInitialBody((note.document as PartialBlock[]) ?? undefined);
    } else {
      setInitialBody(undefined);
    }
    setBodyLoaded(true);
  }, [entryId]);

  // Light reload after background events: never touches the body editor.
  const loadLight = useCallback(async () => {
    const [entryRes, transcriptRes, analysisRes] = await Promise.allSettled([
      api.getEntry(entryId),
      api.getTranscript(entryId),
      api.getAnalysis(entryId),
    ]);
    if (entryRes.status === "fulfilled") {
      setEntry(entryRes.value);
    }
    setTranscript(transcriptRes.status === "fulfilled" ? transcriptRes.value : null);
    setAnalysis(analysisRes.status === "fulfilled" ? analysisRes.value : null);
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

  const status = entry?.status;
  const running = isBusy(status);

  useEffect(() => {
    if (status === "ready" || status === "transcribed" || status === "enriched" || status === "failed") {
      setBusy(null);
    }
  }, [status]);

  // Keep the active transcription line visible while the audio plays.
  useEffect(() => {
    if (!playing || !transcript || transcript.segments.length === 0) {
      return;
    }
    const ms = currentTime * 1000;
    let index = -1;
    for (let i = 0; i < transcript.segments.length; i++) {
      if (transcript.segments[i].start_ms <= ms) {
        index = i;
      } else {
        break;
      }
    }
    transcriptRefs.current[index]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [playing, currentTime, transcript]);

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
    if (!window.confirm("Apagar esta nota e o audio? Esta acao nao pode ser desfeita.")) {
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

  if (!entry) {
    return (
      <div className="editor-layout">
        <div className="editor">
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-block" />
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    );
  }

  const hasAudio = entry.content_type !== "";
  const hasTranscript = !!transcript && (transcript.text.trim() !== "" || transcript.segments.length > 0);
  const processing = running || busy !== null;

  // Highlight the transcription line that matches the current audio position.
  let activeSegment = -1;
  if (currentTime > 0 && transcript && transcript.segments.length > 0) {
    for (let i = 0; i < transcript.segments.length; i++) {
      if (transcript.segments[i].start_ms <= currentTime * 1000) {
        activeSegment = i;
      } else {
        break;
      }
    }
  }

  return (
    <div className="editor-layout">
      <div className="editor">
        <header className="editor-head">
          <input
            className="editor-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void saveTitle()}
            placeholder="Titulo da nota"
            aria-label="Titulo da nota"
          />
          <div className="editor-actions">
            {saving !== "idle" && (
              <span className="muted save-state">{saving === "saving" ? "salvando..." : "salvo"}</span>
            )}
            {(running || busy) && (
              <button type="button" className="danger" onClick={() => void api.cancel(entryId).then(() => loadLight())}>
                Parar
              </button>
            )}
            {hasAudio && (
              <button type="button" onClick={() => void retranscribe()} disabled={busy === "retranscribe" || running}>
                {busy === "retranscribe" ? <Spinner /> : null} Retranscrever
              </button>
            )}
            <button type="button" className="icon-button danger" onClick={() => void remove()} aria-label="Apagar nota">
              <TrashIcon size={16} />
            </button>
          </div>
        </header>

        <p className="editor-meta">
          {formatDateTime(entry.recorded_at ?? entry.created_at)} ·{" "}
          {entry.duration_seconds > 0 ? `${formatDuration(entry.duration_seconds)} · ` : ""}
          {statusLabel(status)}
        </p>

        {failureReason && <div className="banner banner--error">Falha: {failureReason}</div>}
        {error && <p className="error">{error}</p>}

        {/* Notion-like page: the audio (media) at the top, then the written text. */}
        <div className="page-canvas">
          {hasAudio && (
            <div className="audio-block">
              <AudioPlayer
                ref={playerRef}
                src={audioUrl(entry.id)}
                onTime={setCurrentTime}
                onPlaying={setPlaying}
              />
              {hasTranscript && (
                <blockquote className="transcript">
                  {transcript && transcript.segments.length > 0 ? (
                    transcript.segments.map((segment, index) => (
                      <p key={index}>
                        <button
                          ref={(el) => {
                            transcriptRefs.current[index] = el;
                          }}
                          type="button"
                          className={
                            index === activeSegment ? "transcript-line transcript-line--active" : "transcript-line"
                          }
                          onClick={() => playerRef.current?.seek(segment.start_ms / 1000)}
                          title="Ouvir a partir daqui"
                        >
                          <span className="timestamp">{formatDuration(segment.start_ms / 1000)}</span>
                          {segment.text}
                        </button>
                      </p>
                    ))
                  ) : (
                    <p>{transcript?.text}</p>
                  )}
                </blockquote>
              )}
            </div>
          )}

          <div className="page-text">
            {bodyLoaded && <NotesEditor initialContent={initialBody} onChange={handleBodyChange} />}
          </div>

          <div className="page-images">
            <ImageGallery entryId={entry.id} />
          </div>
        </div>
      </div>

      <aside className="insights-rail" aria-label="Insights da IA">
        <div className="rail-head">
          <h3>Insights da IA</h3>
          <button
            type="button"
            className="primary small"
            onClick={() => void analyze()}
            disabled={busy === "analyze" || running}
          >
            {busy === "analyze" ? <Spinner /> : <SparkIcon size={15} />} Analisar
          </button>
        </div>

        {processing ? (
          <div className="analysis-loading">
            <div className="analysis-loading-head">
              <Spinner />
              <span>{processingText(progress, status)}</span>
            </div>
            {progress && progress.stage === "analyzing" && progress.total > 1 && (
              <div
                className="ram-track"
                role="progressbar"
                aria-valuenow={Math.round((progress.done / progress.total) * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="ram-fill"
                  style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                />
              </div>
            )}
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line" style={{ width: "85%" }} />
            <div className="skeleton skeleton-line" style={{ width: "65%" }} />
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
                        {theme.name} <span className="muted">{Math.round(theme.confidence * 100)}%</span>
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
                        {person.relation ? ` (${person.relation})` : ""} · {person.count}
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
                        {place.name} · {place.count}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.emotions_detail && analysis.emotions_detail.length > 0 && (
              <div className="analysis-block">
                <h4>Emocoes</h4>
                <ul className="bars">
                  {analysis.emotions_detail.map((emotion) => (
                    <li key={emotion.name}>
                      <span className="bar-label">{emotion.name}</span>
                      <span className="bar-track">
                        <span
                          className="bar-fill"
                          style={{ width: `${Math.round(Math.min(1, Math.max(0, emotion.intensity)) * 100)}%` }}
                        />
                      </span>
                      <span className="muted">{emotion.intensity.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.key_moments && analysis.key_moments.length > 0 && (
              <div className="analysis-block">
                <h4>Momentos-chave</h4>
                <ul className="moments">
                  {analysis.key_moments.map((moment, index) => (
                    <li key={index}>
                      <button
                        type="button"
                        className="transcript-line"
                        onClick={() => playerRef.current?.seek(moment.start_ms / 1000)}
                      >
                        <span className="timestamp">{formatDuration(moment.start_ms / 1000)}</span>
                        {moment.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.questions && analysis.questions.length > 0 && (
              <div className="analysis-block">
                <h4>Perguntas</h4>
                <ul className="plain-list">
                  {analysis.questions.map((question, index) => (
                    <li key={index}>{question}</li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.decisions && analysis.decisions.length > 0 && (
              <div className="analysis-block">
                <h4>Decisoes</h4>
                <ul className="plain-list">
                  {analysis.decisions.map((decision, index) => (
                    <li key={index}>{decision}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="muted">Sem analise ainda. Clique em Analisar para extrair temas, pessoas, emocoes e mais.</p>
        )}
      </aside>
    </div>
  );
}

export default NoteEditor;
