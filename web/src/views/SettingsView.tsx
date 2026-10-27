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
    model: "deepseek-v4.1-flash-free",
    kind: "openai",
  },
  opencodeGo: {
    label: "OpenCode Go (assinatura)",
    baseUrl: "https://opencode.ai/inference/go/openai/v1",
    model: "deepseek-v4.1-flash",
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
  custom: { label: "Personalizado", baseUrl: "", model: "", kind: "openai" },
};

// A análise fala o formato /chat/completions. No OpenCode, Claude, GPT, Gemini
// e Grok usam outros formatos (Anthropic, Responses, Google), entao so entram
// na lista os modelos que o cliente sabe chamar.
const ZEN_MODELS = [
  "deepseek-v4.1-flash-free",
  "glm-5.3-flash-free",
  "space-bunny-free",
  "glm-5.3-flash",
  "deepseek-v4.1-flash",
  "qwen3.8-max",
  "kimi-k2.7-code",
  "minimax-m3",
];

const GO_MODELS = [
  "deepseek-v4.1-flash",
  "deepseek-v4-pro",
  "glm-5.3-flash",
  "glm-5.3",
  "kimi-k2.7-code",
  "longcat-2.0",
  "space-bunny",
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
  ollama: [],
  custom: [],
};

function providerFromSettings(kind: string, baseUrl: string): string {
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
  return provider !== "opencodeZen" && provider !== "opencodeGo";
}

export function SettingsView({ refreshKey = 0 }: { refreshKey?: number }) {
  const { notify } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
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
  const modelOptions = useMemo(() => {
    const fallback = provider === "ollama"
      ? (local?.models?.length ? local.models : local?.model ? [local.model] : [])
      : FALLBACK_MODELS[provider] ?? [];
    const remote = provider !== "ollama" && searchable ? providerModels : [];
    const list = remote.length > 0 ? remote : fallback;
    const current = settings?.analyze_model ?? "";
    return [...new Set([...list, current])].filter((model) => model !== "");
  }, [provider, providerModels, settings?.analyze_model, local, searchable]);

  const loadSettings = useCallback(async () => {
    const value = await api.getSettings();
    setSettings(value);
    setCeiling(String(value.max_whisper_rss_mb));
    setThemes(value.analysis_themes ?? "");
    setProvider(providerFromSettings(value.analyze_provider, value.analyze_base_url));
  }, []);

  const loadModels = useCallback(async () => {
    const result = await api.listModels();
    setModels(result.models ?? []);
  }, []);

  const loadLocal = useCallback(async () => {
    try {
      setLocal(await api.getLocalAnalysis());
    } catch {
      setLocal(null);
    }
  }, []);

  useEffect(() => {
    loadSettings().catch((err: unknown) => setError(err instanceof Error ? err.message : "falha ao carregar"));
    loadModels().catch((err: unknown) => setError(err instanceof Error ? err.message : "falha ao carregar"));
    void loadLocal();
  }, [loadSettings, loadModels, loadLocal]);

  useEffect(() => {
    if (provider === "ollama") {
      void loadLocal();
    }
  }, [provider, loadLocal]);

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
  const pulling = Boolean(local?.pull && !local.pull.done && !local.pull.error);
  useEffect(() => {
    if (!pulling) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadLocal();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [pulling, loadLocal]);

  const pullDone = Boolean(local?.pull?.done && !local.pull?.error);
  useEffect(() => {
    if (pullDone) {
      void loadSettings();
    }
  }, [pullDone, loadSettings]);

  /** Um clique: configura o Ollama local e baixa o modelo se ainda faltar. */
  const installLocal = async () => {
    const model = settings?.analyze_model?.trim() || local?.model || "";
    setLocalBusy(true);
    try {
      const result = await api.setupLocalAnalysis(model);
      setProvider("ollama");
      await Promise.all([loadSettings(), loadLocal()]);
      notify(
        result.status === "ready"
          ? "Ollama configurado"
          : `Baixando ${result.model} em segundo plano`,
        result.status === "ready" ? "success" : "info",
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : "não foi possível configurar o Ollama", "error");
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
                  if (preset && value !== "custom") {
                    void save(
                      {
                        analyze_provider: preset.kind,
                        analyze_base_url: preset.baseUrl,
                        analyze_model: preset.model,
                        // Escolher o provedor ja e a decisao de ligar a análise.
                        analyze_enabled: true,
                      },
                      "Provedor atualizado",
                    );
                  } else if (value === "custom") {
                    void save({ analyze_provider: "openai" }, "Provedor atualizado");
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
            {provider === "ollama" && (
              <div className="field">
                <span className="field-label">Ollama local</span>
                <div className="field-control">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void installLocal()}
                    disabled={localBusy}
                  >
                    {localBusy ? "Configurando..." : "Instalar e usar o Ollama local"}
                  </button>
                  {local?.pull && !local.pull.done && !local.pull.error && (
                    <span
                      className="ram-track"
                      role="progressbar"
                      aria-valuenow={local.pull.percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <span className="ram-fill" style={{ width: `${local.pull.percent}%` }} />
                    </span>
                  )}
                </div>
                <span className="hint">
                  {local
                    ? local.available
                      ? local.pull && !local.pull.done && !local.pull.error
                        ? `Baixando ${local.pull.model} (${local.pull.percent}%)...`
                        : `Ollama no ar em ${local.base_url}, com ${local.models.length} modelo(s) instalado(s).`
                      : `Ollama não encontrado em ${local.base_url}. Suba o servico local (make ai) e tente de novo.`
                    : "Verificando o Ollama local..."}
                </span>
                {local?.pull?.error && <span className="error">{local.pull.error}</span>}
              </div>
            )}
            {provider !== "ollama" && (
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
                      {model}
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
              {!searchable && (
                <span className="hint">Lista curada de modelos compativeis; a lista completa esta no console.</span>
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
