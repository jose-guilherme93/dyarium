import { useEffect, useState } from "react";

import "./admin.css";
import "./settings.css";
import { formatBytes } from "../lib/format";
import { adminApiUrl } from "../lib/apiBase";

const ADMIN_KEY = "dyarium.admin";

interface DayRow {
  day: string;
  active: number;
  logins: number;
  new_accounts: number;
}

interface TodayRow {
  active: number;
  logins: number;
  new_accounts: number;
}

interface TotalsRow {
  accounts: number;
  installs: number;
  vaults: number;
  notes: number;
  bytes: number;
}

interface AccountRow {
  email: string;
  first_day: string;
  last_day: string;
  installs: number;
  notes: number;
  bytes: number;
  version: string;
  platform: string;
}

interface VersionRow {
  version: string;
  installs: number;
}

interface Stats {
  generated_at: string;
  days: DayRow[];
  today: TodayRow;
  totals: TotalsRow;
  accounts: AccountRow[];
  versions: VersionRow[];
}

function readKey(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_KEY);
  } catch {
    return null;
  }
}

function writeKey(value: string): void {
  try {
    sessionStorage.setItem(ADMIN_KEY, value);
  } catch {
    // ignora
  }
}

function clearKey(): void {
  try {
    sessionStorage.removeItem(ADMIN_KEY);
  } catch {
    // ignora
  }
}

function parseIsoDate(value: string): { y: string; m: string; d: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return { y: match[1], m: match[2], d: match[3] };
}

