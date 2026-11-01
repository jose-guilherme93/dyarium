import { useEffect, useRef, useState } from "react";
import type { Notebook } from "../types";
import { ALL_NOTEBOOKS } from "../lib/notebooks";
import { progress } from "../lib/books";
import {
  AllNotebooksIcon,
  BookIcon,
  CheckIcon,
  ChevronIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
  TrashIcon,
} from "./icons";

interface NotebookSwitcherProps {
  notebooks: Notebook[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onCreateBook: () => void;
  onRename: (notebook: Notebook) => void;
  onBookSettings: (notebook: Notebook) => void;
  onDelete: (notebook: Notebook) => void;
}

/**
 * Seletor compacto de cadernos e livros. Depois de escolher, a sidebar volta a
 * mostrar a lista do caderno (notas ou capitulos); a biblioteca inteira nao
 * ocupa a coluna o tempo todo.
 */
export function NotebookSwitcher({
  notebooks,
  activeId,
  onSelect,
  onCreate,
  onCreateBook,
  onRename,
  onBookSettings,
  onDelete,
}: NotebookSwitcherProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const all = activeId === ALL_NOTEBOOKS;
  const active = notebooks.find((notebook) => notebook.id === activeId);
  const notes = notebooks.filter((notebook) => notebook.kind !== "book");
  const books = notebooks.filter((notebook) => notebook.kind === "book");
  const total = notes.reduce((sum, notebook) => sum + notebook.entry_count, 0);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [activeId]);

  const select = (id: string) => {
    onSelect(id);
    setOpen(false);
  };

  const row = (notebook: Notebook, book: boolean) => (
    <li key={notebook.id} className="notebook-menu-row">
      <button
        type="button"
        className={
          notebook.id === activeId
            ? "notebook-menu-main notebook-menu-main--on"
            : "notebook-menu-main"
        }
        onClick={() => select(notebook.id)}
      >
        {book ? (
          <span
            className={
              "status-dot status-dot--" +
              (notebook.book_status === "done"
                ? "done"
                : notebook.book_status === "revising"
                  ? "revising"
                  : "draft")
            }
          />
        ) : (
          <span
            className="notebook-dot"
            style={{ backgroundColor: notebook.color || "var(--color-muted)" }}
          />
        )}
        <span className="notebook-menu-text">
          <span className="notebook-menu-name">{notebook.name}</span>
          <span className="notebook-menu-last">
            {book
              ? notebook.goal_words > 0
                ? `${notebook.words ?? 0} / ${notebook.goal_words}`
                : `${notebook.chapter_count} capítulos`
              : notebook.last_entry_at
                ? `última em ${new Date(notebook.last_entry_at).toLocaleDateString("pt-BR")}`
                : "sem notas"}
          </span>
          {book && notebook.goal_words > 0 ? (
            <span
              className="book-bar-track notebook-progress"
              aria-hidden="true"
            >
              <i
                style={{
                  width: `${progress(((notebook.words ?? 0) / notebook.goal_words) * 100)}%`,
                }}
              />
            </span>
          ) : null}
        </span>
        {!book ? <span className="notebook-menu-count">{notebook.entry_count}</span> : null}
        {notebook.id === activeId && <CheckIcon size={13} />}
      </button>
      {!notebook.is_default ? (
        <span className="notebook-menu-actions">
          <button
            type="button"
            className="icon-button icon-button--small"
            onClick={() => {
              setOpen(false);
              onBookSettings(notebook);
            }}
            aria-label={book ? `Configurações de ${notebook.name}` : `Modo escritor em ${notebook.name}`}
            title={book ? "Configurações do livro" : "Modo escritor"}
          >
            {book ? <SettingsIcon size={13} /> : <BookIcon size={13} />}
          </button>
          {!book ? (
            <button
              type="button"
              className="icon-button icon-button--small"
              onClick={() => {
                setOpen(false);
                onRename(notebook);
              }}
              aria-label={`Renomear ${notebook.name}`}
              title="Renomear"
            >
              <PencilIcon size={13} />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-button icon-button--small"
            onClick={() => {
              setOpen(false);
              onDelete(notebook);
            }}
            aria-label={`Excluir ${notebook.name}`}
            title="Excluir"
          >
            <TrashIcon size={13} />
          </button>
        </span>
      ) : null}
    </li>
  );

  return (
    <div className="notebook-switcher" ref={root}>
      <button
        type="button"
        className="notebook-current"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="Escolher caderno"
      >
        {all ? (
          <AllNotebooksIcon size={15} />
        ) : active?.kind === "book" ? (
          <BookIcon size={15} />
        ) : (
          <span
            className="notebook-dot"
            style={{ backgroundColor: active?.color || "var(--color-muted)" }}
          />
        )}
        <span className="notebook-current-name">
          {all ? "Todos os cadernos" : (active?.name ?? "Notas ao acaso")}
        </span>
        <ChevronIcon size={14} />
      </button>

      {open ? (
        <ul className="notebook-menu">
          <li className="notebook-menu-row">
            <button
              type="button"
              className={all ? "notebook-menu-main notebook-menu-main--on" : "notebook-menu-main"}
              onClick={() => select(ALL_NOTEBOOKS)}
            >
              <AllNotebooksIcon size={15} />
              <span className="notebook-menu-text">
                <span className="notebook-menu-name">Todos os cadernos</span>
                <span className="notebook-menu-last">a biblioteca inteira</span>
              </span>
              <span className="notebook-menu-count">{total}</span>
              {all && <CheckIcon size={13} />}
            </button>
          </li>
          <li className="notebook-menu-rule" role="presentation" />
          <li className="notebook-menu-label" role="presentation">
            Cadernos
          </li>
          {notes.map((notebook) => row(notebook, false))}
          <li className="notebook-menu-rule" role="presentation" />
          <li className="notebook-menu-label" role="presentation">
            Livros
          </li>
          {books.map((notebook) => row(notebook, true))}
          <li>
            <button type="button" className="notebook-menu-new" onClick={onCreateBook}>
              <BookIcon size={15} />
              Novo livro
            </button>
          </li>
          <li>
            <button type="button" className="notebook-menu-new" onClick={onCreate}>
              <PlusIcon size={15} />
              Novo caderno
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

export default NotebookSwitcher;
