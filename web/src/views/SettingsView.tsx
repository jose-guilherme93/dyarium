import { useEffect, useState } from "react";
import { api } from "../api";
import type { Settings } from "../types";

export function SettingsView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ceiling, setCeiling] = useState("0");
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .getSettings()
      .then((value) => {
        setSettings(value);
        setCeiling(String(value.max_whisper_rss_mb));
      })
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

  const saveCeiling = async () => {
    const value = Math.max(0, Math.floor(Number(ceiling) || 0));
    try {
      await api.putSettings({ max_whisper_rss_mb: value });
      setCeiling(String(value));
      setSettings((current) => (current ? { ...current, max_whisper_rss_mb: value } : current));
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

          <dt>Limite de RAM da transcricao (MB)</dt>
          <dd className="ceiling">
            <input
              type="number"
              min={0}
              aria-label="Limite de RAM da transcricao em MB"
              value={ceiling}
              onChange={(event) => setCeiling(event.target.value)}
            />
            <button type="button" onClick={saveCeiling}>
              Salvar
            </button>
            <span className="muted">0 significa sem limite</span>
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
