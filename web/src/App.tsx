import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { api, ApiError, clearToken, getToken, setToken, verifyToken } from "./api";
import { useEvents } from "./useEvents";
import { TokenGate } from "./components/TokenGate";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { NoteList } from "./components/NoteList";
import { NoteEditor } from "./components/NoteEditor";
import { NotebookDialog } from "./components/NotebookDialog";
import { NotebookSwitcher } from "./components/NotebookSwitcher";
import { OfflineBanner } from "./components/OfflineBanner";
import { TagManager } from "./components/TagManager";
import { ComposeDialog, type ComposeAnchor } from "./components/ComposeDialog";
import { useToast } from "./components/Toasts";
import {
  ChevronIcon,
  ExitIcon,
  InsightsIcon,
  MapIcon,
  MenuIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  WritingIcon,
} from "./components/icons";
import { ALL_NOTEBOOKS, DEFAULT_NOTEBOOK_ID } from "./lib/notebooks";
import { InsightsView } from "./views/InsightsView";
import { MapView } from "./views/MapView";
import { SettingsView } from "./views/SettingsView";
import { WritingView } from "./views/WritingView";
import type { EntityKind, Notebook, ServerEvent } from "./types";
import "./App.css";

type ViewId = "notes" | "map" | "insights" | "writing" | "settings";

const ACTIVE_NOTEBOOK_KEY = "dyarium.notebook";

/** Caderno salvo neste navegador; a selecao e local, não sincronizada. */
function readActiveNotebook(): string {
  try {
    return localStorage.getItem(ACTIVE_NOTEBOOK_KEY) || ALL_NOTEBOOKS;
  } catch {
    return ALL_NOTEBOOKS;
  }
}

function writeActiveNotebook(id: string): void {
  try {
    localStorage.setItem(ACTIVE_NOTEBOOK_KEY, id);
  } catch {
    // sem localStorage: a selecao vale so para esta sessao
  }
}

