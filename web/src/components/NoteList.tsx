import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { formatDateTime } from "../lib/format";
import { tagColor, withAlpha } from "../lib/tags";
import type { Entry, Notebook } from "../types";
import { ArchiveIcon, CloseIcon, PlusIcon, SearchIcon } from "./icons";

interface NoteListProps {
  refreshKey: number;
  activeId: string | null;
  failures: Record<string, string>;
  notebookId: string;
  notebooks: Notebook[];
  onOpen: (id: string) => void;
  onCreate: () => void;
  onManageTags: () => void;
}

// displayTitle hides the date older automatic titles carried; the date is shown
// separately, small, below the title.
function displayTitle(entry: Entry): string {
  const raw = entry.title || entry.original_filename || "Nota";
  return raw.replace(/\s·\s\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}$/, "");
}

function noteDate(entry: Entry): string {
  return entry.recorded_at ?? entry.created_at;
}

function matches(entry: Entry, query: string): boolean {
  return `${displayTitle(entry)} ${entry.original_filename} ${(entry.tags ?? []).join(" ")}`
    .toLowerCase()
    .includes(query);
}

function byDate(a: Entry, b: Entry): number {
  return noteDate(a) < noteDate(b) ? 1 : -1;
}

function tagCounts(entries: Entry[], selected: string[]): { name: string; count: number }[] {
  const universe = new Map<string, { name: string; count: number }>();
  for (const entry of entries) {
    for (const tag of entry.tags ?? []) {
      const key = tag.toLowerCase();
      const current = universe.get(key);
      if (current) current.count += 1;
      else universe.set(key, { name: tag, count: 1 });
    }
  }
  if (selected.length === 0) {
    return [...universe.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  const selectedKeys = selected.map((tag) => tag.toLowerCase());
  return [...universe.values()]
    .map((tag) => {
      const key = tag.name.toLowerCase();
      const wanted = selectedKeys.includes(key) ? selectedKeys : [...selectedKeys, key];
      const count = entries.filter((entry) => {
        const present = new Set((entry.tags ?? []).map((item) => item.toLowerCase()));
        return wanted.every((item) => present.has(item));
      }).length;
      return { name: tag.name, count };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// NoteList e a lista de notas do caderno ativo. A busca e global (todos os
// cadernos); as tags filtram o caderno aberto com E entre si. Subnotas foram
// desativadas: a lista e plana.
export function NoteList({
  refreshKey,
  activeId,
  failures,
  notebookId,
  notebooks,
  onOpen,
  onCreate,
  onManageTags,
}: NoteListProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [archived, setArchived] = useState(false);
  const [searchingOpen, setSearchingOpen] = useState(false);
  // A lista abre em "Recentes" (todos os cadernos, por updated_at). O outro lado
  // do toggle mostra o caderno atual na ordem temporal (recorded_at).
  const [viewMode, setViewMode] = useState<"recent" | "notebook">("recent");

  const load = useCallback(async () => {
    // Carrega as duas listas (ativas e arquivadas) de uma vez: a busca global
    // inclui arquivadas e o toggle so muda a visao.
    const cached = await api.listEntriesCached({ limit: 2000 });
    if (cached) {
      setEntries(cached.entries ?? []);
    }
    try {
      const result = await api.listEntries({ limit: 2000 });
      setEntries(result.entries ?? []);
      setError("");
    } catch (err) {
      if (!cached) {
        setError(err instanceof Error ? err.message : "falha ao carregar");
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    setSelectedTags([]);
    setQuery("");
  }, [notebookId, viewMode]);

  const notebookById = useMemo(
    () => new Map(notebooks.map((notebook) => [notebook.id, notebook])),
    [notebooks],
  );

  const term = query.trim().toLowerCase();
  const activeAcross = useMemo(
    () => entries.filter((entry) => !entry.archived),
    [entries],
  );
  const inNotebook = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (entry.notebook_id ?? "") === notebookId && Boolean(entry.archived) === archived,
      ),
    [entries, notebookId, archived],
  );
  const scoped = viewMode === "recent" ? activeAcross : inNotebook;
  const withTags = useMemo(() => {
    if (selectedTags.length === 0) return scoped;
    return scoped.filter((entry) => {
      const present = new Set((entry.tags ?? []).map((tag) => tag.toLowerCase()));
      return selectedTags.every((tag) => present.has(tag.toLowerCase()));
    });
  }, [scoped, selectedTags]);
  const visible = useMemo(() => {
    const filtered = term ? withTags.filter((entry) => matches(entry, term)) : withTags;
    return [...filtered].sort(
      viewMode === "recent"
        ? (a, b) => (a.updated_at < b.updated_at ? 1 : -1)
        : byDate,
    );
  }, [withTags, term, viewMode]);
  const counts = useMemo(
    () =>
      tagCounts(
        viewMode === "recent" ? activeAcross : inNotebook,
        selectedTags,
      ),
    [viewMode, activeAcross, inNotebook, selectedTags],
  );

  const searching = searchingOpen || term !== "";
  const closeSearch = () => {
    setSearchingOpen(false);
    setQuery("");
  };

  const toggleTag = (name: string) => {
    setSelectedTags((current) =>
      current.some((tag) => tag.toLowerCase() === name.toLowerCase())
        ? current.filter((tag) => tag.toLowerCase() !== name.toLowerCase())
        : [...current, name],
    );
  };

  const changeMode = (mode: "recent" | "notebook") => {
    setViewMode(mode);
    if (mode === "recent") setArchived(false);
  };

  const row = (entry: Entry, showNotebook: boolean) => (
    <li key={entry.id}>
      <div className={entry.id === activeId ? "tree-row tree-row--active" : "tree-row"}>
        <button type="button" className="tree-main" onClick={() => onOpen(entry.id)}>
          <span className="tree-title">{displayTitle(entry)}</span>
          <span className="tree-date">
            {formatDateTime(noteDate(entry))}
            {showNotebook && (
              <span className="tree-notebook">
                {notebookById.get(entry.notebook_id ?? "")?.name ?? "Notas ao acaso"}
              </span>
            )}
            {failures[entry.id] && <span className="tree-failed">falhou</span>}
          </span>
          {(entry.tags ?? []).length > 0 && (
            <span className="tree-tags">
              {(entry.tags ?? []).slice(0, 2).map((tag) => {
                const color = tagColor(tag);
                return (
                  <span
                    key={tag}
                    className="tree-tag"
                    style={{ backgroundColor: withAlpha(color, 0.72), color: "#211e1a" }}
                  >
                    {tag}
                  </span>
                );
              })}
              {(entry.tags ?? []).length > 2 && (
                <span className="tree-tag-more">+{(entry.tags ?? []).length - 2}</span>
              )}
            </span>
          )}
        </button>
      </div>
    </li>
  );

  return (
    <div className="list">
      <div className="view-toggle" role="tablist" aria-label="Visão da lista">
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === "recent"}
          className={viewMode === "recent" ? "view-toggle-option view-toggle-option--on" : "view-toggle-option"}
          onClick={() => changeMode("recent")}
        >
          Recentes
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === "notebook"}
          className={viewMode === "notebook" ? "view-toggle-option view-toggle-option--on" : "view-toggle-option"}
          onClick={() => changeMode("notebook")}
        >
          Caderno
        </button>
      </div>

      <div className="list-head">
        {searching ? (
          <label className="list-search">
            <SearchIcon size={16} />
            <input
              type="search"
              value={query}
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  closeSearch();
                }
              }}
              placeholder={
                viewMode === "recent"
                  ? "Buscar em todos os cadernos"
                  : "Buscar neste caderno"
              }
              aria-label={
                viewMode === "recent"
                  ? "Buscar em todos os cadernos"
                  : "Buscar neste caderno"
              }
            />
            <button
              type="button"
              className="search-close"
              onClick={closeSearch}
              aria-label="Fechar busca"
              title="Fechar busca"
            >
              <CloseIcon size={14} />
            </button>
          </label>
        ) : (
          <button
            type="button"
            className="icon-button"
            onClick={() => setSearchingOpen(true)}
            aria-label="Buscar em todos os cadernos"
            title="Buscar em todos os cadernos"
          >
            <SearchIcon size={16} />
          </button>
        )}
        {viewMode === "notebook" && (
          <button
            type="button"
            className={archived ? "icon-button icon-button--active" : "icon-button"}
            onClick={() => setArchived((value) => !value)}
            aria-pressed={archived}
            aria-label={archived ? "Ver notas da lista de trabalho" : "Ver notas arquivadas"}
            title={archived ? "Lista de trabalho" : "Ver arquivadas"}
          >
            <ArchiveIcon size={16} />
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          onClick={onCreate}
          aria-label="Nova nota"
          title="Nova nota"
        >
          <PlusIcon size={16} />
        </button>
      </div>

      {error && <p className="error list-error">{error}</p>}

      <div className="tag-filter" aria-label="Filtrar por tags">
        <button
          type="button"
          className={selectedTags.length === 0 ? "tag-filter-all tag-filter-all--on" : "tag-filter-all"}
          onClick={() => setSelectedTags([])}
        >
          Todas
        </button>
        {counts.map((tag) => {
          const color = tagColor(tag.name);
          const selected = selectedTags.some(
            (item) => item.toLowerCase() === tag.name.toLowerCase(),
          );
          return (
            <button
              key={tag.name.toLowerCase()}
              type="button"
              className="tag-filter-chip"
              aria-pressed={selected}
              onClick={() => toggleTag(tag.name)}
              style={{
                backgroundColor: withAlpha(color, selected ? 0.92 : 0.62),
                borderColor: selected ? "#211e1a" : withAlpha(color, 0.9),
                color: "#211e1a",
              }}
            >
              {tag.name}
              <span className="tag-filter-count">{tag.count}</span>
            </button>
          );
        })}
        <button type="button" className="tag-filter-manage" onClick={onManageTags}>
          Gerenciar tags
        </button>
      </div>

      <div className="list-scroll">
        {(viewMode === "notebook" || term) && (
          <h3 className="list-section-label">
            {term
              ? "Resultados"
              : archived
                ? "Arquivadas"
                : "Neste caderno"}
          </h3>
        )}
        {visible.length === 0 ? (
          <div className="empty-state">
            {term ? (
              <>
                <p>Nada encontrado.</p>
                <p>Tente outro termo ou uma tag.</p>
              </>
            ) : viewMode === "notebook" && archived ? (
              <>
                <p>Nenhuma nota arquivada.</p>
                <p>Arquivar tira a nota da lista, sem apagar.</p>
              </>
            ) : selectedTags.length > 0 ? (
              <>
                <p>Nenhuma nota com essas tags.</p>
                <p>Limpe o filtro para ver a lista inteira.</p>
              </>
            ) : (
              <>
                <p>Nenhuma nota ainda.</p>
                <p>Use o "+" para criar a primeira.</p>
              </>
            )}
          </div>
        ) : (
          <ul className="tree">
            {visible.map((entry) => row(entry, viewMode === "recent"))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default NoteList;
