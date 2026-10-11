import { useCallback, useEffect, useRef, useState } from "react";
import type { Block, PartialBlock } from "@blocknote/core";
import { api, audioUrl } from "../api";
import { NotesEditor } from "../editor/NotesEditor";
import { formatDateTime, formatDuration } from "../lib/format";
import type { Analysis, EntityKind, Entry, Transcript } from "../types";
import { AudioPlayer, type AudioPlayerHandle } from "./AudioPlayer";
import { ImageGallery } from "./ImageGallery";
import { Spinner, isBusy, statusLabel } from "./Status";
import { SparkIcon, TrashIcon } from "./icons";

interface NoteEditorProps {
  entryId: string;
  refreshKey: number;
  onChanged: () => void;
  onDeleted: () => void;
  onOpenEntity: (kind: EntityKind, name: string) => void;
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

// NoteEditor is the note view: title, written body, audio, transcription,
// images and the AI insights.
export function NoteEditor({ entryId, refreshKey, onChanged, onDeleted, onOpenEntity }: NoteEditorProps) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [title, setTitle] = useState("");
  const [initialBody, setInitialBody] = useState<PartialBlock[] | undefined>(undefined);
  const [bodyLoaded, setBodyLoaded] = useState(false);
  const [showTranscript, setShowTranscript] = useState(true);
  const [showInsights, setShowInsights] = useState(true);
  const [busy, setBusy] = useState<"analyze" | "retranscribe" | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const noteIdRef = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const playerRef = useRef<AudioPlayerHandle | null>(null);

  const load = useCallback(async () => {
    setError("");
    setBodyLoaded(false);
    noteIdRef.current = null;
    try {
      const value = await api.getEntry(entryId);
      setEntry(value);
      setTitle(value.title || value.original_filename || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao carregar a nota");
      return;
    }
    try {
      setTranscript(await api.getTranscript(entryId));
    } catch {
      setTranscript(null);
    }
    try {
      setAnalysis(await api.getAnalysis(entryId));
    } catch {
      setAnalysis(null);
    }
    try {
      const result = await api.listNotes(entryId);
      const note = result.notes?.[0];
      if (note) {
        noteIdRef.current = note.id;
        setInitialBody((note.document as PartialBlock[]) ?? undefined);
      } else {
        setInitialBody(undefined);
      }
    } catch {
      setInitialBody(undefined);
    }
    setBodyLoaded(true);
  }, [entryId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

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
      }
    },
    [entryId],
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
    }
  };

  const retranscribe = async () => {
    setBusy("retranscribe");
    setError("");
    try {
      await api.retranscribe(entryId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha");
      setBusy(null);
    }
  };

  const analyze = async () => {
    setBusy("analyze");
    setError("");
    try {
      await api.analyze(entryId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao analisar");
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
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao apagar");
    }
  };

  if (!entry) {
    return (
      <div className="editor">
        {error ? <p className="error">{error}</p> : <p className="muted">Carregando...</p>}
      </div>
    );
  }

  const hasAudio = entry.content_type !== "";

  return (
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
          {saving !== "idle" && <span className="muted save-state">{saving === "saving" ? "salvando..." : "salvo"}</span>}
          {(running || busy) && (
            <button type="button" className="danger" onClick={() => void api.cancel(entryId).then(load)}>
              Parar
            </button>
          )}
          <button type="button" onClick={() => void retranscribe()} disabled={busy === "retranscribe" || running}>
            {busy === "retranscribe" ? <Spinner /> : null} Retranscrever
          </button>
          <button type="button" className="primary" onClick={() => void analyze()} disabled={busy === "analyze" || running}>
            <SparkIcon size={15} /> Analisar
          </button>
          <button type="button" className="icon-button danger" onClick={() => void remove()} aria-label="Apagar nota">
            <TrashIcon size={16} />
          </button>
        </div>
      </header>

      <p className="editor-meta">
        {formatDateTime(entry.recorded_at ?? entry.created_at)} · {formatDuration(entry.duration_seconds)} ·{" "}
        {statusLabel(status)}
      </p>

      {running && (
        <p className="muted">
          <Spinner /> Processando...
        </p>
      )}
      {error && <p className="error">{error}</p>}

      {bodyLoaded && (
        <div className="editor-body">
          <NotesEditor initialContent={initialBody} onChange={handleBodyChange} />
        </div>
      )}

      {hasAudio && (
        <section className="note-section">
          <AudioPlayer ref={playerRef} src={audioUrl(entry.id)} />
        </section>
      )}

      {transcript && (transcript.text || transcript.segments.length > 0) && (
        <section className="note-section">
          <div className="section-head">
            <h3>Transcricao</h3>
            <button type="button" className="link-button" onClick={() => setShowTranscript((value) => !value)}>
              {showTranscript ? "ocultar" : "mostrar"}
            </button>
          </div>
          {showTranscript &&
            (transcript.segments.length > 0 ? (
              <blockquote className="transcript">
                {transcript.segments.map((segment, index) => (
                  <p key={index}>
                    <button
                      type="button"
                      className="transcript-line"
                      onClick={() => playerRef.current?.seek(segment.start_ms / 1000)}
                      title="Ouvir a partir daqui"
                    >
                      <span className="timestamp">{formatDuration(segment.start_ms / 1000)}</span>
                      {segment.text}
                    </button>
                  </p>
                ))}
              </blockquote>
            ) : (
              <blockquote className="transcript">
                <p>{transcript.text}</p>
              </blockquote>
            ))}
        </section>
      )}

      <section className="note-section">
        <div className="section-head">
          <h3>Imagens</h3>
        </div>
        <ImageGallery entryId={entry.id} refreshKey={refreshKey} />
      </section>

      <section className="note-section">
        <div className="section-head">
          <h3>Insights da IA</h3>
          <button type="button" className="link-button" onClick={() => setShowInsights((value) => !value)}>
            {showInsights ? "ocultar" : "mostrar"}
          </button>
        </div>
        {showInsights &&
          (analysis ? (
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
            <p className="muted">
              {busy === "analyze" || status === "analyzing" ? "Analisando..." : "Sem analise ainda. Clique em Analisar."}
            </p>
          ))}
      </section>
    </div>
  );
}

export default NoteEditor;
