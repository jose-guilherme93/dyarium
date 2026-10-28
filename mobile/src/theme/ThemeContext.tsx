import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';

import { useSettings } from '@/state/SettingsContext';

import { createThemedStyles } from './themedStyles';
import {
  DEFAULT_THEME,
  THEMES,
  type ThemeColors,
  type ThemeGradients,
  type ThemeName,
} from './tokens';

export interface ThemeValue {
  name: ThemeName;
  colors: ThemeColors;
  gradients: ThemeGradients;
}

const DEFAULT_VALUE: ThemeValue = {
  name: DEFAULT_THEME,
  ...THEMES[DEFAULT_THEME],
};

const ThemeContext = createContext<ThemeValue>(DEFAULT_VALUE);

/**
 * Fornece a paleta ativa. Precisa ficar dentro de `SettingsProvider`, que e
 * quem guarda a preferencia e atualiza `setActiveTheme` antes do render.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { theme } = useSettings();
  const value = useMemo<ThemeValue>(
    () => ({ name: theme, ...THEMES[theme] }),
    [theme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Assina a troca de tema e devolve a paleta atual. */
export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}

/**
 * Estilos de um componente para o tema ativo.
 *
 * Receber os estilos de um hook (em vez de ler um objeto importado) e o que faz
 * o React Compiler tratar a troca de tema como dependencia e refazer o JSX.
 */
export function useThemedStyles<
  T extends Record<string, ViewStyle | TextStyle | ImageStyle>,
>(base: T): T {
  const { name } = useTheme();
  return useMemo(() => createThemedStyles(base, name), [base, name]);
}
