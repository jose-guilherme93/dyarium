import { Pressable, StyleSheet, Text } from 'react-native';

import {
  designControl,
  designFont,
  designRadius,
  designType,
  type DesignColors,
} from '@/theme/design';

import { useDesign } from './useDesign';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}

type ButtonPalette = {
  background: string;
  border: string;
  text: string;
};

/** Cores da galeria (`docs/design/index.html`) por variante e estado. */
function paletteFor(
  variant: ButtonVariant,
  colors: DesignColors,
  disabled: boolean,
  pressed: boolean,
): ButtonPalette {
  if (variant === 'primary') {
    if (disabled) {
      return { background: colors.primarySoft, border: colors.line, text: colors.textMuted };
    }
    if (pressed) {
      return { background: colors.primarySoft, border: colors.primary, text: colors.text };
    }
    return { background: colors.primary, border: colors.primary, text: colors.surface };
  }

  if (variant === 'secondary') {
    if (disabled) {
      return { background: colors.surface, border: colors.line, text: colors.textMuted };
    }
    if (pressed) {
      return { background: colors.surfaceRaised, border: colors.line, text: colors.text };
    }
    return { background: colors.surfaceAlt, border: colors.line, text: colors.text };
  }

  if (disabled) {
    return { background: 'transparent', border: 'transparent', text: colors.textMuted };
  }
  if (pressed) {
    return { background: colors.surfaceAlt, border: 'transparent', text: colors.text };
  }
  return { background: 'transparent', border: 'transparent', text: colors.text };
}

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  disabled = false,
  onPress,
  accessibilityLabel,
}: ButtonProps) {
  const colors = useDesign();

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        if (disabled) return;
        onPress?.();
      }}
      style={({ pressed }) => {
        const palette = paletteFor(variant, colors, disabled, pressed);
        return [
          styles.base,
          sizeStyles[size],
          { backgroundColor: palette.background, borderColor: palette.border },
        ];
      }}
    >
      {({ pressed }) => (
        <Text
          numberOfLines={1}
          style={[styles.label, { color: paletteFor(variant, colors, disabled, pressed).text }]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: designRadius.control,
  },
  label: {
    fontFamily: designFont.semibold,
    fontSize: designType.label.size,
    lineHeight: designType.label.size * designType.label.lineHeight,
    letterSpacing: designType.label.letterSpacing,
    textTransform: 'uppercase',
  },
});

const sizeStyles = StyleSheet.create({
  sm: {
    height: designControl.sm,
    paddingHorizontal: designControl.padSm,
  },
  md: {
    height: designControl.md,
    paddingHorizontal: designControl.padMd,
  },
  lg: {
    height: designControl.lg,
    paddingHorizontal: designControl.padLg,
  },
});
