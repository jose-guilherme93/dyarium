import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import "./settings.css";
import { api, getToken, isLocalMode } from "../api";
import { readTelemetryEnabled, setTelemetryEnabled, telemetryConfigured } from "../lib/telemetry";
import {
  AllNotebooksIcon,
  CpuIcon,
  KeyIcon,
  SparkIcon,
  TrashIcon,
  UserIcon,
  WaveIcon,
} from "../components/icons";
import {
  ensureVaultCode,
  setVaultCode as adoptVaultCode,
  vaultKeyFromCode,
} from "../local/vault";
import {
  applySnapshot,
  buildNotesSnapshot,
  buildSnapshot,
  openSnapshot,
  sealSnapshot,
  vaultIdFromCode,
} from "../local/backup";
import { lastSyncSummary } from "../local/folderSync";
import { connectAccount } from "../local/accountConnect";
import { restoreVaultFromDrive, syncVaultToDrive } from "../local/vaultCloud";
import { downloadBytes, packVault, unpackVault } from "../local/bundle";
import {
  pickFolder,
  readVaultFromFolder,
  rememberFolder,
  supportsFolder,
  writeVaultToFolder,
  type FolderLike,
} from "../local/folder";
import {
  disconnectDrive,
  driveConfigured,
  driveSessionState,
  onDriveSessionChange,
  type DriveSessionState,
} from "../local/driveSession";
import { ListSkeleton } from "../components/Skeleton";
import { TrashSection } from "../components/TrashSection";
import { useToast } from "../components/Toasts";
import {
  canSearchModels,
  DEEPGRAM_KEY_URL,
  DEEPGRAM_MODELS,
  FALLBACK_MODELS,
  LOCAL_PROVIDER_IDS,
  CLOUD_PROVIDER_IDS,
  localRuntimeOf,
  providerFromSettings,
  PROVIDER_PRESETS,
  qualityOf,
  recommendedModel,
  TRANSCRIBE_PROVIDERS,
  whisperModelLabel,
  whisperQuality,
  WHISPER_CATALOG_URL,
} from "../lib/modelCatalog";
import type { LocalAnalysis, McpProject, ModelInfo, Settings, SummaryDetail } from "../types";

interface DownloadProgress {
  received: number;
  total: number;
  done: boolean;
  error: string;
}

type TabId = "transcricao" | "analise" | "projetos" | "autor" | "cofre" | "dados";

type FetchStatus = "idle" | "loading" | "ready" | "error" | "needs-key";

const MODEL_PREVIEW = 6;

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "transcricao", label: "Transcrição", icon: <WaveIcon size={12} /> },
  { id: "analise", label: "Análise", icon: <SparkIcon size={12} /> },
  { id: "projetos", label: "Projetos", icon: <AllNotebooksIcon size={12} /> },
  { id: "autor", label: "Autor", icon: <UserIcon size={12} /> },
  { id: "cofre", label: "Cofre", icon: <KeyIcon size={12} /> },
  { id: "dados", label: "Lixeira", icon: <TrashIcon size={12} /> },
];

const SUMMARY_DETAIL_OPTIONS: { value: SummaryDetail; label: string }[] = [
  { value: "concise", label: "Enxuto" },
  { value: "full", label: "Completo" },
];

const IDLE_HOURS = [6, 12, 24, 48];

