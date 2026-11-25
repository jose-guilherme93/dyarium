import { useState } from "react";

import { useEscape } from "../lib/useEscape";
import { startServerImport } from "../local/importJob";
import { CloseIcon } from "./icons";

interface ImportServerDialogProps {
  onClose: () => void;
}

/**
 * Traz o acervo de uma instancia self-hosted para o cofre do navegador.
 *
 * Endereco + token: o mesmo par que o usuario ja usa para entrar no servidor
 * dele. O token fica so nesta chamada. Quem importa e a tarefa em segundo
 * plano: este dialogo entrega o par e fecha na hora; a faixa da area das notas
 * conta o progresso e avisa o fim.
 */
export function ImportServerDialog({ onClose }: ImportServerDialogProps) {
  const [endereco, setEndereco] = useState("");
  const [token, setToken] = useState("");

  useEscape(true, onClose);

  const importar = () => {
    if (!endereco.trim() || !token.trim()) return;
    startServerImport(endereco, token);
    onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Importar de um servidor"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h2 className="modal-title">Importar de um servidor</h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Fechar"
            title="Fechar"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <p className="muted">As notas entram neste navegador com o mesmo id. Rodar de novo atualiza, não duplica.</p>

        <div className="modal-field">
          <label htmlFor="import-endereco">Endereço</label>
          <input
            id="import-endereco"
            type="text"
            value={endereco}
            onChange={(event) => setEndereco(event.target.value)}
            placeholder="https://diario.exemplo"
            autoComplete="off"
          />
        </div>

        <div className="modal-field">
          <label htmlFor="import-token">Token</label>
          <input
            id="import-token"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="o token da instância"
            autoComplete="off"
          />
        </div>

        <div className="modal-actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Fechar
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={importar}
            disabled={!endereco.trim() || !token.trim()}
          >
            Importar
          </button>
        </div>
      </div>
    </div>
  );
}
