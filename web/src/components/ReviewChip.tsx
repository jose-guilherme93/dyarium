import { useState } from "react";
import { formatDuration } from "../lib/format";
import type { Segment, Transcript } from "../types";
import { SparkIcon } from "./icons";

interface ReviewChipProps {
  transcript: Transcript;
  segments: Segment[];
}

/**
 * Estado da revisao em icones e numeros, igual ao app. O chip responde "foi
 * revisado? mudou alguma coisa?"; a lista antes/depois responde "o que mudou?".
 * Sem revisao o chip nao aparece: no dashboard nao ha o que explicar alem de
 * "ainda nao".
 */
export function ReviewChip({ transcript, segments }: ReviewChipProps) {
  const [open, setOpen] = useState(false);
  if (!transcript.revised) return null;

  const changed = segments.filter(
    (segment) => segment.revised && segment.revised !== segment.text,
  );
  const rejected = transcript.revised_rejected ?? 0;
  const pending = transcript.revised_pending ?? 0;
  const comprehension = transcript.revised_comprehension ?? -1;

  return (
    <div className="review">
      <button
        type="button"
        className="review-chip"
        aria-expanded={open}
        aria-label={
          changed.length > 0
            ? `${changed.length} trechos revisados. Ver o antes e o depois.`
            : "Transcrição revisada sem alterações."
        }
        onClick={() => setOpen((value) => !value)}
      >
        <SparkIcon size={14} />
        <span className="review-chip__count">{changed.length}</span>
        {rejected > 0 && <span className="review-chip__warn">{rejected}</span>}
        {pending > 0 && <span className="review-chip__count review-chip__muted">{pending}</span>}
        {comprehension >= 0 && <ScoreRing value={comprehension} />}
      </button>

      {open && (
        <div className="review-changes">
          {changed.length === 0 ? (
            <p className="review-empty">Nada a corrigir neste texto.</p>
          ) : (
            changed.map((segment, index) => (
              <div key={`${segment.start_ms}-${index}`} className="review-change">
                <span className="timestamp">{formatDuration(segment.start_ms / 1000)}</span>
                <span className="review-before">{segment.text}</span>
                <span className="review-after">{segment.revised}</span>
              </div>
            ))
          )}
          {rejected > 0 && (
            <p className="review-empty">{rejected} trechos sem revisão.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Anel de compreensao: cor por faixa, com o numero dentro do titulo. */
function ScoreRing({ value }: { value: number }) {
  const size = 16;
  const stroke = 2.4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = Math.max(0, Math.min(100, value)) / 100;
  const tone = value >= 80 ? "var(--ok)" : value >= 50 ? "var(--color-accent)" : "var(--danger)";
  return (
    <span className="review-score" title={`Compreensão lógica estimada: ${value} de 100`}>
      <svg width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-border)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference * ratio} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span>{value}</span>
    </span>
  );
}
