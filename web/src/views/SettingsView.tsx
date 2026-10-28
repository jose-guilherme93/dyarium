import { useCallback, useEffect, useMemo, useState } from "react";
import { api, getToken } from "../api";
import { Toggle } from "../components/Toggle";
import { TrashSection } from "../components/TrashSection";
import { useToast } from "../components/Toasts";
import type { LocalAnalysis, ModelInfo, Settings } from "../types";

interface DownloadProgress {
  received: number;
  total: number;
  done: boolean;
  error: string;
}

interface ProviderPreset {
  label: string;
  baseUrl: string;
  model: string;
  /** analyze_provider value stored on the server. */
  kind: string;
}

const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  opencodeZen: {
    label: "OpenCode Zen (chave)",
    baseUrl: "https://opencode.ai/inference/openai/v1",
    model: "glm-5.3-flash-free",
    kind: "openai",
  },
  opencodeGo: {
    label: "OpenCode Go (assinatura)",
    baseUrl: "https://opencode.ai/inference/go/openai/v1",
    // Nao e modelo de raciocinio: responde direto, sem gastar o teto pensando.
    model: "glm-5.3-flash",
    kind: "openai",
  },
  opencodeLocal: {
    label: "opencode local (login)",
    baseUrl: "http://127.0.0.1:49374",
    model: "opencode-go/qwen3.8-flash",
    kind: "opencode",
  },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", kind: "openai" },
  ollama: { label: "Ollama local", baseUrl: "http://ollama:11434/v1", model: "qwen2.5:0.5b", kind: "openai" },
  llamaLocal: {
    label: "llama.cpp embutido",
    baseUrl: "",
    model: "qwen2.5-0.5b-instruct-q4_k_m",
    kind: "openai",
  },
  custom: { label: "Personalizado", baseUrl: "", model: "", kind: "openai" },
};

// A análise fala o formato /chat/completions. No OpenCode, Claude, GPT, Gemini
// e Grok usam outros formatos (Anthropic, Responses, Google), entao so entram
// na lista os modelos que o cliente sabe chamar.
// Modelos que pensam antes de responder. Nao servem de padrao para analisar
// notas: gastam o teto de tokens raciocinando e demoram mais. A interface os
// marca para o usuario escolher com o custo na frente.
const REASONING_MODELS = new Set([
  "deepseek-v4.1-flash-free",
  "deepseek-v4.1-flash",
  "deepseek-v4-pro",
  "glm-5.3",
  "longcat-2.0",
  "qwen3.8-max",
  "minimax-m3",
  "hy3",
]);

function isReasoningModel(model: string): boolean {
  return REASONING_MODELS.has(model);
}

const ZEN_MODELS = [
  "glm-5.3-flash-free",
  "glm-5.3-flash",
  "kimi-k2.7-code",
  "space-bunny-free",
  "deepseek-v4.1-flash-free",
  "deepseek-v4.1-flash",
  "qwen3.8-max",
  "minimax-m3",
];

const GO_MODELS = [
  "glm-5.3-flash",
  "kimi-k2.7-code",
  "space-bunny",
  "deepseek-v4.1-flash",
  "deepseek-v4-pro",
  "glm-5.3",
  "longcat-2.0",
  "hy3",
];

const OPENCODE_MODELS = [
  "opencode-go/qwen3.8-flash",
  "opencode-go/glm-5.3-flash",
  "opencode-go/claude-haiku-5-5",
  "opencode-go/gpt-6-luna",
  "deepseek/deepseek-chat",
];

const FALLBACK_MODELS: Record<string, string[]> = {
  opencodeZen: ZEN_MODELS,
  opencodeGo: GO_MODELS,
  opencodeLocal: OPENCODE_MODELS,
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  llamaLocal: [],
  ollama: [],
  custom: [],
};

function providerFromSettings(kind: string, baseUrl: string, localRuntime: string): string {
  if (localRuntime === "embedded") {
    return "llamaLocal";
  }
  if (localRuntime === "ollama") {
    return "ollama";
  }
  if (kind === "opencode") {
    return "opencodeLocal";
  }
  if (baseUrl.includes("opencode.ai/inference/go/")) {
    return "opencodeGo";
  }
  if (baseUrl.includes("opencode.ai/inference/")) {
    return "opencodeZen";
  }
  if (baseUrl.includes("deepseek")) {
    return "deepseek";
  }
  if (baseUrl.includes("ollama") || baseUrl.includes("11434")) {
    return "ollama";
  }
  return "custom";
}

