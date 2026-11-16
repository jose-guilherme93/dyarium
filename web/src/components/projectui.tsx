import type { ReactNode } from "react";

/**
 * Pecas visuais da superficie Projetos (dashboard), na linguagem do sistema
 * de interface: cor e tamanho so via `--dy-*`, forma carrega o estado. Os
 * tracos da arvore sao elementos reais com borda de 1px, nunca caracteres de
 * desenho de caixa. docs/projetos.md e a referencia do contrato.
 */

/** Sessoes por kind na ordem canonica; desconhecidos depois, estaveis. */
export const KIND_ORDER = ["feat", "fix", "perf", "test", "docs", "chore"];

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "7 nov" a partir de AAAA-MM-DD (UTC); data impossivel volta como veio. */
export function shortDay(date: string): string {
  const parts = date.split("-").map(Number);
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return date;
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function kindKeys(counts: Record<string, number>): string[] {
  const keys = Object.keys(counts).filter((kind) => counts[kind] > 0);
  const known = KIND_ORDER.filter((kind) => keys.includes(kind));
  const extra = keys.filter((kind) => !KIND_ORDER.includes(kind)).sort();
  return [...known, ...extra];
}

/**
 * Barra de composicao por kind: 2px, segmentos na ordem canonica, largura
 * proporcional. Kind nunca recebe cor: a composicao se le pelas quebras de 1px
 * entre os segmentos e pela largura de cada um.
 */
export function KindMeter({
  counts,
  total,
  widthClass,
}: {
  counts: Record<string, number>;
  total: number;
  /** classe de largura viva (ex.: --dy-space-16 dupla na linha da arvore) */
  widthClass?: string;
}) {
  if (!total) return null;
  const keys = kindKeys(counts);
  return (
    <span
      className={`pjx-mbar${widthClass ? ` ${widthClass}` : ""}`}
      aria-hidden="true"
    >
      {keys.map((kind) => (
        <i
          key={kind}
          style={{ width: `${((counts[kind] / total) * 100).toFixed(1)}%` }}
          title={`${kind} · ${counts[kind]}`}
        />
      ))}
    </span>
  );
}

/**
 * Marca de estado, forma antes de cor (contrato da galeria): disco preenchido
 * = fechada, anel vazio = aberta, anel com traco = interrompida.
 */
export function StateMark({ state }: { state: string }) {
  const label =
    state === "closed" ? "fechada" : state === "interrupted" ? "interrompida" : "aberta";
  return (
    <span
      className={`pjx-state pjx-state--${state}`}
      role="img"
      aria-label={label}
      title={label}
    >
      {state === "closed" ? (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6" />
        </svg>
      ) : state === "interrupted" ? (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="5.5" />
          <path d="M4 8h8" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="5.5" />
        </svg>
      )}
    </span>
  );
}

/** Icone de tipo do no, na escala do token; o chevron e so a divulgacao. */
export function TypeIcon({ kind, small }: { kind: "machine" | "folder" | "session"; small?: boolean }) {
  const paths: Record<string, ReactNode> = {
    machine: (
      <>
        <rect x="1.75" y="2" width="12.5" height="4.75" rx="1.2" />
        <rect x="1.75" y="9.25" width="12.5" height="4.75" rx="1.2" />
        <path className="pjx-ico-d" d="M4 4.4h2.2M4 11.6h2.2" />
      </>
    ),
    folder: (
      <path d="M1.75 4.4c0-.9.72-1.6 1.6-1.6h2.9l1.7 1.9h4.7c.88 0 1.6.72 1.6 1.6v5.9c0 .88-.72 1.6-1.6 1.6H3.35c-.88 0-1.6-.72-1.6-1.6z" />
    ),
    session: (
      <>
        <path d="M3.25 1.75h6l3.5 3.5v9h-9.5z" />
        <path className="pjx-ico-d" d="M9.4 1.9v3.2h3.2" />
        <path className="pjx-ico-d" d="M5.5 8.3h4.9M5.5 10.9h3.2" />
      </>
    ),
  };
  return (
    <span className={`pjx-ico${small ? " pjx-ico--sm" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 16 16" strokeLinejoin="round" fill="none" stroke="currentColor">
        {paths[kind]}
      </svg>
    </span>
  );
}

/** Chevron de divulgacao: gira quando o no esta aberto. */
export function Chevron({ open }: { open: boolean }) {
  return (
    <span className={`pjx-chev${open ? " pjx-chev--open" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 2.5 8 6 4 9.5" />
      </svg>
    </span>
  );
}

/**
 * Coluna de guias da arvore: uma celula de nivel por ancestral (linha vertical
 * quando o ancestral ainda tem irmao por vir) e o cotovelo do proprio no:
 * T quando ha sequencia (irmao seguinte ou filhos visiveis), L quando fecha.
 */
export function Guides({
  ancestors,
  elbow,
}: {
  /** true = o ancestral do nivel tem irmao seguinte (traco continua). */
  ancestors: boolean[];
  /** undefined = sem cotovelo; true = T; false = L. */
  elbow?: boolean;
}) {
  return (
    <span className="pjx-tcol" aria-hidden="true">
      {ancestors.map((cont, index) => (
        <span key={index} className={`pjx-tcell${cont ? " pjx-tcell--v" : ""}`} />
      ))}
      {elbow === undefined ? null : (
        <span
          className={`pjx-tcell pjx-tcell--e${elbow ? " pjx-tcell--T" : " pjx-tcell--L"}`}
        />
      )}
    </span>
  );
}
