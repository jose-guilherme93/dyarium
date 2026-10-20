import { useEffect, useState } from "react";
import { NOTEBOOK_COLORS } from "../lib/notebooks";

interface NotebookDialogProps {
  open: boolean;
  title: string;
  initialName?: string;
  initialColor?: string;
  onClose: () => void;
  onSave: (input: { name: string; color: string }) => void;
}

/** Modal de criar/renomear/recolorir caderno. */
export function NotebookDialog({
  open,
  title,
  initialName = "",
  initialColor = "",
  onClose,
  onSave,
}: NotebookDialogProps) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setColor(initialColor);
  }, [open, initialName, initialColor]);

  if (!open) return null;

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave({ name: trimmed, color });
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal-card notebook-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="modal-title">{title}</h2>
        <label className="modal-field">
          <span>Nome</span>
          <input
            value={name}
            autoFocus
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") save();
              if (event.key === "Escape") onClose();
            }}
            placeholder="Nome do caderno"
          />
        </label>
        <div className="notebook-colors" aria-label="Cor do caderno">
          {NOTEBOOK_COLORS.map((option) => (
            <button
              key={option || "neutral"}
              type="button"
              className={option === color ? "notebook-color notebook-color--on" : "notebook-color"}
              style={{ backgroundColor: option || "var(--color-surface-2)" }}
              onClick={() => setColor(option)}
              aria-label={option ? `Cor ${option}` : "Sem cor"}
              aria-pressed={option === color}
            />
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="button" onClick={save} disabled={!name.trim()}>
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
