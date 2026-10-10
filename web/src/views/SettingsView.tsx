import { useEffect, useState } from "react";
import { api } from "../api";
import type { Settings } from "../types";

export function SettingsView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "falha ao carregar"));
  }, []);

  const toggleTrim = async () => {
    if (!settings) {
      return;
    }
    const next = { ...settings, trim_silence: !settings.trim_silence };
    setSettings(next);
    try {
      await api.putSettings({ trim_silence: next.trim_silence });
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao salvar");
    }
  };

  return (
    <section className="view">
      <div className="view-header">
        <h1>Configuracao</h1>
      </div>
      {error && <p className="error">{error}</p>}
      {settings ? (
        <dl className="settings">
          <dt>Modelo de transcricao</dt>
          <dd>{settings.whisper_model}</dd>
          <dt>Corte de silencio na transcricao</dt>
          <dd>
            <label className="switch">
              <input type="checkbox" checked={settings.trim_silence} onChange={toggleTrim} />
              {settings.trim_silence ? "Ligado" : "Desligado"}
            </label>
          </dd>
          <dt>Analise por IA</dt>
          <dd>{settings.analyze_enabled ? "Ligada" : "Desligada"}</dd>
          <dt>Base da analise</dt>
          <dd>{settings.analyze_base_url || "(nao definida)"}</dd>
          <dt>Modelo da analise</dt>
          <dd>{settings.analyze_model || "(nao definido)"}</dd>
        </dl>
      ) : (
        <p className="muted">Carregando...</p>
      )}
    </section>
  );
}

export default SettingsView;
