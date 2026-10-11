import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { NotesEditor } from "../editor/NotesEditor";
import { ProgressBar, Spinner, isBusy, stageText } from "../components/Status";
import type { Analysis, Entry, EntryProgress, Note, Settings, Transcript } from "../types";

interface EntryViewProps {
  id: string;
  refreshKey: number;
  progress?: EntryProgress;
  onBack: () => void;
}

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function EntryView({ id, refreshKey, progress, onBack }: EntryViewProps) {
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
          {transcript && (
            <p className="muted">
              Modelo de IA: {transcript.model || "(desconhecido)"}
              {transcript.language ? ` · idioma: ${transcript.language}` : ""}
            </p>
          )}
          {transcript ? (
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
            <div>
              <p>Sentimento: {analysis.sentiment.toFixed(2)}</p>
              {analysis.summary && <p>{analysis.summary}</p>}
              {analysis.emotions && (
                <ul className="chips">
                  {Object.entries(analysis.emotions).map(([name, value]) => (
                    <li key={name}>
                      {name} ({value.toFixed(2)})
                    </li>
                  ))}
                </ul>
              )}
              {analysis.people && analysis.people.length > 0 && <p>Pessoas: {analysis.people.join(", ")}</p>}
              {analysis.places && analysis.places.length > 0 && <p>Lugares: {analysis.places.join(", ")}</p>}
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
