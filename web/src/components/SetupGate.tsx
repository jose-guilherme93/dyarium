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
      setError("Use ao menos 8 caracteres.");
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
      setError(err instanceof Error ? err.message : "Falha ao configurar.");
      setBusy(false);
    }
  };

  return (
    <div className="token-gate">
      <div className="token-card">
        <h1>dyarium</h1>
        <p>Primeiro acesso: defina o token que protege este diario.</p>
        <form onSubmit={submit}>
          <input
            type="password"
            aria-label="Token de acesso"
            placeholder="Escolha um token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <input
            type="password"
            aria-label="Confirme o token"
            placeholder="Repita o token"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
          {error && <p role="alert">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? "Salvando..." : "Comecar"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default SetupGate;
