import { useEffect, useRef } from "react";

/**
 * Prende o foco dentro de um dialogo enquanto ele esta aberto: o foco entra no
 * primeiro controle ao montar, Tab e Shift+Tab circulam so ali dentro, Esc
 * fecha, e ao desmontar o foco volta para quem abriu. Sem isso o Tab escapa
 * para a navegacao atras do modal.
 */
export function useDialogFocus<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const previous = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

    const first = focusables()[0];
    (first ?? node).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const at = list.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey
        ? at <= 0
          ? list.length - 1
          : at - 1
        : at === -1 || at === list.length - 1
          ? 0
          : at + 1;
      event.preventDefault();
      list[next].focus();
    };

    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, []);

  return ref;
}
