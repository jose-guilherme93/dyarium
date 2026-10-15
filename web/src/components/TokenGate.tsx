import { useState } from "react";

interface TokenGateProps {
  onSubmit: (token: string) => void;
  error?: string;
  checking?: boolean;
}

// TokenGate asks for the bearer token once. The parent validates it against the
// API before letting the user in, so a wrong token keeps the gate open.
export function TokenGate({ onSubmit, error, checking = false }: TokenGateProps) {
  const [value, setValue] = useState("");
  return (
    <div className="token-gate">
      <div className="token-card">
        <h1>dyarium</h1>
        <p>Informe o token de acesso para continuar.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim() && !checking) {
              onSubmit(value.trim());
            }
          }}
        >
          <input
            type="password"
            aria-label="Token de acesso"
            placeholder="Token"
            value={value}
            disabled={checking}
            onChange={(event) => setValue(event.target.value)}
          />
          <button type="submit" disabled={checking}>
            {checking ? "Verificando..." : "Entrar"}
          </button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export default TokenGate;
