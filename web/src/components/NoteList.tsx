import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { api } from "../api";
import { NotificationsMenu } from "./NotificationsMenu";
import { ALL_NOTEBOOKS } from "../lib/notebooks";
import { formatDuration, formatShortDate } from "../lib/format";
import { tagColor } from "../lib/tags";
import { useEscape } from "../lib/useEscape";
import type { Entry, Notebook } from "../types";
import {
  ArchiveIcon,
  CloseIcon,
  MicIcon,
  PlusIcon,
  SearchIcon,
  TagIcon,
} from "./icons";

interface NoteListProps {
  refreshKey: number;
  activeId: string | null;
  failures: Record<string, string>;
  /** Caderno do escopo, ou ALL_NOTEBOOKS para a biblioteca inteira. */
  notebookId: string;
  notebooks: Notebook[];
  /** A faixa recolhida pediu a busca: abre o campo assim que a lista montar. */
  autoSearch?: boolean;
  onSearchOpened?: () => void;
  onOpen: (id: string) => void;
  onCreate: (event: ReactMouseEvent<HTMLButtonElement>) => void;
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
  return `${displayTitle(entry)} ${entry.original_filename ?? ""} ${entry.preview ?? ""} ${(
    entry.tags ?? []
  ).join(" ")}`
    .toLowerCase()
    .includes(query);
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

// NoteList e a lista de notas do escopo escolhido no seletor de cadernos. A
// busca e as tags filtram esse escopo; as arquivadas tem o seu proprio modo.
// As tags ficam num popover para a lista receber quase toda a altura da coluna.
export function NoteList({
  refreshKey,
  activeId,
  failures,
  notebookId,
  notebooks,
  autoSearch = false,
  onSearchOpened,
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
  const [tagsOpen, setTagsOpen] = useState(false);
  const tagMenu = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const cached = await api.listEntriesCached({ limit: 1000 });
    if (cached) {
      setEntries(cached.entries ?? []);
    }
    try {
      const result = await api.listAllEntries();
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
    setTagsOpen(false);
  }, [notebookId]);

  useEffect(() => {
    if (autoSearch) {
      setSearchingOpen(true);
      onSearchOpened?.();
    }
  }, [autoSearch, onSearchOpened]);

  useEffect(() => {
    if (!tagsOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (tagMenu.current && !tagMenu.current.contains(event.target as Node)) {
        setTagsOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [tagsOpen]);

  useEscape(tagsOpen, () => setTagsOpen(false));

  // A nota aberta ganha uma terceira linha com as tags; quando ela esta no fim
  // da lista, essa linha ficava cortada pela borda. Rolar o minimo necessario
  // quando a linha da nota ativa aparece mantem a nota inteira visivel sem
  // puxar a lista para o topo a cada recarga.
  const scrollActiveIntoView = useCallback((node: HTMLButtonElement | null) => {
    node?.scrollIntoView?.({ block: "nearest" });
  }, []);

  const allNotebooks = notebookId === ALL_NOTEBOOKS;
  const notebookById = useMemo(
    () => new Map(notebooks.map((notebook) => [notebook.id, notebook])),
    [notebooks],
  );

  // Escopo: caderno (ou tudo) + a aba de arquivadas.
  const inScope = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (allNotebooks || (entry.notebook_id ?? "") === notebookId) &&
          Boolean(entry.archived) === archived,
      ),
    [entries, notebookId, allNotebooks, archived],
  );

  const term = query.trim().toLowerCase();
  const withTags = useMemo(() => {
    if (selectedTags.length === 0) return inScope;
    return inScope.filter((entry) => {
      const present = new Set((entry.tags ?? []).map((tag) => tag.toLowerCase()));
      return selectedTags.every((tag) => present.has(tag.toLowerCase()));
    });
  }, [inScope, selectedTags]);
  const visible = useMemo(() => {
    const filtered = term ? withTags.filter((entry) => matches(entry, term)) : withTags;
    return [...filtered].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }, [withTags, term]);

  const counts = useMemo(() => tagCounts(inScope, selectedTags), [inScope, selectedTags]);

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

  const row = (entry: Entry) => {
    const isAudio = entry.source !== "text";
    const notebook = notebookById.get(entry.notebook_id ?? "");
    const tags = entry.tags ?? [];
    return (
      <li key={entry.id}>
        <div className={entry.id === activeId ? "note-row note-row--active" : "note-row"}>
          <button
            type="button"
            className="note-row-open"
            ref={entry.id === activeId ? scrollActiveIntoView : undefined}
            onClick={() => onOpen(entry.id)}
          >
            <span className="note-row-head">
              {allNotebooks && notebook && (
                <span
                  className="note-row-dot"
                  style={{ backgroundColor: notebook.color || "var(--color-muted)" }}
                  role="img"
                  aria-label={`Caderno ${notebook.name}`}
                  title={notebook.name}
                />
              )}
              <span className="note-row-title">{displayTitle(entry)}</span>
            </span>
            <span className="note-row-line">
              {isAudio && (
                <span className="note-row-kind" title="Áudio">
                  <MicIcon size={11} />
                  {entry.duration_seconds > 0
                    ? formatDuration(entry.duration_seconds)
                    : "áudio"}
                </span>
              )}
              {entry.preview && <span className="note-row-preview">{entry.preview}</span>}
              {(failures[entry.id] || entry.status === "failed") && (
                <span className="note-row-failed">falhou</span>
              )}
              <span className="note-row-date">{formatShortDate(noteDate(entry))}</span>
            </span>
            {tags.length > 0 && entry.id === activeId && (
              <span className="note-row-tags">
                {tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="mini-tag">
                    <span
                      className="mini-tag-dot"
                      style={{ backgroundColor: tagColor(tag) }}
                      aria-hidden
                    />
                    {tag}
                  </span>
                ))}
                {tags.length > 4 && <span className="mini-tag-more">+{tags.length - 4}</span>}
              </span>
            )}
          </button>
        </div>
      </li>
    );
  };

