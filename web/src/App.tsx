import { useCallback, useState } from "react";
import { api, clearToken, getToken, setToken } from "./api";
import { useEvents } from "./useEvents";
import { TokenGate } from "./components/TokenGate";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { NoteList } from "./components/NoteList";
import { NoteEditor } from "./components/NoteEditor";
import { useToast } from "./components/Toasts";
import { InsightsIcon, NoteIcon, SearchIcon, SettingsIcon } from "./components/icons";
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
  const [view, setView] = useState<ViewId>("notes");
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [entityFocus, setEntityFocus] = useState<{ kind: EntityKind; name: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const { notify } = useToast();

  const handleEvent = useCallback(
    (event: ServerEvent) => {
      setRefreshKey((key) => key + 1);
      const id = typeof event.data.entry_id === "string" ? event.data.entry_id : "";
      if (!id) {
        return;
      }
      if (event.name === "entry.failed") {
        const reason = String(event.data.reason ?? "falha ao processar");
        setFailures((map) => ({ ...map, [id]: reason }));
        notify(reason, "error");
      } else if (event.name === "entry.status") {
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
    [notify],
  );
  useEvents(handleEvent);

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
      const entry = await api.createEntry("Nova nota");
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
    <div className="app">
      <aside className="sidebar" aria-label="Navegacao principal">
        <div className="brand">dyarium</div>
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
