import { useCallback, useEffect, useMemo, useState } from "react";
import { api, getToken } from "../api";
import { Toggle } from "../components/Toggle";
import { useToast } from "../components/Toasts";
import type { ModelInfo, Settings } from "../types";

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

const OPENCODE_MODELS = [
  "opencode-go/qwen3.8-flash",
  "opencode-go/glm-5.3-flash",
  "opencode-go/claude-haiku-5-5",
  "opencode-go/gpt-6-luna",
  "deepseek/deepseek-chat",
];

const FALLBACK_MODELS: Record<string, string[]> = {
  opencodeLocal: OPENCODE_MODELS,
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  ollama: [],
  custom: [],
};

function providerFromSettings(kind: string, baseUrl: string): string {
  if (kind === "opencode") {
    return "opencodeLocal";
  }
  if (baseUrl.includes("deepseek")) {
    return "deepseek";
  }
  if (baseUrl.includes("ollama") || baseUrl.includes("11434")) {
    return "ollama";
  }
  return "custom";
}

export function SettingsView() {
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
  const [error, setError] = useState("");

  const modelOptions = useMemo(() => {
    const fallback = FALLBACK_MODELS[provider] ?? [];
    const list = providerModels.length > 0 ? providerModels : fallback;
    const current = settings?.analyze_model ?? "";
    return [...new Set([...list, current])].filter((model) => model !== "");
  }, [provider, providerModels, settings?.analyze_model]);

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

  useEffect(() => {
    loadSettings().catch((err: unknown) => setError(err instanceof Error ? err.message : "falha ao carregar"));
    loadModels().catch((err: unknown) => setError(err instanceof Error ? err.message : "falha ao carregar"));
  }, [loadSettings, loadModels]);

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

  const save = async (patch: Record<string, unknown>, message = "Configuracao salva") => {
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
    if (settings?.analyze_base_url) {
      void fetchModels();
    }
  }, [settings?.analyze_base_url, fetchModels]);

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
      <div className="view-header">
        <h1>Configuracao</h1>
      </div>
      {error && <p className="error">{error}</p>}

      {!settings && <p className="muted">Carregando...</p>}

      {settings && (
        <>
          <div className="card">
            <div className="card-head">
              <h2>Modelos de transcricao</h2>
              <p className="hint">Modelos ggml do whisper. O modelo ativo vale para as proximas transcricoes.</p>
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
                      <button type="button" onClick={() => void download(model.name)} disabled={p && !p.done}>
                        Baixar
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
              <h2>Transcricao</h2>
              <p className="hint">Como o audio vira texto.</p>
            </div>
            <div className="field">
              <span className="field-label">Provedor</span>
              <select
                aria-label="Provedor de transcricao"
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
                      placeholder={settings.deepgram_api_key_set ? "definida (deixe vazio para manter)" : "nao definida"}
                      value={deepgramKey}
                      onChange={(event) => setDeepgramKey(event.target.value)}
                    />
                    <button
                      type="button"
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
                aria-label="Idioma da transcricao"
                value={settings.whisper_language}
                onChange={(event) => void save({ whisper_language: event.target.value })}
              >
                <option value="">Detectar automaticamente</option>
                <option value="pt">Portugues</option>
                <option value="en">Ingles</option>
                <option value="es">Espanhol</option>
                <option value="fr">Frances</option>
                <option value="de">Alemao</option>
                <option value="it">Italiano</option>
                <option value="ja">Japones</option>
                <option value="zh">Chines</option>
                <option value="ru">Russo</option>
                <option value="ar">Arabe</option>
                <option value="hi">Hindi</option>
              </select>
            </div>
            <div className="field">
              <span className="field-label">Corte de silencio</span>
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
                  aria-label="Limite de RAM da transcricao em MB"
                  value={ceiling}
                  onChange={(event) => setCeiling(event.target.value)}
                />
                <button
                  type="button"
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
              <h2>Analise por IA</h2>
              <p className="hint">
                Escolha o provedor, cole a chave e selecione o modelo. A lista de modelos e buscada do provedor;
                use Personalizado para informar a base manualmente.
              </p>
            </div>
            <div className="field">
              <span className="field-label">Ativar analise</span>
              <Toggle
                checked={settings.analyze_enabled}
                onChange={(value) => void save({ analyze_enabled: value })}
                label={settings.analyze_enabled ? "Ligada" : "Desligada"}
              />
            </div>
            <div className="field">
              <span className="field-label">Provedor</span>
              <select
                aria-label="Provedor da analise"
                value={provider}
                onChange={(event) => {
                  const value = event.target.value;
                  setProvider(value);
                  const preset = PROVIDER_PRESETS[value];
                  if (preset && value !== "custom") {
                    void save(
                      { analyze_provider: preset.kind, analyze_base_url: preset.baseUrl, analyze_model: preset.model },
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
            <div className="field">
              <span className="field-label">{provider === "opencodeLocal" ? "Senha do opencode" : "Chave da API"}</span>
              <div className="field-control">
                <input
                  type="password"
                  aria-label="Chave da API de analise"
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
                  onClick={() => {
                    void (async () => {
                      if (apiKey.trim() !== "") {
                        await save({ analyze_api_key: apiKey }, "Chave salva");
                        setApiKey("");
                      }
                      await fetchModels();
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
            </div>
            <div className="field">
              <span className="field-label">Modelo</span>
              <div className="field-control">
                <select
                  aria-label="Modelo da analise"
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
                <button type="button" onClick={() => void fetchModels()}>
                  Buscar modelos
                </button>
              </div>
              {modelsNote && <span className="hint">{modelsNote}</span>}
            </div>
            <div className="field">
              <span className="field-label">Base URL</span>
              <input
                key={settings.analyze_base_url}
                type="text"
                aria-label="Base URL da analise"
                defaultValue={settings.analyze_base_url}
                onBlur={(event) => void save({ analyze_base_url: event.target.value })}
              />
            </div>
            <div className="field">
              <span className="field-label">Temas</span>
              <div className="field-control">
                <input
                  type="text"
                  aria-label="Temas da analise"
                  value={themes}
                  onChange={(event) => setThemes(event.target.value)}
                />
                <button type="button" onClick={() => void save({ analysis_themes: themes }, "Temas salvos")}>
                  Salvar
                </button>
              </div>
              <span className="hint">Temas preferidos na analise, separados por virgulas.</span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export default SettingsView;
