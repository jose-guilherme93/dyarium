import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Entry } from "../types";

interface SearchViewProps {
  refreshKey: number;
  onOpen: (id: string) => void;
}

// SearchView filters entries by title or filename on the client.
export function SearchView({ refreshKey, onOpen }: SearchViewProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await api.listEntries();
      setEntries(result.entries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao carregar");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const term = query.trim().toLowerCase();
  const results = term
    ? entries.filter((entry) =>
        `${entry.title} ${entry.original_filename}`.toLowerCase().includes(term),
      )
    : [];

  return (
    <section className="view">
      <div className="view-header">
        <h1>Busca</h1>
      </div>
      <input
        type="search"
        aria-label="Buscar entradas"
        placeholder="Buscar por titulo ou arquivo"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {error && <p className="error">{error}</p>}
      {term && results.length === 0 && <p className="muted">Nenhum resultado.</p>}
      <ul className="entry-list">
        {results.map((entry) => (
          <li key={entry.id}>
            <button type="button" className="entry-item" onClick={() => onOpen(entry.id)}>
              <span className="entry-title">{entry.title || entry.original_filename}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default SearchView;
