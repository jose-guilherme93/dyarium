import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { api, uploadFile } from "../api";
import type { Entry, EntryProgress, Segment } from "../types";
import { ProgressBar, Spinner, isBusy, stageText, statusLabel } from "../components/Status";

interface EntriesViewProps {
  refreshKey: number;
  progress: Record<string, EntryProgress>;
  partials: Record<string, Segment[]>;
  onOpen: (id: string) => void;
}

export function EntriesView({ refreshKey, progress, partials, onOpen }: EntriesViewProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  const [upload, setUpload] = useState<{ sent: number; total: number; name: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.listEntries();
      setEntries(result.entries ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao carregar");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const stopEntry = async (id: string) => {
    try {
      await api.cancel(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao parar");
    }
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setUpload({ sent: 0, total: file.size, name: file.name });
    try {
      await uploadFile(file, (sent, total) => setUpload({ sent, total, name: file.name }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha no envio");
    } finally {
      setUpload(null);
      event.target.value = "";
    }
  };

  return (
    <section className="view">
      <div className="view-header">
        <h1>Entradas</h1>
        <label className="upload-button">
          Enviar audio
          <input
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.aac,.adts,.ogg,.oga,.opus,.flac,.webm,.amr,.wma,.3gp,.mp4"
            onChange={handleFile}
            hidden
          />
        </label>
      </div>

      {upload && (
        <div className="upload-status">
          <p className="muted">
            <Spinner /> Enviando {upload.name} —{" "}
            {Math.round((upload.sent / Math.max(upload.total, 1)) * 100)}% (
            {Math.round(upload.sent / 1024)} de {Math.round(upload.total / 1024)} KiB)
          </p>
          <ProgressBar done={upload.sent} total={upload.total} />
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {entries.length === 0 && !upload ? (
        <div className="empty-state">
          <p>Nenhuma entrada ainda.</p>
          <p>Envie um audio para comecar a sua primeira entrada.</p>
        </div>
      ) : (
        <ul className="entry-list">
          {entries.map((entry) => {
            const p = progress[entry.id];
            const status = p?.status ?? entry.status;
            const busy = isBusy(status);
            return (
              <li key={entry.id} className="entry-row">
                <button type="button" className="entry-item" onClick={() => onOpen(entry.id)}>
                  <span className="entry-title">{entry.title || entry.original_filename || "Entrada"}</span>
                  <span className="entry-meta">
                    {new Date(entry.created_at).toLocaleString("pt-BR")} ·{" "}
                    {Math.round(entry.duration_seconds)}s · {statusLabel(status)}
                  </span>
                  {busy && (
                    <span className="entry-progress">
                      <Spinner />
                      <span className="muted">{stageText(p ?? { status })}</span>
                      {p && (p.total ?? 0) > 0 && <ProgressBar done={p.done ?? 0} total={p.total ?? 0} />}
                    </span>
                  )}
                  {busy && (partials[entry.id]?.length ?? 0) > 0 && (
                    <span className="entry-live muted">
                      {partials[entry.id].slice(-1)[0].text}
                    </span>
                  )}
                  {p?.error && <span className="error">{p.error}</span>}
                </button>
                {busy && (
                  <button type="button" className="danger entry-stop" onClick={() => void stopEntry(entry.id)}>
                    Parar
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default EntriesView;
