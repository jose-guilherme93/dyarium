import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

export interface ContextMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  /** Acao destrutiva: vermelho e separada das demais. */
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

interface ContextMenuProps {
  /** Posicao do clique, em coordenadas da janela. */
  x: number;
  y: number;
  label: string;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * Menu de contexto do proprio site, no lugar do menu do navegador.
 *
 * Vai para o `body` porque a coluna de notas tem `overflow: hidden` (e no
 * celular vira um painel deslizante com `transform`, que prenderia um
 * `position: fixed` dentro dela). A posicao e ajustada para o menu nunca sair
 * da janela.
 */
export function ContextMenu({ x, y, label, items, onClose }: ContextMenuProps) {
  const menu = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const node = menu.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(x, window.innerWidth - rect.width - margin);
    const top =
      y + rect.height + margin > window.innerHeight
        ? Math.max(margin, y - rect.height)
        : y;
    setPosition({ left: Math.max(margin, left), top: Math.max(margin, top) });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onPointer = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menu}
      className="context-menu"
      role="menu"
      aria-label={label}
      style={{ left: position.left, top: position.top }}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className={item.danger ? "context-menu-item context-menu-item--danger" : "context-menu-item"}
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          <span className="context-menu-label">{item.label}</span>
          {item.icon}
        </button>
      ))}
    </div>,
    document.body,
  );
}

export default ContextMenu;
