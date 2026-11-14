interface IconProps {
  size?: number;
}

function svgProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

export function InsightsIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

export function SearchIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function SettingsIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 7 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 2.6 15H2.5a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10.5 2.6V2.5a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 16 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 21.4 9v.09a1.65 1.65 0 0 0 1.17 1.41" />
    </svg>
  );
}

export function MicIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

export function PlusIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function CommentIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M21 12a8 8 0 0 1-8 8H6l-3 2v-5a8 8 0 0 1 8-8h2a8 8 0 0 1 8 3z" />
    </svg>
  );
}

export function ImportIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

export function ImageIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m4 17 5-5 4 4 3-3 4 4" />
    </svg>
  );
}

export function TrashIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    </svg>
  );
}

export function PlayIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PauseIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ChevronIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function MoreIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CloseIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function CheckIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="m5 12 5 5 9-11" />
    </svg>
  );
}

export function SparkIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
    </svg>
  );
}

export function ExitIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" />
      <path d="M10 8l-4 4 4 4" />
      <path d="M6 12h9" />
    </svg>
  );
}

/** Arquivo com tampa: alterna entre a lista de trabalho e as arquivadas. */
export function ArchiveIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="3" y="4" width="14" height="3" rx="1" />
      <path d="M5 7v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7" />
      <path d="M10 11h0" />
    </svg>
  );
}

/** Etiqueta: abre o filtro por tags da lista. */
export function TagIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 4h7l9 9-7 7-9-9V4Z" />
      <circle cx="8" cy="8" r="1.4" />
    </svg>
  );
}

/** Sino: processos concluidos (transcricoes e analises). */
export function BellIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

/** Menu sanduiche: abre a navegacao no navegador estreito. */
export function MenuIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

/** Lapis: renomear um caderno sem sugerir "configurações". */
export function PencilIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 17v3Z" />
      <path d="m14 7 3 3" />
    </svg>
  );
}

/** Cadernos empilhados: o escopo "todos os cadernos". */
export function AllNotebooksIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 16 9 5 9-5" />
    </svg>
  );
}

/** Markdown: "<>" com barra. Abre a visao de texto cru da nota. */
export function CodeIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M9 7l-5 5 5 5" />
      <path d="M15 7l5 5-5 5" />
    </svg>
  );
}

export function LinkIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
    </svg>
  );
}

export function BookIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16.5H6.5A2.5 2.5 0 0 0 4 22V5.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function WritingIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 19V6a1 1 0 0 1 1-1h9l4 4v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" />
      <path d="M8 12h7M8 16h5" />
    </svg>
  );
}

export function FitIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
    </svg>
  );
}

export function MapIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <circle cx="12" cy="6" r="2.2" />
      <circle cx="5" cy="17" r="2.2" />
      <circle cx="19" cy="17" r="2.2" />
      <path d="M10.6 8.1 6.4 14.9M13.4 8.1l4.2 6.8M7.2 17h9.6" />
    </svg>
  );
}

export function CalendarIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      <path d="M8 13.5h.01M12 13.5h.01" strokeWidth="2.2" />
    </svg>
  );
}

export function ArrowUpRightIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}

export function CpuIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
      <rect x="10" y="10" width="4" height="4" rx="1" />
    </svg>
  );
}

/** Ordena a lista: duas setas (cima/baixo) para alternar mais recentes/antigas. */
export function SortIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M7 4v16" />
      <path d="m4 7 3-3 3 3" />
      <path d="M17 20V4" />
      <path d="m20 17-3 3-3-3" />
    </svg>
  );
}

/** Escudo: o que sai e o que fica no servidor. */
export function ShieldIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M12 3l7 4v5c0 4-3 7-7 9-4-2-7-5-7-9V7l7-4z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

/** Seta circular: buscar a lista de modelos de novo. */
export function RefreshIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M20 12a8 8 0 1 1-2.3-5.7" />
      <path d="M20 4v4h-4" />
    </svg>
  );
}

/** Pessoa: autor das notas. */
export function UserIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 21c0-4 3-7 7-7s7 3 7 7" />
    </svg>
  );
}

/** Onda de audio: a etapa de transcricao. */
export function WaveIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M3 12h2l2-6 3 12 3-9 2 6 2-3h4" />
    </svg>
  );
}

/** Seta saindo da caixa: abre o commit ou link no remoto. */
export function ExternalIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  );
}

/** Funil: abre um filtro entre os itens. */
export function FilterIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
    </svg>
  );
}

/** Controles deslizantes: abre a barra de personalizacao. */
export function SlidersIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <path d="M1 14h6M9 8h6M17 16h6" />
    </svg>
  );
}
