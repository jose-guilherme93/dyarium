import { useState } from "react";
import type { Notebook } from "../types";
import { ChevronIcon, PlusIcon, SettingsIcon, TrashIcon } from "./icons";

interface NotebookSwitcherProps {
  notebooks: Notebook[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (notebook: Notebook) => void;
  onDelete: (notebook: Notebook) => void;
}

/** Seletor de cadernos no topo da sidebar; o padrao fica sempre no fim. */
export function NotebookSwitcher({
  notebooks,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: NotebookSwitcherProps) {
  const [open, setOpen] = useState(false);
  const active = notebooks.find((notebook) => notebook.id === activeId) ?? notebooks[0];

  return (
    <div className="notebook-switcher">
      <button
        type="button"
        className="notebook-current"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="Trocar de caderno"
      >
        <span
          className="notebook-dot"
          style={{ backgroundColor: active?.color || "var(--color-muted)" }}
        />
        <span className="notebook-current-name">{active?.name ?? "Notas ao acaso"}</span>
        <ChevronIcon size={14} />
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={onCreate}
        aria-label="Novo caderno"
        title="Novo caderno"
      >
        <PlusIcon size={16} />
      </button>

      {open && (
        <ul className="notebook-menu">
          {notebooks.map((notebook) => (
            <li key={notebook.id} className="notebook-menu-row">
              <button
                type="button"
                className={
                  notebook.id === activeId
                    ? "notebook-menu-main notebook-menu-main--on"
                    : "notebook-menu-main"
                }
                onClick={() => {
                  onSelect(notebook.id);
                  setOpen(false);
                }}
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
                    <SettingsIcon size={12} />
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
                    <TrashIcon size={12} />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
