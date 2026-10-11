import { useCallback, useEffect, useRef, useState } from "react";
import { api, clearToken, getSetupState, getToken, setToken } from "./api";
import { useEvents } from "./useEvents";
import { TokenGate } from "./components/TokenGate";
import { SetupGate } from "./components/SetupGate";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { NoteList } from "./components/NoteList";
import { NoteEditor } from "./components/NoteEditor";
import { OfflineBanner } from "./components/OfflineBanner";
import { useToast } from "./components/Toasts";
import { InsightsIcon, NoteIcon, PanelIcon, SearchIcon, SettingsIcon } from "./components/icons";
import { InsightsView } from "./views/InsightsView";
import { SearchView } from "./views/SearchView";
import { SettingsView } from "./views/SettingsView";
import type { EntityKind, ServerEvent } from "./types";
import "./App.css";

type ViewId = "notes" | "insights" | "search" | "settings";

const navigation = [
  { id: "notes", label: "Notas", Icon: NoteIcon },
  { id: "insights", label: "Insights", Icon: InsightsIcon },
  { id: "search", label: "Busca", Icon: SearchIcon },
  { id: "settings", label: "Configuracao", Icon: SettingsIcon },
] as const;

export function App() {
  const [token, setTokenState] = useState(getToken());
  const [setupRequired, setSetupRequired] = useState(false);
  const [view, setView] = useState<ViewId>("notes");
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [entityFocus, setEntityFocus] = useState<{ kind: EntityKind; name: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [entryProgress, setEntryProgress] = useState<Record<string, { stage: string; done: number; total: number }>>({});
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem("dyarium.sidebar") !== "closed";
    } catch {
      return true;
    }
  });
  const { notify } = useToast();
  const refreshTimer = useRef<number | null>(null);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem("dyarium.sidebar", next ? "open" : "closed");
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

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
      switch (event.name) {
        case "entry.status":
        case "transcript.ready":
        case "analysis.ready":
        case "entry.failed":
        case "model.download":
          bumpRefresh();
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

  useEffect(() => {
    let active = true;
    getSetupState().then((state) => {
      if (active && state.required) {
        setSetupRequired(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  if (setupRequired) {
    return (
      <SetupGate
        onDone={(value) => {
          setToken(value);
          setTokenState(value);
          setSetupRequired(false);
          if (window.location.pathname.startsWith("/setup")) {
            window.history.replaceState({}, "", "/");
          }
        }}
      />
    );
  }

  if (!token) {
    return (
      <TokenGate
        onSubmit={(value) => {
          setToken(value);
          setTokenState(value);
        }}
      />
    );
  }

  const refresh = () => setRefreshKey((key) => key + 1);

  const createText = async () => {
    try {
      const entry = await api.createEntry("");
      setOpenEntryId(entry.id);
      setView("notes");
      refresh();
    } catch {
      refresh();
    }
  };

  const openFromOtherView = (id: string) => {
    setOpenEntryId(id);
    setView("notes");
  };

  return (
    <div className={sidebarOpen ? "app" : "app app--sidebar-closed"}>
      <OfflineBanner />
      <aside id="app-sidebar" className="sidebar" aria-label="Navegacao principal" hidden={!sidebarOpen}>
        <div className="sidebar-head">
          <span className="brand">dyarium</span>
          <button
            type="button"
            className="icon-button sidebar-toggle"
            onClick={toggleSidebar}
            aria-label="Ocultar menu"
            aria-expanded
            aria-controls="app-sidebar"
          >
            <PanelIcon size={16} />
          </button>
        </div>
        <nav>
          <ul>
            {navigation.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={view === item.id ? "nav-item nav-item--active" : "nav-item"}
                  aria-current={view === item.id ? "page" : undefined}
                  onClick={() => {
                    setView(item.id);
                    setEntityFocus(null);
                  }}
                >
                  <item.Icon size={18} />
                  <span>{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <button
          type="button"
          className="link-button sidebar-exit"
          onClick={() => {
            clearToken();
            setTokenState("");
          }}
        >
          Sair
        </button>
      </aside>

      <main className="workspace" aria-label="Conteudo">
        {!sidebarOpen && (
          <button
            type="button"
            className="sidebar-open"
            onClick={toggleSidebar}
            aria-label="Mostrar menu"
            aria-expanded={false}
            aria-controls="app-sidebar"
          >
            <PanelIcon size={16} />
          </button>
        )}
        <ErrorBoundary>
          {view === "notes" ? (
            <>
              <NoteList
                refreshKey={refreshKey}
                activeId={openEntryId}
                failures={failures}
                onOpen={setOpenEntryId}
                onChanged={refresh}
                onCreateText={() => void createText()}
              />
              <div className="editor-pane">
                {openEntryId ? (
                  <NoteEditor
                    key={openEntryId}
                    entryId={openEntryId}
                    refreshKey={refreshKey}
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
                  />
                ) : (
                  <div className="empty-editor">
                    <h2>Suas notas</h2>
                    <p className="muted">Selecione uma nota, grave um audio ou crie uma nota escrita.</p>
                  </div>
                )}
              </div>
            </>
          ) : view === "insights" ? (
            <div className="page">
              <InsightsView refreshKey={refreshKey} onOpen={openFromOtherView} focus={entityFocus} />
            </div>
          ) : view === "search" ? (
            <div className="page">
              <SearchView refreshKey={refreshKey} onOpen={openFromOtherView} />
            </div>
          ) : (
            <div className="page">
              <SettingsView />
            </div>
          )}
        </ErrorBoundary>
      </main>
    </div>
  );
}

export default App;
