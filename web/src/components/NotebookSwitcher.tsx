import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { Notebook } from "../types";
import { ALL_NOTEBOOKS } from "../lib/notebooks";
import { progress } from "../lib/books";
import {
  AllNotebooksIcon,
  BookIcon,
  CheckIcon,
  ChevronIcon,
  MoreIcon,
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

interface PopState {
  notebook: Notebook;
  top: number;
  left: number;
}

/** Geometria do submenu do "Novo": cartao flutuante ao lado do painel no
 *  desktop ou faixa opaca que preenche a regiao rolavel no estreito. */
interface NewPopState {
  top: number;
  left: number;
  width: number;
  height: number;
  /** true quando a geometria estreita preenche a regiao da lista. */
  fill: boolean;
}

const POP_WIDTH = 176;
const POP_ACTION_PX = 34;
const NEW_POP_WIDTH = 176;
/** 2 itens de 34px + 4px de padding + 2px de borda. */
const NEW_POP_HEIGHT = POP_ACTION_PX * 2 + 6;

/** Caderno padrao e o caderno MCP nao tem acoes na linha. */
const canManage = (notebook: Notebook) => !notebook.is_default && notebook.kind !== "mcp";

/**
 * Seletor compacto de cadernos e livros. O painel e um menu: topo fixo com
 * "Todas as notas", meio rolavel por secoes e rodape fixo com um unico "Novo"
 * que abre um submenu flutuante ("Novo caderno"/"Novo livro") sem esconder a
 * lista. Acoes da linha ficam atras de um "…" com submenu.
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
  const [pop, setPop] = useState<PopState | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newPop, setNewPop] = useState<NewPopState | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const submenu = useRef<HTMLDivElement | null>(null);
  const newRef = useRef<HTMLButtonElement | null>(null);
  const newSubRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const footRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const all = activeId === ALL_NOTEBOOKS;
  const active = notebooks.find((notebook) => notebook.id === activeId);
  const notes = notebooks.filter((notebook) => notebook.kind !== "book");
  const books = notebooks.filter((notebook) => notebook.kind === "book");
  const total = notes.reduce((sum, notebook) => sum + notebook.entry_count, 0);

  const items = () =>
    Array.from(
      menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]') ?? [],
    );

  const close = (returnFocus: boolean) => {
    setPop(null);
    setNewPop(null);
    setNewOpen(false);
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  // Fecha por ponteiro fora do componente e por teclas: Escape esconde o
  // submenu do "Novo" (ou o das acoes do "…"), depois fecha o menu de volta ao
  // gatilho; Tab fecha tudo.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: Event) => {
      if (root.current && !root.current.contains(event.target as Node)) close(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (pop) {
          const anchor = root.current?.querySelector<HTMLElement>(
            `[data-menu-id="${CSS.escape(pop.notebook.id)}"]`,
          );
          setPop(null);
          anchor?.focus();
        } else if (newOpen) {
          setNewOpen(false);
          setNewPop(null);
          newRef.current?.focus();
        } else {
          close(true);
        }
      } else if (event.key === "Tab") {
        close(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, pop, newOpen]);

  useEffect(() => {
    setOpen(false);
    setPop(null);
    setNewOpen(false);
    setNewPop(null);
  }, [activeId]);

  // Ao abrir, o foco cai na linha marcada (ou na primeira).
  useEffect(() => {
    if (!open) return;
    const list = items();
    const checked = list.find((el) => el.getAttribute("aria-checked") === "true");
    (checked ?? list[0])?.focus();
  }, [open]);

  // O primeiro item de um submenu recebe o foco quando ele aparece: as acoes
  // da linha no "…"; o do "Novo" tem efeito proprio abaixo.
  useEffect(() => {
    if (!pop) return;
    submenu.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [pop]);

  // Ao abrir o submenu do "Novo", o foco cai na primeira opcao ("Novo caderno").
  useEffect(() => {
    if (!newOpen) return;
    newSubRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [newOpen]);

  const select = (id: string) => {
    setPop(null);
    setNewPop(null);
    setNewOpen(false);
    setOpen(false);
    if (id !== activeId) onSelect(id);
  };

  const openPop = (notebook: Notebook, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const actions = notebook.kind === "book" ? 2 : 3;
    const height = actions * POP_ACTION_PX + 8;
    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 4);
    let left = rect.right + 6;
    if (left + POP_WIDTH > window.innerWidth - 8) left = Math.max(8, rect.right - POP_WIDTH);
    setNewOpen(false);
    setNewPop(null);
    setPop({ notebook, top, left });
  };

  // Abre o submenu do "Novo" sem tocar na lista: no desktop, um cartao ao lado
  // do painel alinhado embaixo com a linha "Novo" (ou acima se faltar espaco);
  // no estreito, uma faixa opaca que preenche a regiao rolavel ate o rodape.
  const openNew = () => {
    setPop(null);
    const menuEl = menu.current;
    const button = newRef.current;
    if (!menuEl || !button) return;
    const menuRect = menuEl.getBoundingClientRect();
    const btnRect = button.getBoundingClientRect();
    if (window.innerWidth <= 900) {
      const scrollTop = scrollRef.current?.getBoundingClientRect().top ?? menuRect.top;
      const footTop = footRef.current?.getBoundingClientRect().top ?? btnRect.top;
      const available = footTop - scrollTop;
      const fill = available >= NEW_POP_HEIGHT;
      setNewPop({
        top: fill ? scrollTop : footTop - NEW_POP_HEIGHT,
        left: menuRect.left,
        width: menuRect.width,
        height: fill ? available : NEW_POP_HEIGHT,
        fill: true,
      });
      return;
    }
    let left = menuRect.right + 6;
    if (left + NEW_POP_WIDTH > window.innerWidth - 8) {
      left = Math.max(8, menuRect.left - NEW_POP_WIDTH - 6);
    }
    let top = btnRect.bottom - NEW_POP_HEIGHT;
    if (top < 8) top = 8;
    if (top + NEW_POP_HEIGHT > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - 8 - NEW_POP_HEIGHT);
    }
    setNewPop({ top, left, width: NEW_POP_WIDTH, height: NEW_POP_HEIGHT, fill: false });
  };

  const toggleNew = () => {
    if (newOpen) {
      setNewOpen(false);
      setNewPop(null);
      newRef.current?.focus();
    } else {
      openNew();
      setNewOpen(true);
    }
  };

  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = items();
    if (!list.length) return;
    const current = list.indexOf(event.target as HTMLElement);
    if (event.key === "Enter" || event.key === " ") {
      const target = event.target as HTMLElement;
      const pick = target.getAttribute?.("data-pick");
      if (pick) {
        event.preventDefault();
        select(pick);
        return;
      }
      // Enter/Espaco no "Novo" abre o submenu de criacao.
      if (target.getAttribute?.("data-new")) {
        event.preventDefault();
        openNew();
        setNewOpen(true);
      }
      return;
    }
    if (current < 0) return;
    // O caminho do teclado para as acoes da linha: ArrowRight ou menu de
    // contexto (Shift+F10 / ContextMenu) abrem o submenu do "…" da linha.
    // Linha sem acoes (padrao/MCP) nao faz nada.
    if (
      event.key === "ArrowRight" ||
      event.key === "ContextMenu" ||
      (event.key === "F10" && event.shiftKey)
    ) {
      event.preventDefault();
      const pick = (event.target as HTMLElement).getAttribute("data-pick");
      const notebook = notebooks.find((item) => item.id === pick);
      if (notebook && canManage(notebook)) {
        const anchor = (event.target as HTMLElement).querySelector<HTMLButtonElement>(
          "[data-menu-id]",
        );
        if (anchor) openPop(notebook, anchor);
      }
      return;
    }
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    // ArrowDown no "Novo" abre o submenu de criacao; aberto, o wrap normal do
    // menu assume (Novo -> primeira linha).
    if (
      event.key === "ArrowDown" &&
      !newOpen &&
      (event.target as HTMLElement).getAttribute?.("data-new")
    ) {
      event.preventDefault();
      openNew();
      setNewOpen(true);
      return;
    }
    event.preventDefault();
    const next =
      event.key === "ArrowDown"
        ? (current + 1) % list.length
        : event.key === "ArrowUp"
          ? (current - 1 + list.length) % list.length
          : event.key === "Home"
            ? 0
            : list.length - 1;
    list[next]?.focus();
  };

  // Setas com wrap dentro de qualquer submenu (acoes da linha e "Novo").
  const onSubmenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = Array.from(
      (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("button"),
    );
    if (!list.length) return;
    const current = list.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const next =
      event.key === "ArrowDown"
        ? (current + 1) % list.length
        : event.key === "ArrowUp"
          ? (current - 1 + list.length) % list.length
          : event.key === "Home"
            ? 0
            : list.length - 1;
    list[next]?.focus();
  };

  const runAction = (action: (notebook: Notebook) => void) => {
    if (!pop) return;
    const notebook = pop.notebook;
    setPop(null);
    setNewPop(null);
    setNewOpen(false);
    setOpen(false);
    action(notebook);
  };

  const runCreate = (action: () => void) => {
    setPop(null);
    setNewPop(null);
    setNewOpen(false);
    setOpen(false);
    action();
  };

  const row = (notebook: Notebook, isBook: boolean) => {
    const checked = notebook.id === activeId;
    const full = `${notebook.chapter_count} ${notebook.chapter_count === 1 ? "capítulo" : "capítulos"}`;
    return (
      <div
        key={notebook.id}
        role="menuitemradio"
        aria-checked={checked}
        tabIndex={-1}
        data-pick={notebook.id}
        className={checked ? "notebook-menu-row notebook-menu-row--on" : "notebook-menu-row"}
        onClick={() => select(notebook.id)}
      >
        {isBook ? (
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
          {isBook && notebook.goal_words > 0 ? (
            <span className="notebook-menu-meter" aria-hidden="true">
              <i
                style={{
                  width: `${progress(((notebook.words ?? 0) / notebook.goal_words) * 100)}%`,
                }}
              />
            </span>
          ) : null}
        </span>
        {isBook ? (
          <span className="notebook-menu-count" title={full} aria-label={full}>
            {notebook.chapter_count} {notebook.chapter_count === 1 ? "cap" : "caps"}
          </span>
        ) : (
          <span className="notebook-menu-count">{notebook.entry_count}</span>
        )}
        <span className="notebook-menu-check" aria-hidden="true">
          <CheckIcon size={13} />
        </span>
        <span className="notebook-menu-more">
          {canManage(notebook) ? (
            <button
              type="button"
              className="icon-button icon-button--small"
              data-menu-id={notebook.id}
              aria-haspopup="menu"
              aria-expanded={pop?.notebook.id === notebook.id}
              aria-label={`Ações de ${notebook.name}`}
              title="Ações"
              tabIndex={-1}
              onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                event.stopPropagation();
                if (pop?.notebook.id === notebook.id) {
                  setPop(null);
                  return;
                }
                openPop(notebook, event.currentTarget);
              }}
            >
              <MoreIcon size={14} />
            </button>
          ) : null}
        </span>
      </div>
    );
  };

  return (
    <div className="notebook-switcher" ref={root}>
      <button
        ref={triggerRef}
        type="button"
        className="notebook-current"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Escolher caderno"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
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
          {all ? "Todas as notas" : (active?.name ?? "Notas ao acaso")}
        </span>
        <ChevronIcon size={14} />
      </button>

      {open ? (
        <div
          ref={menu}
          className="notebook-menu"
          role="menu"
          aria-label="Escolher caderno"
          onKeyDown={onMenuKey}
        >
          <div className="notebook-menu-top">
            <p className="notebook-menu-label">Todas</p>
            <div
              role="menuitemradio"
              aria-checked={all}
              tabIndex={-1}
              data-pick={ALL_NOTEBOOKS}
              className={all ? "notebook-menu-row notebook-menu-row--on" : "notebook-menu-row"}
              onClick={() => select(ALL_NOTEBOOKS)}
            >
              <span className="notebook-menu-mark">
                <AllNotebooksIcon size={14} />
              </span>
              <span className="notebook-menu-text">
                <span className="notebook-menu-name">Todas as notas</span>
              </span>
              <span className="notebook-menu-count">{total}</span>
              <span className="notebook-menu-check" aria-hidden="true">
                <CheckIcon size={13} />
              </span>
              <span className="notebook-menu-more" aria-hidden="true" />
            </div>
          </div>

          <div
            className="notebook-menu-scroll"
            ref={scrollRef}
            onScroll={() => setPop(null)}
          >
            {notes.length > 0 ? <p className="notebook-menu-label">Cadernos</p> : null}
            {notes.map((notebook) => row(notebook, false))}
            {books.length > 0 ? <p className="notebook-menu-label">Livros</p> : null}
            {books.map((notebook) => row(notebook, true))}
          </div>

          <div className="notebook-menu-foot" ref={footRef}>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              ref={newRef}
              data-new="1"
              className="notebook-menu-new"
              aria-haspopup="menu"
              aria-expanded={newOpen}
              onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                event.stopPropagation();
                toggleNew();
              }}
            >
              <PlusIcon size={14} />
              Novo
              <span className="notebook-menu-caret" aria-hidden="true">
                <ChevronIcon size={13} />
              </span>
            </button>
          </div>
        </div>
      ) : null}

      {newOpen && newPop ? (
        <div
          ref={newSubRef}
          className={
            "notebook-submenu notebook-submenu--new" +
            (newPop.fill ? " notebook-submenu--fill" : "")
          }
          role="menu"
          aria-label="Criar"
          style={{
            top: newPop.top,
            left: newPop.left,
            width: newPop.width,
            height: newPop.height,
          }}
          onKeyDown={onSubmenuKey}
        >
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => runCreate(onCreate)}
          >
            <PlusIcon size={14} />
            Novo caderno
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => runCreate(onCreateBook)}
          >
            <BookIcon size={14} />
            Novo livro
          </button>
        </div>
      ) : null}

      {pop ? (
        <div
          ref={submenu}
          className="notebook-submenu"
          role="menu"
          aria-label={`Ações de ${pop.notebook.name}`}
          style={{ top: pop.top, left: pop.left, width: POP_WIDTH }}
          onKeyDown={onSubmenuKey}
        >
          {pop.notebook.kind === "book" ? (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => runAction(onBookSettings)}
            >
              <SettingsIcon size={14} />
              Configurações
            </button>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => runAction(onRename)}
              >
                <PencilIcon size={14} />
                Renomear
              </button>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => runAction(onBookSettings)}
              >
                <BookIcon size={14} />
                Modo escritor
              </button>
            </>
          )}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="notebook-submenu-danger"
            onClick={() => runAction(onDelete)}
          >
            <TrashIcon size={14} />
            Excluir
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default NotebookSwitcher;
