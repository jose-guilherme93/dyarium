import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Entry } from "../types";

interface MoodViewProps {
  refreshKey: number;
  onOpen: (id: string) => void;
}

// MoodView lists entries with their sentiment when an analysis is available.
export function MoodView({ refreshKey, onOpen }: MoodViewProps) {
  const [rows, setRows] = useState<{ entry: Entry; sentiment: number | null }[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await api.listEntries();
      const entries = (result.entries ?? []).slice(0, 30);
      const withSentiment = await Promise.all(
        entries.map(async (entry) => {
          try {
            const analysis = await api.getAnalysis(entry.id);
            return { entry, sentiment: analysis.sentiment };
          } catch {
            return { entry, sentiment: null };
          }
        }),
      );
      setRows(withSentiment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao carregar");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const withAnalysis = rows.filter((row) => row.sentiment !== null);
  const average =
    withAnalysis.length > 0
      ? withAnalysis.reduce((sum, row) => sum + (row.sentiment ?? 0), 0) / withAnalysis.length
      : 0;

  return (
    <section className="view">
      <div className="view-header">
        <h1>Humor</h1>
      </div>
      {error && <p className="error">{error}</p>}
      {withAnalysis.length === 0 ? (
        <p className="muted">Sem analises de sentimento ainda.</p>
      ) : (
        <>
          <p className="muted">Sentimento medio: {average.toFixed(2)}</p>
          <ul className="entry-list">
            {withAnalysis.map((row) => (
              <li key={row.entry.id}>
                <button type="button" className="entry-item" onClick={() => onOpen(row.entry.id)}>
                  <span className="entry-title">{row.entry.title || row.entry.original_filename}</span>
                  <span className="entry-meta">Sentimento {(row.sentiment ?? 0).toFixed(2)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export default MoodView;
