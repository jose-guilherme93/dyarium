import { useState } from "react";

interface TokenGateProps {
  onSubmit: (token: string) => void;
}

// TokenGate asks for the bearer token once and stores it locally.
export function TokenGate({ onSubmit }: TokenGateProps) {
  const [value, setValue] = useState("");
  return (
    <div className="token-gate">
      <div className="token-card">
        <h1>dyarium</h1>
        <p>Informe o token de acesso para continuar.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim()) {
              onSubmit(value.trim());
            }
          }}
        >
          <input
            type="password"
            aria-label="Token de acesso"
            placeholder="Token"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <button type="submit">Entrar</button>
        </form>
      </div>
    </div>
  );
}

export default TokenGate;
