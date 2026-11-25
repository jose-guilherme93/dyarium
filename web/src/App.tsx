import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  api,
  ApiError,
  clearToken,
  getSetupState,
  getToken,
  probeServer,
  setToken,
  tokenIsPersisted,
  verifyToken,
} from "./api";
import { useEvents } from "./useEvents";

/**
 * O laboratorio (inferencia no navegador) carrega o onnxruntime, cujo wasm
 * passa de 25 MiB — acima do limite por arquivo do Cloudflare. No build
 * hospedado ele fica de fora: nao ha servidor para o /lab falar. O build
 * self-hosted define VITE_ORT=1 e leva tudo, sob demanda.
 */
const LAB_ENABLED = import.meta.env.VITE_ORT === "1";

const LabView = LAB_ENABLED
  ? lazy(() => import("./views/LabView").then((mod) => ({ default: mod.LabView })))
  : null;

const WorkerKeepAlive = LAB_ENABLED
  ? lazy(() =>
      import("./components/WorkerKeepAlive").then((mod) => ({ default: mod.WorkerKeepAlive })),
    )
  : null;
import { FirstRun } from "./components/FirstRun";
import { VaultBoot } from "./components/VaultBoot";
import { DriveReconnect, rememberDriveVault } from "./components/DriveReconnect";
import { AccountAvatar, AccountSheet, accountState } from "./components/AccountSheet";
import { NoteTabs } from "./components/NoteTabs";
import { readTabs, writeTabs, openTab, activateTab, closeTab, closeTabs, reconcileTabs, setTabTitle, type TabsState } from "./lib/tabs";
import { noteTitle } from "./lib/noteTitle";
import { ImportJobStrip } from "./components/ImportJobStrip";
import { importJobState, subscribeImportJob, type ImportJobState } from "./local/importJob";
import { markVaultDirty, runVaultSync, setVaultTarget, flushVaultSync } from "./local/folderSync";
import { rememberFolder } from "./local/folder";
import { connectDrive, driveClient, driveConfigured, driveProfile, driveSessionState, driveVaultRoot, onDriveSessionChange, signOutAccount } from "./local/driveSession";
import { cachedProfile as cachedAccountProfile, onAccountChange } from "./local/account";
import { preloadGoogle } from "./local/google";
import { driveMarked } from "./local/driveMark";
import { connectAccount } from "./local/accountConnect";
import type { VaultStage } from "./local/vaultCloud";
import type { StepProgress } from "./local/backup";
import { TokenGate } from "./components/TokenGate";
import { SetupGate } from "./components/SetupGate";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { NoteList } from "./components/NoteList";
import { NoteEditor } from "./components/NoteEditor";
import { HomeStart } from "./views/HomeStart";
import { Icon } from "./ui";
import { NotebookDialog } from "./components/NotebookDialog";
import { NotebookSwitcher } from "./components/NotebookSwitcher";
import { BookDialog, type BookForm } from "./components/BookDialog";
import { BookSidebar } from "./components/BookSidebar";
import { NotionImportDialog } from "./components/NotionImportDialog";
import { OfflineBanner } from "./components/OfflineBanner";
import { TagManager } from "./components/TagManager";
import { ComposeDialog, type ComposeAnchor } from "./components/ComposeDialog";
import { ImportServerDialog } from "./components/ImportServerDialog";
import { useToast } from "./components/Toasts";
import {
  CalendarIcon,
  ChevronIcon,
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
import { useProjectsIndex, type ProjectsNode } from "./lib/useProjectsIndex";
import { ProjectList } from "./components/ProjectList";
import type { NotionImportResult } from "./lib/notionImport";
import { MapView } from "./views/MapView";
import { ProjectsView } from "./views/ProjectsView";
import { CalendarView } from "./views/CalendarView";
import { SettingsView } from "./views/SettingsView";
import { WritingView } from "./views/WritingView";
import { BookView } from "./views/BookView";
import type { ChapterKind, EntityKind, Entry, Notebook, ServerEvent } from "./types";
import "./App.css";

type ViewId = "notes" | "map" | "calendar" | "writing" | "settings" | "lab";

const ACTIVE_NOTEBOOK_KEY = "dyarium.notebook";

/** O "pronto" fica na tela antes de o app entrar, como no prototipo. */
const VAULT_READY_HOLD_MS = 1200;

function aguardar(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

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

/** Caderno da nota: livro e projetos abrem na propria superficie, sem aba. */
function aceitaAba(notebooks: Notebook[], notebookId: string): boolean {
  const caderno = notebooks.find((notebook) => notebook.id === notebookId);
  return !caderno || caderno.kind === "notes";
}

export function App() {
  /**
   * Desenvolvimento preso ao cofre do navegador (`VITE_LOCAL_ONLY=1`):
   * ignora o token guardado e nem pergunta /setup/state, para o site estatico
   * ser testavel em localhost com a API de pe. So vale a partir do ambiente
   * (web/.env.local, que nao entra no repositorio); nenhum build publico
   * define a variavel.
   */
  const localOnly = import.meta.env.VITE_LOCAL_ONLY === "1";
  const [token, setTokenState] = useState(() => (localOnly ? "" : getToken()));
  const [authError, setAuthError] = useState("");
  const [checkingToken, setCheckingToken] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  /** A instancia respondeu em /setup/state? Sem servidor, o app usa o cofre local. */
  const [serverChecked, setServerChecked] = useState(false);
  // Primeira visita ao site: a tela de apresentacao decide onde o cofre mora.
  const [onboarded, setOnboarded] = useState(() => {
    try {
      return localStorage.getItem("dyarium.onboarded") === "1";
    } catch {
      return false;
    }
  });
  const [account, setAccount] = useState(() => driveProfile() ?? cachedAccountProfile());
  /**
   * Conta lembrada neste navegador: a marca do Drive mais o perfil em cache.
   * O reload nunca volta a primeira tela nesse caso; abre o cache e tenta o
   * Google em silencio.
   */
  const accountRemembered = driveMarked() && account !== null;
  const [accountSheetOpen, setAccountSheetOpen] = useState(false);
  // "Ja tenho uma instalacao propria" troca a apresentacao pelo portao do token.
  const [forceTokenGate, setForceTokenGate] = useState(false);
  // Cofre do Drive abrindo: em vez do botao parado, a tela conta a etapa.
  // `done` e o fim do trabalho; quem desmonta e a entrada no app.
  const [vaultBoot, setVaultBoot] = useState<{
    stage: VaultStage;
    progress?: StepProgress;
    done: boolean;
  } | null>(null);
  const [serverAvailable, setServerAvailable] = useState(false);
  const [view, setView] = useState<ViewId>(() =>
    typeof window !== "undefined" && window.location.pathname === "/lab" ? "lab" : "notes",
  );
  // No navegador estreito a navegacao e uma gaveta: comeca fechada.
  const [navOpen, setNavOpen] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth > 900,
  );
  // Abaixo de 900 o trilho nao existe: a barra do celular e a gaveta assumem,
  // e as acoes globais moram no pe da gaveta. O estado acompanha a janela para
  // o DOM nao ter dois conjuntos de acoes ao mesmo tempo.
  const [compact, setCompact] = useState(() =>
    typeof window === "undefined" ? false : window.innerWidth <= 900,
  );
  useEffect(() => {
    const sync = () => setCompact(window.innerWidth <= 900);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);
  const [openEntryId, setOpenEntryId] = useState<string | null>(
    () => readTabs().activeId,
  );
  // Abas das notas comuns. O estado vive num ref junto com o React para as
  // acoes encadeadas (abrir, fechar, apagar) verem sempre o valor mais novo.
  const [tabsState, setTabsState] = useState<TabsState>(() => readTabs());
  const tabsRef = useRef<TabsState>(tabsState);
  /** Ids que vieram do localStorage: so eles podem ser descartados na lista. */
  const tabsIniciais = useRef<string[]>(tabsState.tabs.map((tab) => tab.id));
  const atualizarAbas = useCallback((atualizar: (atual: TabsState) => TabsState) => {
    const proximo = atualizar(tabsRef.current);
    tabsRef.current = proximo;
    setTabsState(proximo);
    return proximo;
  }, []);
  // A lista so reconcilia as abas restauradas uma vez: abrir uma nota nova
  // antes de a lista chegar nao pode ser confundido com id invalido.
  const abasReconciliadas = useRef(false);
  /** Conta aberta no pe do trilho: guarda o botao para ancorar e devolver foco. */
  const [accountAnchor, setAccountAnchor] = useState<HTMLElement | null>(null);
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
  /** Importacao do acervo de uma instancia self-hosted para este cofre. */
  const [importServerOpen, setImportServerOpen] = useState(false);
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
  // No caderno MCP o no escolhido na arvore dirige a superficie inteira. A
  // selecao e estado do App, nao URL: arvore e superficie leem o mesmo valor.
  const [pjNode, setPjNode] = useState<ProjectsNode>({ kind: "all" });
  useEffect(() => {
    setPjNode({ kind: "all" });
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

  /**
   * Recarrega lista e nota aberta. Toda escrita passa por aqui: o cofre em
   * pasta espera alguns minutos de silencio para gravar so o que mudou.
   *
   * Fica entre os hooks (antes dos retornos condicionais) porque a assinatura
   * da importacao em segundo plano tambem precisa dele quando a tarefa termina.
   */
  const refresh = () => {
    setRefreshKey((key) => key + 1);
    setNoteRefreshKey((key) => key + 1);
    markVaultDirty();
  };

  // A importacao do servidor roda fora do dialogo. Quando a tarefa termina —
  // com resultado ou com erro, porque notas podem ter entrado antes de falhar —
  // a lista recarrega, como o antigo `onImported` fazia. O flush do cofre agora
  // e da propria tarefa (5 s depois do fim), nao de quem abriu o dialogo.
  useEffect(() => {
    let visto: ImportJobState | null = null;
    return subscribeImportJob(() => {
      const estado = importJobState();
      if (visto === estado) return;
      visto = estado;
      if (estado.status === "done" || estado.status === "error") refresh();
    });
    // `refresh` so mexe em setters e na marca do cofre: a assinatura e a mesma.
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
    if (localOnly) {
      // Dev sem servidor: a resposta ja e conhecida e o portao do token nao
      // pode esconder o cofre do navegador.
      setServerChecked(true);
      return;
    }
    let active = true;
    probeServer()
      .then((ok) => {
        if (!active) return;
        setServerAvailable(ok);
        // Site estatico: nao existe /api/v1. O cofre do navegador assume.
        if (!ok) return;
        return getSetupState().then((state) => {
          if (active && state.required) setSetupRequired(true);
        });
      })
      .finally(() => {
        if (active) setServerChecked(true);
      });
    return () => {
      active = false;
    };
  }, [localOnly]);

  // Cofre em pasta: grava o pendente ao abrir e ao fechar a aba. O alvo e o
  // Drive quando ha sessao viva; sem sessao, cai na pasta lembrada.
  useEffect(() => {
    if (!onboarded && !accountRemembered) return;
    setVaultTarget(async () => (driveClient() ? driveVaultRoot() : rememberFolder()));
    const flush = () => {
      void runVaultSync().catch(() => undefined);
    };
    flush();
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [onboarded, accountRemembered]);

  // A sessao do Google vive so na memoria e morre no reload. Todo login que
  // termina — da primeira tela, das Configuracoes ou da linha de reconectar —
  // deixa a marca local de que este navegador tem cofre no Drive. E ela que faz
  // a linha aparecer quando a sessao se perder.
  useEffect(
    () =>
      onDriveSessionChange(() => {
        if (driveSessionState() === "connected") rememberDriveVault();
        setAccount(driveProfile() ?? cachedAccountProfile());
      }),
    [],
  );

  useEffect(() => onAccountChange((p) => setAccount(p ?? driveProfile())), []);

  // Renovacao silenciosa da sessao do Google: ao primeiro gesto do usuario, tenta
  // recuperar o token sem popup. Falha nao faz nada; a linha de reconectar segue.
  useEffect(() => {
    if (!onboarded && !accountRemembered) return;
    if (!driveMarked()) return;
    if (!driveConfigured()) return;
    // O script precisa chegar antes do gesto: baixar durante o clique gasta a
    // ativacao do usuario e o pedido silencioso morre bloqueado.
    void preloadGoogle();
    if (driveSessionState() === "connected") return;
    let encerrado = false;
    const tentar = async () => {
      if (encerrado) return;
      encerrado = true;
      limpar();
      try {
        await connectDrive({ silent: true });
        await flushVaultSync();
        refresh();
      } catch {
        // Nada: a linha de reconectar continua como fallback.
      }
    };
    const limpar = () => {
      document.removeEventListener("pointerdown", tratador, true);
      document.removeEventListener("keydown", tratador, true);
    };
    const tratador = () => void tentar();
    document.addEventListener("pointerdown", tratador, true);
    document.addEventListener("keydown", tratador, true);
    return limpar;
  }, [onboarded, accountRemembered]);

  // A token already stored may be stale (rotated on the server) or simply
  // wrong; validate it on load and fall back to the gate. A network failure
  // keeps the token so the app can still be used offline with cached data.
  useEffect(() => {
    if (localOnly) return;
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
  }, [localOnly]);

  // Cadernos: espelho do servidor. A selecao fica no navegador; se o caderno
  // sumiu, cai no padrao.
  useEffect(() => {
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

  // Uma unica carga do indice de projetos serve as duas superficies: a arvore
  // da sidebar e a area principal. Fora do caderno MCP nao busca nada.
  const projectsData = useProjectsIndex(isMcp ? activeNotebookId : "", refreshKey);

  // A lista de capitulos vive na sidebar, no lugar das notas. O App e o dono
  // dela para a sidebar e a casa do livro verem a mesma ordem.
  useEffect(() => {
    // Sem token o livro tambem tem capitulos: eles moram no cofre do navegador.
    if (!activeNotebook || activeNotebook.kind !== "book") {
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

  // Abas: grava sempre que a mesa muda, para o recarregamento devolver o mesmo.
  useEffect(() => {
    writeTabs(tabsState);
  }, [tabsState]);

  // Abas restauradas: a primeira lista completa que chega descarta os ids que
  // nao existem mais e confirma o titulo das que ficaram. Abrir uma nota nova
  // enquanto isso nao a marca como invalida: so os ids restaurados sao
  // reconciliados, uma vez.
  useEffect(() => {
    if (tabsState.tabs.length === 0) return undefined;
    let active = true;
    const aplicar = (entries: Entry[], completo: boolean) => {
      if (!active) return;
      const porId = new Map(entries.map((entry) => [entry.id, noteTitle(entry)]));
      atualizarAbas((atual) => {
        let proximo = atual;
        for (const tab of atual.tabs) {
          const titulo = porId.get(tab.id);
          if (titulo) proximo = setTabTitle(proximo, tab.id, titulo);
        }
        if (completo && !abasReconciliadas.current) {
          const sumiram = new Set(tabsIniciais.current.filter((id) => !porId.has(id)));
          if (sumiram.size > 0) {
            proximo = reconcileTabs(proximo, (id) => !sumiram.has(id));
          }
        }
        return proximo;
      });
      if (completo && !abasReconciliadas.current) {
        abasReconciliadas.current = true;
        const sumiram = tabsIniciais.current;
        setOpenEntryId((atual) => {
          if (!atual || !sumiram.includes(atual) || porId.has(atual)) return atual;
          return tabsRef.current.activeId;
        });
      }
    };
    // O cache pinta os titulos antes da rede; a lista completa reconcilia.
    void api
      .listEntriesCached({ limit: 1000, exclude_books: true })
      .then((resultado) => {
        if (resultado?.entries) aplicar(resultado.entries, false);
      })
      .catch(() => undefined);
    void api
      .listAllEntries({ exclude_books: true })
      .then((resultado) => aplicar(resultado.entries ?? [], true))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [atualizarAbas, tabsState.tabs.length, refreshKey]);

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

  // Servidor sem token pede o token; site estatico abre o cofre local.
  if (!serverChecked) {
    return null;
  }

  const finishOnboarding = () => {
    try {
      localStorage.setItem("dyarium.onboarded", "1");
    } catch {
      // sem localStorage a apresentacao volta na proxima abertura; nada se perde
    }
    setOnboarded(true);
  };

  // Site estatico ainda sem cofre escolhido: a primeira tela apresenta o
  // produto e pergunta onde as notas vao morar. Com conta lembrada (marca do
  // Drive + perfil), o reload abre o cache em vez de voltar a apresentacao.
  if (!token && !serverAvailable && !onboarded && !forceTokenGate && !accountRemembered) {
    return (
      <>
        {/* A primeira tela fica montada e escondida enquanto o cofre abre: e
            ela que guarda a linha de erro do Drive (o FirstRun mostra o
            motivo da falha), e desmonta-la perderia a mensagem. */}
        <div className="vault-boot-underlay" hidden={vaultBoot !== null}>
          <FirstRun
            googleReady={driveConfigured()}
            onFolderChosen={async (folder) => {
              // O primeiro backup e parte de "criar o cofre": se a pasta recusar a
              // escrita, a tela mostra o erro em vez de seguir como se tivesse dado.
              await runVaultSync(folder);
              finishOnboarding();
            }}
            onDriveChosen={async () => {
              // "conectando" entra antes do clique virar promessa: a tela de
              // carregamento nao espera o Google responder para aparecer.
              setVaultBoot({ stage: "conectando", done: false });
              try {
                // Entrada unica: login, abertura (Drive + local unidos, sem
                // passar por cima do mais novo) e o sync da uniao. A marca do
                // Drive nasce aqui, no fim.
                await connectAccount({
                  // Cada etapa chega sem o progresso da anterior: a contagem
                  // de notas nao pode aparecer no passo dos anexos.
                  onStage: (stage: VaultStage) => setVaultBoot({ stage, done: false }),
                  onProgress: (progress: StepProgress) =>
                    setVaultBoot((current) =>
                      current ? { ...current, progress } : current,
                    ),
                });
                setVaultTarget(() => driveVaultRoot().catch(() => null));
                setVaultBoot((current) => (current ? { ...current, done: true } : current));
                await aguardar(VAULT_READY_HOLD_MS);
                setVaultBoot(null);
                finishOnboarding();
              } catch (causa) {
                // De volta a primeira tela, que mostra a causa em uma linha.
                setVaultBoot(null);
                throw causa;
              }
            }}
            onUseBrowserOnly={finishOnboarding}
            onSelfHosted={() => setForceTokenGate(true)}
          />
        </div>
        {vaultBoot && (
          <VaultBoot
            stage={vaultBoot.stage}
            progress={vaultBoot.progress}
            done={vaultBoot.done}
          />
        )}
      </>
    );
  }


  if (!token && (serverAvailable || forceTokenGate)) {
    return (
      <TokenGate
        onSubmit={(value) => void handleLogin(value)}
        error={authError}
        checking={checkingToken}
      />
    );
  }

  const closeDrawer = () => {
    if (window.innerWidth <= 900) setNavOpen(false);
  };

  /**
   * Abre uma nota comum no editor. Todo caminho que mostra uma nota passa por
   * aqui: a aba nasce (ou e reativada, sem duplicar) junto com o editor.
   */
  const openNote = (id: string, title = "") => {
    atualizarAbas((atual) => openTab(atual, id, title));
    setOpenEntryId(id);
    setView("notes");
    closeDrawer();
  };

  const selectNoteTab = (id: string) => {
    atualizarAbas((atual) => activateTab(atual, id));
    setOpenEntryId(id);
    setView("notes");
  };

  /** Fecha a aba; se era a ativa, a vizinha assume (ou o inicio). */
  const closeNoteTab = (id: string) => {
    const proximo = atualizarAbas((atual) => closeTab(atual, id));
    if (openEntryRef.current === id) setOpenEntryId(proximo.activeId);
  };

  /** Notas apagadas ou arquivadas levam a aba delas junto. */
  const closeTabsFor = (ids: string[]) => {
    if (ids.length === 0) return;
    const proximo = atualizarAbas((atual) => closeTabs(atual, ids));
    if (openEntryRef.current && ids.includes(openEntryRef.current)) {
      setOpenEntryId(proximo.activeId);
    }
  };

  const toggleAccountMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    setAccountAnchor(event.currentTarget);
    setAccountSheetOpen((aberto) => !aberto);
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
      openNote(entry.id);
      refresh();
    } catch {
      notify(isBook ? "Não foi possível criar o capítulo." : "Não foi possível criar a nota.", "error");
      refresh();
    }
  };

  // O calendario cria a nota de hoje (data de geracao) e abre no editor.
  const createCalendarNote = async (title: string) => {
    const entry = await api.createEntry(title, null, targetNotebookId());
    openNote(entry.id, title);
    refresh();
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

  // Abre o compose sem um botao de origem (inicio do web): ancora no centro.
  const openComposeHere = () => {
    const width = 320;
    const left = Math.max(12, (window.innerWidth - width) / 2);
    const top = Math.max(12, window.innerHeight / 2 - 120);
    setComposeAnchor({ top, bottom: top + 40, left, right: left + width });
    setComposeOpen(true);
  };

  const createTextNote = () => {
    setComposeOpen(false);
    void createNote();
  };

  const openCreatedEntry = (id: string) => {
    setComposeOpen(false);
    openNote(id);
    refresh();
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
    openNote(id);
    refresh();
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
    openNote(id);
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

  // A barra do celular nomeia a tela atual: sem isto, Mapa e Configurações
  // continuavam aparecendo como "Notas recentes" no topo.
  const mobileTitle =
    view === "map"
      ? "Mapa"
      : view === "calendar"
        ? "Calendário"
        : view === "writing"
          ? "Estatísticas"
          : view === "settings"
            ? "Configurações"
            : view === "lab"
              ? "Laboratório"
              : activeNotebookId === ALL_NOTEBOOKS
                ? "Notas recentes"
                : (notebooks.find((notebook) => notebook.id === activeNotebookId)?.name ??
                  "Notas ao acaso");

  // Barra de abas so na superficie de notas comuns: livro e caderno de
  // projetos abrem a nota dentro da propria tela, sem aba.
  const showTabs = view === "notes" && !isBook && !isMcp && tabsState.tabs.length > 0;

  /**
   * Sair da conta no site estatico: grava o pendente, apaga o cache local e
   * recarrega vazio. Se a gravacao falhar, so a confirmacao destrutiva passa.
   */
  const sairDaConta = async () => {
    if (!account && !driveMarked()) return;
    const confirmado = window.confirm(
      "Sair da conta? O cofre continua no Drive. O cache deste navegador será apagado.",
    );
    if (!confirmado) return;
    let resultado = await signOutAccount();
    if (!resultado.ok) {
      const descartar = window.confirm(
        `${resultado.message}. Sair mesmo assim? O que não subiu será perdido.`,
      );
      if (!descartar) return;
      resultado = await signOutAccount({ discard: true });
    }
    if (resultado.ok) {
      window.location.reload();
      return;
    }
    notify(resultado.message, "error");
  };

  const footerItems = [
    {
      key: "map",
      label: "Mapa",
      active: view === "map",
      icon: <MapIcon size={16} />,
      onPress: () => openView("map"),
    },
    {
      key: "writing",
      label: "Estatísticas",
      active: view === "writing",
      icon: <WritingIcon size={16} />,
      onPress: () => openView("writing"),
    },
    {
      key: "calendar",
      label: "Calendário",
      active: view === "calendar",
      icon: <CalendarIcon size={16} />,
      onPress: () => openView("calendar"),
    },
    {
      key: "settings",
      label: "Configurações",
      active: view === "settings",
      icon: <SettingsIcon size={16} />,
      onPress: () => openView("settings"),
    },
    {
      key: "logout",
      label: "Sair",
      active: false,
      icon: <ExitIcon size={16} />,
      onPress: () => {
        if (token) {
          clearToken();
          setTokenState("");
          return;
        }
        void sairDaConta();
      },
    },
  ];

  return (
    <div className={navOpen ? "app" : "app app--collapsed"}>
      {WorkerKeepAlive && (
        <Suspense fallback={null}>
          <WorkerKeepAlive />
        </Suspense>
      )}
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
        <span className="mobile-bar-title">{mobileTitle}</span>
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
        <button
          type="button"
          className="account-avatar-button account-avatar-button--bar"
          aria-label="Conta"
          title="Conta"
          aria-haspopup="menu"
          aria-expanded={accountSheetOpen}
          onClick={toggleAccountMenu}
        >
          <AccountAvatar profile={account} state={accountState(account)} />
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
      {/* O trilho nao recolhe: ele e a navegacao global e continua na tela com
          a sidebar aberta ou fechada. Abaixo de 900 ele sai de cena e a gaveta
          leva as mesmas acoes no pe. */}
      {!compact && (
        <nav className="side-rail" aria-label="Trilho">
          <button
            type="button"
            className="rail-action rail-expand"
            onClick={() => setNavOpen((open) => !open)}
            aria-label={navOpen ? "Recolher menu" : "Expandir menu"}
            title={navOpen ? "Recolher menu" : "Expandir menu"}
            aria-expanded={navOpen}
          >
            <ChevronIcon size={16} />
          </button>
          <span className="rail-sep" aria-hidden="true" />
          {!isMcp && (
            <button
              type="button"
              className="rail-action rail-action--new"
              onClick={isBook ? () => void createNote() : openCompose}
              aria-label={isBook ? "Novo capítulo" : "Nova nota"}
              title={isBook ? "Novo capítulo" : "Nova nota"}
            >
              <PlusIcon size={16} />
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
              <SearchIcon size={16} />
            </button>
          )}
          {!isMcp && (
            <button
              type="button"
              className="rail-action"
              onClick={openNotionImport}
              aria-label="Importar do Notion"
              title="Importar do Notion"
            >
              <Icon name="cloud" size={16} />
            </button>
          )}
          {!isMcp && (
            <button
              type="button"
              className="rail-action"
              onClick={() => setImportServerOpen(true)}
              aria-label="Importar de um servidor"
              title="Importar de um servidor"
            >
              <Icon name="server" size={16} />
            </button>
          )}
          <div className="rail-foot">
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
          </div>
          <button
            type="button"
            className="account-avatar-button account-avatar-button--rail"
            aria-label="Conta"
            title="Conta"
            aria-haspopup="menu"
            aria-expanded={accountSheetOpen}
            onClick={toggleAccountMenu}
          >
            <AccountAvatar profile={account} state={accountState(account)} />
          </button>
        </nav>
      )}

      {navOpen && (
        <aside className="sidebar" aria-label="Navegação principal">
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
                index={projectsData.index}
                node={pjNode}
                onSelect={(node) => {
                  setPjNode(node);
                  setOpenEntryId(null);
                  setView("notes");
                  closeDrawer();
                }}
                icons={{}}
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
              onOpen={(id, title) => openNote(id, title)}
              onCreate={openCompose}
              onManageTags={() => {
                closeDrawer();
                setTagsOpen(true);
              }}
              onMutated={(removed) => {
                closeTabsFor(removed);
                refresh();
              }}
            />
            )}
          {/* No celular a gaveta e a unica navegacao: as acoes globais moram
              no pe dela, como antes. No desktop o trilho ja as mostra e a
              sidebar nao as repete. */}
          {compact && (
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
      )}

      <main className="workspace" aria-label="Conteúdo">
        {/* A importacao continua depois do dialogo fechar e nao pertence a
            nenhuma tela: fica acima do conteudo para sobreviver a troca de
            Mapa, Calendario ou Configuracoes. */}
        <div className="workspace-stack">
          <ImportJobStrip />
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
            <div className="notes-shell">
              {/* A linha de reconectar fica acima da area das notas, na area
                  principal: e aqui que a pessoa esta olhando as notas quando a
                  sessao do Google morre, nao dentro das Configuracoes. */}
              {!isMcp && <DriveReconnect />}
              <div
                className={
                  showTabs
                    ? "editor-pane editor-pane--tabs"
                    : isMcp
                      ? "editor-pane editor-pane--pjx"
                      : "editor-pane"
                }
              >
                {showTabs && (
                  <NoteTabs
                    tabs={tabsState.tabs}
                    activeId={openEntryId}
                    onSelect={selectNoteTab}
                    onClose={closeNoteTab}
                  />
                )}
                {openEntryId && isMcp ? (
                  // Caderno de projetos: a nota abre por cima da superficie; a
                  // faixa devolve para a leitura do no, como o menu faz com o livro.
                  <div className="pjx-backbar">
                    <button
                      type="button"
                      className="pjx-back dy-label"
                      onClick={() => setOpenEntryId(null)}
                      aria-label="Voltar para projetos"
                      title="Projetos"
                    >
                      <span className="pjx-ico pjx-ico--sm" aria-hidden="true">
                        <svg
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M10 3 5 8l5 5" />
                        </svg>
                      </span>
                      Projetos
                    </button>
                  </div>
                ) : null}
                {openEntryId ? (
                  <NoteEditor
                    key={openEntryId}
                    entryId={openEntryId}
                    refreshKey={noteRefreshKey}
                    failureReason={failures[openEntryId]}
                    progress={entryProgress[openEntryId]}
                    onChanged={refresh}
                    onDeleted={() => {
                      // A nota que foi apagada leva a aba dela; a vizinha assume
                      // se era a ativa, e navegar no meio do caminho nao troca
                      // a nota que ja esta aberta.
                      closeNoteTab(openEntryId);
                      refresh();
                    }}
                    onOpenEntity={(kind, name, edit) => {
                      setEntityFocus({ kind, name, edit });
                      setView("map");
                    }}
                    onOpenEntry={(id) => openNote(id)}
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
                      node={pjNode}
                      onSelectNode={setPjNode}
                      onOpenEntry={(id) => {
                        setView("notes");
                        setOpenEntryId(id);
                        closeDrawer();
                      }}
                    />
                  </div>
                ) : (
                  <HomeStart
                    onNewNote={openComposeHere}
                    onOpenAnalysis={() => openView("writing")}
                  />
                )}
              </div>
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
          ) : view === "calendar" ? (
            <div className="page page--calendar">
              <CalendarView
                refreshKey={refreshKey}
                notebookId={activeNotebookId}
                notebooks={notebooks}
                onOpenNote={openFromOtherView}
                onCreateNote={createCalendarNote}
              />
            </div>
          ) : view === "lab" && LabView ? (
            <div className="page page--lab">
              <Suspense fallback={null}>
                <LabView onBack={goBack} />
              </Suspense>
            </div>
          ) : (
            <div className="page">
              <SettingsView
                refreshKey={refreshKey}
                onBack={goBack}
                onOpenLab={LAB_ENABLED ? () => openView("lab") : undefined}
                onOpenProject={(notebookId, entryId) => {
                  setActiveNotebookId(notebookId);
                  writeActiveNotebook(notebookId);
                  if (aceitaAba(notebooks, notebookId)) {
                    openNote(entryId);
                    return;
                  }
                  setOpenEntryId(entryId);
                  setView("notes");
                }}
              />
            </div>
          )}
          </ErrorBoundary>
        </div>
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

      {importServerOpen && (
        <ImportServerDialog onClose={() => setImportServerOpen(false)} />
      )}

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
      {accountSheetOpen && (
        <AccountSheet
          open
          onClose={() => setAccountSheetOpen(false)}
          profile={account}
          anchor={accountAnchor}
          onSync={refresh}
          onSignedOut={() => window.location.reload()}
        />
      )}
    </div>
  );
}

export default App;
