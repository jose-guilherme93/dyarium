import { useCallback, useEffect, useState } from "react";
import { api, getToken } from "../api";
import type { ModelInfo, Settings } from "../types";

interface DownloadProgress {
  received: number;
  total: number;
  done: boolean;
  error: string;
}

export function SettingsView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const [ceiling, setCeiling] = useState("0");
  const [apiKey, setApiKey] = useState("");
  const [deepgramKey, setDeepgramKey] = useState("");
  const [themes, setThemes] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadSettings = useCallback(async () => {
    const value = await api.getSettings();
    setSettings(value);
    setCeiling(String(value.max_whisper_rss_mb));
    setThemes(value.analysis_themes ?? "");
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

  const save = async (patch: Record<string, unknown>) => {
    try {
      await api.putSettings(patch);
      await loadSettings();
      setError("");
      setMessage("Configuracao salva.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao salvar");
    }
  };

  const download = async (name: string) => {
    try {
      await api.downloadModel(name);
      setProgress((current) => ({
        ...current,
        [name]: { received: 0, total: 0, done: false, error: "" },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao iniciar o download");
    }
  };

  const downloaded = models.filter((model) => model.downloaded);

  return (
    <section className="view">
      <div className="view-header">
        <h1>Configuracao</h1>
      </div>
      {error && <p className="error">{error}</p>}
      {message && <p className="ok">{message}</p>}

      {settings && (
        <>
          <div className="config-block">
            <h2>Modelos locais</h2>
            <p className="muted">
              Baixe os modelos ggml do whisper. O modelo ativo e usado nas proximas transcricoes.
            </p>
            <ul className="model-list">
              {models.map((model) => {
                const p = progress[model.name];
                const percent =
                  p && p.total > 0 ? Math.min(100, Math.round((p.received / p.total) * 100)) : 0;
                return (
                  <li key={model.name} className="model-item">
                    <div className="model-head">
                      <label className="model-name">
                        <input
                          type="radio"
                          name="active-model"
                          checked={settings.whisper_model === model.path}
                          disabled={!model.downloaded}
                          onChange={() => void save({ whisper_model: model.path })}
                        />
                        {model.name}
                      </label>
                      <span className="muted">
                        ~{model.size_mb} MB ·{" "}
                        {model.downloaded ? `baixado (${Math.round(model.local_bytes / 1048576)} MB)` : "ausente"}
                      </span>
                      {!model.downloaded && (
                        <button type="button" onClick={() => void download(model.name)} disabled={p && !p.done}>
                          Baixar
                        </button>
                      )}
                    </div>
                    {p && !p.done && (
                      <div className="ram-track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                        <div className="ram-fill" style={{ width: `${percent}%` }} />
                      </div>
                    )}
                    {p && p.error && <p className="error">Falha no download: {p.error}</p>}
                  </li>
                );
              })}
            </ul>
            <p className="muted">Modelo ativo: {settings.whisper_model}</p>
          </div>

          <div className="config-block">
            <h2>Transcricao</h2>
            <dl className="settings">
              <dt>Provedor</dt>
              <dd>
                <select
                  aria-label="Provedor de transcricao"
                  value={settings.transcribe_provider}
                  onChange={(event) => void save({ transcribe_provider: event.target.value })}
                >
                  <option value="whisper">Whisper local</option>
                  <option value="deepgram">Deepgram (API na nuvem)</option>
                </select>
              </dd>
              {settings.transcribe_provider === "deepgram" && (
                <>
                  <dt>Modelo Deepgram</dt>
                  <dd>
                    <input
                      type="text"
                      aria-label="Modelo Deepgram"
                      defaultValue={settings.deepgram_model}
                      onBlur={(event) => void save({ deepgram_model: event.target.value })}
                    />
                  </dd>
                  <dt>Chave da Deepgram</dt>
                  <dd className="ceiling">
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
                        void save({ deepgram_api_key: deepgramKey });
                        setDeepgramKey("");
                      }}
                    >
                      Salvar chave
                    </button>
                  </dd>
                </>
              )}
              <dt>Idioma da transcricao</dt>
              <dd>
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
              </dd>
              <dt>Corte de silencio</dt>
              <dd>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={settings.trim_silence}
                    onChange={() => void save({ trim_silence: !settings.trim_silence })}
                  />
                  {settings.trim_silence ? "Ligado" : "Desligado"}
                </label>
              </dd>
              <dt>Limite de RAM (MB)</dt>
              <dd className="ceiling">
                <input
                  type="number"
                  min={0}
                  aria-label="Limite de RAM da transcricao em MB"
                  value={ceiling}
                  onChange={(event) => setCeiling(event.target.value)}
                />
                <button type="button" onClick={() => void save({ max_whisper_rss_mb: Math.max(0, Math.floor(Number(ceiling) || 0)) })}>
                  Salvar
                </button>
                <span className="muted">0 significa sem limite</span>
              </dd>
            </dl>
          </div>

          <div className="config-block">
            <h2>Analise por IA (API compativel com OpenAI)</h2>
            <p className="muted">
              Funciona com Ollama local ou APIs pagas (OpenAI e compativeis). Informe a base, a chave e o modelo.
            </p>
            <dl className="settings">
              <dt>Ativar analise</dt>
              <dd>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={settings.analyze_enabled}
                    onChange={() => void save({ analyze_enabled: !settings.analyze_enabled })}
                  />
                  {settings.analyze_enabled ? "Ligada" : "Desligada"}
                </label>
              </dd>
              <dt>Base URL</dt>
              <dd>
                <input
                  type="text"
                  aria-label="Base URL da analise"
                  defaultValue={settings.analyze_base_url}
                  onBlur={(event) => void save({ analyze_base_url: event.target.value })}
                />
              </dd>
              <dt>Modelo</dt>
              <dd>
                <input
                  type="text"
                  aria-label="Modelo da analise"
                  defaultValue={settings.analyze_model}
                  onBlur={(event) => void save({ analyze_model: event.target.value })}
                />
              </dd>
              <dt>Temas</dt>
              <dd className="ceiling">
                <input
                  type="text"
                  aria-label="Temas da analise"
                  value={themes}
                  onChange={(event) => setThemes(event.target.value)}
                />
                <button type="button" onClick={() => void save({ analysis_themes: themes })}>
                  Salvar
                </button>
              </dd>
              <dt />
              <dd className="muted">Temas preferidos na analise, separados por virgulas.</dd>
              <dt>Chave da API</dt>
              <dd className="ceiling">
                <input
                  type="password"
                  aria-label="Chave da API de analise"
                  placeholder={settings.analyze_api_key_set ? "definida (deixe vazio para manter)" : "nao definida"}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => {
                    void save({ analyze_api_key: apiKey });
                    setApiKey("");
                  }}
                >
                  Salvar chave
                </button>
              </dd>
            </dl>
          </div>
        </>
      )}

      {!settings && <p className="muted">Carregando...</p>}
      {settings && downloaded.length === 0 && <p className="muted">Nenhum modelo baixado ainda.</p>}
    </section>
  );
}

export default SettingsView;
