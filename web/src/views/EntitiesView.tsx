import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Spinner } from "../components/Status";
import type { EntityDetail, EntityKind, EntitySummary } from "../types";

interface EntitiesViewProps {
  kind: EntityKind;
  title: string;
  selected: string | null;
  onSelect: (name: string | null) => void;
  onOpen: (id: string) => void;
  refreshKey: number;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "sem data";
  }
  return new Date(value).toLocaleDateString("pt-BR");
}

// EntitiesView lists the extracted entities of one kind and, when one is
// selected, the entries that mention it.
export function EntitiesView({ kind, title, selected, onSelect, onOpen, refreshKey }: EntitiesViewProps) {
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const result = await api.listEntities(kind);
      setEntities(result.entities ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao carregar");
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    api
      .getEntity(kind, selected)
      .then((value) => {
        if (!cancelled) {
          setDetail(value);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "falha ao carregar");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [kind, selected, refreshKey]);

  if (selected) {
    return (
      <section className="view">
        <header className="page-head">
          <div>
            <button type="button" className="link-button" onClick={() => onSelect(null)}>
              Voltar aos insights
            </button>
            <h1>{selected}</h1>
            {detail && (
              <p>
                {detail.mentions} {detail.mentions === 1 ? "menção" : "menções"} em {detail.entries}{" "}
                {detail.entries === 1 ? "nota" : "notas"} · tom{" "}
                {Number(detail.sentiment ?? 0).toFixed(2)} · visto por último em{" "}
                {formatDate(detail.last_seen)}
              </p>
            )}
          </div>
        </header>
        {error && <p className="error">{error}</p>}
        {!detail && !error && (
          <p className="muted">
            <Spinner /> Carregando...
          </p>
        )}
        {detail && (
          <>
            {detail.entry_list.length === 0 ? (
              <p className="muted">Nenhuma nota menciona {selected}.</p>
            ) : (
              <ul className="entry-list">
                {detail.entry_list.map((entry) => (
                  <li key={entry.id}>
                    <button type="button" className="entry-item" onClick={() => onOpen(entry.id)}>
                      <span className="entry-title">{entry.title || "Entrada"}</span>
                      <span className="entry-meta">
                        {formatDate(entry.date)} · {entry.count}{" "}
                        {entry.count === 1 ? "menção" : "menções"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    );
  }

  return (
    <section className="view">
      {title && (
        <header className="page-head">
          <div>
            <h1>{title}</h1>
          </div>
        </header>
      )}
      {error && <p className="error">{error}</p>}
      {loading && entities.length === 0 ? (
        <p className="muted">
          <Spinner /> Carregando...
        </p>
      ) : entities.length === 0 ? (
        <div className="empty-state">
          <p>Nada por aqui ainda.</p>
          <p>As entidades aparecem depois que uma nota passa pela análise.</p>
        </div>
      ) : (
        <ul className="entry-list">
          {entities.map((entity) => (
            <li key={entity.name}>
              <button type="button" className="entry-item" onClick={() => onSelect(entity.name)}>
                <span className="entry-title">{entity.name}</span>
                <span className="entry-meta">
                  {entity.mentions} {entity.mentions === 1 ? "menção" : "menções"} em{" "}
                  {entity.entries} {entity.entries === 1 ? "nota" : "notas"} · tom{" "}
                  {Number(entity.sentiment ?? 0).toFixed(2)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default EntitiesView;
