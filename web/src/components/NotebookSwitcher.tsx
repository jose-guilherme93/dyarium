import { useEffect, useRef, useState } from "react";
import type { Notebook } from "../types";
import { ALL_NOTEBOOKS } from "../lib/notebooks";
import {
  AllNotebooksIcon,
  CheckIcon,
  ChevronIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "./icons";

interface NotebookSwitcherProps {
  notebooks: Notebook[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (notebook: Notebook) => void;
  onDelete: (notebook: Notebook) => void;
}

/** Seletor de cadernos no topo da sidebar; "todos" vem primeiro. */
export function NotebookSwitcher({
  notebooks,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: NotebookSwitcherProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const all = activeId === ALL_NOTEBOOKS;
  const active = notebooks.find((notebook) => notebook.id === activeId);
  const total = notebooks.reduce((sum, notebook) => sum + notebook.entry_count, 0);

  // Um menu aberto não sobrevive a um clique fora, ao Esc nem à troca de tela:
  // antes ele ficava aberto por cima da nota e do painel de configurações.
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

      {open && (
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
          {notebooks.map((notebook) => (
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
                <span
                  className="notebook-dot"
                  style={{ backgroundColor: notebook.color || "var(--color-muted)" }}
                />
                <span className="notebook-menu-text">
                  <span className="notebook-menu-name">{notebook.name}</span>
                  <span className="notebook-menu-last">
                    {notebook.last_entry_at
                      ? `última em ${new Date(notebook.last_entry_at).toLocaleDateString("pt-BR")}`
                      : "sem notas"}
                  </span>
                </span>
                <span className="notebook-menu-count">{notebook.entry_count}</span>
                {notebook.id === activeId && <CheckIcon size={13} />}
              </button>
              {!notebook.is_default && (
                <span className="notebook-menu-actions">
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
              )}
            </li>
          ))}
          <li className="notebook-menu-rule" role="presentation" />
          <li>
            <button
              type="button"
              className="notebook-menu-new"
              onClick={() => {
                setOpen(false);
                onCreate();
              }}
            >
              <PlusIcon size={15} />
              Novo caderno
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

export default NotebookSwitcher;
