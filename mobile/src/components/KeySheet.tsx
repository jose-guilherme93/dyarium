/**
 * Chave de provedor: entra no cofre, nunca aparece de volta na tela.
 *
 * O campo nasce vazio mesmo quando ja ha uma chave; salvar com o campo vazio
 * mantem a atual. "Remover" e a unica forma de apagar.
 */

import { useState } from 'react';
import { View } from 'react-native';

import { Text, TextInput } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { Press } from '@/components/Press';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

interface KeySheetProps {
  visible: boolean;
  title: string;
  placeholder: string;
  hasKey: boolean;
  onSave(key: string): Promise<void> | void;
  onClear(): Promise<void> | void;
  onClose(): void;
  /** Texto de apoio curto: onde criar a chave, por exemplo. */
  hint?: string;
}

export function KeySheet({
  visible,
  title,
  placeholder,
  hasKey,
  onSave,
  onClear,
  onClose,
  hint,
}: KeySheetProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [wasVisible, setWasVisible] = useState(false);

  // Sincroniza o campo ao abrir sem efeito: setState no render de derivacao e
  // o caminho recomendado e nao dispara render em cascata.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setValue('');
  }

  const save = async () => {
    const key = value.trim();
    if (key === '' || busy) return;
    setBusy(true);
    try {
      await onSave(key);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onClear();
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
          placeholder={hasKey ? 'definida — cole outra para trocar' : placeholder}
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.accent}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={styles.input}
          accessibilityLabel={title}
        />
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        <View style={styles.actions}>
          <Press
            onPress={() => void save()}
            disabled={value.trim() === '' || busy}
            accessibilityRole="button"
            accessibilityLabel="Salvar chave"
            style={styles.save}
          >
            <Text style={styles.saveText}>{busy ? 'Salvando…' : 'Salvar'}</Text>
          </Press>
          {hasKey ? (
            <Press
              onPress={() => void clear()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Remover chave"
              style={styles.clear}
            >
              <Text style={styles.clearText}>Remover</Text>
            </Press>
          ) : null}
        </View>
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
  hint: { color: baseColors.textSecondary, fontSize: fontSize.xs, lineHeight: 17 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  save: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: baseColors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  saveText: { color: baseColors.onAccent, fontSize: fontSize.md, fontWeight: '600' },
  clear: { paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
  clearText: { color: baseColors.danger, fontSize: fontSize.md, fontWeight: '500' },
});
