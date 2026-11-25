export interface WaveProps {
  /** Amostras normalizadas de 0 a 1, uma barra por valor. */
  peaks: number[];
  /** Fracao ja tocada, de 0 a 1. */
  played?: number;
  /** Nome acessivel da onda. */
  label: string;
  /** Altura total em px; o padrao acompanha `wave.height`. */
  height?: number;
  minHeight?: number;
}

/**
 * Onda de audio do web. Uma barra fina por amostra visivel: a forma do audio
 * aparece de verdade, sem virar um bloco decorativo.
 */
export function Wave({ peaks, played = 0, label, height = 44, minHeight = 2 }: WaveProps) {
  const limit = Math.round(Math.min(Math.max(played, 0), 1) * peaks.length);

  return (
    <div className="dy-wave" role="img" aria-label={label} style={{ height: `${height}px` }}>
      {peaks.map((peak, index) => {
        const value = Math.min(Math.max(peak, 0), 1);
        return (
          <b
            key={index}
            data-played={index < limit ? "true" : undefined}
            style={{ height: `${Math.max(minHeight, Math.round(value * height))}px` }}
          />
        );
      })}
    </div>
  );
}
