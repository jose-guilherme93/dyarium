import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { NotesEditor } from "../editor/NotesEditor";
import type { Analysis, Entry, Note, Transcript } from "../types";

interface EntryViewProps {
  id: string;
  refreshKey: number;
  onBack: () => void;
}

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function EntryView({ id, refreshKey, onBack }: EntryViewProps) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [noteDocument, setNoteDocument] = useState<unknown>([]);

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
  }, [id]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const retranscribe = async () => {
    try {
      await api.retranscribe(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha");
    }
  };

  const analyze = async () => {
    try {
      await api.analyze(id);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.code === "analyze_disabled") {
        setError("A analise por IA esta desligada.");
      } else {
        setError(err instanceof Error ? err.message : "falha");
      }
    }
  };

  const saveNote = async (document: unknown) => {
    try {
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

  return (
    <section className="view">
      <div className="view-header">
        <button type="button" className="link-button" onClick={onBack}>
          Voltar
        </button>
        <h1>{entry.title || entry.original_filename || "Entrada"}</h1>
        <div className="actions">
          <button type="button" onClick={retranscribe}>
            Retranscrever
          </button>
          <button type="button" onClick={analyze}>
            Analisar
          </button>
        </div>
      </div>

      <p className="muted">
        {new Date(entry.created_at).toLocaleString("pt-BR")} · {Math.round(entry.duration_seconds)}s ·{" "}
        {entry.status}
      </p>
      {error && <p className="error">{error}</p>}

      <div className="panels">
        <div className="panel">
          <h2>Transcricao</h2>
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
            <p className="muted">Transcricao ainda nao disponivel.</p>
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
              {analysis.people && analysis.people.length > 0 && (
                <p>Pessoas: {analysis.people.join(", ")}</p>
              )}
              {analysis.places && analysis.places.length > 0 && (
                <p>Lugares: {analysis.places.join(", ")}</p>
              )}
            </div>
          ) : (
            <p className="muted">Sem analise.</p>
          )}
        </div>
      </div>

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

export default EntryView;
