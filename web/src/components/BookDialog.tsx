import { useEffect, useState } from "react";
import type { BookStatus, Notebook } from "../types";
import { NOTEBOOK_COLORS } from "../lib/notebooks";
import { countLabel } from "../lib/books";
import { useEscape } from "../lib/useEscape";

export interface BookForm {
  name: string;
  color: string;
  subtitle: string;
  author: string;
  synopsis: string;
  language: string;
  goal_words: number;
  book_status: BookStatus;
}

interface BookDialogProps {
  open: boolean;
  /** Ausente cria um livro novo; presente edita um caderno. */
  notebook?: Notebook;
  defaultAuthor?: string;
  chapterCount?: number;
  onClose: () => void;
  onSave: (form: BookForm) => void;
  onActivate?: (form: BookForm) => void;
  onDeactivate?: () => void;
  onMoveNotes?: (form: BookForm) => void;
  onDelete?: (confirmName: string) => void;
}

/** Modal do livro: criacao, metadados, ativacao no caderno e exclusao. */
export function BookDialog({
  open,
  notebook,
  defaultAuthor = "",
  chapterCount = 0,
  onClose,
  onSave,
  onActivate,
  onDeactivate,
  onMoveNotes,
  onDelete,
}: BookDialogProps) {
  const [form, setForm] = useState<BookForm>({
    name: "",
    color: "",
    subtitle: "",
    author: defaultAuthor,
    synopsis: "",
    language: "pt-BR",
    goal_words: 0,
    book_status: "drafting",
  });
  const [confirmName, setConfirmName] = useState("");

  useEffect(() => {
    if (!open) return;
    setConfirmName("");
    if (notebook) {
      setForm({
        name: notebook.name,
        color: notebook.color,
        subtitle: notebook.subtitle,
        author: notebook.author || defaultAuthor,
        synopsis: notebook.synopsis,
        language: notebook.language || "pt-BR",
        goal_words: notebook.goal_words,
        book_status: notebook.book_status,
      });
    } else {
      setForm({
        name: "",
        color: "",
        subtitle: "",
        author: defaultAuthor,
        synopsis: "",
        language: "pt-BR",
        goal_words: 0,
        book_status: "drafting",
      });
    }
  }, [open, notebook, defaultAuthor]);

  useEscape(open, onClose);
  if (!open) return null;

  const patch = (value: Partial<BookForm>) => setForm((current) => ({ ...current, ...value }));
  const save = () => {
    const name = form.name.trim();
    if (!name) return;
    onSave({ ...form, name });
  };
  const isNotes = notebook !== undefined && notebook.kind === "notes";
  const isBook = notebook?.kind === "book";
  const occupied = isNotes && notebook.entry_count > 0;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal-card book-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={notebook ? "Configurações do livro" : "Novo livro"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="modal-title">
          {isNotes ? "Modo escritor" : notebook ? "Configurações do livro" : "Novo livro"}
        </h2>

        {isNotes ? (
          <div className="state-card">
            <h3>{occupied ? "Caderno com notas" : "Caderno limpo"}</h3>
            <p className="state-sub">
              {occupied
                ? "O modo escritor não apaga nem converte notas sozinho."
                : "Um clique transforma o caderno vazio em livro."}
            </p>
            <div className="state-line">
              <span className="status-dot status-dot--draft" />
              <span>{notebook.name}</span>
              <span className="spacer" />
              <span className={occupied ? "state-toggle is-off" : "state-toggle"} aria-hidden="true" />
            </div>
            <div className="state-line">
              {occupied ? (
                <span className="state-locked">
                  {countLabel(notebook.entry_count, "nota ativa", "notas ativas")}
                </span>
              ) : (
                <span>Título do livro</span>
              )}
              <span className="spacer" />
              <b>{occupied ? "bloqueado" : form.name}</b>
            </div>
            <div className="state-line">
              <span>Autor</span>
              <span className="spacer" />
              <b>{form.author || defaultAuthor || "—"}</b>
            </div>
            <div className="state-line">
              <span>Meta de palavras</span>
              <span className="spacer" />
              <b>{form.goal_words > 0 ? form.goal_words.toLocaleString("pt-BR") : "—"}</b>
            </div>
            {occupied ? (
              <button
                type="button"
                className="button button--ghost state-action"
                onClick={() => onMoveNotes?.(form)}
              >
                Mover {countLabel(notebook.entry_count, "nota", "notas")} para Notas ao acaso
              </button>
            ) : (
              <button
                type="button"
                className="button button--primary state-action"
                onClick={() => onActivate?.(form)}
              >
                Criar livro
              </button>
            )}
            <p className="state-note">
              {occupied
                ? "Depois de mover, o interruptor liga. A lixeira não conta."
                : "O nome do caderno vira o título; o autor começa com o nome do dono do diário."}
            </p>
          </div>
        ) : null}

        {!isNotes ? (
        <>
        <div className="book-fields">
          <label className="modal-field">
            <span>Título</span>
            <input
              value={form.name}
              autoFocus
              maxLength={80}
              onChange={(event) => patch({ name: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") save();
              }}
            />
          </label>
          <label className="modal-field">
            <span>Subtítulo</span>
            <input value={form.subtitle} onChange={(event) => patch({ subtitle: event.target.value })} />
          </label>
          <label className="modal-field">
            <span>Autor</span>
            <input value={form.author} onChange={(event) => patch({ author: event.target.value })} />
          </label>
          <label className="modal-field">
            <span>Idioma</span>
            <input value={form.language} onChange={(event) => patch({ language: event.target.value })} />
          </label>
          <label className="modal-field">
            <span>Meta de palavras</span>
            <input
              type="number"
              min={0}
              value={form.goal_words || ""}
              onChange={(event) => patch({ goal_words: Math.max(0, Number(event.target.value) || 0) })}
              placeholder="sem meta"
            />
          </label>
          <label className="modal-field">
            <span>Estado</span>
            <select
              value={form.book_status}
              onChange={(event) => patch({ book_status: event.target.value as BookStatus })}
            >
              <option value="drafting">Rascunho</option>
              <option value="revising">Revisão</option>
              <option value="done">Final</option>
            </select>
          </label>
          <label className="modal-field book-field--wide">
            <span>Sinopse</span>
            <textarea
              rows={3}
              value={form.synopsis}
              onChange={(event) => patch({ synopsis: event.target.value })}
            />
          </label>
        </div>

        <div className="notebook-colors" aria-label="Cor do livro">
          {NOTEBOOK_COLORS.map((option) => (
            <button
              key={option || "neutral"}
              type="button"
              className={option === form.color ? "notebook-color notebook-color--on" : "notebook-color"}
              style={{ backgroundColor: option || "var(--color-surface-2)" }}
              onClick={() => patch({ color: option })}
              aria-label={option ? `Cor ${option}` : "Sem cor"}
              aria-pressed={option === form.color}
            />
          ))}
        </div>
        </>
        ) : null}

        {isBook ? (
          <div className="book-danger">
            <button
              type="button"
              className="button button--ghost"
              onClick={() => onDeactivate?.()}
            >
              {chapterCount > 0 ? "Converter em caderno comum" : "Desativar"}
            </button>
            <div className="book-delete">
              <input
                value={confirmName}
                onChange={(event) => setConfirmName(event.target.value)}
                placeholder="Digite o título"
                aria-label="Confirmar exclusão do livro"
              />
              <button
                type="button"
                className="button button--danger"
                disabled={confirmName.trim() !== notebook.name}
                onClick={() => onDelete?.(confirmName.trim())}
              >
                Excluir livro
              </button>
            </div>
          </div>
        ) : null}

        <div className="modal-actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancelar
          </button>
          {!isNotes ? (
            <button type="button" className="button" onClick={save} disabled={!form.name.trim()}>
              {notebook ? "Salvar" : "Criar livro"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