export function SettingsView({
  refreshKey = 0,
  onBack,
  onOpenLab,
  onOpenProject,
}: {
  refreshKey?: number;
  onBack?: () => void;
  /** Abre a tela de processamento local (fila, modelos e perfil do worker). */
  onOpenLab?: () => void;
  /** Abre o projeto do MCP no caderno Projetos. */
  onOpenProject?: (notebookId: string, entryId: string) => void;
}) {
  const { notify } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ownerName, setOwnerName] = useState("");

  useEffect(() => {
    void ensureVaultCode()
      .then(setVaultCode)
      .catch(() => undefined);
    // A pasta escolhida antes volta se o navegador ainda der permissao.
    void rememberFolder()
      .then(setFolder)
      .catch(() => undefined);
  }, []);

  // A sessao do Drive vive fora do React: ouvir mantem botao e marcas em dia
  // quando conecta, vence ou desconecta.
  useEffect(() => onDriveSessionChange(() => setDriveState(driveSessionState())), []);

  useEffect(() => {
    void readTelemetryEnabled().then(setDiagnosticsOn);
  }, []);

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const [ceiling, setCeiling] = useState("0");
  const [apiKey, setApiKey] = useState("");
  const [keyEditing, setKeyEditing] = useState(false);
  const [deepgramKey, setDeepgramKey] = useState("");
  const [themes, setThemes] = useState<string[]>([]);
  const [themeDraft, setThemeDraft] = useState("");
  const [provider, setProvider] = useState("custom");
  const [providerModels, setProviderModels] = useState<string[]>([]);
  const [modelsNote, setModelsNote] = useState("");
  const [local, setLocal] = useState<LocalAnalysis | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<McpProject[] | null>(null);
  const [projectsError, setProjectsError] = useState("");
  const [mcpNotebook, setMcpNotebook] = useState("");
  const [copied, setCopied] = useState<"command" | "file" | "token" | "endpoint" | "code" | null>(null);
  const [mcpSnippet, setMcpSnippet] = useState<"command" | "file">("command");
  const [projectErrors, setProjectErrors] = useState<Record<string, string>>({});
  const [showArchived, setShowArchived] = useState(false);

  // UI state
  const [activeTab, setActiveTab] = useState<TabId>("analise");
  const [modelFilter, setModelFilter] = useState("");
  /** Codigo de recuperacao do cofre local (a chave e derivada dele). */
  const [vaultCode, setVaultCode] = useState("");
  const [driveState, setDriveState] = useState<DriveSessionState>(() => driveSessionState());
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupStatus, setBackupStatus] = useState("");
  const [folder, setFolder] = useState<FolderLike | null>(null);
  const backupFileRef = useRef<HTMLInputElement | null>(null);
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("idle");
  const [fetchError, setFetchError] = useState("");
  const [deepgramBusy, setDeepgramBusy] = useState(false);
  const [showAllModels, setShowAllModels] = useState(false);
  const [savedOn, setSavedOn] = useState(false);
  const [diagnosticsOn, setDiagnosticsOn] = useState(true);
  const savedTimer = useRef<number | undefined>(undefined);

  // Id da requisicao em andamento, para descartar respostas obsoletas.
  const fetchReqId = useRef(0);

  const localRuntime = localRuntimeOf(provider);
  const preset = PROVIDER_PRESETS[provider];
  const currentLocal = localRuntime && local?.runtime === localRuntime ? local : null;

  const flashSaved = useCallback(() => {
    setSavedOn(true);
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSavedOn(false), 1400);
  }, []);

  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  const whisperModels = useMemo(() => {
    const bySize = [...models].sort((a, b) => a.size_mb - b.size_mb);
    const seen = new Set<string>();
    return bySize.filter((m) => {
      if (seen.has(m.name)) return false;
      seen.add(m.name);
      return true;
    });
  }, [models]);

  const analysisModels = useMemo(() => {
    if (localRuntime) {
      const localModels = currentLocal?.models?.length ? currentLocal.models : currentLocal?.model ? [currentLocal.model] : [];
      return [...new Set([...localModels, settings?.analyze_model ?? ""])].filter((m) => m !== "");
    }
    if (providerModels.length > 0) return providerModels;
    const fallback = FALLBACK_MODELS[provider] ?? [];
    return [...new Set([...fallback, settings?.analyze_model ?? ""])].filter((m) => m !== "");
  }, [provider, providerModels, localRuntime, currentLocal, settings?.analyze_model]);

  const filteredModels = useMemo(() => {
    const needle = modelFilter.trim().toLowerCase();
    const list = needle === "" ? analysisModels : analysisModels.filter((m) => m.toLowerCase().includes(needle));
    if (showAllModels || list.length <= MODEL_PREVIEW) return list;
    const preview = list.slice(0, MODEL_PREVIEW);
    const selected = settings?.analyze_model ?? "";
    return selected && list.includes(selected) && !preview.includes(selected) ? [...preview, selected] : preview;
  }, [analysisModels, modelFilter, settings?.analyze_model, showAllModels]);

  const deepgramModels = useMemo(() => {
    const current = settings?.deepgram_model ?? "";
    return [...new Set([...DEEPGRAM_MODELS, current])].filter((model) => model !== "");
  }, [settings?.deepgram_model]);

  const modelCountNote = (() => {
    if (fetchStatus === "loading") return "buscando";
    if (localRuntime) return `${analysisModels.length} locais`;
    if (fetchStatus === "ready") return `${analysisModels.length} do provedor`;
    return `${analysisModels.length} no catálogo`;
  })();

  const loadSettings = useCallback(async () => {
    const value = await api.getSettings();
    setSettings(value);
    setCeiling(String(value.max_whisper_rss_mb));
    setThemes(
      (value.analysis_themes ?? "")
        .split(",")
        .map((theme) => theme.trim())
        .filter((theme) => theme !== ""),
    );
    setProvider(providerFromSettings(value.analyze_provider, value.analyze_base_url, value.analyze_local_runtime ?? ""));
  }, []);

  const loadModels = useCallback(async () => {
    const result = await api.listModels();
    setModels(result.models ?? []);
  }, []);

  const loadLocal = useCallback(async (runtime: "ollama" | "embedded") => {
    try {
      setLocal(await api.getLocalAnalysis(runtime));
    } catch {
      setLocal(null);
    }
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const [result, notebooks] = await Promise.all([api.mcpProjects(), api.listNotebooks(false)]);
      setProjectsError("");
      setProjects(result.projects ?? []);
      const mcp = (notebooks.notebooks ?? []).find((notebook) => notebook.kind === "mcp");
      setMcpNotebook(mcp?.id ?? "");
    } catch {
      setProjects([]);
      setProjectsError("Falha ao carregar os projetos.");
    }
  }, []);

  useEffect(() => {
    loadSettings().catch((err: unknown) => setError(err instanceof Error ? err.message : "falha ao carregar"));
    loadModels().catch((err: unknown) => setError(err instanceof Error ? err.message : "falha ao carregar"));
    void loadLocal("ollama");
    void loadProjects();
  }, [loadSettings, loadModels, loadLocal, loadProjects, refreshKey]);

  useEffect(() => {
    if (localRuntime) {
      void loadLocal(localRuntime);
    }
  }, [localRuntime, loadLocal]);

  useEffect(() => {
    const token = getToken();
    if (!token || typeof EventSource === "undefined") {
      return;
    }
    const source = new EventSource(`/api/v1/events?token=${encodeURIComponent(token)}`);
    const listener = (event: MessageEvent) => {
      const data = JSON.parse(event.data) as {
        name: string;
        received: number;
        total: number;
        done: boolean;
        error: string;
      };
      setProgress((current) => ({
        ...current,
        [data.name]: { received: data.received, total: data.total, done: data.done, error: data.error },
      }));
      if (data.done && !data.error) {
        void loadModels();
      }
    };
    source.addEventListener("model.download", listener as EventListener);
    return () => source.close();
  }, [loadModels]);

  useEffect(() => {
    if (settings) setOwnerName(settings.owner_name ?? "");
  }, [settings]);

  const save = async (patch: Record<string, unknown>, message = "Configuração salva"): Promise<boolean> => {
    try {
      await api.putSettings(patch);
      await loadSettings();
      setError("");
      flashSaved();
      if (message !== "") notify(message, "success");
      return true;
    } catch (err) {
      notify(err instanceof Error ? err.message : "falha ao salvar", "error");
      return false;
    }
  };

  /** Troca o detalhe do resumo MCP de um projeto, otimista e com volta em erro. */
  const setProjectDetail = async (project: McpProject, value: SummaryDetail) => {
    const previous = project.summary_detail ?? "concise";
    if (previous === value) return;
    setProjectErrors((current) => {
      const next = { ...current };
      delete next[project.id];
      return next;
    });
    setProjects((current) => current?.map((p) => (p.id === project.id ? { ...p, summary_detail: value } : p)) ?? current);
    try {
      await api.patchEntry(project.id, { summary_detail: value });
      flashSaved();
    } catch {
      setProjects((current) => current?.map((p) => (p.id === project.id ? { ...p, summary_detail: previous } : p)) ?? current);
      setProjectErrors((current) => ({ ...current, [project.id]: "Falha ao salvar." }));
    }
  };

  const setProjectArchived = async (project: McpProject, archived: boolean) => {
    setProjects((current) => current?.map((p) => (p.id === project.id ? { ...p, archived } : p)) ?? current);
    try {
      await api.patchEntry(project.id, { archived });
      flashSaved();
    } catch {
      setProjects((current) => current?.map((p) => (p.id === project.id ? { ...p, archived: !archived } : p)) ?? current);
      setProjectErrors((current) => ({ ...current, [project.id]: "Falha ao salvar." }));
    }
  };

  /** Busca a lista de modelos do provedor, salvando primeiro quando e preciso. */
  const fetchAnalyzeModels = useCallback(async () => {
    const reqId = ++fetchReqId.current;
    setFetchStatus("loading");
    setFetchError("");
    try {
      const result = await api.listAnalyzeModels();
      if (reqId !== fetchReqId.current) return;
      const list = result.models ?? [];
      setProviderModels(list);
      setFetchStatus(list.length > 0 ? "ready" : "error");
      setModelsNote(list.length > 0 ? "" : "Nenhum modelo retornado.");
    } catch (err) {
      if (reqId !== fetchReqId.current) return;
      setProviderModels([]);
      setFetchStatus("error");
      setFetchError(err instanceof Error ? err.message : "falha ao buscar modelos");
      setModelsNote("");
    }
  }, []);

  const selectProvider = async (id: string) => {
    setProvider(id);
    setProviderModels([]);
    setApiKey("");
    setShowAllModels(false);
    setModelFilter("");
    setFetchStatus("idle");
    setFetchError("");
    setModelsNote("");
    const p = PROVIDER_PRESETS[id];
    if (!p) return;

    if (id === "llamaLocal" || id === "ollama") {
      void installLocal(id === "llamaLocal" ? "embedded" : "ollama");
      return;
    }

    const ok = await save(
      {
        analyze_provider: p.kind,
        analyze_base_url: p.baseUrl,
        analyze_model: p.model,
        analyze_local_runtime: "",
        analyze_enabled: true,
      },
      "Provedor atualizado",
    );
    if (!ok) {
      await loadSettings();
      return;
    }

    if (p.keyRequired && !(settings?.analyze_api_key_set ?? false)) {
      setFetchStatus("needs-key");
      return;
    }
    if (canSearchModels(id)) {
      void fetchAnalyzeModels();
    } else {
      setFetchStatus("ready");
    }
  };

  /** Salva a chave e, quando o provedor permite, ja testa a busca de modelos. */
  const saveAnalyzeKey = async () => {
    const key = apiKey.trim();
    if (key === "") return;
    const saved = await save({ analyze_api_key: key }, "Chave salva");
    if (!saved) return;
    setApiKey("");
    setKeyEditing(false);
    if (preset?.searchable) {
      setFetchStatus("idle");
      await fetchAnalyzeModels();
    }
  };

  const pulling = Boolean(currentLocal?.pull && !currentLocal.pull.done && !currentLocal.pull.error);
  useEffect(() => {
    if (!pulling || !localRuntime) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadLocal(localRuntime);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [pulling, loadLocal, localRuntime]);

  const pullDone = Boolean(currentLocal?.pull?.done && !currentLocal.pull?.error);
  useEffect(() => {
    if (pullDone && localRuntime) {
      void Promise.all([loadSettings(), loadLocal(localRuntime)]);
    }
  }, [pullDone, loadSettings, loadLocal, localRuntime]);

  const installLocal = async (runtime: "ollama" | "embedded", model?: string) => {
    const p = runtime === "embedded" ? PROVIDER_PRESETS.llamaLocal : PROVIDER_PRESETS.ollama;
    const saved = localRuntime === runtime ? settings?.analyze_model?.trim() : "";
    const current = local?.runtime === runtime ? local : null;
    const target = model || saved || current?.model || p.model;
    setLocalBusy(true);
    try {
      const result = await api.setupLocalAnalysis(runtime, target);
      setProvider(runtime === "embedded" ? "llamaLocal" : "ollama");
      await Promise.all([loadSettings(), loadLocal(runtime)]);
      notify(
        result.status === "ready"
          ? runtime === "embedded"
            ? "llama.cpp configurado"
            : "Ollama configurado"
          : `Baixando ${result.model} em segundo plano`,
        result.status === "ready" ? "success" : "info",
      );
    } catch (err) {
      await loadSettings();
      notify(err instanceof Error ? err.message : "não foi possível configurar a análise local", "error");
    } finally {
      setLocalBusy(false);
    }
  };

  const download = async (name: string) => {
    try {
      await api.downloadModel(name);
      setProgress((current) => ({
        ...current,
        [name]: { received: 0, total: 0, done: false, error: "" },
      }));
      notify(`Download de ${name} iniciado`, "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : "falha ao iniciar o download", "error");
    }
  };

  const localHint = (() => {
    if (!currentLocal) {
      return provider === "llamaLocal" ? "Verificando o llama.cpp..." : "Verificando o Ollama local...";
    }
    if (provider === "llamaLocal") {
      if (!currentLocal.available) return "llama.cpp indisponível nesta imagem.";
      if (!currentLocal.downloaded) return currentLocal.size_mb ? `Modelo ausente (~${currentLocal.size_mb} MB).` : "Modelo ausente.";
      return currentLocal.running ? "llama.cpp pronto e rodando." : "llama.cpp pronto; carrega na primeira análise.";
    }
    if (currentLocal.available) return `Ollama no ar · ${currentLocal.models.length} modelo(s)`;
    return `Ollama fora do ar em ${currentLocal.base_url}`;
  })();

  // ---------- derivados de estado ----------
  const transcribeProvider = settings?.transcribe_provider ?? "whisper";
  const tpPreset = TRANSCRIBE_PROVIDERS[transcribeProvider as keyof typeof TRANSCRIBE_PROVIDERS];
  const analyzeProviderId = providerFromSettings(
    settings?.analyze_provider ?? "openai",
    settings?.analyze_base_url ?? "",
    settings?.analyze_local_runtime ?? "",
  );
  const analyzePreset = PROVIDER_PRESETS[analyzeProviderId];
  const analyzeLabel = analyzePreset ? analyzePreset.short : (settings?.analyze_provider ?? "");
  const visibleProjects = (projects ?? []).filter((project) => showArchived || !project.archived);
  const archivedCount = (projects ?? []).filter((project) => project.archived).length;
  const openSessions = (projects ?? []).filter((project) => project.state === "open").length;

  const mcpEndpoint = `${window.location.origin}/mcp`;
  const mcpCommand = (token: string) =>
    `opencode mcp add dyarium --global --url "${mcpEndpoint}" --header "Authorization=Bearer ${token}" --header "X-Dyarium-Host=$(hostname -s)"`;
  const mcpFile = (token: string) => `{
  "mcp": {
    "servers": {
      "dyarium": {
        "type": "remote",
        "url": "${mcpEndpoint}",
        "oauth": false,
        "headers": {
          "Authorization": "Bearer ${token}",
          "X-Dyarium-Host": "nome-da-maquina"
        }
      }
    }
  }
}`;

  const copy = async (kind: "command" | "file" | "token" | "endpoint", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      notify("Não foi possível copiar", "error");
    }
  };

  const providerOptions = useMemo(() => {
    if (!settings) return [];
    return [...LOCAL_PROVIDER_IDS, ...CLOUD_PROVIDER_IDS].map((id) => {
      const p = PROVIDER_PRESETS[id];
      const local = Boolean(p.localRuntime);
      const service = id === "opencodeLocal";
      const missing = Boolean(p.keyRequired) && !settings.analyze_api_key_set;
      const meta = local ? "local" : service ? "serviço" : p.keyRequired ? (missing ? "sem chave" : "chave ok") : "URL";
      return { value: id, label: p.short, meta, missing };
    });
  }, [settings]);

  // ---------- conteudo ----------
  const renderTranscription = (s: Settings) => (
    <>
      <div className="cfg-block">
        <div className="cfg-field">
          <span className="cfg-name">Provedor</span>
          <ProviderSelect
            label={tpPreset?.short ?? transcribeProvider}
            meta={
              transcribeProvider === "deepgram"
                ? s.deepgram_api_key_set
                  ? "nuvem · chave ok"
                  : "nuvem · chave ausente"
                : "local · 5 modelos"
            }
            value={transcribeProvider}
            options={[
              { value: "whisper", label: TRANSCRIBE_PROVIDERS.whisper.short, meta: "local" },
              {
                value: "deepgram",
                label: TRANSCRIBE_PROVIDERS.deepgram.short,
                meta: s.deepgram_api_key_set ? "chave ok" : "sem chave",
                missing: !s.deepgram_api_key_set,
              },
            ]}
            onChange={(value) => void save({ transcribe_provider: value }, "Provedor atualizado")}
          />
        </div>
      </div>

      {s.transcribe_provider === "whisper" ? (
        <>
          <div className="cfg-block">
            <p className="cfg-label">
              Modelo
              <span className="n">
                {whisperModels.filter((m) => m.downloaded).length} de {whisperModels.length} baixados
              </span>
              <a className="cfg-link" style={{ marginLeft: 8 }} href={WHISPER_CATALOG_URL} target="_blank" rel="noreferrer">
                catálogo
              </a>
              <button
                type="button"
                className="cfg-link"
                style={{ marginLeft: 8 }}
                onClick={() => void loadModels()}
                aria-label="Atualizar lista de modelos"
              >
                atualizar
              </button>
            </p>
            <div className="cfg-table" role="radiogroup" aria-label="Modelo de transcrição">
              <div className="cfg-row-head" aria-hidden="true">
                <span />
                <span>Tamanho</span>
                <span>Qualidade</span>
              </div>
              {whisperModels.map((model) => {
                const p = progress[model.name];
                const percent = p && p.total > 0 ? Math.min(100, Math.round((p.received / p.total) * 100)) : 0;
                const quality = whisperQuality(whisperModelLabel(model.name));
                const selected = s.whisper_model === model.path;
                return (
                  <div key={model.name} className="cfg-model-row" data-on={selected ? "1" : undefined}>
                    <span className="cfg-pick">
                      <input
                        type="radio"
                        name="whisper-model"
                        value={model.path}
                        checked={selected}
                        disabled={!model.downloaded}
                        onChange={() => void save({ whisper_model: model.path }, "Modelo ativo atualizado")}
                        aria-label={whisperModelLabel(model.name)}
                      />
                      <b>{whisperModelLabel(model.name)}</b>
                      {selected && <span className="cfg-pick-tag">escolhido</span>}
                    </span>
                    <span className="cfg-row-num">
                      {model.size_mb} MB{model.downloaded ? "" : " · ausente"}
                    </span>
                    <span className="cfg-row-q">
                      <Meter level={quality.score} />
                      {quality.label.toLowerCase()}
                    </span>
                    {!model.downloaded && (
                      <span className="cfg-download">
                        <button
                          type="button"
                          className="cfg-btn cfg-btn--quiet"
                          onClick={() => void download(model.name)}
                          disabled={Boolean(p && !p.done)}
                        >
                          {p && !p.done ? "baixando" : "baixar"}
                        </button>
                        {p && !p.done && (
                          <span className="cfg-meter" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                            <i className="f" style={{ width: `${percent}%` }} />
                          </span>
                        )}
                        {p && p.error && <span className="cfg-state" data-state="bad">{p.error}</span>}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="cfg-block">
            <div className="cfg-field">
              <span className="cfg-name">Idioma</span>
              <select
                aria-label="Idioma da transcrição"
                value={s.whisper_language}
                onChange={(event) => void save({ whisper_language: event.target.value }, "")}
              >
                <option value="">Detectar automaticamente</option>
                <option value="pt">Português</option>
                <option value="en">Inglês</option>
                <option value="es">Espanhol</option>
                <option value="fr">Francês</option>
                <option value="de">Alemão</option>
                <option value="it">Italiano</option>
                <option value="ja">Japonês</option>
                <option value="zh">Chinês</option>
                <option value="ru">Russo</option>
                <option value="ar">Árabe</option>
                <option value="hi">Hindi</option>
              </select>
            </div>
            <div className="cfg-field">
              <span className="cfg-name">Limite de RAM</span>
              <input
                type="number"
                min={0}
                aria-label="Limite de RAM da transcrição em MB"
                value={ceiling}
                onChange={(event) => setCeiling(event.target.value)}
                onBlur={() => {
                  const next = Math.max(0, Math.floor(Number(ceiling) || 0));
                  if (next !== s.max_whisper_rss_mb) void save({ max_whisper_rss_mb: next }, "");
                }}
              />
              <span className="cfg-meta">MB</span>
              <span className="cfg-state">0 = sem limite</span>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="cfg-block">
            <div className="cfg-field">
              <span className="cfg-name">Modelo</span>
              <select
                aria-label="Modelo Deepgram"
                value={s.deepgram_model}
                onChange={(event) => void save({ deepgram_model: event.target.value }, "")}
              >
                {deepgramModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="cfg-block">
            <p className="cfg-label">
              Chave
              <span className="n" data-state={s.deepgram_api_key_set ? "on" : "warn"}>
                {s.deepgram_api_key_set ? "definida" : "ausente"}
              </span>
            </p>
            <div className="cfg-field">
              <input
                className="cfg-grow"
                type="password"
                aria-label="Chave da Deepgram"
                placeholder={s.deepgram_api_key_set ? "definida (deixe vazio para manter)" : "cole a chave da Deepgram"}
                value={deepgramKey}
                onChange={(event) => setDeepgramKey(event.target.value)}
                disabled={deepgramBusy}
              />
              <button
                type="button"
                className="cfg-btn cfg-btn--solid"
                onClick={() => {
                  const key = deepgramKey.trim();
                  if (key === "") return;
                  setDeepgramBusy(true);
                  void save({ deepgram_api_key: key }, "Chave da Deepgram salva").then((ok) => {
                    if (ok) setDeepgramKey("");
                    setDeepgramBusy(false);
                  });
                }}
                disabled={deepgramBusy || deepgramKey.trim() === ""}
              >
                {deepgramBusy ? "salvando" : "Salvar"}
              </button>
              <a className="cfg-link" href={DEEPGRAM_KEY_URL} target="_blank" rel="noreferrer">
                criar chave
              </a>
            </div>
          </div>
        </>
      )}

      <div className="cfg-block">
        <div className="cfg-field">
          <span className="cfg-name">Cortar silêncio</span>
          <Switch
            checked={s.trim_silence}
            ariaLabel="Corte de silêncio"
            onChange={(value) => void save({ trim_silence: value }, "")}
          />
          <Why>Remove trechos sem fala antes de enviar para o provedor. O áudio original não muda.</Why>
        </div>
      </div>

      {onOpenLab && (
        <div className="cfg-block">
          <button type="button" className="cfg-link" onClick={onOpenLab}>
            <CpuIcon size={12} /> Processamento neste computador
          </button>
        </div>
      )}
    </>
  );

  const renderAnalysis = (s: Settings) => {
    const recommended = recommendedModel(provider);
    return (
      <>
        <div className="cfg-block">
          <div className="cfg-field">
            <Switch
              checked={s.analyze_enabled}
              ariaLabel="Análise por IA"
              onChange={(value) => void save({ analyze_enabled: value }, "")}
            />
            <span className="cfg-state">Análise por IA</span>
            <Why>Desligada, a nota guarda só a transcrição. O provedor e o modelo ficam como estão.</Why>
          </div>
        </div>

        <div className="cfg-block">
          <div className="cfg-field">
            <span className="cfg-name">Provedor</span>
            <ProviderSelect
              label={analyzeLabel}
              value={analyzeProviderId}
              options={providerOptions}
              meta={
                localRuntime
                  ? "local"
                  : preset?.keyRequired
                    ? s.analyze_api_key_set
                      ? "chave ok"
                      : "sem chave"
                    : analyzeProviderId === "opencodeLocal"
                      ? "serviço"
                      : "URL"
              }
              onChange={(value) => void selectProvider(value)}
            />
          </div>
          {localRuntime && (
            <div className="cfg-field" style={{ marginTop: 6 }}>
              <span className="cfg-name" />
              <span className="cfg-state">{localHint}</span>
              <span className="cfg-grow" />
              <button
                type="button"
                className="cfg-btn cfg-btn--quiet"
                onClick={() => void installLocal(localRuntime)}
                disabled={localBusy}
              >
                {localBusy ? "configurando" : "usar análise local"}
              </button>
              {currentLocal?.pull && !currentLocal.pull.done && !currentLocal.pull.error && (
                <span className="cfg-meter" role="progressbar" aria-valuenow={currentLocal.pull.percent} aria-valuemin={0} aria-valuemax={100}>
                  <i className="f" style={{ width: `${currentLocal.pull.percent}%` }} />
                </span>
              )}
              {currentLocal?.pull?.error && <span className="cfg-state" data-state="bad">{currentLocal.pull.error}</span>}
            </div>
          )}
        </div>

        <div className="cfg-block">
          <p className="cfg-label">
            Modelo
            <span className="n">{modelCountNote}</span>
            {preset?.searchable && (
              <button
                type="button"
                className="cfg-link"
                style={{ marginLeft: 8 }}
                onClick={() => void fetchAnalyzeModels()}
                disabled={fetchStatus === "loading" || (Boolean(preset?.keyRequired) && !s.analyze_api_key_set)}
              >
                atualizar
              </button>
            )}
          </p>
          <div className="cfg-field" style={{ marginBottom: 8 }}>
            <input
              className="cfg-grow"
              type="text"
              placeholder="filtrar por nome"
              aria-label="Filtrar modelos"
              value={modelFilter}
              onChange={(event) => setModelFilter(event.target.value)}
            />
          </div>
          {fetchStatus === "error" && (
            <p className="cfg-field">
              <span className="cfg-state" data-state="bad">{fetchError}</span>
              <span className="cfg-grow" />
              <button type="button" className="cfg-btn cfg-btn--quiet" onClick={() => void fetchAnalyzeModels()}>
                tentar de novo
              </button>
            </p>
          )}
          <div className="cfg-table" role="radiogroup" aria-label="Modelo de análise">
            <div className="cfg-row-head" aria-hidden="true">
              <span />
              <span>Custo</span>
              <span>Qualidade</span>
            </div>
            {fetchStatus === "loading" ? (
              <ListSkeleton rows={2} />
            ) : (
              filteredModels.map((model) => {
                const q = qualityOf(provider, model);
                const selected = s.analyze_model === model;
                return (
                  <div key={model} className="cfg-model-row" data-on={selected ? "1" : undefined}>
                    <span className="cfg-pick">
                      <input
                        type="radio"
                        name="analysis-model"
                        value={model}
                        checked={selected}
                        onChange={() => void save({ analyze_model: model }, "Modelo atualizado")}
                        aria-label={model}
                      />
                      <b>{model}</b>
                      {selected && <span className="cfg-pick-tag">escolhido</span>}
                      {model === recommended && !selected && <span className="cfg-state">· recomendado</span>}
                    </span>
                    <span className="cfg-row-num">{q.cost === "local" ? "local" : q.cost}</span>
                    <span className="cfg-row-q">
                      <Meter level={q.score} />
                      {q.label.toLowerCase()}
                    </span>
                  </div>
                );
              })
            )}
            {filteredModels.length === 0 && fetchStatus !== "loading" && (
              <p className="cfg-state" style={{ padding: "8px 0" }}>
                Nenhum modelo com esse nome.
              </p>
            )}
          </div>
          {modelsNote && <p className="cfg-state">{modelsNote}</p>}
          {analysisModels.length > MODEL_PREVIEW && modelFilter.trim() === "" && (
            <div className="cfg-field" style={{ marginTop: 8 }}>
              <button type="button" className="cfg-link" onClick={() => setShowAllModels((value) => !value)}>
                {showAllModels ? "mostrar menos" : `mostrar os ${analysisModels.length}`}
              </button>
            </div>
          )}
        </div>

        {!localRuntime && (
          <div className="cfg-block">
            <p className="cfg-label">
              Chave
              <span className="n" data-state={s.analyze_api_key_set ? "on" : "warn"}>
                {s.analyze_api_key_set ? "definida" : "ausente"}
              </span>
            </p>
            {(s.analyze_api_key_set && !keyEditing) ? (
              <div className="cfg-field">
                <span className="cfg-grow cfg-meta">••••••••••••</span>
                <button type="button" className="cfg-btn cfg-btn--quiet" onClick={() => setKeyEditing(true)}>
                  trocar
                </button>
                <button type="button" className="cfg-btn cfg-btn--quiet" onClick={() => void save({ analyze_api_key: "" }, "Chave removida").then(() => setKeyEditing(false))}>
                  remover
                </button>
              </div>
            ) : (
              <div className="cfg-field">
                <input
                  className="cfg-grow"
                  type="password"
                  aria-label="Chave da API de análise"
                  placeholder={
                    provider === "opencodeLocal" ? "senha de ~/.config/opencode/service.json" : (preset?.keyPlaceholder ?? "cole a chave do provedor")
                  }
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
                <button
                  type="button"
                  className="cfg-btn cfg-btn--solid"
                  onClick={() => void saveAnalyzeKey()}
                  disabled={apiKey.trim() === ""}
                >
                  {preset?.searchable ? "Salvar e testar" : "Salvar"}
                </button>
              </div>
            )}
            {preset?.links?.length ? (
              <div className="cfg-field" style={{ marginTop: 4 }}>
                {preset.links.map((link) => (
                  <a key={link.href} className="cfg-link" href={link.href} target="_blank" rel="noreferrer">
                    {link.label}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        )}

        <div className="cfg-block">
          <div className="cfg-field">
            <span className="cfg-name">Concorrência</span>
            <input
              type="number"
              min={0}
              max={16}
              value={s.analyze_concurrency ?? 0}
              aria-label="Concorrência da análise"
              onChange={(event) => {
                const next = Math.max(0, Math.min(16, Math.floor(Number(event.target.value) || 0)));
                void save({ analyze_concurrency: next }, "");
              }}
            />
            <span className="cfg-state">{(s.analyze_concurrency ?? 0) === 0 ? "automático" : "notas ao mesmo tempo"}</span>
            <Why>Quantas notas a análise processa ao mesmo tempo. 0 deixa o servidor decidir pela memória livre.</Why>
          </div>
        </div>

        <div className="cfg-block">
          <div className="cfg-field">
            <Switch
              checked={s.review_enabled}
              ariaLabel="Revisar a transcrição com IA"
              onChange={(value) => void save({ review_enabled: value }, "")}
            />
            <span className="cfg-state">Revisar transcrição</span>
            <Why>Corrige concordância, pontuação e siglas antes de analisar. Vale só para este dashboard; o app tem a sua escolha.</Why>
          </div>
          {s.review_enabled && (
            <div className="cfg-field">
              <Switch
                checked={s.literal_transcript}
                ariaLabel="Transcrição literal"
                onChange={(value) => void save({ literal_transcript: value }, "")}
              />
              <span className="cfg-state">Transcrição literal</span>
              <Why>Mantém hesitações e repetições. Desligada, a revisão remove só o que não tem significado; gírias ficam.</Why>
            </div>
          )}
        </div>

        <div className="cfg-block">
          <p className="cfg-label">Avançado</p>
          <div className="cfg-field">
            <span className="cfg-name">Base URL</span>
            <input
              key={s.analyze_base_url}
              className="cfg-grow"
              type="text"
              aria-label="Base URL da análise"
              defaultValue={s.analyze_base_url}
              onBlur={(event) => {
                if (event.target.value !== s.analyze_base_url) void save({ analyze_base_url: event.target.value }, "");
              }}
            />
          </div>
          <div className="cfg-field" style={{ alignItems: "flex-start" }}>
            <span className="cfg-name">Temas</span>
            <div className="cfg-chips cfg-grow">
              {themes.map((theme) => (
                <span key={theme} className="cfg-chip">
                  {theme}
                  <button
                    type="button"
                    aria-label={`Remover ${theme}`}
                    onClick={() => {
                      const next = themes.filter((value) => value !== theme);
                      setThemes(next);
                      void save({ analysis_themes: next.join(", ") }, "");
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                type="text"
                placeholder="novo tema"
                aria-label="Novo tema"
                style={{ width: 104 }}
                value={themeDraft}
                onChange={(event) => setThemeDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  const value = themeDraft.trim();
                  if (value === "" || themes.includes(value)) return;
                  const next = [...themes, value];
                  setThemes(next);
                  setThemeDraft("");
                  void save({ analysis_themes: next.join(", ") }, "");
                }}
              />
            </div>
          </div>
        </div>
      </>
    );
  };

  const renderProjects = () => (
    <>
      <div className="cfg-block">
        <p className="cfg-label">
          Conexão
          <span className="n" data-state={settings?.mcp_paused ? "warn" : "on"}>
            {settings?.mcp_paused ? "pausada" : "ativa"}
          </span>
        </p>
        <div className="cfg-field">
          <span className="cfg-name">Endpoint</span>
          <code className="cfg-grow cfg-meta">{mcpEndpoint}</code>
          <button type="button" className="cfg-btn" onClick={() => void copy("endpoint", mcpEndpoint)}>
            {copied === "endpoint" ? "copiado" : "copiar"}
          </button>
        </div>
        <div className="cfg-field">
          <span className="cfg-name">Token</span>
          <span className="cfg-grow cfg-meta">••••••••••••</span>
          <button
            type="button"
            className="cfg-btn"
            title="Copia o token real"
            onClick={() => void copy("token", getToken())}
          >
            {copied === "token" ? "copiado" : "copiar"}
          </button>
          <Why>O botão copia o token real desta sessão; o trecho abaixo mostra SEU_TOKEN só como exemplo.</Why>
        </div>
        <div className="cfg-field">
          <span className="cfg-name">Máquina</span>
          <input
            className="cfg-grow"
            type="text"
            maxLength={80}
            aria-label="Apelido da máquina"
            value={settings?.mcp_machine_alias ?? ""}
            placeholder="nome da máquina"
            onChange={(event) => {
              const value = event.target.value;
              setSettings((current) => (current ? { ...current, mcp_machine_alias: value } : current));
            }}
            onBlur={() => {
              const next = (settings?.mcp_machine_alias ?? "").trim();
              void save({ mcp_machine_alias: next }, "");
            }}
          />
          <span className="cfg-meta">X-Dyarium-Host</span>
        </div>
      </div>

      <div className="cfg-block">
        <div className="cfg-snippet-head">
          <div className="cfg-seg" role="group" aria-label="Formato da conexão">
            <button type="button" aria-pressed={mcpSnippet === "command"} onClick={() => setMcpSnippet("command")}>
              Comando
            </button>
            <button type="button" aria-pressed={mcpSnippet === "file"} onClick={() => setMcpSnippet("file")}>
              Arquivo
            </button>
          </div>
          <button
            type="button"
            className="cfg-btn"
            onClick={() => void copy(mcpSnippet, mcpSnippet === "command" ? mcpCommand(getToken() || "SEU_TOKEN") : mcpFile(getToken() || "SEU_TOKEN"))}
          >
            {copied === mcpSnippet ? "copiado" : "copiar"}
          </button>
        </div>
        <pre>{mcpSnippet === "command" ? mcpCommand("SEU_TOKEN") : mcpFile("SEU_TOKEN")}</pre>
      </div>

      <div className="cfg-block">
        <div className="cfg-field">
          <span className="cfg-name">Pausar MCP</span>
          <Switch
            checked={settings?.mcp_paused ?? false}
            ariaLabel="Pausar MCP"
            onChange={(value) => void save({ mcp_paused: value }, value ? "MCP pausado" : "MCP ativo")}
          />
          <span className="cfg-state">{settings?.mcp_paused ? "recusando chamadas" : "aceitando chamadas"}</span>
          <Why>Pausado, o endpoint recusa novas chamadas sem apagar nada.</Why>
        </div>
      </div>

      <div className="cfg-block">
        <p className="cfg-label">
          Projetos
          <span className="n">
            {(projects ?? []).length} · {archivedCount} arquivado{archivedCount === 1 ? "" : "s"}
          </span>
          {archivedCount > 0 && (
            <button type="button" className="cfg-link" style={{ marginLeft: 8 }} onClick={() => setShowArchived((value) => !value)}>
              {showArchived ? "ocultar arquivados" : "mostrar arquivados"}
            </button>
          )}
        </p>
        {projectsError && <p className="cfg-state" data-state="bad">{projectsError}</p>}
        {projects === null && <ListSkeleton rows={3} />}
        {projects !== null && visibleProjects.length === 0 && !projectsError && (
          <p className="cfg-state">Nenhum projeto ainda. Abra uma sessão com o MCP para criar o primeiro.</p>
        )}
        {visibleProjects.length > 0 && (
          <div className="cfg-table">
            <div className="cfg-projects-head" aria-hidden="true">
              <span />
              <span>Projeto</span>
              <span>Sessões</span>
              <span>Última</span>
              <span>Resumo</span>
              <span />
            </div>
            {visibleProjects.map((project) => (
              <div key={project.id} className="cfg-project">
                <span className="cfg-mark" data-state={projectState(project)} aria-label={stateLabel(project)} />
                <span className="cfg-project-cell">
                  <button
                    type="button"
                    title={project.title}
                    onClick={() => {
                      if (mcpNotebook && onOpenProject) onOpenProject(mcpNotebook, project.id);
                    }}
                  >
                    {project.title}
                  </button>
                  {project.path && project.path.toLowerCase() !== project.title.toLowerCase() && (
                    <span className="cfg-meta">{project.path}</span>
                  )}
                </span>
                <span className="cfg-stats">
                  <span className="cfg-row-num">
                    {project.sessions}
                    <span className="cfg-unit">{project.sessions === 1 ? " sessão" : " sessões"}</span>
                  </span>
                  <span className="cfg-row-num">{relativeTime(project.last_session_at)}</span>
                </span>
                <div className="cfg-seg cfg-seg--sm" role="group" aria-label={`Resumo de ${project.title}`}>
                  {SUMMARY_DETAIL_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={(project.summary_detail ?? "concise") === option.value}
                      onClick={() => void setProjectDetail(project, option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <details className="cfg-project-menu">
                  <summary aria-label={`Ações de ${project.title}`}>⋯</summary>
                  <div>
                    {onOpenProject && mcpNotebook && (
                      <button type="button" onClick={() => onOpenProject(mcpNotebook, project.id)}>
                        abrir no caderno
                      </button>
                    )}
                    <button type="button" onClick={() => void setProjectArchived(project, !project.archived)}>
                      {project.archived ? "desarquivar" : "arquivar"}
                    </button>
                  </div>
                </details>
                {projectErrors[project.id] && <span className="cfg-state cfg-row-error" data-state="bad">{projectErrors[project.id]}</span>}
              </div>
            ))}
          </div>
        )}
        <p className="cfg-meta" style={{ marginTop: 8 }}>
          {openSessions} aberta{openSessions === 1 ? "" : "s"} agora
        </p>
      </div>

      <div className="cfg-block">
        <p className="cfg-label">Regras da sessão</p>
        <div className="cfg-field">
          <span className="cfg-name">Interrompida após</span>
          <select
            aria-label="Janela de inatividade"
            value={settings?.mcp_idle_hours ?? 12}
            onChange={(event) => void save({ mcp_idle_hours: Number(event.target.value) }, "")}
          >
            {[...new Set([...IDLE_HOURS, settings?.mcp_idle_hours ?? 12])].sort((a, b) => a - b).map((hours) => (
              <option key={hours} value={hours}>
                {hours} h
              </option>
            ))}
          </select>
          <Why>Sessão aberta sem atividade por esse tempo passa a ler como interrompida. O estado é derivado na leitura.</Why>
        </div>
        <div className="cfg-field">
          <span className="cfg-name">Histórico</span>
          <input
            type="number"
            min={0}
            max={10}
            aria-label="Sessões no histórico"
            value={settings?.mcp_history_sessions ?? 3}
            onChange={(event) => {
              const next = Math.max(0, Math.min(10, Math.floor(Number(event.target.value) || 0)));
              void save({ mcp_history_sessions: next }, "");
            }}
          />
          <span className="cfg-state">sessões que o agente vê ao abrir</span>
        </div>
        <div className="cfg-field">
          <span className="cfg-name">Commits</span>
          <Switch
            checked={settings?.mcp_include_commits ?? true}
            ariaLabel="Incluir commits no resumo"
            onChange={(value) => void save({ mcp_include_commits: value }, "")}
          />
          <span className="cfg-state">entram no resumo</span>
        </div>
        <div className="cfg-field">
          <span className="cfg-name">Links</span>
          <Switch
            checked={settings?.mcp_include_links ?? true}
            ariaLabel="Incluir links no resumo"
            onChange={(value) => void save({ mcp_include_links: value }, "")}
          />
          <span className="cfg-state">entram no resumo</span>
        </div>
      </div>

      <div className="cfg-block">
        <p className="cfg-label">Privacidade</p>
        <div className="cfg-field">
          <span className="cfg-name">Caminho completo</span>
          <Switch
            checked={settings?.mcp_store_full_path ?? false}
            ariaLabel="Gravar caminho completo"
            onChange={(value) => void save({ mcp_store_full_path: value }, "")}
          />
          <span className="cfg-state">{(settings?.mcp_store_full_path ?? false) ? "caminho absoluto" : "só o nome da pasta"}</span>
          <Why>Desligado, o projeto guarda e mostra só o nome da pasta.</Why>
        </div>
      </div>
    </>
  );

  const renderAuthor = (s: Settings) => (
    <div className="cfg-block">
      <div className="cfg-field">
        <span className="cfg-name">Nome</span>
        <input
          className="cfg-grow"
          type="text"
          aria-label="Seu nome"
          value={ownerName}
          maxLength={80}
          placeholder="Você"
          onChange={(event) => setOwnerName(event.target.value)}
          onBlur={() => {
            const next = ownerName.trim();
            if (next !== (s.owner_name ?? "")) {
              void save({ owner_name: next }, "Nome salvo");
            }
          }}
        />
      </div>
      <div className="cfg-field">
        <Switch
          checked={s.all_notes_mine}
          ariaLabel="Todas as notas são minhas"
          onChange={(value) => void save({ all_notes_mine: value }, "")}
        />
        <span className="cfg-state">Minhas notas por padrão</span>
        <Why>Desligado, a nota sem escolha manual fica sem autor. O seletor da nota sempre vence.</Why>
      </div>
    </div>
  );

  const codigoDoCofre = async (): Promise<string> => {
    const codigo = vaultCode || (await ensureVaultCode());
    if (!codigo || codigo !== vaultCode) setVaultCode(codigo);
    return codigo;
  };

  const backupToFolder = async () => {
    setBackupBusy(true);
    setBackupStatus("");
    try {
      const codigo = await codigoDoCofre();
      const alvo = folder ?? (await pickFolder());
      setFolder(alvo);
      const chave = await vaultKeyFromCode(codigo);
      const vaultId = await vaultIdFromCode(codigo);
      // `backup.enc` fica v1 (o app tambem le); o estado completo vai ao lado.
      const notas = await buildNotesSnapshot(vaultId);
      const estado = await buildSnapshot(vaultId);
      await writeVaultToFolder(
        alvo,
        codigo,
        await sealSnapshot(notas, chave),
        await sealSnapshot(estado, chave),
      );
      setBackupStatus(`pasta "${alvo.name}" · ${notas.notes.length} notas`);
    } catch (error) {
      setBackupStatus(describe(error));
    } finally {
      setBackupBusy(false);
    }
  };

  const restoreFromFolder = async () => {
    setBackupBusy(true);
    setBackupStatus("");
    try {
      const alvo = folder ?? (await pickFolder());
      setFolder(alvo);
      const { code, sealed, state } = await readVaultFromFolder(alvo);
      // A pasta manda: a chave dela substitui a que este navegador criou.
      setVaultCode(await adoptVaultCode(code));
      const chave = await vaultKeyFromCode(code);
      // `state.enc` quando existe; pasta antiga cai no v1 sem erro.
      const retrato = await openSnapshot(state ?? sealed, chave);
      const resumo = await applySnapshot(retrato);
      setBackupStatus(`${resumo.created} novas · ${resumo.updated} atualizadas · ${resumo.skipped} mantidas`);
    } catch (error) {
      setBackupStatus(describe(error));
    } finally {
      setBackupBusy(false);
    }
  };

  /** Download do pacote: o caminho que funciona em Firefox e Safari. */
  const downloadBackup = async () => {
    setBackupBusy(true);
    setBackupStatus("");
    try {
      const codigo = await codigoDoCofre();
      const vaultId = await vaultIdFromCode(codigo);
      const chave = await vaultKeyFromCode(codigo);
      // Mesma divisao da pasta e do Drive: v1 no `backup.enc`, v2 no `state.enc`.
      const notas = await buildNotesSnapshot(vaultId);
      const estado = await buildSnapshot(vaultId);
      downloadBytes(
        `dyarium-${vaultId}.zip`,
        packVault(codigo, await sealSnapshot(notas, chave), await sealSnapshot(estado, chave)),
      );
      setBackupStatus(`${notas.notes.length} notas · arquivo baixado`);
    } catch (error) {
      setBackupStatus(describe(error));
    } finally {
      setBackupBusy(false);
    }
  };

  const restoreFromFile = async (file: File) => {
    setBackupBusy(true);
    setBackupStatus("");
    try {
      const { code, sealed, state } = await unpackVault(new Uint8Array(await file.arrayBuffer()));
      setVaultCode(await adoptVaultCode(code));
      const chave = await vaultKeyFromCode(code);
      // Zip novo traz `state.enc`; zip antigo so tem o v1 e abre igual.
      const retrato = await openSnapshot(state ?? sealed, chave);
      const resumo = await applySnapshot(retrato);
      setBackupStatus(`${resumo.created} novas · ${resumo.updated} atualizadas · ${resumo.skipped} mantidas`);
    } catch (error) {
      setBackupStatus(describe(error));
    } finally {
      setBackupBusy(false);
    }
  };

  const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

  const driveConfigurado = driveConfigured();
  const driveConectado = driveState === "connected";
  const driveMark = !driveConfigurado
    ? "warn"
    : driveConectado
      ? "on"
      : driveState === "expired"
        ? "warn"
        : "off";
  const driveLabel = !driveConfigurado
    ? "sem client id"
    : driveConectado
      ? "conectado"
      : driveState === "expired"
        ? "sessão vencida"
        : "desconectado";

  const connectDriveNow = async () => {
    setBackupBusy(true);
    setBackupStatus("");
    try {
      // Mesma entrada da primeira tela e do menu: login, uniao e sync. Aqui o
      // caminho e o rapido: a lista aparece e o sync termina em segundo plano.
      const aberto = await connectAccount({ attachments: "skip", sync: "background" });
      setBackupStatus(
        `conectado · ${aberto.summary.notes} ${aberto.summary.notes === 1 ? "nota" : "notas"}`,
      );
    } catch (error) {
      setBackupStatus(describe(error));
    } finally {
      setBackupBusy(false);
    }
  };

  const disconnectDriveNow = () => {
    disconnectDrive();
    setBackupStatus("");
  };

  const saveToDrive = async () => {
    setBackupBusy(true);
    setBackupStatus("");
    try {
      const resultado = await syncVaultToDrive();
      const resumo = lastSyncSummary() ?? resultado;
      if (resumo && resumo.written === 0 && resumo.deleted === 0 && resumo.unchanged === 0) {
        // Plano vazio: nao ha nota neste navegador. Dizer "0 gravadas" sem
        // explicar mandaria o dono procurar defeito no Drive.
        setBackupStatus(isLocalMode() ? "cofre vazio neste navegador · nada para gravar" : "nada para gravar");
      } else {
        setBackupStatus(
          resumo
            ? `${resumo.written} gravadas · ${resumo.deleted} apagadas · ${resumo.unchanged} sem mudança`
            : "cofre salvo",
        );
      }
    } catch (error) {
      setBackupStatus(describe(error));
    } finally {
      setBackupBusy(false);
    }
  };

  const restoreDriveVault = async () => {
    setBackupBusy(true);
    setBackupStatus("");
    try {
      // Restauracao manual pede o cofre inteiro agora, anexos inclusive: e o
      // caminho completo, ao contrario do login rapido.
      const resumo = await restoreVaultFromDrive(undefined, { attachments: "all" });
      const codigo = await ensureVaultCode().catch(() => "");
      if (codigo) {
        setVaultCode(codigo);
        }
      setBackupStatus(
        `${resumo.created} novas · ${resumo.updated} atualizadas · ${resumo.skipped} mantidas`,
      );
    } catch (error) {
      setBackupStatus(describe(error));
    } finally {
      setBackupBusy(false);
    }
  };

  const renderVault = () => (
    <>
      <div className="cfg-block">
        <p className="cfg-label">Backup</p>
        <div className="cfg-item">
          <span className="cfg-mark" data-state={folder ? "on" : "off"} />
          <span className="cfg-grow">Pasta</span>
          <span className="cfg-meta">{folder ? folder.name : "não escolhida"}</span>
          <button type="button" className="cfg-btn cfg-btn--quiet" disabled={backupBusy || !supportsFolder()} onClick={() => void backupToFolder()}>
            enviar
          </button>
          <button type="button" className="cfg-btn cfg-btn--quiet" disabled={backupBusy || !supportsFolder()} onClick={() => void restoreFromFolder()}>
            restaurar
          </button>
        </div>
        <div className="cfg-item">
          <span className="cfg-mark" />
          <span className="cfg-grow">Arquivo .zip</span>
          <span className="cfg-meta">manual</span>
          <button type="button" className="cfg-btn cfg-btn--quiet" disabled={backupBusy} onClick={() => void downloadBackup()}>
            baixar
          </button>
          <button type="button" className="cfg-btn cfg-btn--quiet" disabled={backupBusy} onClick={() => backupFileRef.current?.click()}>
            restaurar
          </button>
          <input
            ref={backupFileRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void restoreFromFile(file);
            }}
          />
        </div>
        <div className="cfg-item">
          <span className="cfg-mark" data-state={driveMark} />
          <span className="cfg-grow">Google Drive</span>
          <span className="cfg-meta">{driveLabel}</span>
          <button
            type="button"
            className="cfg-btn cfg-btn--quiet"
            disabled={backupBusy || (!driveConectado && !driveConfigurado)}
            onClick={() => void (driveConectado ? disconnectDriveNow() : connectDriveNow())}
          >
            {driveConectado ? "desconectar" : "conectar"}
          </button>
          <button type="button" className="cfg-btn cfg-btn--quiet" disabled={backupBusy || !driveConectado} onClick={() => void saveToDrive()}>
            salvar
          </button>
          <button type="button" className="cfg-btn cfg-btn--quiet" disabled={backupBusy || !driveConectado} onClick={() => void restoreDriveVault()}>
            restaurar
          </button>
        </div>
        {backupStatus && <p className="cfg-meta" style={{ marginTop: 8 }}>{backupStatus}</p>}
      </div>
    </>
  );

  const renderSectionContent = (tab: TabId, s: Settings) => {
    if (tab === "transcricao") return renderTranscription(s);
    if (tab === "analise") return renderAnalysis(s);
    if (tab === "projetos") return renderProjects();
    if (tab === "autor") return renderAuthor(s);
    if (tab === "cofre") return renderVault();
    return (
      <>
        <div className="cfg-block">
          <TrashSection refreshKey={refreshKey} bare />
        </div>
        <div className="cfg-block">
          <div className="cfg-field">
            <Switch
              checked={diagnosticsOn}
              ariaLabel="Enviar diagnóstico"
              disabled={!telemetryConfigured()}
              onChange={(value) => {
                setDiagnosticsOn(value);
                void setTelemetryEnabled(value);
              }}
            />
            <span className="cfg-state">Enviar diagnóstico</span>
            {telemetryConfigured() && (
              <Why>Manda erro e versão, sem nota, sem usuário. O app tem a sua própria opção.</Why>
            )}
          </div>
        </div>
      </>
    );
  };

  return (
    <section className="cfg-page">
      <header className="cfg-head">
        {onBack && (
          <button type="button" className="cfg-back" onClick={onBack} aria-label="Voltar">
            <ChevronIcon size={12} />
          </button>
        )}
        <h1 className="cfg-title">Configurações</h1>
        <span className="cfg-saved" data-on={savedOn ? "1" : "0"} aria-live="polite">
          salvo
        </span>
        <nav className="cfg-tabs" role="tablist" aria-label="Seções de configurações">
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`cfg-${tab.id}`}
                className="cfg-tab"
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </header>

      {error && (
        <p className="cfg-state" data-state="bad">
          {error}
        </p>
      )}

      {!settings && <ListSkeleton rows={4} />}

      {settings && (
        <main className="cfg-body" id={`cfg-${activeTab}`} role="tabpanel">
          {renderSectionContent(activeTab, settings)}
        </main>
      )}
    </section>
  );
}

/** Tempo relativo curto para a ultima sessao de um projeto. */
function relativeTime(iso: string): string {
  if (!iso) return "nunca";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "nunca";
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "ontem";
  if (days < 30) return `há ${days} d`;
  return `há ${Math.floor(days / 30)} m`;
}

function projectState(project: McpProject): "on" | "warn" | "off" {
  if (project.state === "open") return "on";
  if (project.state === "interrupted") return "warn";
  return "off";
}

function stateLabel(project: McpProject): string {
  if (project.state === "open") return "sessão aberta";
  if (project.state === "interrupted") return "sessão interrompida";
  if (project.state === "closed") return "sessão fechada";
  return "sem sessão";
}

function ChevronIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** Interruptor: quadrado preenchido quando ligado, contorno quando desligado. */
function Switch({
  checked,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className="cfg-sw"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  );
}

/** Estado da chave: preenchido quando ja existe uma guardada. */
function Why({ children }: { children: React.ReactNode }) {
  return (
    <details className="cfg-why">
      <summary aria-label="Explicação">?</summary>
      <p>{children}</p>
    </details>
  );
}

function Meter({ level }: { level: number }) {
  return (
    <span className="cfg-meter" aria-hidden="true">
      {[1, 2, 3].map((step) => (
        <i key={step} className={step <= level ? "f" : ""} />
      ))}
    </span>
  );
}

interface ProviderOption {
  value: string;
  label: string;
  meta: string;
  missing?: boolean;
}

/** Seletor de provedor: fechado mostra nome e natureza, aberto lista com estado. */
function ProviderSelect({
  label,
  meta,
  value,
  options,
  onChange,
}: {
  label: string;
  meta: string;
  value: string;
  options: ProviderOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="cfg-sel" data-open={open ? "1" : "0"} ref={ref}>
      <button
        type="button"
        className="cfg-sel-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Provedor"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{label}</span>
        <span className="cfg-meta">{meta}</span>
        <ChevronDownIcon />
      </button>
      {open && (
        <div className="cfg-sel-menu" role="listbox" aria-label="Provedor">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                setOpen(false);
                if (option.value !== value) onChange(option.value);
              }}
            >
              <i />
              <span>{option.label}</span>
              <em data-state={option.missing ? "missing" : undefined}>{option.meta}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
