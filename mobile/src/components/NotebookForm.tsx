import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { FastModal } from '@/components/FastModal';
import { NOTEBOOK_COLORS } from '@/core/notebooks';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

interface NotebookFormProps {
  visible: boolean;
  title: string;
  initialName?: string;
  initialColor?: string;
  /** Esconde a paleta ao editar apenas o nome (opcional). */
  showColors?: boolean;
  onClose(): void;
  onSave(input: { name: string; color: string }): void;
}

export function NotebookForm({
  visible,
  title,
  initialName = '',
  initialColor = '',
  showColors = true,
  onClose,
  onSave,
}: NotebookFormProps) {
  // O pai remonta o formulario com uma `key` por modo/caderno; assim o estado
  // inicial vem das props sem um efeito de sincronizacao.
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave({ name: trimmed, color });
  };

  return (
    <FastModal visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => undefined}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Nome do caderno"
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.accent}
            style={styles.input}
            autoFocus
            maxLength={80}
          />
          {showColors ? (
            <View style={styles.colors}>
              {NOTEBOOK_COLORS.map((option) => (
                <Pressable
                  key={option || 'neutral'}
                  onPress={() => setColor(option)}
                  accessibilityRole="button"
                  accessibilityLabel={option ? `Cor ${option}` : 'Sem cor'}
                  style={[
                    styles.color,
                    { backgroundColor: option || colors.surfaceElevated },
                    option === color ? styles.colorOn : null,
                  ]}
                >
                  {option === color ? <View style={styles.check} /> : null}
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.cancel} accessibilityRole="button">
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
            <Pressable
              onPress={save}
              style={[styles.save, !name.trim() ? styles.saveOff : null]}
              disabled={!name.trim()}
              accessibilityRole="button"
            >
              <Text style={styles.saveText}>Salvar</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </FastModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.xl },
  card: { backgroundColor: colors.bgElevated, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.lg },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  input: {
    color: colors.text,
    fontSize: fontSize.md,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  color: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorOn: { borderColor: colors.text },
  check: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.text },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md },
  cancel: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  cancelText: { color: colors.textSecondary, fontSize: fontSize.md, fontWeight: '600' },
  save: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  saveOff: { opacity: 0.4 },
  saveText: { color: '#FFFFFF', fontSize: fontSize.md, fontWeight: '700' },
});
