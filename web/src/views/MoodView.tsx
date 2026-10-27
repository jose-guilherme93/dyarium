import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { MoodPoint } from "../types";

interface MoodViewProps {
  refreshKey: number;
}

// MoodView shows the daily sentiment timeline from GET /mood.
export function MoodView({ refreshKey }: MoodViewProps) {
  const [points, setPoints] = useState<MoodPoint[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await api.getMood();
      setPoints(result.mood ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao carregar");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const average =
    points.length > 0 ? points.reduce((sum, point) => sum + point.sentiment, 0) / points.length : 0;

  return (
    <section className="view">
      {error && <p className="error">{error}</p>}
      {points.length === 0 ? (
        <div className="empty-state">
          <p>Sem análise de sentimento ainda.</p>
          <p>O humor aparece depois que as notas passam pela análise.</p>
        </div>
      ) : (
        <>
          <p className="muted mood-summary">
            Tom médio das {points.length} {points.length === 1 ? "análise" : "análises"}:{" "}
            <strong>{average.toFixed(2)}</strong>
          </p>
          <ul className="mood-list">
            {points.map((point) => (
              <li key={point.date}>
                <span className="mood-date">{new Date(`${point.date}T00:00:00`).toLocaleDateString("pt-BR")}</span>
                <span className="mood-track">
                  <span
                    className={point.sentiment >= 0 ? "mood-fill mood-pos" : "mood-fill mood-neg"}
                    style={{ width: `${Math.round(Math.min(1, Math.abs(point.sentiment)) * 100)}%` }}
                  />
                </span>
                <span className="muted">
                  {point.sentiment.toFixed(2)}, {point.entries} {point.entries === 1 ? "nota" : "notas"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export default MoodView;
