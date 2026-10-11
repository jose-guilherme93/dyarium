import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { NotesEditor } from "../editor/NotesEditor";
import { ProgressBar, Spinner, isBusy, stageText } from "../components/Status";
import type { Analysis, EntityKind, Entry, EntryProgress, Note, Segment, Settings, Transcript } from "../types";

interface EntryViewProps {
  id: string;
  refreshKey: number;
  progress?: EntryProgress;
  partials?: Segment[];
  onBack: () => void;
  onOpenEntity?: (kind: EntityKind, name: string) => void;
}

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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

export function EntryView({ id, refreshKey, progress, partials, onBack, onOpenEntity }: EntryViewProps) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [noteDocument, setNoteDocument] = useState<unknown>([]);
  const [busy, setBusy] = useState<"retranscribe" | "analyze" | null>(null);

  const load = useCallback(async () => {
    try {
      setEntry(await api.getEntry(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao carregar");
      return;
    }
    try {
      setTranscript(await api.getTranscript(id));
    } catch {
      setTranscript(null);
    }
    try {
      setAnalysis(await api.getAnalysis(id));
    } catch {
      setAnalysis(null);
    }
    try {
      const result = await api.listNotes(id);
      setNotes(result.notes ?? []);
    } catch {
      setNotes([]);
    }
    try {
      setSettings(await api.getSettings());
    } catch {
      setSettings(null);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const status = progress?.status ?? entry?.status;
  const running = isBusy(status);

  useEffect(() => {
    if (status === "ready" || status === "transcribed" || status === "enriched" || status === "failed") {
      setBusy(null);
    }
  }, [status]);

  const retranscribe = async () => {
    setBusy("retranscribe");
    setError("");
    try {
      await api.retranscribe(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha");
      setBusy(null);
    }
  };

  const analyze = async () => {
    setBusy("analyze");
    setError("");
    try {
      await api.analyze(id);
    } catch (err) {
      if (err instanceof ApiError && err.code === "analyze_disabled") {
        setError("A analise por IA esta desligada. Ative em Configuracao e informe a API.");
      } else {
        setError(err instanceof Error ? err.message : "falha ao analisar");
      }
      setBusy(null);
    }
  };

  const stop = async () => {
    setError("");
    try {
      await api.cancel(id);
      setBusy(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao parar");
    }
  };

  const saveNote = async (document: unknown) => {    try {
      await api.createNote(id, "", document);
      setEditing(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao salvar a nota");
    }
  };

  if (!entry) {
    return (
      <section className="view">
        <button type="button" className="link-button" onClick={onBack}>
          Voltar
        </button>
        {error ? <p className="error">{error}</p> : <p className="muted">Carregando...</p>}
      </section>
    );
  }

  const canAnalyze = settings?.analyze_enabled ?? false;

  return (
    <section className="view">
      <div className="view-header">
        <button type="button" className="link-button" onClick={onBack}>
          Voltar
        </button>
        <h1>{entry.title || entry.original_filename || "Entrada"}</h1>
        <div className="actions">
          {(running || busy) && (
            <button type="button" className="danger" onClick={stop}>
              Parar
            </button>
          )}
          <button type="button" onClick={retranscribe} disabled={busy === "retranscribe" || running}>
            {busy === "retranscribe" ? <Spinner /> : null} Retranscrever
          </button>
          <button type="button" onClick={analyze} disabled={busy === "analyze" || running || !canAnalyze}>
            {busy === "analyze" ? <Spinner /> : null} Analisar
          </button>
        </div>
      </div>

      <p className="muted">
        {new Date(entry.created_at).toLocaleString("pt-BR")} · {Math.round(entry.duration_seconds)}s ·{" "}
        {status}
      </p>

      {running && (
        <div className="entry-progress">
          <Spinner />
          <span className="muted">{stageText(progress ?? { status })}</span>
          {progress && (progress.total ?? 0) > 0 && (
            <ProgressBar done={progress.done ?? 0} total={progress.total ?? 0} />
          )}
        </div>
      )}
      {progress?.error && <p className="error">{progress.error}</p>}
      {error && <p className="error">{error}</p>}
      {!canAnalyze && (
        <p className="muted">A analise por IA esta desligada. Ative em Configuracao para enriquecer as entradas.</p>
      )}

      <div className="panels">
        <div className="panel">
          <h2>Transcricao</h2>
          {running && <p className="muted"><Spinner /> transcrevendo ao vivo...</p>}
          {!running && transcript && (
            <p className="muted">
              Modelo de IA: {transcript.model || "(desconhecido)"}
              {transcript.language ? ` · idioma: ${transcript.language}` : ""}
            </p>
          )}
          {running && partials && partials.length > 0 ? (
            <ol className="segments">
              {partials.map((segment, index) => (
                <li key={index}>
                  <span className="timestamp">{formatTime(segment.start_ms)}</span>
                  <span>{segment.text}</span>
                </li>
              ))}
            </ol>
          ) : transcript ? (
            transcript.segments.length > 0 ? (
              <ol className="segments">
                {transcript.segments.map((segment, index) => (
                  <li key={index}>
                    <span className="timestamp">{formatTime(segment.start_ms)}</span>
                    <span>{segment.text}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">{transcript.text || "Transcricao vazia."}</p>
            )
          ) : (
            <p className="muted">
              {running ? "Transcricao em andamento..." : "Transcricao ainda nao disponivel."}
            </p>
          )}
        </div>

        <div className="panel">
          <h2>Analise</h2>
          {analysis ? (
            <div className="analysis">
              <p>
                Sentimento: {sentimentText(analysis.sentiment_label)}{" "}
                <span className="muted">({Number(analysis.sentiment ?? 0).toFixed(2)})</span>
              </p>
              {analysis.summary && <p>{analysis.summary}</p>}

              {analysis.themes && analysis.themes.length > 0 && (
                <div className="analysis-block">
                  <h3>Temas</h3>
                  <ul className="chips">
                    {analysis.themes.map((theme) => (
                      <li key={theme.name}>
                        <button
                          type="button"
                          className="chip-button"
                          onClick={() => onOpenEntity?.("theme", theme.name)}
                        >
                          {theme.name} <span className="muted">{Math.round(theme.confidence * 100)}%</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.people_detail && analysis.people_detail.length > 0 && (
                <div className="analysis-block">
                  <h3>Pessoas</h3>
                  <ul className="chips">
                    {analysis.people_detail.map((person) => (
                      <li key={person.name}>
                        <button
                          type="button"
                          className="chip-button"
                          onClick={() => onOpenEntity?.("person", person.name)}
                        >
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
                  <h3>Lugares</h3>
                  <ul className="chips">
                    {analysis.places_detail.map((place) => (
                      <li key={place.name}>
                        <button
                          type="button"
                          className="chip-button"
                          onClick={() => onOpenEntity?.("place", place.name)}
                        >
                          {place.name} · {place.count}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.emotions_detail && analysis.emotions_detail.length > 0 && (
                <div className="analysis-block">
                  <h3>Emocoes</h3>
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
                  <h3>Momentos-chave</h3>
                  <ol className="segments">
                    {analysis.key_moments.map((moment, index) => (
                      <li key={index}>
                        <span className="timestamp">{formatTime(moment.start_ms)}</span>
                        <span>{moment.text}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {analysis.questions && analysis.questions.length > 0 && (
                <div className="analysis-block">
                  <h3>Perguntas</h3>
                  <ul className="plain-list">
                    {analysis.questions.map((question, index) => (
                      <li key={index}>{question}</li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.decisions && analysis.decisions.length > 0 && (
                <div className="analysis-block">
                  <h3>Decisoes</h3>
                  <ul className="plain-list">
                    {analysis.decisions.map((decision, index) => (
                      <li key={index}>{decision}</li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.emotions && typeof analysis.emotions === "object" && !Array.isArray(analysis.emotions) &&
                !(analysis.emotions_detail && analysis.emotions_detail.length > 0) && (
                  <div className="analysis-block">
                    <h3>Emocoes</h3>
                    <ul className="chips">
                      {Object.entries(analysis.emotions).map(([name, value]) => (
                        <li key={name}>
                          {name} ({typeof value === "number" ? value.toFixed(2) : String(value)})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              {Array.isArray(analysis.people) && analysis.people.length > 0 &&
                !(analysis.people_detail && analysis.people_detail.length > 0) && (
                  <p className="muted">Pessoas: {analysis.people.join(", ")}</p>
                )}
              {Array.isArray(analysis.places) && analysis.places.length > 0 &&
                !(analysis.places_detail && analysis.places_detail.length > 0) && (
                  <p className="muted">Lugares: {analysis.places.join(", ")}</p>
                )}
            </div>
          ) : (
            <p className="muted">
              {busy === "analyze" || status === "analyzing" ? "Analisando..." : "Sem analise."}
            </p>
          )}
        </div>
      </div>

      {entry.metrics && (
        <div className="panel">
          <h2>Recursos</h2>
          <RamBar peak={entry.metrics.whisper_peak_rss_mb} ceiling={settings?.max_whisper_rss_mb ?? 0} />
        </div>
      )}

      <div className="panel">
        <div className="view-header">
          <h2>Notas</h2>
          <button type="button" onClick={() => setEditing((value) => !value)}>
            {editing ? "Cancelar" : "Nova nota"}
          </button>
        </div>
        {editing && <NotesEditor onChange={(blocks) => setNoteDocument(blocks)} />}
        {editing && (
          <button type="button" className="primary" onClick={() => saveNote(noteDocument)}>
            Salvar nota
          </button>
        )}
        {notes.length === 0 && !editing && <p className="muted">Nenhuma nota.</p>}
        <ul className="note-list">
          {notes.map((note) => (
            <li key={note.id}>{note.title || "Nota"}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function RamBar({ peak, ceiling }: { peak: number; ceiling: number }) {
  const percent = ceiling > 0 ? Math.min(100, Math.round((peak / ceiling) * 100)) : 0;
  return (
    <div className="ram">
      <p className="muted">
        Pico de RAM da transcricao: {peak} MB
        {ceiling > 0 ? ` / limite ${ceiling} MB` : " (sem limite configurado)"}
      </p>
      {ceiling > 0 && (
        <div className="ram-track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="ram-fill" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}

export default EntryView;
