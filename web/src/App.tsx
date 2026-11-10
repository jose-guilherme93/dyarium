import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  api,
  ApiError,
  clearToken,
  getSetupState,
  getToken,
  setToken,
  tokenIsPersisted,
  verifyToken,
} from "./api";
import { useEvents } from "./useEvents";
import { TokenGate } from "./components/TokenGate";
import { SetupGate } from "./components/SetupGate";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { NoteList } from "./components/NoteList";
import { NoteEditor } from "./components/NoteEditor";
import { NotebookDialog } from "./components/NotebookDialog";
import { NotebookSwitcher } from "./components/NotebookSwitcher";
import { BookDialog, type BookForm } from "./components/BookDialog";
import { BookSidebar } from "./components/BookSidebar";
import { NotionImportDialog } from "./components/NotionImportDialog";
import { OfflineBanner } from "./components/OfflineBanner";
import { WorkerKeepAlive } from "./components/WorkerKeepAlive";
import { TagManager } from "./components/TagManager";
import { ComposeDialog, type ComposeAnchor } from "./components/ComposeDialog";
import { useToast } from "./components/Toasts";
import {
  BookIcon,
  ChevronIcon,
  CpuIcon,
  ExitIcon,
  MapIcon,
  MenuIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  WritingIcon,
} from "./components/icons";
import { ALL_NOTEBOOKS, DEFAULT_NOTEBOOK_ID } from "./lib/notebooks";
import { orderedChapters } from "./lib/books";
import { aggregate, useProjectsIndex } from "./lib/useProjectsIndex";
import { ProjectList } from "./components/ProjectList";
import type { NotionImportResult } from "./lib/notionImport";
import { MapView } from "./views/MapView";
import { ProjectsView } from "./views/ProjectsView";
import type { ProjectsFilterRequest } from "./views/ProjectsView";
import { ProjectNote } from "./views/ProjectNote";
import { LabView } from "./views/LabView";
import { SettingsView } from "./views/SettingsView";
import { WritingView } from "./views/WritingView";
import { BookView } from "./views/BookView";
import type { ChapterKind, EntityKind, Entry, Notebook, ServerEvent } from "./types";
import "./App.css";

