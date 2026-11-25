export interface MeterProps {
  value: number;
  max?: number;
  label?: string;
  showValue?: boolean;
}

/**
 * Medidor de progresso. A largura da barra e o unico estilo inline do sistema:
 * e um valor dinamico, e o `style` e o jeito de leva-lo ao DOM.
 */
export function Meter({ value, max = 100, label, showValue = true }: MeterProps) {
  const fracao = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;

  return (
    <div
      className="dy-meter"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
    >
      <div className="dy-meter__track">
        <div className="dy-meter__fill" style={{ width: `${fracao * 100}%` }} />
      </div>
      {showValue ? (
        <span className="dy-meter__value dy-mono">
          {value}/{max}
        </span>
      ) : null}
    </div>
  );
}
