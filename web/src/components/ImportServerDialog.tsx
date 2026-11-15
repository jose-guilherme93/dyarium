import { useState } from "react";

import { useEscape } from "../lib/useEscape";
import { importEntries, type ImportProgress, type ImportResult } from "../local/import";
import { serverSource } from "../local/serverSource";
import { CloseIcon } from "./icons";

interface ImportServerDialogProps {
  onClose: () => void;
  /** Chamado quando algo entrou no cofre, para a lista recarregar. */
  onImported: () => void;
}

/**
 * Traz o acervo de uma instancia self-hosted para o cofre do navegador.
 *
 * Endereco + token: o mesmo par que o usuario ja usa para entrar no servidor
 * dele. Nada sai daqui; o token fica so nesta chamada.
 */
export function ImportServerDialog({ onClose, onImported }: ImportServerDialogProps) {
  const [endereco, setEndereco] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [progresso, setProgresso] = useState<ImportProgress | null>(null);
  const [resultado, setResultado] = useState<ImportResult | null>(null);
  const [erro, setErro] = useState("");

  useEscape(true, onClose);

  const importar = async () => {
    setBusy(true);
    setErro("");
    setResultado(null);
    setProgresso(null);
    try {
      const resumo = await importEntries(serverSource(endereco, token), setProgresso);
      setResultado(resumo);
      if (resumo.created + resumo.updated + resumo.trashed > 0) onImported();
    } catch (error) {
      // CORS fechado, token errado ou servidor fora do ar caem todos aqui.
      setErro(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={busy ? undefined : onClose}>
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
            disabled={busy}
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
            disabled={busy}
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
            disabled={busy}
          />
        </div>

        {progresso && (
          <p className="muted">
            {progresso.done} de {progresso.total}
          </p>
        )}
        {resultado && (
          <p>
            {resultado.created} novas · {resultado.updated} atualizadas · {resultado.trashed} na lixeira
          </p>
        )}
        {erro && <p className="error">{erro}</p>}

        <div className="modal-actions">
          <button type="button" className="button button--ghost" onClick={onClose} disabled={busy}>
            Fechar
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void importar()}
            disabled={busy || !endereco.trim() || !token.trim()}
          >
            {busy ? "Importando..." : "Importar"}
          </button>
        </div>
      </div>
    </div>
  );
}
