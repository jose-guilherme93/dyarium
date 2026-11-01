import { useEffect, useState } from "react";
import type { BookStatus, Notebook, PageSize } from "../types";
import { NOTEBOOK_COLORS } from "../lib/notebooks";
import { PAGE_SIZE_ORDER, PAGE_SIZES, bookPage, countLabel } from "../lib/books";
import { BOOK_FONTS, BOOK_FONT_ORDER, bookFont, type BookFontId } from "../lib/bookFonts";
import { CoverEditor } from "./CoverEditor";
import { coverUrl } from "../api";
import { useEscape } from "../lib/useEscape";
import { ChevronIcon } from "./icons";

export interface BookForm {
  name: string;
  color: string;
  subtitle: string;
  author: string;
  synopsis: string;
  language: string;
  goal_words: number;
  book_status: BookStatus;
  page_size: PageSize;
  page_margin_mm: number;
  body_px: number;
  body_leading: number;
  body_font: BookFontId;
  daily_goal_words: number;
  deadline: string;
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
  onCoverSave?: (image: Blob) => Promise<void>;
  onCoverRemove?: () => Promise<void>;
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
  onCoverSave,
  onCoverRemove,
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
    page_size: "14x21",
    page_margin_mm: 19,
    body_px: 18,
    body_leading: 160,
    body_font: "newsreader",
    daily_goal_words: 0,
    deadline: "",
  });
  const [confirmName, setConfirmName] = useState("");
  const [dangerOpen, setDangerOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConfirmName("");
    setDangerOpen(false);
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
        page_size: notebook.page_size ?? "14x21",
        page_margin_mm: notebook.page_margin_mm ?? 19,
        body_px: notebook.body_px ?? 18,
        body_leading: notebook.body_leading ?? 160,
        body_font: notebook.body_font ?? "newsreader",
        daily_goal_words: notebook.daily_goal_words ?? 0,
        deadline: notebook.deadline ?? "",
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
        page_size: "14x21",
        page_margin_mm: 19,
        body_px: 18,
        body_leading: 160,
        body_font: "newsreader",
        daily_goal_words: 0,
        deadline: "",
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
  const previewPage = bookPage(form);
  const previewFont = bookFont(form.body_font);
  const previewWidth = 150;
  const previewHeight = Math.round((previewWidth * previewPage.heightMm) / previewPage.widthMm);
  const previewMargin = Math.round((previewPage.marginMm / previewPage.widthMm) * previewWidth);
  const previewTitle = form.name.trim() || "um livro";
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
        <div className="book-dialog-body">
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
            <div className="state-line">
              <span>Página</span>
              <span className="spacer" />
              <b>{PAGE_SIZES[form.page_size].label}</b>
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
          <label
            className="modal-field"
            title="Tamanho total que você quer que o livro tenha. A casa do livro compara o texto com essa meta."
          >
            <span>Meta do livro</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={form.goal_words || ""}
              onChange={(event) => patch({ goal_words: Math.max(0, Number(event.target.value) || 0) })}
              placeholder="ex.: 80000"
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

          {notebook?.kind === "book" && onCoverSave && onCoverRemove ? (
            <>
              <p className="book-section">Capa</p>
              <div className="book-cover-field">
                <CoverEditor
                  aspect={previewPage.widthMm / previewPage.heightMm}
                  initialUrl={
                    notebook.has_cover ? coverUrl(notebook.id, notebook.cover_updated_at) : undefined
                  }
                  onSave={onCoverSave}
                  onRemove={onCoverRemove}
                />
              </div>
            </>
          ) : null}

          <p className="book-section">Formato</p>
          <div className="book-press">
            <div className="book-press-controls">
              <div className="book-formats" role="radiogroup" aria-label="Formato do livro">
                {PAGE_SIZE_ORDER.map((size) => {
                  const item = PAGE_SIZES[size];
                  return (
                    <button
                      key={size}
                      type="button"
                      role="radio"
                      aria-checked={form.page_size === size}
                      className={form.page_size === size ? "book-format is-on" : "book-format"}
                      onClick={() => patch({ page_size: size })}
                      title={item.label}
                    >
                      <span
                        className="book-format-sheet"
                        style={{
                          width: Math.round((54 * item.widthMm) / item.heightMm),
                          height: 54,
                        }}
                      >
                        <i />
                      </span>
                      <b>{item.name}</b>
                      <span>{item.dims}</span>
                    </button>
                  );
                })}
              </div>
              <p className="book-format-note">
                {form.page_size === "a4"
                  ? "Formato atual: A4. A4 não é formato de livro; escolha um dos formatos acima."
                  : "A4 não é formato de livro; fica no manuscrito."}
              </p>
              <div className="book-press-fields">
                <label className="modal-field">
                  <span>Margem (mm)</span>
                  <input
                    type="number"
                    min={10}
                    max={60}
                    value={form.page_margin_mm}
                    onChange={(event) =>
                      patch({ page_margin_mm: Math.min(60, Math.max(10, Number(event.target.value) || 19)) })
                    }
                  />
                </label>
                <label className="modal-field">
                  <span>Corpo (px)</span>
                  <input
                    type="number"
                    min={12}
                    max={26}
                    value={form.body_px}
                    onChange={(event) =>
                      patch({ body_px: Math.min(26, Math.max(12, Number(event.target.value) || 18)) })
                    }
                  />
                </label>
                <label className="modal-field">
                  <span>Entrelinha (%)</span>
                  <input
                    type="number"
                    min={100}
                    max={220}
                    step={5}
                    value={form.body_leading}
                    onChange={(event) =>
                      patch({ body_leading: Math.min(220, Math.max(100, Number(event.target.value) || 160)) })
                    }
                  />
                </label>
              </div>
            </div>
            <div
              className="book-page-preview"
              style={{ width: previewWidth, height: previewHeight }}
              aria-label="Prévia da página"
            >
              <div
                className="book-page-preview-body"
                style={{
                  padding: previewMargin,
                  fontFamily: previewFont.css,
                  fontSize: Math.max(6, Math.min(11, 6 + (form.body_px - 12) * 0.4)),
                  lineHeight: form.body_leading / 100,
                }}
              >
                <span className="book-preview-overline">Capítulo</span>
                <b className="book-preview-title">{previewTitle}</b>
                <p>Toda vida começa com uma lista de coisas que ninguém escreveu. A minha começou numa tarde de agosto.</p>
                <p>Não foi como nos livros. Houve um copo de água e a sua mão em cima da minha.</p>
              </div>
            </div>
          </div>

          <p className="book-section">Letra</p>
          <div className="book-fonts" role="radiogroup" aria-label="Fonte do livro">
            {BOOK_FONT_ORDER.map((id) => {
              const font = BOOK_FONTS[id];
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={form.body_font === id}
                  className={form.body_font === id ? "book-font is-on" : "book-font"}
                  onClick={() => patch({ body_font: id })}
                  title={`${font.label} · ${font.era}`}
                >
                  <span className="book-font-sample" style={{ fontFamily: font.css }}>
                    Aa
                  </span>
                  <span className="book-font-text">
                    <b>{font.label}</b>
                    <i>{font.era}</i>
                  </span>
                </button>
              );
            })}
          </div>

          <p className="book-section">Ritmo</p>
          <label
            className="modal-field"
            title="Palavras que você quer escrever por dia. A casa do livro mostra o que já escreveu hoje contra essa meta."
          >
            <span>Palavras por dia</span>
            <input
              type="number"
              min={0}
              step={50}
              inputMode="numeric"
              value={form.daily_goal_words || ""}
              placeholder="ex.: 500"
              onChange={(event) => patch({ daily_goal_words: Math.max(0, Number(event.target.value) || 0) })}
            />
          </label>
          <label
            className="modal-field"
            title="Data em que você quer terminar. A casa do livro calcula o ritmo até lá."
          >
            <span>Prazo</span>
            <input
              type="date"
              value={form.deadline}
              onChange={(event) => patch({ deadline: event.target.value })}
            />
          </label>
        </div>

        <div className="book-color-row">
          <span className="book-color-label">Cor</span>
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
        </div>
        </>
        ) : null}



        </div>

        {isBook ? (
          <div className="book-danger-strip">
            <button
              type="button"
              className="book-danger-toggle"
              aria-expanded={dangerOpen}
              onClick={() => setDangerOpen((value) => !value)}
            >
              <span>Apagar ou converter</span>
              <ChevronIcon size={13} />
            </button>
            {dangerOpen ? (
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
          </div>
        ) : null}

        <div className="modal-actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancelar
          </button>
          {!isNotes ? (
            <button type="button" className="button button--primary" onClick={save} disabled={!form.name.trim()}>
              {notebook ? "Salvar" : "Criar livro"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