function shortDate(value: string): string {
  const iso = parseIsoDate(value);
  if (iso) return `${iso.d}/${iso.m}/${iso.y.slice(-2)}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function dayLabel(value: string): string {
  const iso = parseIsoDate(value);
  if (iso) return `${iso.d}/${iso.m}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

export function AdminView() {
  const [key, setKey] = useState<string | null>(() => readKey());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(adminApiUrl("/admin-api/stats?days=30"), {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (res.status === 401) {
          clearKey();
          if (!cancelled) {
            setKey(null);
            setError("Chave invalida.");
          }
          return;
        }
        if (!res.ok) {
          const text = await res.text();
          let body: { error?: string } = {};
          try {
            body = text ? JSON.parse(text) : {};
          } catch {
            body = {};
          }
          throw new Error(body?.error ?? (res.statusText || "falha ao carregar"));
        }
        const json = (await res.json()) as Stats;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "falha ao carregar");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [key, reload]);

  const entrar = () => {
    const value = input.trim();
    if (!value) return;
    writeKey(value);
    setError("");
    setKey(value);
    setInput("");
  };

  const sair = () => {
    clearKey();
    setKey(null);
    setData(null);
    setError("");
    setInput("");
  };

  const atualizar = () => {
    setReload((n) => n + 1);
  };

  const remover = async (email: string) => {
    if (!key) return;
    if (!window.confirm(`Remover ${email}? O historico anonimo fica.`)) return;
    setRemoving(email);
    try {
      const res = await fetch(adminApiUrl(`/admin-api/account?email=${encodeURIComponent(email)}`), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.status === 401) {
        clearKey();
        setKey(null);
        setError("Chave invalida.");
        return;
      }
      if (!res.ok) {
        const text = await res.text();
        let body: { error?: string } = {};
        try {
          body = text ? JSON.parse(text) : {};
        } catch {
          body = {};
        }
        throw new Error(body?.error ?? (res.statusText || "falha ao remover"));
      }
      const body = (await res.json()) as { removed?: boolean };
      if (body?.removed) atualizar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao remover");
    } finally {
      setRemoving(null);
    }
  };

  // ---- gate ----
  if (!key) {
    return (
      <main className="admin-page">
        <div className="admin-column">
          <header className="admin-head">
            <span className="admin-brand">dyarium</span>
            <span className="admin-label">admin</span>
          </header>
          <div className="admin-gate">
            <input
              type="password"
              aria-label="Chave"
              placeholder="Chave"
              autoComplete="off"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") entrar();
              }}
              autoFocus
            />
            <button type="button" className="cfg-btn cfg-btn--solid" onClick={entrar}>
              Entrar
            </button>
          </div>
          {error && (
            <p className="admin-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </main>
    );
  }

  // ---- loading ----
  if (loading && !data) {
    return (
      <main className="admin-page">
        <div className="admin-column">
          <header className="admin-head">
            <span className="admin-brand">dyarium</span>
            <span className="admin-label">admin</span>
            <div className="admin-head-actions">
              <button type="button" className="cfg-btn cfg-btn--quiet" onClick={atualizar}>
                atualizar
              </button>
              <button type="button" className="cfg-btn cfg-btn--quiet" onClick={sair}>
                sair
              </button>
            </div>
          </header>
          <p className="admin-loading">carregando…</p>
        </div>
      </main>
    );
  }

  // ---- error without data ----
  if (error && !data) {
    return (
      <main className="admin-page">
        <div className="admin-column">
          <header className="admin-head">
            <span className="admin-brand">dyarium</span>
            <span className="admin-label">admin</span>
            <div className="admin-head-actions">
              <button type="button" className="cfg-btn cfg-btn--quiet" onClick={atualizar}>
                atualizar
              </button>
              <button type="button" className="cfg-btn cfg-btn--quiet" onClick={sair}>
                sair
              </button>
            </div>
          </header>
          <p className="admin-error" role="alert">
            {error}
          </p>
        </div>
      </main>
    );
  }

  if (!data) return null;

  const isEmpty = data.totals.installs === 0 && data.totals.accounts === 0;

  const maxBar = Math.max(
    1,
    ...data.days.map((d) => Math.max(d.active, d.logins)),
  );

  return (
    <main className="admin-page">
      <div className="admin-column">
        <header className="admin-head">
          <span className="admin-brand">dyarium</span>
          <span className="admin-label">admin</span>
          <div className="admin-head-actions">
            <button type="button" className="cfg-btn cfg-btn--quiet" onClick={atualizar}>
              atualizar
            </button>
            <button type="button" className="cfg-btn cfg-btn--quiet" onClick={sair}>
              sair
            </button>
          </div>
        </header>

        {error && (
          <p className="admin-error" role="alert">
            {error}
          </p>
        )}

        {isEmpty ? (
          <p className="admin-empty">Sem dados ainda.</p>
        ) : (
          <>
            {/* Hoje */}
            <section className="admin-today">
              <div className="admin-num">
                <span className="admin-num-value">{data.today.active.toLocaleString("pt-BR")}</span>
                <span className="admin-num-legend">Ativos</span>
              </div>
              <div className="admin-num">
                <span className="admin-num-value">{data.today.logins.toLocaleString("pt-BR")}</span>
                <span className="admin-num-legend">Entraram</span>
              </div>
              <div className="admin-num">
                <span className="admin-num-value">{data.today.new_accounts.toLocaleString("pt-BR")}</span>
                <span className="admin-num-legend">Novas</span>
              </div>
              <div className="admin-num">
                <span className="admin-num-value">{data.totals.accounts.toLocaleString("pt-BR")}</span>
                <span className="admin-num-legend">Contas</span>
              </div>
            </section>

            {/* Grafico 30 dias */}
            <section className="admin-chart" aria-label="30 dias">
              <div className="admin-chart-bars">
                {data.days.map((d, i) => {
                  const activeH = (d.active / maxBar) * 100;
                  const loginH = (d.logins / maxBar) * 100;
                  const showLabel = i % 5 === 0 || i === data.days.length - 1;
                  return (
                    <div className="admin-chart-slot" key={d.day}>
                      <div className="admin-chart-pair">
                        <span
                          className="admin-chart-bar admin-chart-bar--active"
                          style={{ height: `${activeH}%` }}
                          title={`${d.day} — ativos ${d.active}, entraram ${d.logins}`}
                        />
                        <span
                          className="admin-chart-bar admin-chart-bar--login"
                          style={{ height: `${loginH}%` }}
                          title={`${d.day} — ativos ${d.active}, entraram ${d.logins}`}
                        />
                      </div>
                      {showLabel && <span className="admin-chart-label">{dayLabel(d.day)}</span>}
                    </div>
                  );
                })}
              </div>
              <div className="admin-chart-legend">
                <span>
                  <i className="admin-dot admin-dot--active" /> Ativos
                </span>
                <span>
                  <i className="admin-dot admin-dot--login" /> Entraram
                </span>
              </div>
            </section>

            {/* Ao todo */}
            <section className="admin-totals">
              <span>
                <b>{data.totals.installs.toLocaleString("pt-BR")}</b> Instalações
              </span>
              <span>
                <b>{data.totals.vaults.toLocaleString("pt-BR")}</b> Cofres
              </span>
              <span>
                <b>{data.totals.notes.toLocaleString("pt-BR")}</b> Notas nos cofres
              </span>
              <span>
                <b>{formatBytes(data.totals.bytes)}</b> Tamanho
              </span>
            </section>

            {/* Contas */}
            <section className="admin-accounts">
              <p className="admin-section-label">Contas</p>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>1º dia</th>
                      <th>Último</th>
                      <th>Navegadores</th>
                      <th>Notas</th>
                      <th>Tamanho</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.accounts.map((a) => (
                      <tr key={a.email}>
                        <td>{a.email}</td>
                        <td className="admin-mono">{shortDate(a.first_day)}</td>
                        <td className="admin-mono">{shortDate(a.last_day)}</td>
                        <td className="admin-mono">{a.installs.toLocaleString("pt-BR")}</td>
                        <td className="admin-mono">{a.notes.toLocaleString("pt-BR")}</td>
                        <td className="admin-mono">{formatBytes(a.bytes)}</td>
                        <td>
                          <button
                            type="button"
                            className="cfg-btn cfg-btn--quiet admin-remove"
                            disabled={removing === a.email}
                            onClick={() => void remover(a.email)}
                          >
                            remover
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Versoes */}
            <section className="admin-versions">
              <p className="admin-section-label">Versões</p>
              <ul className="admin-version-list">
                {data.versions.map((v) => (
                  <li key={v.version}>
                    <span>{v.version}</span>
                    <span className="admin-mono">{v.installs.toLocaleString("pt-BR")}</span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

export default AdminView;