/** Modelos do OpenCode vem de uma lista curada: o /models deles não diz o formato de cada um. */
function canSearchModels(provider: string): boolean {
  return provider !== "opencodeZen" && provider !== "opencodeGo" && provider !== "ollama" && provider !== "llamaLocal";
}

/** Runtime local de um provedor, ou vazio quando a análise usa a nuvem. */
function localRuntimeOf(provider: string): "ollama" | "embedded" | null {
  if (provider === "llamaLocal") {
    return "embedded";
  }
  if (provider === "ollama") {
    return "ollama";
  }
  return null;
}

export function SettingsView({ refreshKey = 0 }: { refreshKey?: number }) {
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

  const searchable = canSearchModels(provider);
  const localRuntime = localRuntimeOf(provider);
  const currentLocal = localRuntime && local?.runtime === localRuntime ? local : null;
  const modelOptions = useMemo(() => {
    const fallback = localRuntime
      ? (currentLocal?.models?.length ? currentLocal.models : currentLocal?.model ? [currentLocal.model] : [])
      : FALLBACK_MODELS[provider] ?? [];
    const remote = !localRuntime && searchable ? providerModels : [];
    const list = remote.length > 0 ? remote : fallback;
    const current = settings?.analyze_model ?? "";
    return [...new Set([...list, current])].filter((model) => model !== "");
  }, [provider, providerModels, settings?.analyze_model, currentLocal, searchable, localRuntime]);

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

  useEffect(() => {
    loadSettings().catch((err: unknown) => setError(err instanceof Error ? err.message : "falha ao carregar"));
    loadModels().catch((err: unknown) => setError(err instanceof Error ? err.message : "falha ao carregar"));
    void loadLocal("ollama");
  }, [loadSettings, loadModels, loadLocal]);

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

  const save = async (patch: Record<string, unknown>, message = "Configuração salva") => {
    try {
      await api.putSettings(patch);
      await loadSettings();
      setError("");
      notify(message, "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : "falha ao salvar", "error");
    }
  };

  const fetchModels = useCallback(async () => {
    setModelsNote("Buscando modelos...");
    try {
      const result = await api.listAnalyzeModels();
      const list = result.models ?? [];
      setProviderModels(list);
      setModelsNote(
        list.length > 0 ? `${list.length} modelos encontrados.` : "Nenhum modelo retornado pelo provedor.",
      );
    } catch (err) {
      setProviderModels([]);
      setModelsNote(err instanceof Error ? err.message : "falha ao buscar modelos");
    }
  }, []);

  useEffect(() => {
    if (settings?.analyze_base_url && searchable) {
      void fetchModels();
    }
  }, [settings?.analyze_base_url, searchable, fetchModels]);

  // Enquanto o modelo baixa, o painel acompanha pelo mesmo endpoint que iniciou
  // o download; quando termina, recarrega as configurações para refletir o modelo.
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

  /** Um clique: configura o runtime local e baixa o modelo se ainda faltar. */
  const installLocal = async (runtime: "ollama" | "embedded", model?: string) => {
    const preset = runtime === "embedded" ? PROVIDER_PRESETS.llamaLocal : PROVIDER_PRESETS.ollama;
    const saved = localRuntime === runtime ? settings?.analyze_model?.trim() : "";
    const current = local?.runtime === runtime ? local : null;
    const target = model || saved || current?.model || preset.model;
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
      // O seletor ja mudou na tela; volta para o provedor que esta salvo.
      await loadSettings();
      notify(err instanceof Error ? err.message : "não foi possível configurar a análise local", "error");
    } finally {
      setLocalBusy(false);
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

  return (
    <section className="settings-page">
      <header className="page-head">
        <div>
          <h1>Configurações</h1>
          <p>Transcrição, análise por IA e o que fica guardado no servidor.</p>
        </div>
      </header>
      {error && <p className="error">{error}</p>}

      {!settings && <p className="muted">Carregando...</p>}

      {settings && (
        <>
          <div className="card">
            <div className="card-head">
              <h2>Modelos de transcrição</h2>
              <p className="hint">Modelos ggml do whisper. O modelo ativo vale para as próximas transcrições.</p>
            </div>
            <ul className="model-list">
              {models.map((model) => {
                const p = progress[model.name];
                const percent =
                  p && p.total > 0 ? Math.min(100, Math.round((p.received / p.total) * 100)) : 0;
                return (
                  <li key={model.name} className="model-item">
                    <label className="model-name">
                      <input
                        type="radio"
                        name="active-model"
                        checked={settings.whisper_model === model.path}
                        disabled={!model.downloaded}
                        onChange={() => void save({ whisper_model: model.path }, "Modelo ativo atualizado")}
                      />
                      <span>{model.name}</span>
                    </label>
                    <span className="muted">
                      ~{model.size_mb} MB{" "}
                      {model.downloaded ? `(${Math.round(model.local_bytes / 1048576)} MB baixados)` : "(ausente)"}
                    </span>
                    {!model.downloaded && (
                      <button
                        type="button"
                        className="button button--ghost button--small"
                        onClick={() => void download(model.name)}
                        disabled={p && !p.done}
                      >
                        {p && !p.done ? "Baixando..." : "Baixar"}
                      </button>
                    )}
                    {p && !p.done && (
                      <span className="ram-track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                        <span className="ram-fill" style={{ width: `${percent}%` }} />
                      </span>
                    )}
                    {p && p.error && <span className="error">Falha no download: {p.error}</span>}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Transcrição</h2>
              <p className="hint">Como o audio vira texto.</p>
            </div>
            <div className="field">
              <span className="field-label">Provedor</span>
              <select
                aria-label="Provedor de transcrição"
                value={settings.transcribe_provider}
                onChange={(event) => void save({ transcribe_provider: event.target.value })}
              >
                <option value="whisper">Whisper local</option>
                <option value="deepgram">Deepgram (API na nuvem)</option>
              </select>
            </div>
            {settings.transcribe_provider === "deepgram" && (
              <>
                <div className="field">
                  <span className="field-label">Modelo Deepgram</span>
                  <input
                    type="text"
                    aria-label="Modelo Deepgram"
                    defaultValue={settings.deepgram_model}
                    onBlur={(event) => void save({ deepgram_model: event.target.value })}
                  />
                </div>
                <div className="field">
                  <span className="field-label">Chave da Deepgram</span>
                  <div className="field-control">
                    <input
                      type="password"
                      aria-label="Chave da Deepgram"
                      placeholder={settings.deepgram_api_key_set ? "definida (deixe vazio para manter)" : "não definida"}
                      value={deepgramKey}
                      onChange={(event) => setDeepgramKey(event.target.value)}
                    />
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => {
                        if (deepgramKey.trim() !== "") {
                          void save({ deepgram_api_key: deepgramKey }, "Chave da Deepgram salva");
                          setDeepgramKey("");
                        }
                      }}
                    >
                      Salvar chave
                    </button>
                  </div>
                </div>
              </>
            )}
            <div className="field">
              <span className="field-label">Idioma</span>
              <select
                aria-label="Idioma da transcrição"
                value={settings.whisper_language}
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
            <div className="field">
              <span className="field-label">Corte de silêncio</span>
              <Toggle
                checked={settings.trim_silence}
                onChange={(value) => void save({ trim_silence: value })}
                label={settings.trim_silence ? "Ligado" : "Desligado"}
              />
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
                  className="button button--ghost button--small"
                  onClick={() => void save({ max_whisper_rss_mb: Math.max(0, Math.floor(Number(ceiling) || 0)) })}
                >
                  Salvar
                </button>
                <span className="hint">0 significa sem limite</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Autor</h2>
              <p className="hint">
                O nome que a IA e o centro do mapa usam. O interruptor vale para notas sem escolha manual;
                o seletor de cada nota sempre vence.
              </p>
            </div>
            <div className="field">
              <span className="field-label">Seu nome</span>
              <input
                type="text"
                aria-label="Seu nome"
                value={ownerName}
                maxLength={80}
                placeholder="Você"
                onChange={(event) => setOwnerName(event.target.value)}
                onBlur={() => {
                  const next = ownerName.trim();
                  if (next !== (settings.owner_name ?? "")) {
                    void save({ owner_name: next }, "Nome salvo");
                  }
                }}
              />
            </div>
            <div className="field">
              <span className="field-label">Todas as notas são minhas</span>
              <Toggle
                checked={settings.all_notes_mine}
                onChange={(value) => void save({ all_notes_mine: value })}
                label={settings.all_notes_mine ? "Ligado" : "Desligado"}
                ariaLabel="Todas as notas são minhas"
              />
              <span className="hint">
                Desligado, uma nota sem escolha manual fica sem autor. O seletor da nota sempre vence.
              </span>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Análise por IA</h2>
              <p className="hint">
                Escolha o provedor, cole a chave e selecione o modelo. A lista de modelos e buscada do provedor;
                use Personalizado para informar a base manualmente.
              </p>
            </div>
            <div className="field">
              <span className="field-label">Ativar análise</span>
              <Toggle
                checked={settings.analyze_enabled}
                onChange={(value) => void save({ analyze_enabled: value })}
                label={settings.analyze_enabled ? "Ligada" : "Desligada"}
              />
            </div>
            <div className="field">
              <span className="field-label">Revisar a transcrição com IA</span>
              <Toggle
                checked={settings.review_enabled}
                onChange={(value) => void save({ review_enabled: value })}
                label={settings.review_enabled ? "Ligada" : "Desligada"}
                ariaLabel="Revisar a transcrição com IA"
              />
              <span className="hint">
                Corrige concordância, pontuação e siglas antes de analisar. Desligada, a análise
                continua funcionando, mas perde precisão sobre o que foi falado. Vale só para este
                dashboard: a escolha no app é separada.
              </span>
            </div>
            {settings.review_enabled && (
              <div className="field">
                <span className="field-label">Transcrição literal</span>
                <Toggle
                  checked={settings.literal_transcript}
                  onChange={(value) => void save({ literal_transcript: value })}
                  label={settings.literal_transcript ? "Ligada" : "Desligada"}
                  ariaLabel="Transcrição literal"
                />
                <span className="hint">
                  Mantém hesitações ("éé", "hum") e repetições de gagueira, para quem quer acompanhar
                  como fala. Desligada, a revisão remove só o que não tem significado; "tipo", "né"
                  e gírias ficam sempre.
                </span>
              </div>
            )}
            <div className="field">
              <span className="field-label">Provedor</span>
              <select
                aria-label="Provedor da análise"
                value={provider}
                onChange={(event) => {
                  const value = event.target.value;
                  setProvider(value);
                  setProviderModels([]);
                  setModelsNote("");
                  const preset = PROVIDER_PRESETS[value];
                  if (value === "ollama" || value === "llamaLocal") {
                    // O runtime local ja se configura e baixa o modelo em um
                    // clique; nao salvar a base URL antes de o servico responder.
                    void installLocal(value === "llamaLocal" ? "embedded" : "ollama");
                  } else if (preset && value !== "custom") {
                    void save(
                      {
                        analyze_provider: preset.kind,
                        analyze_base_url: preset.baseUrl,
                        analyze_model: preset.model,
                        // Sair do runtime local: a base URL e o runtime antigos
                        // nao podem continuar valendo.
                        analyze_local_runtime: "",
                        // Escolher o provedor ja e a decisao de ligar a análise.
                        analyze_enabled: true,
                      },
                      "Provedor atualizado",
                    );
                  } else if (value === "custom") {
                    void save(
                      { analyze_provider: "openai", analyze_local_runtime: "" },
                      "Provedor atualizado",
                    );
                  }
                }}
              >
                {Object.entries(PROVIDER_PRESETS).map(([id, preset]) => (
                  <option key={id} value={id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>
            {localRuntime && (
              <div className="field">
                <span className="field-label">
                  {provider === "llamaLocal" ? "llama.cpp embutido" : "Ollama local"}
                </span>
                <div className="field-control">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void installLocal(localRuntime)}
                    disabled={localBusy}
                  >
                    {localBusy ? "Configurando..." : "Usar análise local"}
                  </button>
                  {currentLocal?.pull && !currentLocal.pull.done && !currentLocal.pull.error && (
                    <span
                      className="ram-track"
                      role="progressbar"
                      aria-valuenow={currentLocal.pull.percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <span className="ram-fill" style={{ width: `${currentLocal.pull.percent}%` }} />
                    </span>
                  )}
                </div>
                <span className="hint">
                  {currentLocal?.pull && !currentLocal.pull.done && !currentLocal.pull.error
                    ? `Baixando ${currentLocal.pull.model} (${currentLocal.pull.percent}%)...`
                    : localHint}
                </span>
                {currentLocal?.pull?.error && <span className="error">{currentLocal.pull.error}</span>}
              </div>
            )}
            {!localRuntime && (
              <div className="field">
                <span className="field-label">
                  {provider === "opencodeLocal" ? "Senha do opencode" : "Chave da API"}
                </span>
                <div className="field-control">
                  <input
                    type="password"
                    aria-label="Chave da API de análise"
                    placeholder={
                      settings.analyze_api_key_set
                        ? "definida (deixe vazio para manter)"
                        : provider === "opencodeLocal"
                          ? "senha de ~/.config/opencode/service.json"
                          : "cole a chave do provedor"
                    }
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => {
                      void (async () => {
                        if (apiKey.trim() !== "") {
                          await save({ analyze_api_key: apiKey }, "Chave salva");
                          setApiKey("");
                        }
                        if (searchable) {
                          await fetchModels();
                        }
                      })();
                    }}
                  >
                    Salvar chave
                  </button>
                </div>
                {provider === "opencodeLocal" && (
                  <span className="hint">
                    Usa o opencode ja logado na sua maquina. Informe a URL do servidor do opencode e a senha de
                    ~/.config/opencode/service.json. O modelo usa o formato provedor/modelo.
                  </span>
                )}
                {(provider === "opencodeZen" || provider === "opencodeGo") && (
                  <span className="hint">
                    Chave do OpenCode Console (opencode.ai/console).{" "}
                    {provider === "opencodeZen"
                      ? "Ha modelos gratuitos na lista."
                      : "A assinatura Go inclui os modelos listados."}
                  </span>
                )}
              </div>
            )}
            <div className="field">
              <span className="field-label">Modelo</span>
              <div className="field-control">
                <select
                  aria-label="Modelo da análise"
                  value={settings.analyze_model}
                  onChange={(event) => void save({ analyze_model: event.target.value }, "Modelo atualizado")}
                >
                  {settings.analyze_model === "" && <option value="">(nenhum)</option>}
                  {modelOptions.map((model) => (
                    <option key={model} value={model}>
                      {isReasoningModel(model) ? `${model} · raciocínio` : model}
                    </option>
                  ))}
                </select>
                {searchable && (
                  <button type="button" className="button button--ghost button--small" onClick={() => void fetchModels()}>
                    Buscar modelos
                  </button>
                )}
              </div>
              {modelsNote && <span className="hint">{modelsNote}</span>}
              {isReasoningModel(settings.analyze_model) && (
                <span className="hint">
                  Modelo de raciocínio: pensa antes de responder, demora mais e gasta mais tokens.
                  Um modelo comum entrega a mesma análise mais rápido.
                </span>
              )}
              {!searchable && !localRuntime && (
                <span className="hint">Lista curada de modelos compativeis; a lista completa esta no console.</span>
              )}
              {localRuntime && (
                <span className="hint">
                  {provider === "llamaLocal"
                    ? "Modelo GGUF executado pelo proprio servidor."
                    : "Modelo instalado no servico Ollama."}
                </span>
              )}
            </div>
            <div className="field">
              <span className="field-label">Base URL</span>
              <input
                key={settings.analyze_base_url}
                type="text"
                aria-label="Base URL da análise"
                defaultValue={settings.analyze_base_url}
                onBlur={(event) => void save({ analyze_base_url: event.target.value })}
              />
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
                  className="button button--ghost button--small"
                  onClick={() => void save({ analysis_themes: themes }, "Temas salvos")}
                >
                  Salvar
                </button>
              </div>
              <span className="hint">Temas preferidos na análise, separados por vírgulas.</span>
            </div>
          </div>

          <TrashSection refreshKey={refreshKey} />
        </>
      )}
    </section>
  );
}

export default SettingsView;
