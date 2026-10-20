import { useCallback, useEffect, useRef, useState } from "react";
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
import { useToast } from "./components/Toasts";
import { ChevronIcon, ExitIcon, InsightsIcon, SettingsIcon, WritingIcon } from "./components/icons";
import { DEFAULT_NOTEBOOK_ID } from "./lib/notebooks";
import { InsightsView } from "./views/InsightsView";
import { SettingsView } from "./views/SettingsView";
import { WritingView } from "./views/WritingView";
import type { EntityKind, Notebook, ServerEvent } from "./types";
import "./App.css";

type ViewId = "notes" | "insights" | "writing" | "settings";

const ACTIVE_NOTEBOOK_KEY = "dyarium.notebook";

/** Caderno salvo neste navegador; a selecao e local, nao sincronizada. */
function readActiveNotebook(): string {
  try {
    return localStorage.getItem(ACTIVE_NOTEBOOK_KEY) || DEFAULT_NOTEBOOK_ID;
  } catch {
    return DEFAULT_NOTEBOOK_ID;
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
  const [navOpen, setNavOpen] = useState(true);
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
  // A nota aberta tem o seu proprio contador: um evento de outra entrada nao
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
          if (list.some((notebook) => notebook.id === current)) return current;
          return (
            list.find((notebook) => notebook.is_default)?.id ??
            list[0]?.id ??
            DEFAULT_NOTEBOOK_ID
          );
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

  const refresh = () => {
    setRefreshKey((key) => key + 1);
    setNoteRefreshKey((key) => key + 1);
  };

  const selectNotebook = (id: string) => {
    setActiveNotebookId(id);
    writeActiveNotebook(id);
    setOpenEntryId(null);
  };

  const createNote = async () => {
    try {
      const entry = await api.createEntry("", null, activeNotebookId);
      setOpenEntryId(entry.id);
      setView("notes");
      refresh();
    } catch {
      refresh();
    }
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

        {/* O menu e a lista de notas: nao ha "Notas" aqui, porque a lista e as
            notas. As demais telas viram icones pequenos no rodape. */}
        {navOpen && (
          <>
            <NotebookSwitcher
              notebooks={notebooks}
              activeId={activeNotebookId}
              onSelect={selectNotebook}
              onCreate={() => setNotebookDialog({ mode: "create" })}
              onRename={(notebook) => setNotebookDialog({ mode: "rename", notebook })}
              onDelete={(notebook) => void deleteNotebook(notebook)}
            />
            <NoteList
              refreshKey={refreshKey}
              activeId={openEntryId}
              failures={failures}
              notebookId={activeNotebookId}
              notebooks={notebooks}
              onOpen={(id) => {
                setOpenEntryId(id);
                setView("notes");
              }}
              onCreate={() => void createNote()}
              onManageTags={() => setTagsOpen(true)}
            />
          </>
        )}

        <nav className="sidebar-foot">
          <button
            type="button"
            className={view === "insights" ? "foot-icon foot-icon--active" : "foot-icon"}
            onClick={() => {
              setView("insights");
              setEntityFocus(null);
            }}
            aria-label="Insights"
            aria-pressed={view === "insights"}
            title="Insights"
          >
            <InsightsIcon size={17} />
          </button>
          <button
            type="button"
            className={view === "writing" ? "foot-icon foot-icon--active" : "foot-icon"}
            onClick={() => setView("writing")}
            aria-label="Escrita"
            aria-pressed={view === "writing"}
            title="Escrita"
          >
            <WritingIcon size={17} />
          </button>
          <span className="foot-sep" />
          <button
            type="button"
            className={view === "settings" ? "foot-icon foot-icon--active" : "foot-icon"}
            onClick={() => setView("settings")}
            aria-label="Configuracao"
            aria-pressed={view === "settings"}
            title="Configuracao"
          >
            <SettingsIcon size={17} />
          </button>
          <button
            type="button"
            className="foot-icon"
            onClick={() => {
              clearToken();
              setTokenState("");
            }}
            aria-label="Sair"
            title="Sair"
          >
            <ExitIcon size={17} />
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
                  <h2>Suas notas</h2>
                  <p className="muted">Escolha uma nota na esquerda, grave um audio ou crie uma nota escrita.</p>
                </div>
              )}
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
    </div>
  );
}

export default App;
