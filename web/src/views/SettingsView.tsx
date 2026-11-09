import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, getToken } from "../api";
import { AllNotebooksIcon, RefreshIcon, SparkIcon, TrashIcon, UserIcon, WaveIcon } from "../components/icons";
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
import type { Entry, LocalAnalysis, ModelInfo, Settings, SummaryDetail } from "../types";

interface DownloadProgress {
  received: number;
  total: number;
  done: boolean;
  error: string;
}

type TabId = "transcricao" | "analise" | "projetos" | "autor" | "dados";

type FetchStatus = "idle" | "loading" | "ready" | "error" | "needs-key";

const MODEL_PREVIEW = 6;

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "transcricao", label: "Transcrição", icon: <WaveIcon size={12} /> },
  { id: "analise", label: "Análise", icon: <SparkIcon size={12} /> },
  { id: "projetos", label: "Projetos (MCP)", icon: <AllNotebooksIcon size={12} /> },
  { id: "autor", label: "Autor", icon: <UserIcon size={12} /> },
  { id: "dados", label: "Dados e lixeira", icon: <TrashIcon size={12} /> },
];

const SUMMARY_DETAIL_OPTIONS: { value: SummaryDetail; label: string }[] = [
  { value: "concise", label: "Enxuto" },
  { value: "full", label: "Completo" },
];

