import { iconGlyphs, iconViewBox, type IconName } from "./iconGlyphs";

export type { IconName };

export interface IconProps {
  /** Nome do desenho declarado em docs/design/icons.json. */
  name: IconName;
  /** Lado do desenho, em px. 14 e o padrao do sistema. */
  size?: number;
  /** Rotulo para leitor de tela. Sem rotulo, o icone e decorativo. */
  label?: string;
  className?: string;
}

/**
 * Icone do sistema. O caminho vem de `iconGlyphs.ts`, gerado dos mesmos
 * desenhos que o app referencia; aqui so entram tamanho, traco e rotulo.
 */
export function Icon({ name, size = 14, label, className }: IconProps) {
  const glyph = iconGlyphs[name];
  const classes = ["dy-icon", className].filter(Boolean).join(" ");

  return (
    <svg
      className={classes}
      width={size}
      height={size}
      viewBox={`0 0 ${iconViewBox} ${iconViewBox}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-fill={glyph.fill ? "true" : undefined}
      focusable="false"
    >
      {label ? <title>{label}</title> : null}
      <path d={glyph.d} fill={glyph.fill ? "currentColor" : "none"} />
    </svg>
  );
}
