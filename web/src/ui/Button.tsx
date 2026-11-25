import type { ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
  children: ReactNode;
  ariaLabel?: string;
}

/**
 * Botao do sistema. A aparencia mora inteira em `ui.css`: o componente so
 * escolhe as classes de variante e tamanho, nunca estilo inline.
 */
export function Button({
  variant = "primary",
  size = "md",
  disabled = false,
  type = "button",
  onClick,
  children,
  ariaLabel,
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`dy-btn dy-label dy-btn--${variant} dy-btn--${size}`}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}
