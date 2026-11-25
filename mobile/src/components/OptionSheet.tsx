/** Folha de escolha unica: titulo, opcoes e a marcada. */

import { View } from 'react-native';

import { Text } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { Press } from '@/components/Press';
import { baseColors, fontSize, spacing } from '@/theme/tokens';
import { useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

export interface OptionItem {
  id: string;
  label: string;
  hint?: string;
}

interface OptionSheetProps {
  visible: boolean;
  title: string;
  options: OptionItem[];
  selected: string;
  onSelect(id: string): void;
  onClose(): void;
}

export function OptionSheet({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
}: OptionSheetProps) {
  const styles = useThemedStyles(baseStyles);
  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel={`Fechar ${title}`}>
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        {options.map((option) => {
          const active = option.id === selected;
          return (
            <Press
              key={option.id}
              style={styles.row}
              onPress={() => {
                onSelect(option.id);
                onClose();
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={option.label}
            >
              <View style={styles.texts}>
                <Text style={[styles.label, active && styles.labelActive]}>{option.label}</Text>
                {option.hint ? <Text style={styles.hint}>{option.hint}</Text> : null}
              </View>
              {active ? <Text style={styles.check}>✓</Text> : null}
            </Press>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const baseStyles = defineStyles({
  body: { padding: spacing.xl, gap: spacing.xs },
  title: {
    color: baseColors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 46,
    borderBottomWidth: 1,
    borderBottomColor: baseColors.border,
  },
  texts: { flex: 1, gap: 2 },
  label: { color: baseColors.text, fontSize: fontSize.md, fontWeight: '500' },
  labelActive: { fontWeight: '600' },
  hint: { color: baseColors.textSecondary, fontSize: fontSize.sm },
  check: { color: baseColors.accent, fontSize: fontSize.md, fontWeight: '700' },
});
