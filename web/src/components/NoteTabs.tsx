import { useEffect, useRef } from "react";
import { CloseIcon } from "./icons";
import type { NoteTab } from "../lib/tabs";

interface NoteTabsProps {
  tabs: NoteTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

function rotulo(tab: NoteTab): string {
  return tab.title.trim() || "Sem título";
}

/**
 * Barra de abas das notas comuns, no topo da area do editor.
 *
 * Cada nota aberta ocupa uma aba de 26 dentro da barra de 34. A ativa leva
 * degrau tonal e a barra de 2 na borda de ataque; a inativa revela o "x" ao
 * passar o mouse e no foco, e a ativa sempre pode fechar. Muitas abas rolam na
 * horizontal, sem empurrar o editor.
 */
export function NoteTabs({ tabs, activeId, onSelect, onClose }: NoteTabsProps) {
  const ativaRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    ativaRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  return (
    <div className="note-tabs" role="tablist" aria-label="Notas abertas">
      {tabs.map((tab) => {
        const ativa = tab.id === activeId;
        const nome = rotulo(tab);
        return (
          <div
            key={tab.id}
            className={ativa ? "note-tab note-tab--active" : "note-tab"}
            role="presentation"
          >
            <button
              type="button"
              role="tab"
              className="note-tab-open"
              aria-selected={ativa}
              tabIndex={ativa ? 0 : -1}
              ref={ativa ? (node) => { ativaRef.current = node; } : undefined}
              onClick={() => onSelect(tab.id)}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  onClose(tab.id);
                }
              }}
              title={nome}
            >
              <span className="note-tab-title">{nome}</span>
            </button>
            <button
              type="button"
              className="note-tab-close"
              aria-label={`Fechar ${nome}`}
              title={`Fechar ${nome}`}
              onClick={() => onClose(tab.id)}
            >
              <CloseIcon size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default NoteTabs;
