import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";
import type { Entry } from "../types";

interface SearchViewProps {
  refreshKey: number;
  onOpen: (id: string) => void;
}

const EMPTY_FILTERS = { person: "", place: "", theme: "" };

// SearchView filters entries by title (client side) and by person, place or
// theme (server side, via GET /entries).
export function SearchView({ refreshKey, onOpen }: SearchViewProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const hasFilter = applied.person !== "" || applied.place !== "" || applied.theme !== "";
    try {
      const result = await api.listEntries(hasFilter ? applied : undefined);
      setEntries(result.entries ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao carregar");
    }
  }, [applied]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setApplied(filters);
  };

  const term = query.trim().toLowerCase();
  const results = term
    ? entries.filter((entry) =>
        `${entry.title} ${entry.original_filename}`.toLowerCase().includes(term),
      )
    : entries;

  const hasFilter = applied.person !== "" || applied.place !== "" || applied.theme !== "";

  return (
    <section className="view">
      <div className="view-header">
        <h1>Busca</h1>
      </div>
      <form className="search-filters" onSubmit={submit}>
        <label>
          Pessoas
          <input
            type="text"
            aria-label="Filtrar por pessoa"
            value={filters.person}
            onChange={(event) => setFilters({ ...filters, person: event.target.value })}
          />
        </label>
        <label>
          Lugares
          <input
            type="text"
            aria-label="Filtrar por lugar"
            value={filters.place}
            onChange={(event) => setFilters({ ...filters, place: event.target.value })}
          />
        </label>
        <label>
          Temas
          <input
            type="text"
            aria-label="Filtrar por tema"
            value={filters.theme}
            onChange={(event) => setFilters({ ...filters, theme: event.target.value })}
          />
        </label>
        <button type="submit" className="primary">
          Filtrar
        </button>
        {hasFilter && (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              setApplied(EMPTY_FILTERS);
            }}
          >
            Limpar filtros
          </button>
        )}
      </form>

      <input
        type="search"
        aria-label="Buscar entradas"
        placeholder="Buscar por titulo ou arquivo"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {error && <p className="error">{error}</p>}
      {results.length === 0 ? (
        <p className="muted">Nenhum resultado.</p>
      ) : (
        <ul className="entry-list">
          {results.map((entry) => (
            <li key={entry.id}>
              <button type="button" className="entry-item" onClick={() => onOpen(entry.id)}>
                <span className="entry-title">{entry.title || entry.original_filename}</span>
                <span className="entry-meta">{new Date(entry.created_at).toLocaleString("pt-BR")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default SearchView;
