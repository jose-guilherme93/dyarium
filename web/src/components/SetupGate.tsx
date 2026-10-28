import { useState, type FormEvent } from "react";
import { claimSetup } from "../api";

interface SetupGateProps {
  onDone: (token: string) => void;
}

// SetupGate is the first-run wizard: it shows once, while the instance has no
// token yet, and lets the operator choose the access token.
export function SetupGate({ onDone }: SetupGateProps) {
  const [token, setToken] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = token.trim();
    if (value.length < 8) {
      setError("O token precisa ter ao menos 8 caracteres.");
      return;
    }
    if (value !== confirm.trim()) {
      setError("Os tokens nao coincidem.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await claimSetup(value);
      onDone(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nao foi possivel salvar o token.");
      setBusy(false);
    }
  };

  return (
    <div className="token-gate">
      <div className="token-card">
        <div>
          <h1>dyarium</h1>
          <p>
            Bem-vindo. Defina o token que protege este diario. Voce vai usa-lo para entrar
            aqui e no app do celular.
          </p>
        </div>
        <form onSubmit={submit}>
          <label htmlFor="setup-token">Token de acesso</label>
          <input
            id="setup-token"
            type="password"
            autoComplete="new-password"
            aria-label="Token de acesso"
            placeholder="Ao menos 8 caracteres"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            disabled={busy}
          />
          <label htmlFor="setup-confirm">Confirme o token</label>
          <input
            id="setup-confirm"
            type="password"
            autoComplete="new-password"
            aria-label="Confirme o token"
            placeholder="Repita o token"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            disabled={busy}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? "Salvando..." : "Criar token e entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default SetupGate;
