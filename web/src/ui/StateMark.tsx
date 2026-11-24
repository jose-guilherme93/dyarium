export type MarkState = "done" | "todo" | "out";

const DEFAULT_LABEL: Record<MarkState, string> = {
  done: "feito",
  todo: "não feito",
  out: "ficou de fora",
};

export interface StateMarkProps {
  state: MarkState;
  label?: string;
}

/**
 * Marca de estado. A forma distingue antes da cor: disco cheio e feito, anel
 * vazio e nao feito, anel com traco e ficou de fora.
 */
export function StateMark({ state, label }: StateMarkProps) {
  return (
    <span
      className="dy-mark"
      data-state={state}
      role="img"
      aria-label={label ?? DEFAULT_LABEL[state]}
    />
  );
}
