import { useCallback, useEffect, useState } from "react";
import { clearToken, getSetupState, getToken, setToken } from "./api";
import { useEvents } from "./useEvents";
import { TokenGate } from "./components/TokenGate";
import { SetupGate } from "./components/SetupGate";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { EntriesView } from "./views/EntriesView";
import { EntryView } from "./views/EntryView";
import { MoodView } from "./views/MoodView";
import { SearchView } from "./views/SearchView";
import { SettingsView } from "./views/SettingsView";
import type { EntryProgress, Segment, ServerEvent } from "./types";
import "./App.css";

type ViewId = "entries" | "mood" | "search" | "settings";

const navigation: { id: ViewId; label: string }[] = [
  { id: "entries", label: "Entradas" },
  { id: "mood", label: "Humor" },
  { id: "search", label: "Busca" },
  { id: "settings", label: "Configuracao" },
];

export function App() {
  const [token, setTokenState] = useState(getToken());
  const [setupRequired, setSetupRequired] = useState(false);
  const [view, setView] = useState<ViewId>("entries");
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [progress, setProgress] = useState<Record<string, EntryProgress>>({});
  const [partials, setPartials] = useState<Record<string, Segment[]>>({});

  const handleEvent = useCallback((event: ServerEvent) => {
    setRefreshKey((key) => key + 1);
    const id = typeof event.data.entry_id === "string" ? event.data.entry_id : "";
    if (!id) {
      return;
    }
    switch (event.name) {
      case "transcript.partial": {
        const segment: Segment = {
          start_ms: Number(event.data.start_ms ?? 0),
          end_ms: Number(event.data.end_ms ?? 0),
          text: String(event.data.text ?? ""),
        };
        setPartials((p) => ({ ...p, [id]: [...(p[id] ?? []), segment] }));
        setProgress((p) => ({ ...p, [id]: { ...p[id], status: "transcribing" } }));
        break;
      }
      case "entry.status": {
        const status = String(event.data.status ?? "");
        if (status === "queued" || status === "transcribing") {
          setPartials((p) => ({ ...p, [id]: [] }));
        }
        setProgress((p) => ({ ...p, [id]: { ...p[id], status, error: undefined } }));
        break;
      }
      case "job.progress":
        setProgress((p) => ({
          ...p,
          [id]: {
            ...p[id],
            stage: String(event.data.stage ?? ""),
            done: Number(event.data.done ?? 0),
            total: Number(event.data.total ?? 0),
            error: undefined,
          },
        }));
        break;
      case "transcript.ready":
        setProgress((p) => ({ ...p, [id]: { ...p[id], status: "transcribed" } }));
        break;
      case "analysis.ready":
        setProgress((p) => ({ ...p, [id]: { ...p[id], status: "ready" } }));
        break;
      case "entry.failed":
        setProgress((p) => ({ ...p, [id]: { ...p[id], status: "failed", error: String(event.data.reason ?? "falha") } }));
        break;
    }
  }, []);
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

  const activeLabel = openEntry
    ? "Entrada"
    : navigation.find((item) => item.id === view)?.label ?? "";

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
                  className={view === item.id && !openEntry ? "nav-item nav-item--active" : "nav-item"}
                  aria-current={view === item.id && !openEntry ? "page" : undefined}
                  onClick={() => {
                    setOpenEntry(null);
                    setView(item.id);
                  }}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            clearToken();
            setTokenState("");
          }}
        >
          Sair
        </button>
      </aside>

      <div className="content">
        <header className="topbar">
          <h1>{activeLabel}</h1>
          <button
            type="button"
            className="panel-toggle"
            aria-expanded={panelOpen}
            aria-controls="context-panel"
            onClick={() => setPanelOpen((value) => !value)}
          >
            {panelOpen ? "Ocultar painel" : "Mostrar painel"}
          </button>
        </header>

        <main className="main" aria-label="Conteudo">
          <ErrorBoundary>
            {openEntry ? (
              <EntryView
                id={openEntry}
                refreshKey={refreshKey}
                progress={progress[openEntry]}
                partials={partials[openEntry]}
                onBack={() => setOpenEntry(null)}
              />
            ) : view === "entries" ? (
              <EntriesView refreshKey={refreshKey} progress={progress} partials={partials} onOpen={setOpenEntry} />
            ) : view === "mood" ? (
              <MoodView refreshKey={refreshKey} onOpen={setOpenEntry} />
            ) : view === "search" ? (
              <SearchView refreshKey={refreshKey} onOpen={setOpenEntry} />
            ) : (
              <SettingsView />
            )}
          </ErrorBoundary>
        </main>
      </div>

      {panelOpen && (
        <aside id="context-panel" className="context-panel" aria-label="Painel de contexto">
          <h2>Contexto</h2>
          <p>Selecione uma entrada para ver analise, metadados e notas.</p>
        </aside>
      )}
    </div>
  );
}

export default App;
