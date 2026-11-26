import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { api } from "../api";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { NotificationsMenu } from "./NotificationsMenu";
import { ListSkeleton } from "./Skeleton";
import { ALL_NOTEBOOKS } from "../lib/notebooks";

const NOTE_ORDER_KEY = "dyarium.noteOrder";

function readNoteOrder(): NoteOrder {
  try {
    const value = localStorage.getItem(NOTE_ORDER_KEY);
    return value === "oldest" ? "oldest" : "newest";
  } catch {
    return "newest";
  }
}
import { normalizeSearch } from "../lib/search";
import { formatShortDateTime } from "../lib/format";
import { tagColor } from "../lib/tags";
import { noteTitle } from "../lib/noteTitle";
import { noteDate, sortNotesByDate, type NoteOrder } from "../lib/noteOrder";
import { useEscape } from "../lib/useEscape";
import type { Entry, Notebook } from "../types";
import {
  ArchiveIcon,
  CheckIcon,
  CloseIcon,
  SearchIcon,
  SelectIcon,
  SortIcon,
  TagIcon,
} from "./icons";
import { useToast } from "./Toasts";
import { Icon } from "../ui";

interface NoteListProps {
  refreshKey: number;
  activeId: string | null;
  failures: Record<string, string>;
  /** Caderno do escopo, ou ALL_NOTEBOOKS para a biblioteca inteira. */
  notebookId: string;
  notebooks: Notebook[];
  /** A faixa recolhida pediu a busca: abre o campo assim que a lista montar. */
  autoSearch?: boolean;
  /** Mostra o botao de lupa no cabecalho da lista. Padrao true. */
  showSearch?: boolean;
  /** Drive nao sincroniza: mostra marca vermelha nas notas locais. */
  unsynced?: boolean;
  onSearchOpened?: () => void;
  onOpen: (id: string, title?: string) => void;
  /** Abre a nota numa aba nova; ausente, a acao nao aparece no menu. */
  onOpenInNewTab?: (id: string, title?: string) => void;
  onCreate: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onManageTags: () => void;
  /** Notas apagadas ou arquivadas: o dono do estado fecha a aba delas. */
  onMutated?: (removedIds: string[]) => void;
}

// A busca usa o mesmo titulo que a linha mostra (o automatico antigo trazia a
// data no fim; ela aparece separada, pequena, abaixo).
function matches(entry: Entry, query: string): boolean {
  return normalizeSearch(
    `${noteTitle(entry)} ${entry.original_filename ?? ""} ${entry.preview ?? ""} ${(
      entry.tags ?? []
    ).join(" ")}`,
  ).includes(query);
}

