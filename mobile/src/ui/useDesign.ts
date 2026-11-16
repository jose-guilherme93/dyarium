import { designColors, type DesignColors, type DesignThemeName } from '@/theme/design';
import { useTheme } from '@/theme/ThemeContext';

const DESIGN_THEMES: readonly DesignThemeName[] = ['light', 'dark', 'amoled'];

/**
 * Nome de tema do app para o nome de paleta do design. Um tema fora da lista
 * cai em `light`, a paleta mais neutra.
 */
export function designThemeFor(name: string): DesignThemeName {
  return DESIGN_THEMES.find((theme) => theme === name) ?? 'light';
}

/** Cores da paleta de design do tema ativo. */
export function useDesign(): DesignColors {
  const { name } = useTheme();
  return designColors[designThemeFor(name)];
}