export function SettingsView({ refreshKey = 0, onBack }: { refreshKey?: number; onBack?: () => void }) {
  const { notify } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ownerName, setOwnerName] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const [ceiling, setCeiling] = useState("0");
  const [apiKey, setApiKey] = useState("");
  const [deepgramKey, setDeepgramKey] = useState("");
  const [themes, setThemes] = useState("");
  const [provider, setProvider] = useState("custom");
  const [providerModels, setProviderModels] = useState<string[]>([]);
  const [modelsNote, setModelsNote] = useState("");
  const [local, setLocal] = useState<LocalAnalysis | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const [error, setError] = useState("");
  const [mcpEntries, setMcpEntries] = useState<Entry[] | null>(null);
  const [copied, setCopied] = useState<"command" | "file" | null>(null);
  const [mcpSnippet, setMcpSnippet] = useState<"command" | "file">("command");
  const [summaryErrors, setSummaryErrors] = useState<Record<string, string>>({});
  const [summaryLoadError, setSummaryLoadError] = useState("");

  // UI state
  const [activeTab, setActiveTab] = useState<TabId>("analise");
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("idle");
  const [fetchError, setFetchError] = useState("");
  const [deepgramBusy, setDeepgramBusy] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showAllModels, setShowAllModels] = useState(false);

  // Id da requisicao em andamento, para descartar respostas obsoletas.
  const fetchReqId = useRef(0);

  const localRuntime = localRuntimeOf(provider);
  const preset = PROVIDER_PRESETS[provider];
  const currentLocal = localRuntime && local?.runtime === localRuntime ? local : null;

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

  const deepgramModels = useMemo(() => {
    const current = settings?.deepgram_model ?? "";
    return [...new Set([...DEEPGRAM_MODELS, current])].filter((model) => model !== "");
  }, [settings?.deepgram_model]);

  const visibleModels = useMemo(() => {
    if (showAllModels || analysisModels.length <= MODEL_PREVIEW) return analysisModels;
    const preview = analysisModels.slice(0, MODEL_PREVIEW);
    const selected = settings?.analyze_model ?? "";
    return selected && !preview.includes(selected) ? [...preview, selected] : preview;
  }, [analysisModels, settings?.analyze_model, showAllModels]);

  const modelCountNote = (() => {
    if (fetchStatus === "loading") return "buscando modelos";
    if (localRuntime) return `${analysisModels.length} modelos · locais`;
    if (fetchStatus === "ready") return `${analysisModels.length} modelos · do provedor`;
    if (fetchStatus === "needs-key") return `${analysisModels.length} modelos · catálogo`;
    return `${analysisModels.length} modelos · catálogo`;
  })();

  const loadSettings = useCallback(async () => {
    const value = await api.getSettings();
    setSettings(value);
    setCeiling(String(value.max_whisper_rss_mb));
    setThemes(value.analysis_themes ?? "");
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

  const loadNotebooks = useCallback(async () => {
    try {
      const result = await api.listNotebooks(false);
      setSummaryLoadError("");
      const mcp = (result.notebooks ?? []).find((notebook) => notebook.kind === "mcp");
      if (mcp) {
        try {
          const entries = await api.listAllEntries({ notebook_id: mcp.id });
          setMcpEntries(entries.entries ?? []);
        } catch {
          setMcpEntries([]);
        }
      } else {
        setMcpEntries([]);
      }
    } catch {
      setMcpEntries([]);
      setSummaryLoadError("Falha ao carregar projetos.");
    }
  }, []);

  useEffect(() => {
    loadSettings().catch((err: unknown) => setError(err instanceof Error ? err.message : "falha ao carregar"));
    loadModels().catch((err: unknown) => setError(err instanceof Error ? err.message : "falha ao carregar"));
    void loadLocal("ollama");
    void loadNotebooks();
  }, [loadSettings, loadModels, loadLocal, loadNotebooks]);

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
      notify(message, "success");
      return true;
    } catch (err) {
      notify(err instanceof Error ? err.message : "falha ao salvar", "error");
      return false;
    }
  };

  /** Troca o detalhe do resumo MCP de um projeto, otimista e com volta em erro. */
  const setProjectDetail = async (entry: Entry, value: SummaryDetail) => {
    const previous = entry.summary_detail ?? "concise";
    if (previous === value) return;
    setSummaryErrors((current) => {
      const next = { ...current };
      delete next[entry.id];
      return next;
    });
    setMcpEntries((current) => current?.map((e) => (e.id === entry.id ? { ...e, summary_detail: value } : e)) ?? current);
    try {
      await api.patchEntry(entry.id, { summary_detail: value });
    } catch {
      setMcpEntries((current) => current?.map((e) => (e.id === entry.id ? { ...e, summary_detail: previous } : e)) ?? current);
      setSummaryErrors((current) => ({ ...current, [entry.id]: "Falha ao salvar. Tente de novo." }));
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
      setModelsNote(
        list.length > 0 ? `${list.length} modelos encontrados.` : "Nenhum modelo retornado pelo provedor.",
      );
    } catch (err) {
      if (reqId !== fetchReqId.current) return;
      setProviderModels([]);
      setFetchStatus("error");
      setFetchError(err instanceof Error ? err.message : "falha ao buscar modelos");
      setModelsNote("Falha ao buscar modelos do provedor.");
    }
  }, []);

  const selectProvider = async (id: string) => {
    setProvider(id);
    setProviderModels([]);
    setApiKey("");
    setShowAllModels(false);
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
      setModelsNote("Informe a chave para ver os modelos do provedor.");
      return;
    }
    const canSearch = canSearchModels(id);
    if (canSearch) {
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
      if (!currentLocal.available) {
        return "llama.cpp não está disponível nesta imagem; use o Ollama local ou um provedor.";
      }
      if (!currentLocal.downloaded) {
        return currentLocal.size_mb ? `Modelo local ausente (~${currentLocal.size_mb} MB).` : "Modelo local ausente.";
      }
      return currentLocal.running
        ? "llama.cpp pronto e rodando."
        : "llama.cpp pronto; carrega na primeira análise.";
    }
    if (currentLocal.available) {
      return `Ollama no ar em ${currentLocal.base_url}, com ${currentLocal.models.length} modelo(s) instalado(s).`;
    }
    return `Ollama não encontrado em ${currentLocal.base_url}. Confira se o serviço ollama está no ar.`;
  })();

  // ---------- resumo de cada secao (linha do acordeao) ----------
  const transcribeProvider = settings?.transcribe_provider ?? "whisper";
  const tpPreset = TRANSCRIBE_PROVIDERS[transcribeProvider as keyof typeof TRANSCRIBE_PROVIDERS];
  const transcribeSummary = tpPreset ? tpPreset.short : transcribeProvider;

  const analyzeProviderId = providerFromSettings(
    settings?.analyze_provider ?? "openai",
    settings?.analyze_base_url ?? "",
    settings?.analyze_local_runtime ?? "",
  );
  const analyzePreset = PROVIDER_PRESETS[analyzeProviderId];
  const analyzeLabel = analyzePreset ? analyzePreset.short : (settings?.analyze_provider ?? "");
  const transcribeKeyMissing = transcribeProvider === "deepgram" && !settings?.deepgram_api_key_set;
  const projectEntries = mcpEntries ?? [];
  const projectCount = projectEntries.length;
  const fullProjects = projectEntries.filter((entry) => entry.summary_detail === "full").length;

  const summaries: Record<TabId, { text: string; state?: "ok" | "warn" | "off"; stateText?: string }> = {
    transcricao: {
      text: `${transcribeSummary} · ${
        transcribeProvider === "deepgram" ? (settings?.deepgram_model ?? "") : (settings?.whisper_model ? whisperModelLabel(settings.whisper_model) : "")
      }`.replace(/ · $/, ""),
      state: transcribeKeyMissing ? "warn" : undefined,
      stateText: transcribeKeyMissing ? "chave ausente" : undefined,
    },
    analise: {
      text: `${analyzeLabel}${settings?.analyze_model ? " · " + settings.analyze_model : ""}`,
      state: settings && !settings.analyze_enabled ? "off" : undefined,
      stateText: settings && !settings.analyze_enabled ? "desligada" : undefined,
    },
    projetos: {
      text: mcpEntries === null ? "carregando" : `${projectCount} ${projectCount === 1 ? "projeto" : "projetos"}`,
      stateText: fullProjects > 0 ? `${fullProjects} completo${fullProjects === 1 ? "" : "s"}` : undefined,
    },
    autor: {
      text: settings?.owner_name && settings.owner_name.trim() !== "" ? settings.owner_name : "sem nome",
      state: settings?.all_notes_mine ? "ok" : "off",
      stateText: settings?.all_notes_mine ? "minhas" : "por nota",
    },
    // "lixeira" ja esta no nome da secao; o resumo diz o que ha ali.
    dados: { text: "notas excluídas", state: "off" },
  };

  // ---------- conteudo aberto de cada secao ----------
  const renderTranscription = (s: Settings) => (
    <>
      <div className="settings-columns">
        <div className="settings-main">
          <div className="section-block">
            <div className="listhead">
              <span className="meta">{whisperModels.length} modelos</span>
              <button type="button" className="refresh" onClick={() => void loadModels()} aria-label="Atualizar lista de modelos">
                <RefreshIcon size={9} />
                Atualizar
              </button>
              <a className="lnk" href={WHISPER_CATALOG_URL} target="_blank" rel="noreferrer">
                Catálogo
              </a>
            </div>
            <div className="rows">
              {whisperModels.map((model) => {
                const p = progress[model.name];
                const percent = p && p.total > 0 ? Math.min(100, Math.round((p.received / p.total) * 100)) : 0;
                const quality = whisperQuality(whisperModelLabel(model.name));
                const downloaded = model.downloaded;
                const selected = s.whisper_model === model.path;
                return (
                  <div key={model.name} className={`row${selected ? " row--selected" : ""}`} aria-selected={selected}>
                    <input
                      className="radio"
                      type="radio"
                      name="whisper-model"
                      value={model.path}
                      checked={selected}
                      disabled={!downloaded}
                      onChange={() => void save({ whisper_model: model.path }, "Modelo ativo atualizado")}
                      aria-label={whisperModelLabel(model.name)}
                    />
                    <span className="mname">
                      <span className="n">
                        <span className="n-text">{whisperModelLabel(model.name)}</span>
                        {quality.score >= 2 && <span className="reco">recomendado</span>}
                      </span>
                      <span className="s">
                        {downloaded ? `~${model.size_mb} MB` : `~${model.size_mb} MB (ausente)`} ·{" "}
                        {quality.note === "mais leve" || quality.note === "equilíbrio" || quality.note === "mais preciso"
                          ? quality.note
                          : ""}
                      </span>
                    </span>
                    <span className="meter">
                      {[1, 2, 3].map((level) => (
                        <i key={level} className={level <= quality.score ? "f" : ""} />
                      ))}
                    </span>
                    <span className="qual">{quality.label}</span>
                    <span className="chip">local</span>
                    {!downloaded && (
                      <button
                        type="button"
                        className="button button--small button--ghost"
                        onClick={() => void download(model.name)}
                        disabled={p && !p.done}
                      >
                        {p && !p.done ? "Baixando..." : "Baixar"}
                      </button>
                    )}
                    {!downloaded && p && !p.done && (
                      <span className="ram-track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                        <span className="ram-fill" style={{ width: `${percent}%` }} />
                      </span>
                    )}
                    {!downloaded && p && p.error && <span className="error">Falha no download: {p.error}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="settings-side">
          <div className="section-block">
            <div className="providers providers--2">
              <ProviderCard
                preset={TRANSCRIBE_PROVIDERS.whisper}
                selected={s.transcribe_provider === "whisper"}
                onSelect={() => void save({ transcribe_provider: "whisper" }, "Provedor atualizado")}
              />
              <ProviderCard
                preset={TRANSCRIBE_PROVIDERS.deepgram}
                selected={s.transcribe_provider === "deepgram"}
                onSelect={() => void save({ transcribe_provider: "deepgram" }, "Provedor atualizado")}
              />
            </div>
            {s.transcribe_provider === "deepgram" && (
              <>
                <div className="field">
                  <span className="field-label">Modelo</span>
                  <div className="field-control">
                    <select
                      aria-label="Modelo Deepgram"
                      value={s.deepgram_model}
                      onChange={(event) => void save({ deepgram_model: event.target.value }, "Modelo da Deepgram atualizado")}
                    >
                      {deepgramModels.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="field field-full">
                  <span className="field-label">
                    Chave da Deepgram <KeyState defined={s.deepgram_api_key_set} />
                  </span>
                  <div className="field-control">
                    <input
                      type="password"
                      aria-label="Chave da Deepgram"
                      placeholder={s.deepgram_api_key_set ? "definida (deixe vazio para manter)" : "cole a chave da Deepgram"}
                      value={deepgramKey}
                      onChange={(event) => setDeepgramKey(event.target.value)}
                      disabled={deepgramBusy}
                    />
                    <button
                      type="button"
                      className="button button--small button--ghost"
                      onClick={() => {
                        const key = deepgramKey.trim();
                        if (key === "") return;
                        setDeepgramBusy(true);
                        void save({ deepgram_api_key: key }, "Chave da Deepgram salva").then((ok) => {
                          if (ok) setDeepgramKey("");
                          setDeepgramBusy(false);
                        });
                      }}
                      disabled={deepgramBusy}
                    >
                      {deepgramBusy ? "Salvando..." : "Salvar chave da Deepgram"}
                    </button>
                  </div>
                  <div className="key-links">
                    <a className="lnk" href={DEEPGRAM_KEY_URL} target="_blank" rel="noreferrer">
                      Criar chave na Deepgram
                    </a>
                  </div>
                </div>
              </>
            )}
            <div className="fields">
              <div className="field">
                <span className="field-label">Idioma</span>
                <div className="field-control">
                  <select
                    aria-label="Idioma da transcrição"
                    value={s.whisper_language}
                    onChange={(event) => void save({ whisper_language: event.target.value })}
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
              </div>
              <div className="field">
                <span className="field-label">Corte de silêncio</span>
                <div className="field-control">
                  <ToggleCustom
                    ariaLabel="Corte de silêncio"
                    checked={s.trim_silence}
                    onChange={(value) => void save({ trim_silence: value })}
                  />
                </div>
              </div>
              <div className="field">
                <span className="field-label">Limite de RAM (MB)</span>
                <div className="field-control">
                  <input
                    type="number"
                    min={0}
                    aria-label="Limite de RAM da transcrição em MB"
                    value={ceiling}
                    onChange={(event) => setCeiling(event.target.value)}
                  />
                  <button
                    type="button"
                    className="button button--small button--ghost"
                    onClick={() => void save({ max_whisper_rss_mb: Math.max(0, Math.floor(Number(ceiling) || 0)) })}
                  >
                    Salvar
                  </button>
                  <span className="field-hint">0 significa sem limite</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  const renderAnalysis = (s: Settings) => {
    const recommended = recommendedModel(provider);
    return (
      <>
        <div className="settings-columns">
          <div className="settings-main">
            <div className="section-block">
              <div className="field">
                <span className="field-label">Análise por IA</span>
                <div className="field-control">
                  <ToggleCustom ariaLabel="Análise por IA" checked={s.analyze_enabled} onChange={(value) => void save({ analyze_enabled: value })} />
                </div>
              </div>
            </div>

            <div className="section-block">
              <div className="step">
                <span className="num">1</span>
                <span className="t">Provedor</span>
              </div>
              <div className="providers">
                {[...LOCAL_PROVIDER_IDS, ...CLOUD_PROVIDER_IDS].map((id) => {
                  const p = PROVIDER_PRESETS[id];
                  return (
                    <ProviderCard
                      key={id}
                      preset={p}
                      selected={provider === id}
                      onSelect={() => void selectProvider(id)}
                      disabled={localBusy && id !== provider}
                    />
                  );
                })}
              </div>
            </div>

            <div className="section-block">
              <div className="step">
                <span className="num">2</span>
                <span className="t">Modelo</span>
                <span className="listhead">
                  <span className="meta">{modelCountNote}</span>
                  {preset?.searchable && (
                    <button
                      type="button"
                      className="refresh"
                      onClick={() => void fetchAnalyzeModels()}
                      disabled={fetchStatus === "loading" || (Boolean(preset?.keyRequired) && !s.analyze_api_key_set)}
                      aria-label="Buscar modelos do provedor"
                    >
                      <RefreshIcon size={9} />
                      Buscar
                    </button>
                  )}
                </span>
                {fetchStatus === "loading" && (
                  <span className="listhead">
                    <span className="meta">{modelsNote || "Buscando modelos..."}</span>
                  </span>
                )}
                {fetchStatus === "error" && (
                  <span className="listhead error-banner">
                    <span className="error">{fetchError}</span>
                    <button type="button" className="button button--small button--ghost" onClick={() => void fetchAnalyzeModels()}>
                      Tentar novamente
                    </button>
                  </span>
                )}
              </div>

              <div className="rows">
                {fetchStatus === "loading" ? (
                  <div className="row skeleton-row">
                    <span className="skeleton-cell skeleton-title" />
                    <span className="skeleton-cell skeleton-line" />
                    <span className="skeleton-cell skeleton-line" />
                  </div>
                ) : visibleModels.map((model) => {
                  const q = qualityOf(provider, model);
                  const selected = s.analyze_model === model;
                  const isReasoning = q.reasoning;
                  return (
                    <div key={model} className={`row${selected ? " row--selected" : ""}`} aria-selected={selected}>
                      <input
                        className="radio"
                        type="radio"
                        name="analysis-model"
                        value={model}
                        checked={selected}
                        onChange={() => void save({ analyze_model: model }, "Modelo atualizado")}
                        aria-label={model}
                      />
                      <span className="mname">
                        <span className="n">
                          <span className="n-text">{model}</span>
                          {model === recommended && <span className="reco">recomendado</span>}
                        </span>
                        <span className="s">{isReasoning ? "pensa antes de responder" : q.note}</span>
                      </span>
                      <span className="meter">
                        {[1, 2, 3].map((level) => (
                          <i key={level} className={level <= q.score ? "f" : ""} />
                        ))}
                      </span>
                      <span className="qual">{q.label}</span>
                      <span className="chip">
                        {q.cost === "local" ? "local" : q.cost === "grátis" ? "grátis" : q.cost === "" ? undefined : q.cost}
                        {isReasoning && q.cost ? " · " : ""}
                        {isReasoning ? "lento" : ""}
                      </span>
                    </div>
                  );
                })}
                {analysisModels.length === 0 && fetchStatus !== "loading" && (
                  <div className="row">
                    <span className="muted">Nenhum modelo disponível para este provedor.</span>
                  </div>
                )}
              </div>
              {modelsNote && fetchStatus !== "loading" && <span className="hint">{modelsNote}</span>}
              {analysisModels.length > MODEL_PREVIEW && (
                <button
                  type="button"
                  className="more"
                  aria-expanded={showAllModels}
                  onClick={() => setShowAllModels((value) => !value)}
                >
                  {showAllModels ? "Mostrar menos" : `Mostrar todos os ${analysisModels.length}`}
                  {!showAllModels && (
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  )}
                </button>
              )}
            </div>
          </div>

          <div className="settings-side">
            {!localRuntime && (
              <div className="field key-field">
                <span className="field-label">
                  {provider === "opencodeLocal" ? "Senha do opencode" : "Chave da API"} <KeyState defined={s.analyze_api_key_set} />
                </span>
                <div className="field-control">
                  <input
                    type="password"
                    aria-label="Chave da API de análise"
                    placeholder={
                      s.analyze_api_key_set
                        ? "definida (deixe vazio para manter)"
                        : provider === "opencodeLocal"
                          ? "senha de ~/.config/opencode/service.json"
                          : preset?.keyPlaceholder ?? "cole a chave do provedor"
                    }
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                  <button
                    type="button"
                    className="button button--small button--ghost"
                    onClick={() => void saveAnalyzeKey()}
                    disabled={apiKey.trim() === ""}
                  >
                    {preset?.searchable ? "Salvar e testar" : "Salvar chave"}
                  </button>
                </div>
                <KeyLinks links={preset?.links} />
              </div>
            )}

            {localRuntime && (
              <div className="runtime-box">
                <div className="card-head">
                  <h2>{provider === "llamaLocal" ? "llama.cpp embutido" : "Ollama local"}</h2>
                  <p className="hint">{localHint}</p>
                </div>
                <div className="field-control">
                  <button
                    type="button"
                    className="button button--small button--ghost"
                    onClick={() => void installLocal(localRuntime)}
                    disabled={localBusy}
                  >
                    {localBusy ? "Configurando..." : "Usar análise local"}
                  </button>
                  {currentLocal?.pull && !currentLocal.pull.done && !currentLocal.pull.error && (
                    <span className="ram-track" role="progressbar" aria-valuenow={currentLocal.pull.percent} aria-valuemin={0} aria-valuemax={100}>
                      <span className="ram-fill" style={{ width: `${currentLocal.pull.percent}%` }} />
                    </span>
                  )}
                </div>
                {currentLocal?.pull?.error && <span className="error">{currentLocal.pull.error}</span>}
              </div>
            )}

            <div className="section-block">
              <div className="fields">
                <div className="field">
                  <span className="field-label">Revisar a transcrição com IA</span>
                  <div className="field-control">
                    <ToggleCustom ariaLabel="Revisar a transcrição com IA" checked={s.review_enabled} onChange={(value) => void save({ review_enabled: value })} />
                  </div>
                  <span className="field-hint">
                    Corrige concordância, pontuação e siglas antes de analisar. Desligada, a análise
                    continua funcionando, mas perde precisão sobre o que foi falado. Vale só para este
                    dashboard: a escolha no app é separada.
                  </span>
                </div>
                {s.review_enabled && (
                  <div className="field">
                    <span className="field-label">Transcrição literal</span>
                    <div className="field-control">
                      <ToggleCustom ariaLabel="Transcrição literal" checked={s.literal_transcript} onChange={(value) => void save({ literal_transcript: value })} />
                    </div>
                    <span className="field-hint">
                      Mantém hesitações ("éé", "hum") e repetições de gagueira, para quem quer acompanhar
                      como fala. Desligada, a revisão remove só o que não tem significado; "tipo", "né"
                      e gírias ficam sempre.
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="section-block">
              <button
                className="collapsible-head"
                aria-expanded={advancedOpen}
                aria-label="Avançado"
                onClick={() => setAdvancedOpen(!advancedOpen)}
              >
                <div>
                  <h2>Avançado</h2>
                  <p className="hint">Base URL e temas da análise.</p>
                </div>
                <span className="collapsive-icon">{advancedOpen ? "▾" : "▸"}</span>
              </button>
              {advancedOpen && (
                <div className="collapsible-body">
                  <div className="fields">
                    <div className="field">
                      <span className="field-label">Base URL</span>
                      <div className="field-control">
                        <input
                          key={s.analyze_base_url}
                          type="text"
                          aria-label="Base URL da análise"
                          defaultValue={s.analyze_base_url}
                          onBlur={(event) => void save({ analyze_base_url: event.target.value })}
                        />
                      </div>
                    </div>
                    <div className="field">
                      <span className="field-label">Temas</span>
                      <div className="field-control">
                        <input
                          type="text"
                          aria-label="Temas da análise"
                          value={themes}
                          onChange={(event) => setThemes(event.target.value)}
                        />
                        <button
                          type="button"
                          className="button button--small button--ghost"
                          onClick={() => void save({ analysis_themes: themes }, "Temas salvos")}
                        >
                          Salvar
                        </button>
                      </div>
                      <span className="field-hint">Temas preferidos na análise, separados por vírgulas.</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="caption">
              Adequação para analisar notas em português. Não é um ranking geral de inteligência.
            </div>
          </div>
        </div>
      </>
    );
  };

  const renderAuthor = (s: Settings) => (
    <div className="settings-single">
      <div className="section-block">
        <div className="fields">
          <div className="field">
            <span className="field-label">Seu nome</span>
            <div className="field-control">
              <input
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
          </div>
          <div className="field">
            <span className="field-label">Todas as notas são minhas</span>
            <div className="field-control">
              <ToggleCustom
                checked={s.all_notes_mine}
                onChange={(value) => void save({ all_notes_mine: value })}
                ariaLabel="Todas as notas são minhas"
              />
            </div>
            <span className="field-hint">
              Desligado, uma nota sem escolha manual fica sem autor. O seletor da nota sempre vence.
            </span>
          </div>
        </div>
      </div>
    </div>
  );

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

  const copyMcp = async (kind: "command" | "file") => {
    const token = getToken() || "SEU_TOKEN";
    const text = kind === "command" ? mcpCommand(token) : mcpFile(token);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // ignore
    }
  };

  const renderProjects = () => (
    <div className="settings-single mcp-settings">
      <div className="section-block">
        {summaryLoadError && <p className="error">{summaryLoadError}</p>}
        <div className="mcp-connection">
          <div className="mcp-connection-head">
            <div className="segmented segmented--compact" role="group" aria-label="Formato da conexão">
              <button type="button" aria-pressed={mcpSnippet === "command"} onClick={() => setMcpSnippet("command")}>
                Comando
              </button>
              <button type="button" aria-pressed={mcpSnippet === "file"} onClick={() => setMcpSnippet("file")}>
                Arquivo
              </button>
            </div>
            <button
              type="button"
              className="button button--small button--ghost"
              onClick={() => void copyMcp(mcpSnippet)}
              title="Copia com o token real"
            >
              {copied === mcpSnippet ? "Copiado" : "Copiar"}
            </button>
          </div>
          <pre className="mcp-snippet">
            {mcpSnippet === "command" ? mcpCommand("SEU_TOKEN") : mcpFile("SEU_TOKEN")}
          </pre>
        </div>
        <div className="mcp-projects-head">
          <span className="mcp-connection-label">Projetos</span>
        </div>
        {mcpEntries === null && <ListSkeleton rows={2} />}
        {mcpEntries !== null && projectCount === 0 && !summaryLoadError && <p className="meta">Nenhum projeto ainda.</p>}
        {mcpEntries !== null && projectCount > 0 && (
          <div className="mcp-projects">
            {projectEntries.map((entry) => {
              const value = entry.summary_detail ?? "concise";
              return (
                <div key={entry.id} className="mcp-project">
                  <span className="mcp-project-name" title={entry.title}>
                    {entry.title}
                  </span>
                  <div
                    className="segmented segmented--compact"
                    role="group"
                    aria-label={`Resumo de ${entry.title}`}
                    title="Detalhe do resumo automático que o MCP gera para este projeto"
                  >
                    {SUMMARY_DETAIL_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={value === option.value}
                        onClick={() => void setProjectDetail(entry, option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {summaryErrors[entry.id] && <span className="error">{summaryErrors[entry.id]}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const renderData = () => (
    <div className="settings-single">
      <div className="section-block">
        <TrashSection refreshKey={refreshKey} />
      </div>
    </div>
  );

  const renderSectionContent = (tab: TabId, s: Settings) => {
    if (tab === "transcricao") return renderTranscription(s);
    if (tab === "analise") return renderAnalysis(s);
    if (tab === "projetos") return renderProjects();
    if (tab === "autor") return renderAuthor(s);
    return renderData();
  };

  return (
    <section className="settings-page">
      <header className="settings-header">
        {onBack && (
          <button type="button" className="page-back" onClick={onBack} aria-label="Voltar" title="Voltar">
            <ChevronIcon size={16} />
          </button>
        )}
        <span className="header-title">Configurações</span>
        <nav className="settings-nav" aria-label="Seções de configurações">
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <a
                key={tab.id}
                href={`#settings-${tab.id}`}
                className={`settings-nav-item${active ? " settings-nav-item--on" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  setActiveTab(tab.id);
                }}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </a>
            );
          })}
        </nav>
      </header>

      {error && <p className="error">{error}</p>}

      {!settings && <ListSkeleton rows={4} />}

      {settings && (
        <main className="settings-sections">
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            const summary = summaries[tab.id];
            const contentId = `settings-section-${tab.id}`;
            return (
              <div
                key={tab.id}
                className={`section-row${active ? " section-row--open" : ""}`}
                id={`settings-${tab.id}`}
              >
                <button
                  type="button"
                  className="section-toggle"
                  aria-expanded={active}
                  aria-controls={contentId}
                  aria-label={tab.label}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <span className="section-label">{tab.label}</span>
                  <span className="section-summary">{summary.text}</span>
                  {summary.stateText && (
                    <span className={`state-pill${summary.state === "warn" ? " state-pill--warn" : ""}${summary.state === "ok" ? " state-pill--ok" : ""}`}>
                      {summary.stateText}
                    </span>
                  )}
                  <ChevronIcon size={14} rotate={active} />
                </button>
                {active && (
                  <div className="section-content" id={contentId}>
                    {renderSectionContent(tab.id, settings)}
                  </div>
                )}
              </div>
            );
          })}
        </main>
      )}
    </section>
  );
}

function ChevronIcon({ size = 18, rotate = false }: { size?: number; rotate?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={rotate ? "chevron chevron--open" : "chevron"}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function ToggleCustom({ checked, onChange, ariaLabel }: { checked: boolean; onChange: (checked: boolean) => void; ariaLabel?: string }) {
  return (
    <label className={`toggle${checked ? " toggle--on" : ""}`}>
      <input type="checkbox" checked={checked} readOnly onChange={(event) => onChange(event.target.checked)} aria-label={ariaLabel} />
      <span className="sw" />
    </label>
  );
}

/** Estado da chave: preenchido quando ja existe uma guardada. */
function KeyState({ defined }: { defined: boolean }) {
  return <span className={`key-state${defined ? " key-state--on" : ""}`}>{defined ? "definida" : "ausente"}</span>;
}

/** Atalhos do console do provedor, abertos em outra aba. */
function KeyLinks({ links }: { links?: { label: string; href: string }[] }) {
  if (!links?.length) return null;
  return (
    <span className="key-links">
      {links.map((link) => (
        <a key={link.href} className="lnk" href={link.href} target="_blank" rel="noreferrer">
          {link.label}
        </a>
      ))}
    </span>
  );
}

/** Cartao compacto de provedor (transcricao e analise). */
function ProviderCard({
  preset,
  selected,
  onSelect,
  disabled,
}: {
  preset: { short: string; label: string; initials: string; baseUrl?: string; kind?: string; localRuntime?: string };
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`pv${selected ? " pv--on" : ""}`}
      onClick={onSelect}
      disabled={disabled}
      role="radio"
      aria-checked={selected}
      aria-label={preset.label}
    >
      <span className="pv-initials">{preset.initials}</span>
      <span className="txt">
        <span className="nm">{preset.label}</span>
      </span>
    </button>
  );
}
