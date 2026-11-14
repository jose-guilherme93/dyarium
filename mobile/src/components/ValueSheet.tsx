/** Folha de texto livre (modelo, URL de provedor personalizado). */

import { useState } from 'react';
import { View } from 'react-native';

import { Text, TextInput } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { Press } from '@/components/Press';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

interface ValueSheetProps {
  visible: boolean;
  title: string;
  placeholder?: string;
  initial?: string;
  keyboardType?: 'default' | 'url';
  onSave(value: string): Promise<void> | void;
  onClose(): void;
}

export function ValueSheet({
  visible,
  title,
  placeholder,
  initial = '',
  keyboardType = 'default',
  onSave,
  onClose,
}: ValueSheetProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [wasVisible, setWasVisible] = useState(false);

  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setValue(initial);
  }

  const save = async () => {
    const next = value.trim();
    if (next === '' || busy) return;
    setBusy(true);
    try {
      await onSave(next);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel={`Fechar ${title}`}>
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        <TextInput
          value={value}
          onChangeText={setValue}
          placeholder={placeholder}
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.accent}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={keyboardType}
          style={styles.input}
          accessibilityLabel={title}
        />
        <Press
          onPress={() => void save()}
          disabled={value.trim() === '' || busy}
          accessibilityRole="button"
          accessibilityLabel="Salvar"
          style={styles.save}
        >
          <Text style={styles.saveText}>{busy ? 'Salvando…' : 'Salvar'}</Text>
        </Press>
      </View>
    </BottomSheet>
  );
}

const baseStyles = defineStyles({
  body: { padding: spacing.xl, gap: spacing.md },
  title: { color: baseColors.text, fontSize: fontSize.lg, fontWeight: '700' },
  input: {
    color: baseColors.text,
    fontSize: fontSize.md,
    backgroundColor: baseColors.bgElevated,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 46,
  },
  save: {
    alignItems: 'center',
    backgroundColor: baseColors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  saveText: { color: baseColors.onAccent, fontSize: fontSize.md, fontWeight: '600' },
});
