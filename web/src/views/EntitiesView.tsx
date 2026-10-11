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
        <div className="view-header">
          <button type="button" className="link-button" onClick={() => onSelect(null)}>
            Voltar
          </button>
          <h1>{selected}</h1>
        </div>
        {error && <p className="error">{error}</p>}
        {!detail && !error && (
          <p className="muted">
            <Spinner /> Carregando...
          </p>
        )}
        {detail && (
          <>
            <p className="muted">
              {detail.mentions} mencoes em {detail.entries} entrada(s) · sentimento{" "}
              {Number(detail.sentiment ?? 0).toFixed(2)} · visto por ultimo em {formatDate(detail.last_seen)}
            </p>
            {detail.entry_list.length === 0 ? (
              <p className="muted">Nenhuma entrada.</p>
            ) : (
              <ul className="entry-list">
                {detail.entry_list.map((entry) => (
                  <li key={entry.id}>
                    <button type="button" className="entry-item" onClick={() => onOpen(entry.id)}>
                      <span className="entry-title">{entry.title || "Entrada"}</span>
                      <span className="entry-meta">
                        {formatDate(entry.date)} · {entry.count} mencao(oes)
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
      <div className="view-header">
        <h1>{title}</h1>
      </div>
      {error && <p className="error">{error}</p>}
      {loading && entities.length === 0 ? (
        <p className="muted">
          <Spinner /> Carregando...
        </p>
      ) : entities.length === 0 ? (
        <div className="empty-state">
          <p>Nada por aqui ainda.</p>
          <p>As entidades aparecem depois que uma entrada e analisada pela IA.</p>
        </div>
      ) : (
        <ul className="entry-list">
          {entities.map((entity) => (
            <li key={entity.name}>
              <button type="button" className="entry-item" onClick={() => onSelect(entity.name)}>
                <span className="entry-title">{entity.name}</span>
                <span className="entry-meta">
                  {entity.mentions} mencao(oes) em {entity.entries} entrada(s) · sentimento{" "}
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
