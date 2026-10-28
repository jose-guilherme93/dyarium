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
