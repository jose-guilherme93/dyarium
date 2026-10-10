import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { api, uploadFile } from "../api";
import type { Entry } from "../types";

interface EntriesViewProps {
  refreshKey: number;
  onOpen: (id: string) => void;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    received: "Recebido",
    validating: "Validando",
    stored: "Armazenado",
    queued: "Na fila",
    transcribing: "Transcrevendo",
    transcribed: "Transcrito",
    analyzing: "Analisando",
    enriched: "Enriquecido",
    ready: "Pronto",
    failed: "Falhou",
    deleted: "Removido",
  };
  return labels[status] ?? status;
}

export function EntriesView({ refreshKey, onOpen }: EntriesViewProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);

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

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setProgress({ sent: 0, total: file.size });
    try {
      await uploadFile(file, (sent, total) => setProgress({ sent, total }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha no envio");
    } finally {
      setProgress(null);
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

      {progress && (
        <p className="muted">
          Enviando {Math.round((progress.sent / progress.total) * 100)}% (
          {Math.round(progress.sent / 1024)} de {Math.round(progress.total / 1024)} KiB)
        </p>
      )}
      {error && <p className="error">{error}</p>}

      {entries.length === 0 ? (
        <div className="empty-state">
          <p>Nenhuma entrada ainda.</p>
          <p>Envie um audio para comecar a sua primeira entrada.</p>
        </div>
      ) : (
        <ul className="entry-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button type="button" className="entry-item" onClick={() => onOpen(entry.id)}>
                <span className="entry-title">{entry.title || entry.original_filename || "Entrada"}</span>
                <span className="entry-meta">
                  {new Date(entry.created_at).toLocaleString("pt-BR")} ·{" "}
                  {Math.round(entry.duration_seconds)}s · {statusLabel(entry.status)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default EntriesView;