export function App() {
  const [token, setTokenState] = useState(getToken());
  const [authError, setAuthError] = useState("");
  const [checkingToken, setCheckingToken] = useState(false);
  const [view, setView] = useState<ViewId>("notes");
  // No navegador estreito a navegacao e uma gaveta: comeca fechada.
  const [navOpen, setNavOpen] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth > 900,
  );
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [entityFocus, setEntityFocus] = useState<{ kind: EntityKind; name: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [activeNotebookId, setActiveNotebookId] = useState(() => readActiveNotebook());
  const [notebookDialog, setNotebookDialog] = useState<{
    mode: "create" | "rename";
    notebook?: Notebook;
  } | null>(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeAnchor, setComposeAnchor] = useState<ComposeAnchor | null>(null);
  // A busca pedida pela faixa recolhida so vale uma vez: sem isto, reabrir a
  // gaveta no celular abriria o campo de busca de novo sem ninguem pedir.
  const [pendingSearch, setPendingSearch] = useState(false);
  // A nota aberta tem o seu proprio contador: um evento de outra entrada não
  // pode obrigar a nota visivel a recarregar tudo.
  const [noteRefreshKey, setNoteRefreshKey] = useState(0);
  const openEntryRef = useRef<string | null>(null);
  useEffect(() => {
    openEntryRef.current = openEntryId;
  }, [openEntryId]);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [entryProgress, setEntryProgress] = useState<Record<string, { stage: string; done: number; total: number }>>({});
  const { notify } = useToast();
  const refreshTimer = useRef<number | null>(null);

  // Coalesce bursts of events into a single refresh so the UI stays responsive.
  const bumpRefresh = useCallback(() => {
    if (refreshTimer.current !== null) {
      return;
    }
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      setRefreshKey((key) => key + 1);
    }, 350);
  }, []);

  const handleEvent = useCallback(
    (event: ServerEvent) => {
      const id = typeof event.data.entry_id === "string" ? event.data.entry_id : "";
      if (id && (event.name === "analysis.ready" || event.name === "entry.status")) {
        api.invalidateAnalysis(id);
      }
      switch (event.name) {
        // Revisao por janela: so a nota aberta precisa recarregar. O feed de
        // atividades nao muda aqui (a passada ainda nao terminou).
        case "transcript.revised":
          if (id && id === openEntryRef.current) {
            setNoteRefreshKey((key) => key + 1);
          }
          break;
        case "entry.status":
        case "transcript.ready":
        case "analysis.ready":
        case "entry.failed":
        case "model.download":
        case "notebook.changed":
          bumpRefresh();
          if (id && id === openEntryRef.current) {
            setNoteRefreshKey((key) => key + 1);
          }
          break;
        case "job.progress":
          if (id) {
            setEntryProgress((map) => ({
              ...map,
              [id]: {
                stage: String(event.data.stage ?? ""),
                done: Number(event.data.done ?? 0),
                total: Number(event.data.total ?? 0),
              },
            }));
          }
          break;
        default:
          break;
      }
      if (!id) {
        return;
      }
      if (event.name === "entry.failed") {
        const reason = String(event.data.reason ?? "falha ao processar");
        setFailures((map) => ({ ...map, [id]: reason }));
        setEntryProgress((map) => {
          const next = { ...map };
          delete next[id];
          return next;
        });
        notify(reason, "error");
      } else if (event.name === "entry.status") {
        const status = String(event.data.status ?? "");
        if (status === "ready" || status === "transcribed" || status === "failed") {
          setEntryProgress((map) => {
            if (!(id in map)) {
              return map;
            }
            const next = { ...map };
            delete next[id];
            return next;
          });
        }
        setFailures((map) => {
          if (!(id in map)) {
            return map;
          }
          const next = { ...map };
          delete next[id];
          return next;
        });
      }
    },
    [notify, bumpRefresh],
  );
  useEvents(handleEvent);

  // A token already stored may be stale (rotated on the server) or simply
  // wrong; validate it on load and fall back to the gate. A network failure
  // keeps the token so the app can still be used offline with cached data.
  useEffect(() => {
    const stored = getToken();
    if (!stored) {
      return;
    }
    let active = true;
    verifyToken(stored)
      .then((ok) => {
        if (active && !ok) {
          clearToken();
          setTokenState("");
          setAuthError("Token invalido. Informe o token novamente.");
        }
      })
      .catch(() => {
        // Offline: keep the stored token and serve cached data.
      });
    return () => {
      active = false;
    };
  }, []);

  // Cadernos: espelho do servidor. A selecao fica no navegador; se o caderno
  // sumiu, cai no padrao.
  useEffect(() => {
    if (!token) return;
    let active = true;
    api
      .listNotebooks()
      .then((result) => {
        if (!active) return;
        const list = result.notebooks ?? [];
        setNotebooks(list);
        setActiveNotebookId((current) => {
          if (current === ALL_NOTEBOOKS) return current;
          if (list.some((notebook) => notebook.id === current)) return current;
          return ALL_NOTEBOOKS;
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [token, refreshKey]);

  // Validate the token against the API before storing it, so a wrong token
  // keeps the gate open instead of entering an empty (broken) session.
  const handleLogin = async (value: string) => {
    setCheckingToken(true);
    setAuthError("");
    try {
      const ok = await verifyToken(value);
      if (!ok) {
        setAuthError("Token invalido. Confira o valor e tente de novo.");
        return;
      }
      setToken(value);
      setTokenState(value);
    } catch (err) {
      if (err instanceof ApiError) {
        setAuthError("Não foi possível validar o token. Tente de novo.");
        return;
      }
      // Falha de rede: entra em modo offline com o token informado.
      setToken(value);
      setTokenState(value);
    } finally {
      setCheckingToken(false);
    }
  };

  if (!token) {
    return (
      <TokenGate
        onSubmit={(value) => void handleLogin(value)}
        error={authError}
        checking={checkingToken}
      />
    );
  }

  const refresh = () => {
    setRefreshKey((key) => key + 1);
    setNoteRefreshKey((key) => key + 1);
  };

  const closeDrawer = () => {
    if (window.innerWidth <= 900) setNavOpen(false);
  };

  const selectNotebook = (id: string) => {
    setActiveNotebookId(id);
    writeActiveNotebook(id);
    setOpenEntryId(null);
    closeDrawer();
  };

  // Em "todos os cadernos" a nota nova nasce no padrao: o escopo e uma visao,
  // nao um caderno de verdade.
  const targetNotebookId = () =>
    activeNotebookId === ALL_NOTEBOOKS
      ? (notebooks.find((notebook) => notebook.is_default)?.id ?? DEFAULT_NOTEBOOK_ID)
      : activeNotebookId;

  const createNote = async () => {
    try {
      const entry = await api.createEntry("", null, targetNotebookId());
      setOpenEntryId(entry.id);
      setView("notes");
      closeDrawer();
      refresh();
    } catch {
      notify("Não foi possível criar a nota.", "error");
      refresh();
    }
  };

  // O popover de nova nota abre colado no botao que o pediu. Guardamos o
  // retangulo na hora do clique: no celular a gaveta fecha e o botao sai da
  // tela, mas a posicao continua valida.
  const openCompose = (event: ReactMouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setComposeAnchor({
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
    });
    setComposeOpen(true);
  };

  const createTextNote = () => {
    setComposeOpen(false);
    void createNote();
  };

  const openCreatedEntry = (id: string) => {
    setComposeOpen(false);
    setOpenEntryId(id);
    setView("notes");
    refresh();
    closeDrawer();
  };

  const expandSearch = () => {
    setNavOpen(true);
    setPendingSearch(true);
  };

  const saveNotebook = async (input: { name: string; color: string }) => {
    if (!notebookDialog) return;
    try {
      if (notebookDialog.mode === "create") {
        const created = await api.createNotebook(input);
        selectNotebook(created.id);
      } else if (notebookDialog.notebook) {
        await api.updateNotebook(notebookDialog.notebook.id, input);
      }
      setNotebookDialog(null);
      refresh();
    } catch {
      notify("Não foi possível salvar o caderno.", "error");
    }
  };

  const deleteNotebook = async (notebook: Notebook) => {
    if (notebook.is_default) return;
    const ok = window.confirm(
      notebook.entry_count > 0
        ? `Excluir “${notebook.name}”? As ${notebook.entry_count} nota(s) vão para “Notas ao acaso”.`
        : `Excluir “${notebook.name}”?`,
    );
    if (!ok) return;
    try {
      await api.deleteNotebook(notebook.id);
      if (activeNotebookId === notebook.id) {
        selectNotebook(DEFAULT_NOTEBOOK_ID);
      }
      refresh();
    } catch {
      notify("Não foi possível excluir o caderno.", "error");
    }
  };

  const openFromOtherView = (id: string) => {
    setOpenEntryId(id);
    setView("notes");
    closeDrawer();
  };

  const openView = (id: ViewId) => {
    setView(id);
    closeDrawer();
  };

  const footerItems = [
    {
      key: "map",
      label: "Mapa",
      active: view === "map",
      icon: <MapIcon size={17} />,
      onPress: () => openView("map"),
    },
    {
      key: "insights",
      label: "Insights",
      active: view === "insights",
      icon: <InsightsIcon size={17} />,
      onPress: () => {
        setEntityFocus(null);
        openView("insights");
      },
    },
    {
      key: "writing",
      label: "Escrita",
      active: view === "writing",
      icon: <WritingIcon size={17} />,
      onPress: () => openView("writing"),
    },
    {
      key: "settings",
      label: "Configurações",
      active: view === "settings",
      icon: <SettingsIcon size={17} />,
      onPress: () => openView("settings"),
    },
    {
      key: "logout",
      label: "Sair",
      active: false,
      icon: <ExitIcon size={17} />,
      onPress: () => {
        clearToken();
        setTokenState("");
      },
    },
  ];

  return (
    <div className={navOpen ? "app" : "app app--collapsed"}>
      <header className="mobile-bar">
        <button
          type="button"
          className="icon-button"
          onClick={() => setNavOpen(true)}
          aria-label="Abrir menu"
          title="Abrir menu"
        >
          <MenuIcon size={18} />
        </button>
        <span className="mobile-bar-title">
          {activeNotebookId === ALL_NOTEBOOKS
            ? "Todos os cadernos"
            : (notebooks.find((notebook) => notebook.id === activeNotebookId)?.name ??
              "Notas ao acaso")}
        </span>
        <button
          type="button"
          className="button button--primary button--small"
          onClick={openCompose}
          aria-label="Nova nota"
        >
          <PlusIcon size={15} />
          Nova nota
        </button>
      </header>
      {navOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          onClick={() => setNavOpen(false)}
          aria-label="Fechar menu"
        />
      )}
      <OfflineBanner />
      <aside className="sidebar" aria-label="Navegação principal">
        {navOpen ? (
          <>
            <div className="sidebar-top">
              <NotebookSwitcher
                notebooks={notebooks}
                activeId={activeNotebookId}
                onSelect={selectNotebook}
                onCreate={() => setNotebookDialog({ mode: "create" })}
                onRename={(notebook) => setNotebookDialog({ mode: "rename", notebook })}
                onDelete={(notebook) => void deleteNotebook(notebook)}
              />
              <button
                type="button"
                className="sidebar-toggle"
                onClick={() => setNavOpen(false)}
                aria-label="Recolher menu"
                title="Recolher menu"
              >
                <ChevronIcon size={16} />
              </button>
            </div>

            {/* O menu e a lista de notas: não ha "Notas" aqui, porque a lista e
                as notas. As demais telas viram icones pequenos no rodape. */}
            <NoteList
              refreshKey={refreshKey}
              activeId={openEntryId}
              failures={failures}
              notebookId={activeNotebookId}
              notebooks={notebooks}
              autoSearch={pendingSearch}
              onSearchOpened={() => setPendingSearch(false)}
              onOpen={(id) => {
                setOpenEntryId(id);
                setView("notes");
                closeDrawer();
              }}
              onCreate={openCompose}
              onManageTags={() => setTagsOpen(true)}
            />
          </>
        ) : (
          <div className="side-rail">
            <button
              type="button"
              className="rail-action rail-action--new"
              onClick={openCompose}
              aria-label="Nova nota"
              title="Nova nota"
            >
              <PlusIcon size={18} />
            </button>
            <button
              type="button"
              className="rail-action"
              onClick={expandSearch}
              aria-label="Buscar nas notas"
              title="Buscar"
            >
              <SearchIcon size={17} />
            </button>
            <button
              type="button"
              className="rail-action rail-expand"
              onClick={() => setNavOpen(true)}
              aria-label="Expandir menu"
              title="Expandir menu"
            >
              <ChevronIcon size={16} />
            </button>
            <nav className="rail-foot" aria-label="Telas do dyarium">
              {footerItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={item.active ? "foot-item foot-item--active" : "foot-item"}
                  onClick={item.onPress}
                  aria-label={item.label}
                  aria-pressed={item.key === "logout" ? undefined : item.active}
                  title={item.label}
                >
                  {item.icon}
                </button>
              ))}
            </nav>
          </div>
        )}

        {navOpen && (
          <nav className="sidebar-foot" aria-label="Telas do dyarium">
            {footerItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={item.active ? "foot-item foot-item--active" : "foot-item"}
                onClick={item.onPress}
                aria-label={item.label}
                aria-pressed={item.key === "logout" ? undefined : item.active}
                title={item.label}
              >
                {item.icon}
              </button>
            ))}
          </nav>
        )}
      </aside>

      <main className="workspace" aria-label="Conteúdo">
        <ErrorBoundary>
          {view === "notes" ? (
            <div className="editor-pane">
              {openEntryId ? (
                <NoteEditor
                  key={openEntryId}
                  entryId={openEntryId}
                  refreshKey={noteRefreshKey}
                  failureReason={failures[openEntryId]}
                  progress={entryProgress[openEntryId]}
                  onChanged={refresh}
                  onDeleted={() => {
                    setOpenEntryId(null);
                    refresh();
                  }}
                  onOpenEntity={(kind, name) => {
                    setEntityFocus({ kind, name });
                    setView("insights");
                  }}
                  onOpenEntry={(id) => setOpenEntryId(id)}
                  notebooks={notebooks}
                />
              ) : (
                <div className="empty-editor">
                  <div className="empty-inner">
                    <h2>Um lugar para as suas notas</h2>
                    <p className="muted">
                      Escolha uma nota na lista, ou comece uma nova. Áudios viram texto,
                      imagens entram no corpo e a análise encontra pessoas, lugares e temas.
                    </p>
                    <div className="empty-actions">
                      <button type="button" className="button button--primary" onClick={openCompose}>
                        Nova nota
                      </button>
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() => setView("insights")}
                      >
                        Ver insights
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : view === "map" ? (
            <div className="page page--map">
              <MapView refreshKey={refreshKey} onOpen={openFromOtherView} />
            </div>
          ) : view === "insights" ? (
            <div className="page">
              <InsightsView refreshKey={refreshKey} onOpen={openFromOtherView} focus={entityFocus} />
            </div>
          ) : view === "writing" ? (
            <div className="page">
              <WritingView refreshKey={refreshKey} />
            </div>
          ) : (
            <div className="page">
              <SettingsView refreshKey={refreshKey} />
            </div>
          )}
        </ErrorBoundary>
      </main>

      <NotebookDialog
        open={notebookDialog !== null}
        title={notebookDialog?.mode === "create" ? "Novo caderno" : "Renomear caderno"}
        initialName={notebookDialog?.notebook?.name ?? ""}
        initialColor={notebookDialog?.notebook?.color ?? ""}
        onClose={() => setNotebookDialog(null)}
        onSave={(input) => void saveNotebook(input)}
      />

      <TagManager
        open={tagsOpen}
        onClose={() => setTagsOpen(false)}
        onChanged={refresh}
      />

      <ComposeDialog
        open={composeOpen}
        anchor={composeAnchor}
        notebookId={activeNotebookId === ALL_NOTEBOOKS ? undefined : activeNotebookId}
        onClose={() => setComposeOpen(false)}
        onCreateText={createTextNote}
        onCreated={openCreatedEntry}
      />
    </div>
  );
}

export default App;
