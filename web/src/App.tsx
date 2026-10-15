import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, clearToken, getToken, setToken, verifyToken } from "./api";
import { useEvents } from "./useEvents";
import { TokenGate } from "./components/TokenGate";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { NoteList } from "./components/NoteList";
import { NoteEditor } from "./components/NoteEditor";
import { OfflineBanner } from "./components/OfflineBanner";
import { useToast } from "./components/Toasts";
import { ChevronIcon, ExitIcon, InsightsIcon, NoteIcon, SettingsIcon } from "./components/icons";
import { InsightsView } from "./views/InsightsView";
import { SettingsView } from "./views/SettingsView";
import type { EntityKind, ServerEvent } from "./types";
import "./App.css";

type ViewId = "notes" | "insights" | "settings";

export function App() {
  const [token, setTokenState] = useState(getToken());
  const [authError, setAuthError] = useState("");
  const [checkingToken, setCheckingToken] = useState(false);
  const [view, setView] = useState<ViewId>("notes");
  const [navOpen, setNavOpen] = useState(true);
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [entityFocus, setEntityFocus] = useState<{ kind: EntityKind; name: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
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
        setAuthError("Nao foi possivel validar o token. Tente de novo.");
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
    <div className={navOpen ? "app" : "app app--collapsed"}>
      <OfflineBanner />
      <aside className="sidebar" aria-label="Navegacao principal">
        <div className="sidebar-top">
          <div className="brand">dyarium</div>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setNavOpen((value) => !value)}
            aria-label={navOpen ? "Recolher menu" : "Expandir menu"}
            aria-expanded={navOpen}
          >
            <ChevronIcon size={16} />
          </button>
        </div>

        {navOpen && (
          <NoteList
            refreshKey={refreshKey}
            activeId={openEntryId}
            failures={failures}
            onOpen={(id) => {
              setOpenEntryId(id);
              setView("notes");
            }}
            onChanged={refresh}
            onCreateText={() => void createText()}
          />
        )}

        <nav className="sidebar-foot">
          <button
            type="button"
            className={view === "notes" ? "foot-item foot-item--active" : "foot-item"}
            onClick={() => setView("notes")}
          >
            <NoteIcon size={18} />
            <span>Notas</span>
          </button>
          <button
            type="button"
            className={view === "insights" ? "foot-item foot-item--active" : "foot-item"}
            onClick={() => {
              setView("insights");
              setEntityFocus(null);
            }}
          >
            <InsightsIcon size={18} />
            <span>Insights</span>
          </button>
          <button
            type="button"
            className={view === "settings" ? "foot-item foot-item--active" : "foot-item"}
            onClick={() => setView("settings")}
          >
            <SettingsIcon size={18} />
            <span>Configuracao</span>
          </button>
          <button
            type="button"
            className="foot-item"
            onClick={() => {
              clearToken();
              setTokenState("");
            }}
          >
            <ExitIcon size={18} />
            <span>Sair</span>
          </button>
        </nav>
      </aside>

      <main className="workspace" aria-label="Conteudo">
        <ErrorBoundary>
          {view === "notes" ? (
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
                  onOpenEntry={(id) => setOpenEntryId(id)}
                />
              ) : (
                <div className="empty-editor">
                  <h2>Suas notas</h2>
                  <p className="muted">Escolha uma nota na esquerda, grave um audio ou crie uma nota escrita.</p>
                </div>
              )}
            </div>
          ) : view === "insights" ? (
            <div className="page">
              <InsightsView refreshKey={refreshKey} onOpen={openFromOtherView} focus={entityFocus} />
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