type ViewId = "notes" | "map" | "writing" | "settings" | "lab";

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
  const [setupRequired, setSetupRequired] = useState(false);
  const [view, setView] = useState<ViewId>(() =>
    typeof window !== "undefined" && window.location.pathname === "/lab" ? "lab" : "notes",
  );
  // No navegador estreito a navegacao e uma gaveta: comeca fechada.
  const [navOpen, setNavOpen] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth > 900,
  );
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  // Voltar de uma tela aberta por dentro de outra (processamento a partir da
  // nota, por exemplo) precisa devolver para onde o usuario estava, e nao para
  // a primeira tela do menu.
  const [returnView, setReturnView] = useState<ViewId | null>(null);
  const [entityFocus, setEntityFocus] = useState<{
    kind: EntityKind;
    name: string;
    /** "kind": abre o editor da entidade ja no seletor de tipo (lapis da ficha). */
    edit?: "kind";
  } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [bookChapters, setBookChapters] = useState<Entry[]>([]);
  const [bookChaptersLoading, setBookChaptersLoading] = useState(false);
  const [activeNotebookId, setActiveNotebookId] = useState(() => readActiveNotebook());
  const [notebookDialog, setNotebookDialog] = useState<{
    mode: "create" | "rename";
    notebook?: Notebook;
  } | null>(null);
  const [bookDialog, setBookDialog] = useState<{ notebook?: Notebook } | null>(null);
  const [ownerName, setOwnerName] = useState("");
  const [tagsOpen, setTagsOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeAnchor, setComposeAnchor] = useState<ComposeAnchor | null>(null);
  const [importOpen, setImportOpen] = useState(false);
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
  // A nota do caderno MCP abre em leitura (ProjectNote); "Editar" liga o editor
  // de markdown de sempre, e a faixa "Leitura" devolve para a leitura.
  const [pjEditing, setPjEditing] = useState(false);
  useEffect(() => {
    setPjEditing(false);
  }, [openEntryId, activeNotebookId]);
  // "Filtrar itens" fecha a nota e pede a superficie de projetos a filtrar
  // aquele projeto e periodo; o nonce re-aplica o mesmo pedido duas vezes.
  const [pjFilter, setPjFilter] = useState<ProjectsFilterRequest | null>(null);
  // Projeto aberto na lista da sidebar do caderno MCP; null = "Todos". A
  // selecao e estado do App, nao URL: lista e superficie leem o mesmo valor.
  const [pjProject, setPjProject] = useState<string | null>(null);
  // Icones escolhidos nesta sessao (a escolha local vence a entry persistida);
  // vivem no App para a lista e a superficie mostrarem o mesmo icone.
  const [pjIcons, setPjIcons] = useState<Record<string, string>>({});
  useEffect(() => {
    setPjProject(null);
    setPjIcons({});
  }, [activeNotebookId]);
  // /lab e uma pagina de verdade: recarregar a aba continua no processamento,
  // e o endereco fica estavel para deixar a aba aberta no PC.
  useEffect(() => {
    const path = view === "lab" ? "/lab" : "/";
    if (window.location.pathname !== path) {
      window.history.replaceState(null, "", path);
    }
  }, [view]);

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
  useEvents(token, handleEvent);

  // O primeiro acesso e publico: sem token, a instancia ainda nao foi
  // reivindicada. Falha de rede cai no portao de token normal.
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

  useEffect(() => {
    if (!token) return;
    void api
      .getSettings()
      .then((settings) => setOwnerName(settings.owner_name ?? ""))
      .catch(() => undefined);
  }, [token]);

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
      if (!tokenIsPersisted()) {
        notify("O navegador bloqueou o armazenamento. O token vale só até fechar esta aba.", "info");
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setAuthError("Não foi possível validar o token. Tente de novo.");
        return;
      }
      // Falha de rede: entra em modo offline com o token informado.
      setToken(value);
      setTokenState(value);
      if (!tokenIsPersisted()) {
        notify("O navegador bloqueou o armazenamento. O token vale só até fechar esta aba.", "info");
      }
    } finally {
      setCheckingToken(false);
    }
  };

  const activeNotebook =
    activeNotebookId === ALL_NOTEBOOKS
      ? null
      : (notebooks.find((notebook) => notebook.id === activeNotebookId) ?? null);
  const isBook = activeNotebook?.kind === "book";
  const isMcp = activeNotebook?.kind === "mcp";

  // Uma unica carga do indice de projetos serve as duas superficies: a lista
  // da sidebar e a area principal. Fora do caderno MCP nao busca nada.
  const projectsData = useProjectsIndex(isMcp ? activeNotebookId : "", refreshKey);
  const projectAggs = projectsData.index ? aggregate(projectsData.index) : [];

  const chooseProjectIcon = (entryId: string, icon: string) => {
    setPjIcons((current) => ({ ...current, [entryId]: icon }));
    // O icone persiste na entry; se a gravacao falhar, a tela nao quebra e a
    // escolha fica nesta sessao.
    void api.updateEntry(entryId, { icon }).catch(() => undefined);
  };

  // A lista de capitulos vive na sidebar, no lugar das notas. O App e o dono
  // dela para a sidebar e a casa do livro verem a mesma ordem.
  useEffect(() => {
    if (!token || !activeNotebook || activeNotebook.kind !== "book") {
      setBookChapters([]);
      setBookChaptersLoading(false);
      return;
    }
    let active = true;
    setBookChaptersLoading(true);
    void (async () => {
      const cached =
        (await api.listEntriesCached({ notebook_id: activeNotebook.id, limit: 1000 })) ??
        (await api.listEntriesCached({
          notebook_id: activeNotebook.id,
          include_words: true,
          limit: 1000,
        }));
      if (active && cached?.entries) setBookChapters(orderedChapters(cached.entries));
      try {
        const result = await api.listAllEntries({
          notebook_id: activeNotebook.id,
          include_words: true,
          limit: 1000,
        });
        if (active) setBookChapters(orderedChapters(result.entries ?? []));
      } catch {
        // Sem rede e com cache: mantem a lista que ja esta na tela.
      } finally {
        if (active) setBookChaptersLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token, activeNotebook?.id, activeNotebook?.kind, refreshKey]);

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
      if (isBook && activeNotebook) {
        await createBookChapter("chapter");
        return;
      }
      const entry = await api.createEntry("", null, targetNotebookId());
      setOpenEntryId(entry.id);
      setView("notes");
      closeDrawer();
      refresh();
    } catch {
      notify(isBook ? "Não foi possível criar o capítulo." : "Não foi possível criar a nota.", "error");
      refresh();
    }
  };

  const createBookChapter = async (kind: ChapterKind) => {
    if (!activeNotebook) return;
    try {
      const created = await api.createEntry("Sem título", null, activeNotebook.id, kind);
      setBookChapters((current) => orderedChapters([...current, created]));
      setOpenEntryId(created.id);
      setView("notes");
      closeDrawer();
      refresh();
    } catch {
      notify("Não foi possível criar o capítulo.", "error");
    }
  };

  // Ctrl+Enter no capitulo abre o proximo logo depois dele. A posicao e
  // recalculada pela mesma ordem que o arrastar usa, entao a lista continua
  // sendo uma so.
  const createBookChapterAfter = async (currentId: string) => {
    if (!activeNotebook) return;
    try {
      const created = await api.createEntry("Sem título", null, activeNotebook.id, "chapter");
      const list = orderedChapters([...bookChapters, created]).filter(
        (chapter) => chapter.id !== created.id,
      );
      const at = list.findIndex((chapter) => chapter.id === currentId);
      list.splice(at >= 0 ? at + 1 : list.length, 0, created);
      const payload = list.map((chapter, index) => ({
        entry_id: chapter.id,
        chapter_kind: (chapter.chapter_kind || "chapter") as ChapterKind,
        chapter_status: chapter.chapter_status || "draft",
        position: (index + 1) * 1024,
      }));
      await api.reorderChapters(activeNotebook.id, payload);
      setBookChapters(
        list.map((chapter, index) => ({ ...chapter, chapter_position: (index + 1) * 1024 })),
      );
      setOpenEntryId(created.id);
      refresh();
    } catch {
      notify("Não foi possível criar o capítulo.", "error");
    }
  };

  const reorderBookChapters = async (sourceId: string, targetId: string) => {
    if (!activeNotebook || sourceId === targetId) return;
    const list = orderedChapters(bookChapters);
    const from = list.findIndex((chapter) => chapter.id === sourceId);
    const to = list.findIndex((chapter) => chapter.id === targetId);
    if (from < 0 || to < 0) return;
    const moved = list.splice(from, 1)[0];
    list.splice(to, 0, moved);
    const payload = list.map((chapter, index) => ({
      entry_id: chapter.id,
      chapter_kind: (chapter.chapter_kind || "chapter") as ChapterKind,
      chapter_status: chapter.chapter_status || "draft",
      position: (index + 1) * 1024,
    }));
    try {
      await api.reorderChapters(activeNotebook.id, payload);
      setBookChapters(
        list.map((chapter, index) => ({ ...chapter, chapter_position: (index + 1) * 1024 })),
      );
      refresh();
    } catch {
      notify("Não foi possível reordenar.", "error");
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

  const openNotionImport = () => {
    setComposeOpen(false);
    setImportOpen(true);
  };

  const finishNotionImport = (result: NotionImportResult) => {
    // Caderno vazio e removido ao fim: nao seleciona um id que ja nao existe.
    if (!result.notebookRemoved) {
      setActiveNotebookId(result.notebookId);
      writeActiveNotebook(result.notebookId);
    }
    refresh();
  };

  const openNotionEntry = (id: string) => {
    setImportOpen(false);
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
    // Um livro nao some com um clique: o dialogo pede o titulo e mostra que os
    // capitulos vao para a Lixeira.
    if (notebook.kind === "book") {
      setBookDialog({ notebook });
      return;
    }
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

  const saveBookCover = async (notebook: Notebook, image: Blob) => {
    try {
      await api.uploadCover(notebook.id, image);
      refresh();
    } catch {
      notify("Não foi possível salvar a capa.", "error");
      throw new Error("cap");
    }
  };

  const removeBookCover = async (notebook: Notebook) => {
    try {
      await api.deleteCover(notebook.id);
      refresh();
    } catch {
      notify("Não foi possível remover a capa.", "error");
      throw new Error("cap");
    }
  };

  const saveBook = async (form: BookForm) => {
    try {
      if (bookDialog?.notebook) {
        await api.updateNotebook(bookDialog.notebook.id, form);
      } else {
        const created = await api.createNotebook({ ...form, kind: "book" });
        selectNotebook(created.id);
      }
      setBookDialog(null);
      refresh();
    } catch {
      notify("Não foi possível salvar o livro.", "error");
    }
  };

  const activateBook = async (notebook: Notebook, form: BookForm) => {
    try {
      await api.updateNotebook(notebook.id, { ...form, kind: "book" });
      setBookDialog(null);
      selectNotebook(notebook.id);
      refresh();
    } catch {
      notify("Não foi possível ativar o modo escritor.", "error");
    }
  };

  const moveNotesAndActivate = async (notebook: Notebook, form: BookForm) => {
    try {
      const defaultID =
        notebooks.find((item) => item.is_default)?.id ?? DEFAULT_NOTEBOOK_ID;
      const result = await api.listAllEntries({ notebook_id: notebook.id, limit: 1000 });
      for (const entry of result.entries ?? []) {
        await api.patchEntry(entry.id, { notebook_id: defaultID });
      }
      await api.updateNotebook(notebook.id, { ...form, kind: "book" });
      setBookDialog(null);
      selectNotebook(notebook.id);
      refresh();
    } catch {
      notify("Não foi possível mover as notas.", "error");
    }
  };

  const deactivateBook = async (notebook: Notebook) => {
    const chapters = notebook.chapter_count ?? 0;
    if (chapters > 0) {
      const ok = window.confirm(
        `Converter “${notebook.name}” em caderno comum? Os ${chapters} capítulos continuam como notas; só a estrutura do livro é descartada.`,
      );
      if (!ok) return;
    }
    try {
      await api.updateNotebook(notebook.id, {
        kind: "notes",
        ...(chapters > 0 ? { confirm_convert: true } : {}),
      });
      setBookDialog(null);
      refresh();
    } catch {
      notify("Não foi possível desativar o livro.", "error");
    }
  };

  const deleteBook = async (notebook: Notebook, confirmName: string) => {
    try {
      await api.deleteNotebook(notebook.id, { trash: true, confirm: confirmName });
      if (activeNotebookId === notebook.id) {
        selectNotebook(DEFAULT_NOTEBOOK_ID);
      }
      setBookDialog(null);
      refresh();
    } catch {
      notify("Não foi possível excluir o livro.", "error");
    }
  };

  const openFromOtherView = (id: string) => {
    setOpenEntryId(id);
    setView("notes");
    closeDrawer();
  };

  const openView = (id: ViewId) => {
    // Entrar pelo menu abre a tela no estado padrao; um foco vindo de uma nota
    // so vale para a abertura imediata do mapa.
    setEntityFocus(null);
    setReturnView(view === id ? null : view);
    setView(id);
    closeDrawer();
  };
  const goBack = () => {
    const target = returnView ?? "notes";
    setReturnView(null);
    setView(target);
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
      key: "writing",
      label: "Estatísticas",
      active: view === "writing",
      icon: <WritingIcon size={17} />,
      onPress: () => openView("writing"),
    },
    {
      key: "lab",
      label: "Processamento",
      active: view === "lab",
      icon: <CpuIcon size={17} />,
      onPress: () => openView("lab"),
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
      <WorkerKeepAlive />
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
            ? "Notas recentes"
            : (notebooks.find((notebook) => notebook.id === activeNotebookId)?.name ??
              "Notas ao acaso")}
        </span>
        {!isMcp && (
          <button
            type="button"
            className="button button--primary button--small"
            onClick={isBook ? () => void createNote() : openCompose}
            aria-label={isBook ? "Novo capítulo" : "Nova nota"}
          >
            <PlusIcon size={15} />
            {isBook ? "Capítulo" : "Nova nota"}
          </button>
        )}
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
            <div className="sidebar-brand-row">
              <div className="brand">
                dyarium
                <small>tinta e papel</small>
              </div>
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
            <div className="sidebar-top">
              <NotebookSwitcher
                notebooks={notebooks}
                activeId={activeNotebookId}
                onSelect={selectNotebook}
                onCreate={() => {
                  closeDrawer();
                  setNotebookDialog({ mode: "create" });
                }}
                onCreateBook={() => {
                  closeDrawer();
                  setBookDialog({});
                }}
                onBookSettings={(notebook) => {
                  closeDrawer();
                  setBookDialog({ notebook });
                }}
                onRename={(notebook) => {
                  closeDrawer();
                  setNotebookDialog({ mode: "rename", notebook });
                }}
                onDelete={(notebook) => {
                  closeDrawer();
                  void deleteNotebook(notebook);
                }}
              />
            </div>

            {/* O menu e a lista do escopo. No caderno de projetos (MCP) a
                lista da sidebar sao os proprios projetos: cada um no seu
                lugar, abrir um escopa a area principal. Nas listas comuns a
                busca, tags e arquivadas ficam no topo da propria lista. */}
            {isBook && activeNotebook ? (
              <BookSidebar
                book={activeNotebook}
                chapters={bookChapters}
                loading={bookChaptersLoading}
                activeChapterId={openEntryId}
                onOpen={(id) => {
                  setOpenEntryId(id);
                  setView("notes");
                  closeDrawer();
                }}
                onCreate={(kind) => void createBookChapter(kind)}
                onReorder={(source, target) => void reorderBookChapters(source, target)}
              />
            ) : isMcp ? (
              <ProjectList
                projects={projectAggs}
                totalCount={projectsData.index?.rows.length ?? 0}
                selectedProject={pjProject}
                onSelect={(project) => {
                  setPjProject(project);
                  setOpenEntryId(null);
                  setView("notes");
                  closeDrawer();
                }}
                icons={pjIcons}
                loading={projectsData.loading}
                error={projectsData.error}
              />
            ) : (
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
              onManageTags={() => {
                closeDrawer();
                setTagsOpen(true);
              }}
              onMutated={(removed) => {
                if (openEntryId && removed.includes(openEntryId)) {
                  setOpenEntryId(null);
                }
                refresh();
              }}
            />
            )}
          </>
        ) : (
          <div className="side-rail">
            {!isMcp && (
              <button
                type="button"
                className="rail-action rail-action--new"
                onClick={isBook ? () => void createNote() : openCompose}
                aria-label={isBook ? "Novo capítulo" : "Nova nota"}
                title={isBook ? "Novo capítulo" : "Nova nota"}
              >
                <PlusIcon size={18} />
              </button>
            )}
            {!isMcp && (
              <button
                type="button"
                className="rail-action"
                onClick={expandSearch}
                aria-label="Buscar nas notas"
                title="Buscar"
              >
                <SearchIcon size={17} />
              </button>
            )}
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
        <ErrorBoundary resetKey={`${view}:${openEntryId ?? ""}`}>
          {view === "notes" && isBook && activeNotebook ? (
            <BookView
              book={activeNotebook}
              chapters={bookChapters}
              loading={bookChaptersLoading}
              activeChapterId={openEntryId}
              onOpenChapter={(id) => {
                setOpenEntryId(id);
                setView("notes");
                closeDrawer();
              }}
              onCloseChapter={() => setOpenEntryId(null)}
              onCreateChapter={(kind) => void createBookChapter(kind)}
              onCreateChapterAfter={(id) => void createBookChapterAfter(id)}
              onReorderChapter={(source, target) => void reorderBookChapters(source, target)}
              onChanged={refresh}
              onOpenSettings={() => setBookDialog({ notebook: activeNotebook })}
            />
          ) : view === "notes" ? (
            <div className={isMcp ? "editor-pane editor-pane--pj" : "editor-pane"}>
              {openEntryId && isMcp ? (
                // Caderno de projetos: a nota abre por cima da superficie; a
                // faixa devolve para a tabela, como o menu faz com o livro.
                <div className="pj-backbar">
                  <button
                    type="button"
                    className="pj-back"
                    onClick={() => setOpenEntryId(null)}
                    aria-label="Voltar para projetos"
                    title="Projetos"
                  >
                    <span className="pj-backic" aria-hidden="true">
                      <ChevronIcon size={14} />
                    </span>
                    Projetos
                  </button>
                  {pjEditing ? (
                    <button
                      type="button"
                      className="pj-back"
                      onClick={() => {
                        setPjEditing(false);
                        refresh();
                      }}
                      aria-label="Voltar para a leitura"
                      title="Leitura"
                    >
                      <BookIcon size={14} />
                      Leitura
                    </button>
                  ) : null}
                </div>
              ) : null}
              {openEntryId && isMcp && !pjEditing ? (
                // Leitura da nota do projeto, como o prototipo; a edicao fica
                // a um toque (Editar), e ao voltar da edicao le de novo.
                <ProjectNote
                  key={openEntryId}
                  entryId={openEntryId}
                  notebookName={activeNotebook?.name ?? "Projetos"}
                  refreshKey={noteRefreshKey}
                  onFilterItems={(project, range) => {
                    setOpenEntryId(null);
                    // O pedido de fora escolhe o projeto na lista (estado do
                    // App) e so o periodo vai como pedido a superficie.
                    setPjProject(project);
                    setPjFilter((current) => ({
                      project,
                      range,
                      nonce: (current?.nonce ?? 0) + 1,
                    }));
                  }}
                  onEdit={() => setPjEditing(true)}
                />
              ) : openEntryId ? (
                <NoteEditor
                  key={openEntryId}
                  entryId={openEntryId}
                  refreshKey={noteRefreshKey}
                  failureReason={failures[openEntryId]}
                  progress={entryProgress[openEntryId]}
                  onChanged={refresh}
                  onDeleted={() => {
                    // So apaga a nota aberta se ela ainda for a que foi
                    // deletada; ao navegar para outra nota no meio, nao
                    // fecha a que acabou de abrir.
                    setOpenEntryId((current) =>
                      current === openEntryId ? null : current,
                    );
                    refresh();
                  }}
                  onOpenEntity={(kind, name, edit) => {
                    setEntityFocus({ kind, name, edit });
                    setView("map");
                  }}
                  onOpenEntry={(id) => setOpenEntryId(id)}
                  notebooks={notebooks}
                />
              ) : isMcp ? (
                // Caderno de projetos MCP: a lista da sidebar sao os projetos;
                // abrir um escopa esta area. Clicar numa linha abre a nota
                // daquele projeto no mesmo editor, como a lista de notas faz.
                <div className="page page--projects">
                  <ProjectsView
                    index={projectsData.index}
                    loading={projectsData.loading}
                    error={projectsData.error}
                    selectedProject={pjProject}
                    icons={pjIcons}
                    onChooseIcon={chooseProjectIcon}
                    filterRequest={pjFilter}
                    onOpenEntry={(id) => {
                      setView("notes");
                      setOpenEntryId(id);
                      closeDrawer();
                    }}
                  />
                </div>
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
                        onClick={openNotionImport}
                      >
                        Importar do Notion
                      </button>
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() => openView("map")}
                      >
                        Ver mapa
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : view === "map" ? (
            <div className="page page--map">
              <MapView
                refreshKey={refreshKey}
                onOpen={openFromOtherView}
                focus={entityFocus}
                onFocusApplied={() => setEntityFocus(null)}
              />
            </div>
          ) : view === "writing" ? (
            <div className="page">
              <WritingView refreshKey={refreshKey} />
            </div>
          ) : view === "lab" ? (
            <div className="page page--lab">
              <LabView onBack={goBack} />
            </div>
          ) : (
            <div className="page">
              <SettingsView refreshKey={refreshKey} onBack={goBack} />
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

      <BookDialog
        open={bookDialog !== null}
        notebook={bookDialog?.notebook}
        defaultAuthor={ownerName}
        chapterCount={bookDialog?.notebook?.chapter_count ?? 0}
        onClose={() => setBookDialog(null)}
        onSave={(form) => void saveBook(form)}
        onActivate={(form) => bookDialog?.notebook && void activateBook(bookDialog.notebook, form)}
        onMoveNotes={(form) =>
          bookDialog?.notebook && void moveNotesAndActivate(bookDialog.notebook, form)
        }
        onDeactivate={() => bookDialog?.notebook && void deactivateBook(bookDialog.notebook)}
        onDelete={(confirm) => bookDialog?.notebook && void deleteBook(bookDialog.notebook, confirm)}
        onCoverSave={
          bookDialog?.notebook ? (image) => saveBookCover(bookDialog.notebook!, image) : undefined
        }
        onCoverRemove={
          bookDialog?.notebook ? () => removeBookCover(bookDialog.notebook!) : undefined
        }
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
        onImport={openNotionImport}
        onCreated={openCreatedEntry}
      />

      {importOpen && (
        <NotionImportDialog
          open
          notebooks={notebooks}
          currentNotebookId={targetNotebookId()}
          onClose={() => setImportOpen(false)}
          onFinished={finishNotionImport}
          onOpenEntry={openNotionEntry}
        />
      )}
    </div>
  );
}

export default App;
