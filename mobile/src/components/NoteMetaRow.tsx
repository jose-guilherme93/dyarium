import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native';
import { Press } from '@/components/Press';

import { TagChip } from '@/components/TagChip';
import { TagStrip } from '@/components/TagStrip';
import type { Recording } from '@/core/types';
import { baseColors, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

interface NoteMetaRowProps {
  note: Recording;
  onAddTag(): void;
  onRemoveTag(tag: string): void;
}

/** Linha de tags logo abaixo da data; o caderno fica no cabecalho da nota. */
export function NoteMetaRow({ note, onAddTag, onRemoveTag }: NoteMetaRowProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  return (
    <TagStrip style={styles.tags}>
      {(note.tags ?? []).map((tag) => (
        <TagChip key={tag.toLowerCase()} name={tag} onRemove={() => onRemoveTag(tag)} />
      ))}
      <Press
        onPress={onAddTag}
        style={styles.add}
        accessibilityRole="button"
        accessibilityLabel="Adicionar tag"
        hitSlop={4}
      >
        <Ionicons name="pricetag-outline" size={14} color={colors.textSecondary} />
      </Press>
    </TagStrip>
  );
}

const baseStyles = defineStyles({
  tags: { marginTop: spacing.sm },
  add: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 30,
    height: 28,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.border,
  },
});
