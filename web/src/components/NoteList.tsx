import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api";
import { formatDateTime } from "../lib/format";
import type { Entry } from "../types";
import { ArchiveIcon, ChevronIcon, CloseIcon, PlusIcon, SearchIcon } from "./icons";

interface NoteListProps {
  refreshKey: number;
  activeId: string | null;
  failures: Record<string, string>;
  onOpen: (id: string) => void;
  // onCreate creates a note: parentId null creates a top-level note (under the
  // root), otherwise a subnote of the given note.
  onCreate: (parentId: string | null) => void;
}

interface TreeNode {
  entry: Entry;
  children: TreeNode[];
}

// displayTitle hides the date older automatic titles carried; the date is shown
// separately, small, below the title.
function displayTitle(entry: Entry): string {
  const raw = entry.title || entry.original_filename || "Nota";
  return raw.replace(/\s·\s\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}$/, "");
}

function buildTree(entries: Entry[]): TreeNode[] {
  const ids = new Set(entries.map((entry) => entry.id));
  const childrenOf = new Map<string, Entry[]>();
  for (const entry of entries) {
    const parent = entry.parent_id && ids.has(entry.parent_id) ? entry.parent_id : "";
    const list = childrenOf.get(parent);
    if (list) {
      list.push(entry);
    } else {
      childrenOf.set(parent, [entry]);
    }
  }
  const make = (parent: string): TreeNode[] =>
    (childrenOf.get(parent) ?? [])
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .map((entry) => ({ entry, children: make(entry.id) }));
  return make("");
}

function matches(entry: Entry, query: string): boolean {
  return `${displayTitle(entry)} ${entry.original_filename}`.toLowerCase().includes(query);
}

function prune(nodes: TreeNode[], query: string): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of nodes) {
    const children = prune(node.children, query);
    if (matches(node.entry, query) || children.length > 0) {
      out.push({ entry: node.entry, children });
    }
  }
  return out;
}

// NoteList is the notes tree in the left panel, like Trilium/Notion: notes can
// have subnotes, expand/collapse, and a "+" on each row creates a child.
export function NoteList({ refreshKey, activeId, failures, onOpen, onCreate }: NoteListProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  // Arquivadas tem lista propria: sao as notas que o celular tirou da lista de
  // trabalho. Sem isso, arquivar no celular sumiria com a nota daqui.
  const [archived, setArchived] = useState(false);
  // A busca so ocupa espaco enquanto esta em uso.
  const [searchingOpen, setSearchingOpen] = useState(false);

  const load = useCallback(async () => {
    const cached = await api.listEntriesCached({ archived });
    if (cached) {
      setEntries(cached.entries ?? []);
    }
    try {
      const result = await api.listEntries({ archived });
      setEntries(result.entries ?? []);
      setError("");
    } catch (err) {
      if (!cached) {
        setError(err instanceof Error ? err.message : "falha ao carregar");
      }
    }
  }, [archived]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const toggle = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const term = query.trim().toLowerCase();
  const tree = term ? prune(buildTree(entries), term) : buildTree(entries);

  // A busca e so um icone de lupa: o campo aparece quando ela e acionada e some
  // quando nao ha nada digitado, para o menu ficar so com a lista de notas.
  const searching = searchingOpen || term !== "";
  const closeSearch = () => {
    setSearchingOpen(false);
    setQuery("");
  };

  const renderNodes = (nodes: TreeNode[], depth: number): ReactNode =>
    nodes.map((node) => {
      const hasChildren = node.children.length > 0;
      const isCollapsed = collapsed.has(node.entry.id);
      return (
        <li key={node.entry.id}>
          <div
            className={node.entry.id === activeId ? "tree-row tree-row--active" : "tree-row"}
            style={{ paddingLeft: `${4 + depth * 14}px` }}
          >
            <button
              type="button"
              className={hasChildren ? "tree-toggle" : "tree-toggle tree-toggle--empty"}
              onClick={() => hasChildren && toggle(node.entry.id)}
              aria-label={isCollapsed ? "Expandir" : "Recolher"}
              aria-expanded={hasChildren ? !isCollapsed : undefined}
              tabIndex={hasChildren ? 0 : -1}
            >
              {hasChildren && (
                <ChevronIcon size={14} />
              )}
            </button>
            <button type="button" className="tree-main" onClick={() => onOpen(node.entry.id)}>
              <span className="tree-title">{displayTitle(node.entry)}</span>
              <span className="tree-date">
                {formatDateTime(node.entry.created_at)}
                {failures[node.entry.id] && <span className="tree-failed">falhou</span>}
              </span>
            </button>
            <button
              type="button"
              className="tree-add"
              onClick={() => onCreate(node.entry.id)}
              aria-label="Nova subnota"
              title="Nova subnota"
            >
              <PlusIcon size={14} />
            </button>
          </div>
          {hasChildren && !isCollapsed && (
            <ul className="tree-children">{renderNodes(node.children, depth + 1)}</ul>
          )}
        </li>
      );
    });

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
              placeholder="Buscar notas"
              aria-label="Buscar notas"
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
            aria-label="Buscar notas"
            title="Buscar notas"
          >
            <SearchIcon size={16} />
          </button>
        )}
        <button
          type="button"
          className={archived ? "icon-button icon-button--active" : "icon-button"}
          onClick={() => setArchived((value) => !value)}
          aria-pressed={archived}
          aria-label={archived ? "Ver notas da lista de trabalho" : "Ver notas arquivadas"}
          title={archived ? "Lista de trabalho" : "Arquivadas"}
        >
          <ArchiveIcon size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => onCreate(null)}
          aria-label="Nova nota"
          title="Nova nota"
        >
          <PlusIcon size={16} />
        </button>
      </div>

      {error && <p className="error list-error">{error}</p>}

      <div className="list-scroll">
        {tree.length === 0 ? (
          <div className="empty-state">
            {archived ? (
              <>
                <p>Nenhuma nota arquivada.</p>
                <p>Arquivar no celular tira a nota da lista, sem apagar.</p>
              </>
            ) : (
              <>
                <p>Nenhuma nota ainda.</p>
                <p>Use o "+" para criar a primeira.</p>
              </>
            )}
          </div>
        ) : (
          <ul className="tree">{renderNodes(tree, 0)}</ul>
        )}
      </div>
    </div>
  );
}

export default NoteList;
