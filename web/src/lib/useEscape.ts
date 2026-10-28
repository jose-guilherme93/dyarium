import { useEffect } from "react";

/**
 * Fecha um dialogo ou menu com Esc, independentemente de onde esta o foco.
 * Sem isto, um modal aberto so fechava no botao ou no clique fora.
 */
export function useEscape(active: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, onClose]);
}