  return (
    <div className="list">
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
              placeholder="Buscar nas notas"
              aria-label="Buscar nas notas"
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
          <>
            <div className="list-tools">
              <button
                type="button"
                className="icon-button"
                onClick={() => setSearchingOpen(true)}
                aria-label="Buscar nas notas"
                title="Buscar"
              >
                <SearchIcon size={16} />
              </button>
              <button
                type="button"
                className={archived ? "icon-button icon-button--active" : "icon-button"}
                onClick={() => setArchived((value) => !value)}
                aria-pressed={archived}
                aria-label={archived ? "Voltar para as notas" : "Ver notas arquivadas"}
                title={archived ? "Voltar para as notas" : "Arquivadas"}
              >
                <ArchiveIcon size={16} />
              </button>
              <div className="tag-menu" ref={tagMenu}>
                <button
                  type="button"
                  className={
                    selectedTags.length > 0
                      ? "icon-button icon-button--active"
                      : "icon-button"
                  }
                  onClick={() => setTagsOpen((value) => !value)}
                  aria-expanded={tagsOpen}
                  aria-label="Filtrar por tags"
                  title="Filtrar por tags"
                >
                  <TagIcon size={16} />
                </button>
                {tagsOpen && (
                  <div className="tag-popover" role="dialog" aria-label="Filtrar por tags">
                    <div className="tag-popover-head">
                      <span>Tags</span>
                      <button
                        type="button"
                        className="tag-manage"
                        onClick={() => {
                          setTagsOpen(false);
                          onManageTags();
                        }}
                      >
                        Gerenciar
                      </button>
                    </div>
                    {counts.length === 0 ? (
                      <p className="tag-popover-empty">Nenhuma tag ainda.</p>
                    ) : (
                      <div className="tag-filter">
                        <button
                          type="button"
                          className={
                            selectedTags.length === 0
                              ? "tag-filter-all tag-filter-all--on"
                              : "tag-filter-all"
                          }
                          onClick={() => setSelectedTags([])}
                        >
                          Todas
                        </button>
                        {counts.map((tag) => {
                          const selected = selectedTags.some(
                            (item) => item.toLowerCase() === tag.name.toLowerCase(),
                          );
                          return (
                            <button
                              key={tag.name.toLowerCase()}
                              type="button"
                              className={
                                selected
                                  ? "tag-filter-chip tag-filter-chip--on"
                                  : "tag-filter-chip"
                              }
                              aria-pressed={selected}
                              onClick={() => toggleTag(tag.name)}
                            >
                              <span
                                className="tag-filter-dot"
                                style={{ backgroundColor: tagColor(tag.name) }}
                                aria-hidden
                              />
                              {tag.name}
                              <span className="tag-filter-count">{tag.count}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <NotificationsMenu refreshKey={refreshKey} onOpen={onOpen} />
            </div>
            <button
              type="button"
              className="icon-button list-new"
              onClick={onCreate}
              aria-label="Nova nota"
              title="Nova nota"
            >
              <PlusIcon size={16} />
            </button>
          </>
        )}
      </div>

      {selectedTags.length > 0 && (
        <div className="active-filters" aria-label="Filtros ativos">
          {selectedTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className="active-filter"
              onClick={() => toggleTag(tag)}
              aria-label={`Remover filtro ${tag}`}
              title={`Remover filtro ${tag}`}
            >
              <span
                className="mini-tag-dot"
                style={{ backgroundColor: tagColor(tag) }}
                aria-hidden
              />
              {tag}
              <CloseIcon size={11} />
            </button>
          ))}
          <button
            type="button"
            className="active-filters-clear"
            onClick={() => setSelectedTags([])}
          >
            Limpar
          </button>
        </div>
      )}

      {error && <p className="error list-error">{error}</p>}

      <div className="list-scroll">
        {(term || archived) && (
          <h3 className="list-section-label">
            {term ? "Resultados" : archived ? "Arquivadas" : ""}
          </h3>
        )}
        {visible.length === 0 ? (
          <div className="empty-state">
            {term ? (
              <>
                <p>Nada encontrado.</p>
                <p>Tente outro termo ou uma tag.</p>
              </>
            ) : archived ? (
              <>
                <p>Nenhuma nota arquivada.</p>
                <p>Arquivar tira a nota da lista, sem apagar.</p>
              </>
            ) : selectedTags.length > 0 ? (
              <>
                <p>Nenhuma nota com essas tags.</p>
                <p>Limpe o filtro para ver o escopo inteiro.</p>
              </>
            ) : (
              <>
                <p>Nenhuma nota ainda.</p>
                <p>Use o + acima para criar a primeira.</p>
              </>
            )}
          </div>
        ) : (
          <ul className="tree">{visible.map(row)}</ul>
        )}
      </div>
    </div>
  );
}

export default NoteList;
