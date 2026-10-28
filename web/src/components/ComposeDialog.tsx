import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, uploadFile } from "../api";
import { useEscape } from "../lib/useEscape";
import { ImportIcon, MicIcon, WritingIcon } from "./icons";
import { Recorder } from "./Recorder";

/** Retangulo do botao que abriu o popover, em coordenadas de viewport. */
export interface ComposeAnchor {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface ComposeDialogProps {
  open: boolean;
  /**
   * Botao de origem. O popover abre logo abaixo dele, alinhado a sua borda
   * direita, para o mouse nao atravessar a tela ate o centro.
   */
  anchor?: ComposeAnchor | null;
  /** Caderno escolhido na coluna; sem ele, a nota fica no caderno padrao. */
  notebookId?: string;
  onClose: () => void;
  onCreateText: () => void;
  onImport: () => void;
  onCreated: (entryId: string) => void;
}

interface PopoverPlace {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

/**
 * Popover de criacao ancorado no botao "+": texto abre uma pagina em branco;
 * audio grava no navegador ou recebe um arquivo. O audio novo nasce no caderno
 * escolhido na coluna, como no app, em vez de cair sempre no caderno padrao.
 */
export function ComposeDialog({
  open,
  anchor,
  notebookId,
  onClose,
  onCreateText,
  onImport,
  onCreated,
}: ComposeDialogProps) {
  const [stage, setStage] = useState<"choose" | "audio">("choose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [place, setPlace] = useState<PopoverPlace | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setStage("choose");
    setBusy(false);
    setError("");
  }, [open]);

  // A posicao vem do botao que abriu o popover. O alinhamento a direita mantem
  // o menu dentro da coluna; em telas estreitas ele encosta na margem.
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const position = () => {
      const margin = 8;
      const width = Math.min(280, window.innerWidth - margin * 2);
      let left = anchor ? anchor.right - width : margin;
      if (left + width > window.innerWidth - margin) {
        left = window.innerWidth - margin - width;
      }
      left = Math.max(margin, left);
      const top = anchor ? Math.round(anchor.bottom + 6) : 64;
      setPlace({
        left,
        top,
        width,
        maxHeight: Math.max(180, window.innerHeight - top - margin),
      });
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [open, anchor]);

  useEscape(open, onClose);

  if (!open || !place) return null;

  const moveToNotebook = async (entryId: string) => {
    if (!notebookId) return;
    try {
      await api.patchEntry(entryId, { notebook_id: notebookId });
    } catch (err) {
      console.warn("[dyarium] falha ao mover o audio para o caderno", err);
    }
  };

  const submitFile = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const result = await uploadFile(file);
      await moveToNotebook(result.entry_id);
      onCreated(result.entry_id);
    } catch {
      setError("Não foi possível enviar o áudio.");
    } finally {
      setBusy(false);
    }
  };

  const uploaded = async (entryId: string) => {
    await moveToNotebook(entryId);
    onCreated(entryId);
  };

  return (
    <div className="compose-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="compose-card compose-popover"
        style={{
          left: place.left,
          top: place.top,
          width: place.width,
          maxHeight: place.maxHeight,
        }}
        role="dialog"
        aria-modal="true"
        aria-label={stage === "choose" ? "Nova nota" : "Nova nota de áudio"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {stage === "choose" ? (
          <>
            <h2 className="modal-title compose-title">Nova nota</h2>
            <div className="compose-menu">
              <button type="button" className="compose-option" onClick={onCreateText} autoFocus>
                <span className="compose-icon">
                  <WritingIcon size={16} />
                </span>
                <span className="compose-copy">
                  <span className="compose-label">Texto</span>
                  <span className="compose-desc">Página em branco</span>
                </span>
              </button>
              <button type="button" className="compose-option" onClick={() => setStage("audio")}>
                <span className="compose-icon">
                  <MicIcon size={16} />
                </span>
                <span className="compose-copy">
                  <span className="compose-label">Áudio</span>
                  <span className="compose-desc">Gravar ou enviar um arquivo</span>
                </span>
              </button>
              <button type="button" className="compose-option" onClick={onImport}>
                <span className="compose-icon">
                  <ImportIcon size={16} />
                </span>
                <span className="compose-copy">
                  <span className="compose-label">Notion</span>
                  <span className="compose-desc">Importar exportação HTML</span>
                </span>
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="compose-head">
              <button
                type="button"
                className="icon-button"
                onClick={() => setStage("choose")}
                aria-label="Voltar"
                title="Voltar"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m14 6-6 6 6 6" />
                </svg>
              </button>
              <h2 className="modal-title">Nova nota de áudio</h2>
            </div>
            <p className="compose-hint">O áudio vira uma nota e é transcrito depois.</p>
            <Recorder onUploaded={(entryId) => void uploaded(entryId)} />
            <div className="compose-or" role="presentation">
              <span>ou</span>
            </div>
            <button
              type="button"
              className="button button--ghost compose-file"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              {busy ? "Enviando..." : "Escolher um arquivo"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              hidden
              aria-label="Escolher arquivo de áudio"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void submitFile(file);
              }}
            />
            {error && <p className="error compose-error">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="button button--ghost" onClick={onClose}>
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ComposeDialog;