function tagCounts(entries: Entry[], selected: string[]): { name: string; count: number }[] {
  const universe = new Map<string, { name: string; count: number }>();
  for (const entry of entries) {
    for (const tag of entry.tags ?? []) {
      const key = normalizeSearch(tag);
      const current = universe.get(key);
      if (current) current.count += 1;
      else universe.set(key, { name: tag, count: 1 });
    }
  }
  if (selected.length === 0) {
    return [...universe.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  const selectedKeys = selected.map((tag) => normalizeSearch(tag));
  return [...universe.values()]
    .map((tag) => {
      const key = normalizeSearch(tag.name);
      const wanted = selectedKeys.includes(key) ? selectedKeys : [...selectedKeys, key];
      const count = entries.filter((entry) => {
        const present = new Set((entry.tags ?? []).map((item) => normalizeSearch(item)));
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
  showSearch = true,
  unsynced = false,
  onSearchOpened,
  onOpen,
  onOpenInNewTab,
  onManageTags,
  onMutated,
}: NoteListProps) {
  const { notify } = useToast();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [archived, setArchived] = useState(false);
  const [searchingOpen, setSearchingOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [selecting, setSelecting] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [noteOrder, setNoteOrder] = useState<NoteOrder>(() => readNoteOrder());
  const [busy, setBusy] = useState(false);
  const tagMenu = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const cached = await api.listEntriesCached({ limit: 1000, exclude_books: true });
    if (cached) {
      setEntries(cached.entries ?? []);
      setLoaded(true);
    }
    try {
      const result = await api.listAllEntries({ exclude_books: true });
      setEntries(result.entries ?? []);
      setError("");
    } catch (err) {
      if (!cached) {
        setError(err instanceof Error ? err.message : "falha ao carregar");
      }
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    setSelectedTags([]);
    setQuery("");
    setTagsOpen(false);
    setSelected(new Set());
    setSelecting(false);
    setMenu(null);
  }, [notebookId, archived]);

  useEffect(() => {
    if (autoSearch) {
      setSearchingOpen(true);
      onSearchOpened?.();
    }
  }, [autoSearch, onSearchOpened]);

  useEffect(() => {
    try {
      localStorage.setItem(NOTE_ORDER_KEY, noteOrder);
    } catch {
      // sem localStorage: a ordem vale so para esta sessao
    }
  }, [noteOrder]);

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
  const activeNotebook = useMemo(
    () => notebooks.find((notebook) => notebook.id === notebookId),
    [notebooks, notebookId],
  );
  const isMcp = activeNotebook?.kind === "mcp";

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

  const term = normalizeSearch(query.trim());
  const withTags = useMemo(() => {
    if (selectedTags.length === 0) return inScope;
    return inScope.filter((entry) => {
      const present = new Set((entry.tags ?? []).map((tag) => normalizeSearch(tag)));
      return selectedTags.every((tag) => present.has(normalizeSearch(tag)));
    });
  }, [inScope, selectedTags]);
  const visible = useMemo(() => {
    const filtered = term ? withTags.filter((entry) => matches(entry, term)) : withTags;
    return sortNotesByDate(filtered, noteOrder);
  }, [withTags, term, noteOrder]);

  const counts = useMemo(() => tagCounts(inScope, selectedTags), [inScope, selectedTags]);

  // A selecao so vale para o que esta na tela: some com a busca e o filtro.
  useEffect(() => {
    setSelected((current) => {
      if (current.size === 0) return current;
      const alive = new Set(visible.map((entry) => entry.id));
      if ([...current].every((id) => alive.has(id))) return current;
      return new Set([...current].filter((id) => alive.has(id)));
    });
  }, [visible]);

  const selectedEntries = useMemo(
    () => visible.filter((entry) => selected.has(entry.id)),
    [visible, selected],
  );

  // Sair do modo de selecao sempre limpa a selecao; entrar deixa o conjunto
  // vazio para o usuario marcar a partir de um estado previsivel.
  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setSelecting(false);
  }, []);

  const toggleSelected = (id: string) => {
    // Selecionar por atalho, menu ou clique deixa o modo ativo: assim os
    // quadradinhos ficam visiveis e o toque (sem modificador) alterna.
    setSelecting(true);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEscape(selecting && menu === null, clearSelection);

  const archiveEntries = async (targets: Entry[], next: boolean) => {
    if (targets.length === 0) return;
    setBusy(true);
    let changed = 0;
    const changedIds: string[] = [];
    for (const entry of targets) {
      try {
        await api.patchEntry(entry.id, { archived: next });
        changed += 1;
        changedIds.push(entry.id);
      } catch {
        // segue com as demais; o aviso no fim diz quantas falharam
      }
    }
    setBusy(false);
    clearSelection();
    if (changed > 0) {
      notify(
        changed === 1
          ? next
            ? "Nota arquivada"
            : "Nota desarquivada"
          : `${changed} notas ${next ? "arquivadas" : "desarquivadas"}`,
        "success",
      );
    }
    if (changed < targets.length) {
      notify(`Não foi possível arquivar ${targets.length - changed}`, "error");
    }
    // Arquivar tira a nota da lista: a aba dela fecha junto. Desarquivar nao
    // fecha nada, porque a nota volta para a lista.
    onMutated?.(next ? changedIds : []);
    if (!onMutated) void load();
  };

  const deleteEntries = async (targets: Entry[]) => {
    if (targets.length === 0) return;
    const question =
      targets.length === 1
        ? "Apagar esta nota? Ela vai para a Lixeira e pode ser restaurada em Configurações > Lixeira."
        : `Apagar ${targets.length} notas? Elas vão para a Lixeira e podem ser restauradas em Configurações > Lixeira.`;
    if (!window.confirm(question)) return;
    setBusy(true);
    const removed: string[] = [];
    for (const entry of targets) {
      try {
        await api.deleteEntry(entry.id);
        removed.push(entry.id);
      } catch {
        // o aviso no fim conta quantas ficaram
      }
    }
    setBusy(false);
    clearSelection();
    if (removed.length > 0) {
      notify(removed.length === 1 ? "Nota apagada" : `${removed.length} notas apagadas`, "success");
    }
    if (removed.length < targets.length) {
      notify(`Não foi possível apagar ${targets.length - removed.length}`, "error");
    }
    onMutated?.(removed);
    if (!onMutated) void load();
  };

  const menuItems = (entry: Entry): ContextMenuItem[] => {
    const targets = selected.size > 1 ? selectedEntries : [entry];
    const allSelected = visible.length > 0 && selected.size === visible.length;
    return [
      {
        key: "open",
        label: "Abrir",
        onSelect: () => {
          clearSelection();
          onOpen(entry.id, noteTitle(entry));
        },
      },
      // A unica acao que cria aba: o clique normal abre a nota sozinha.
      ...(onOpenInNewTab
        ? [
            {
              key: "open-tab",
              label: "Abrir em nova aba",
              onSelect: () => {
                clearSelection();
                onOpenInNewTab(entry.id, noteTitle(entry));
              },
            },
          ]
        : []),
      {
        key: "select",
        label: selected.has(entry.id) ? "Desmarcar" : "Selecionar",
        onSelect: () => toggleSelected(entry.id),
      },
      {
        key: "select-all",
        label: allSelected ? "Limpar seleção" : "Selecionar todas",
        disabled: visible.length === 0,
        onSelect: () => {
          if (allSelected) {
            clearSelection();
          } else {
            setSelecting(true);
            setSelected(new Set(visible.map((item) => item.id)));
          }
        },
      },
      {
        key: "archive",
        label: entry.archived ? "Desarquivar" : "Arquivar",
        disabled: busy,
        onSelect: () => void archiveEntries(targets, !entry.archived),
      },
      {
        key: "delete",
        label: targets.length > 1 ? `Apagar ${targets.length} notas` : "Apagar nota",
        danger: true,
        disabled: busy,
        onSelect: () => void deleteEntries(targets),
      },
    ];
  };

  const searching = searchingOpen || term !== "";
  const closeSearch = () => {
    setSearchingOpen(false);
    setQuery("");
  };

  const toggleTag = (name: string) => {
    setSelectedTags((current) =>
      current.some((tag) => normalizeSearch(tag) === normalizeSearch(name))
        ? current.filter((tag) => normalizeSearch(tag) !== normalizeSearch(name))
        : [...current, name],
    );
  };

  const row = (entry: Entry) => {
    const title = noteTitle(entry);
    const isSelected = selected.has(entry.id);
    const className = [
      "note-row",
      entry.id === activeId ? "note-row--active" : "",
      isSelected ? "note-row--selected" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <li key={entry.id}>
        <div
          className={className}
          onContextMenu={(event) => {
            event.preventDefault();
            // O clique direito so abre o menu: não seleciona a nota nem
            // desfaz a selecao existente. As acoes valem para o conjunto ja
            // selecionado quando a nota clicada esta nele.
            setMenu({ x: event.clientX, y: event.clientY, id: entry.id });
          }}
        >
          <button
            type="button"
            className="note-row-open"
            ref={entry.id === activeId ? scrollActiveIntoView : undefined}
            aria-selected={isSelected}
            onClick={(event) => {
              const additive = event.metaKey || event.ctrlKey || event.shiftKey;
              if (selecting || additive) {
                toggleSelected(entry.id);
                return;
              }
              onOpen(entry.id, title);
            }}
          >
            <span className="note-row-head">
              <span className="note-row-title">{title}</span>
              {selecting && (
                <span
                  className={isSelected ? "note-row-check note-row-check--on" : "note-row-check"}
                  aria-hidden
                >
                  {isSelected && <CheckIcon size={11} />}
                </span>
              )}
            </span>
            {/* Sem titulo, a linha usa a previa como titulo: repetir o mesmo
                trecho logo abaixo duplicava o texto na lista. */}
            {entry.preview && entry.preview !== title ? (
              <span className="note-row-preview">{entry.preview}</span>
            ) : null}
            <span className="note-row-line">
              {(failures[entry.id] || entry.status === "failed") && (
                <span className="note-row-failed">falhou</span>
              )}
              <span className="note-row-date">{formatShortDateTime(noteDate(entry))}</span>
              {unsynced && (
                <Icon name="cloud-off" size={12} className="note-row-sync--off" label="sem envio" />
              )}
            </span>
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
              {showSearch && (
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setSearchingOpen(true)}
                  aria-label="Buscar nas notas"
                  title="Buscar"
                >
                  <SearchIcon size={16} />
                </button>
              )}
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
              <button
                type="button"
                className={selecting ? "icon-button icon-button--active" : "icon-button"}
                onClick={() => {
                  if (selecting) clearSelection();
                  else setSelecting(true);
                }}
                aria-pressed={selecting}
                aria-label={selecting ? "Cancelar seleção" : "Selecionar notas"}
                title={selecting ? "Cancelar seleção" : "Selecionar notas"}
              >
                <SelectIcon size={16} />
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
                            (item) => normalizeSearch(item) === normalizeSearch(tag.name),
                          );
                          return (
                            <button
                              key={normalizeSearch(tag.name)}
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
              <button
                type="button"
                className="icon-button"
                onClick={() =>
                  setNoteOrder((value) => (value === "newest" ? "oldest" : "newest"))
                }
                aria-pressed={noteOrder === "oldest"}
                // Rotulo e dica dizem a mesma coisa (a acao do clique); antes o
                // title descrevia o estado atual e contradizia o aria-label.
                aria-label={
                  noteOrder === "newest"
                    ? "Ordenar notas: mais antigas primeiro"
                    : "Ordenar notas: mais recentes primeiro"
                }
                title={
                  noteOrder === "newest"
                    ? "Ordenar notas: mais antigas primeiro"
                    : "Ordenar notas: mais recentes primeiro"
                }
              >
                <SortIcon size={16} />
              </button>
              <NotificationsMenu refreshKey={refreshKey} onOpen={onOpen} />
            </div>
          </>
        )}
      </div>

      {selected.size > 0 && (
        <div className="list-selection" role="toolbar" aria-label="Notas selecionadas">
          <span className="list-selection-count" aria-live="polite">
            {selected.size} {selected.size === 1 ? "nota" : "notas"}
          </span>
          {selected.size === 1 && (
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => {
                const id = [...selected][0];
                const entrada = entries.find((item) => item.id === id);
                clearSelection();
                onOpen(id, entrada ? noteTitle(entrada) : "");
              }}
              disabled={busy}
            >
              Abrir
            </button>
          )}
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => void archiveEntries(selectedEntries, !archived)}
            disabled={busy || selectedEntries.length === 0}
          >
            {archived ? "Desarquivar" : "Arquivar"}
          </button>
          <button
            type="button"
            className="button button--ghost button--small list-selection-delete"
            onClick={() => void deleteEntries(selectedEntries)}
            disabled={busy || selectedEntries.length === 0}
          >
            Apagar
          </button>
          <button
            type="button"
            className="icon-button list-selection-clear"
            onClick={() => setSelected(new Set())}
            aria-label="Limpar seleção"
            title="Limpar seleção"
          >
            <CloseIcon size={14} />
          </button>
        </div>
      )}

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
        {!loaded && visible.length === 0 ? (
          <ListSkeleton rows={7} />
        ) : visible.length === 0 ? (
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
            ) : isMcp ? (
              <>
                <p>Nenhum projeto ainda.</p>
              </>
            ) : (
              <>
                <p>Nenhuma nota</p>
              </>
            )}
          </div>
        ) : (
          <ul className="tree stagger-in">{visible.map(row)}</ul>
        )}
      </div>

      {menu !== null &&
        (() => {
          const entry = entries.find((item) => item.id === menu.id);
          if (!entry) return null;
          return (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              label="Ações da nota"
              items={menuItems(entry)}
              onClose={() => setMenu(null)}
            />
          );
        })()}
    </div>
  );
}

export default NoteList;
