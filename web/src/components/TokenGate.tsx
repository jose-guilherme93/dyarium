import { useState, type FormEvent } from "react";

interface TokenGateProps {
  onSubmit: (token: string) => void;
}

// TokenGate asks for the bearer token once and stores it locally.
export function TokenGate({ onSubmit }: TokenGateProps) {
  const [value, setValue] = useState("");

  return (
    <div className="token-gate">
      <div className="token-card">
        <div>
          <h1 className="token-card__brand">dyarium</h1>
          <p className="token-card__lead">Informe o token de acesso para continuar.</p>
        </div>
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (value.trim()) {
              onSubmit(value.trim());
            }
          }}
        >
          <div className="token-field">
            <label htmlFor="login-token">Token de acesso</label>
            <input
              id="login-token"
              type="password"
              autoComplete="current-password"
              placeholder="Token"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          <button type="submit" className="token-submit">
            Entrar
          </button>
        </form>
      </div>
    </div>
  );
}

export default TokenGate;
