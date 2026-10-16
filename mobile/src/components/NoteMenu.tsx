import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FastModal } from '@/components/FastModal';
import { titleFontSize } from '@/core/format';
import {
  clampFontSize,
  type NoteFontFamily,
  type NoteFontWeight,
  type NoteTypography,
} from '@/core/typography';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

export interface NoteProperty {
  label: string;
  value: string;
}

export interface NoteMenuAnchor {
  top: number;
  right: number;
}

interface NoteMenuProps {
  visible: boolean;
  title: string;
  properties: NoteProperty[];
  /** Posicao do popover (abaixo do botao de configuracoes). */
  anchor?: NoteMenuAnchor | null;
  typography: NoteTypography;
  onChangeTypography(next: NoteTypography): void;
  onClose(): void;
  onShare(): void;
}

const FAMILY_OPTIONS: { value: NoteFontFamily; label: string }[] = [
  { value: 'system', label: 'Sistema' },
  { value: 'serif', label: 'Serifada' },
  { value: 'mono', label: 'Mono' },
];

const WEIGHT_OPTIONS: { value: NoteFontWeight; label: string }[] = [
  { value: 'light', label: 'Leve' },
  { value: 'regular', label: 'Normal' },
  { value: 'bold', label: 'Forte' },
];

function Segment<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.segment}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            style={[styles.segmentItem, active && styles.segmentItemActive]}
            onPress={() => onChange(option.value)}
            accessibilityLabel={option.label}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Configuracoes da nota: um popover que abre logo abaixo do botao (tres
 * pontinhos), sem subir de baixo. Reune compartilhar, tipografia do editor e a
 * ficha de propriedades.
 */
export function NoteMenu({
  visible,
  title,
  properties,
  anchor,
  typography,
  onChangeTypography,
  onClose,
  onShare,
}: NoteMenuProps) {
  const shown = title.trim() || 'Nota sem título';
  const placement = anchor
    ? { top: anchor.top, right: anchor.right }
    : { top: 80, right: spacing.lg };

  return (
    <FastModal visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fechar menu">
        <Pressable style={[styles.card, placement]} onPress={() => undefined}>
          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            <Text style={[styles.title, { fontSize: titleFontSize(shown, 20, 14) }]} numberOfLines={2}>
              {shown}
            </Text>

            <Pressable style={styles.action} onPress={onShare} accessibilityLabel="Compartilhar nota">
              <Ionicons name="share-outline" size={19} color={colors.text} />
              <Text style={styles.actionText}>Compartilhar nota</Text>
            </Pressable>

            <Text style={styles.sectionLabel}>Fonte</Text>
            <Segment
              value={typography.family}
              options={FAMILY_OPTIONS}
              onChange={(family) => onChangeTypography({ ...typography, family })}
            />

            <Text style={styles.sectionLabel}>Tamanho</Text>
            <View style={styles.stepper}>
              <Pressable
                style={styles.stepButton}
                onPress={() => onChangeTypography({ ...typography, size: clampFontSize(typography.size - 1) })}
                accessibilityLabel="Diminuir fonte"
              >
                <Text style={styles.stepText}>A-</Text>
              </Pressable>
              <Text style={styles.stepValue}>{typography.size}</Text>
              <Pressable
                style={styles.stepButton}
                onPress={() => onChangeTypography({ ...typography, size: clampFontSize(typography.size + 1) })}
                accessibilityLabel="Aumentar fonte"
              >
                <Text style={styles.stepText}>A+</Text>
              </Pressable>
            </View>

            <Text style={styles.sectionLabel}>Peso</Text>
            <Segment
              value={typography.weight}
              options={WEIGHT_OPTIONS}
              onChange={(weight) => onChangeTypography({ ...typography, weight })}
            />

            <Text style={styles.sectionLabel}>Propriedades</Text>
            <View style={styles.props}>
              {properties.map((property) => (
                <View key={property.label} style={styles.propRow}>
                  <Text style={styles.propLabel}>{property.label}</Text>
                  <Text style={styles.propValue} numberOfLines={1}>
                    {property.value}
                  </Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </FastModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  card: {
    position: 'absolute',
    width: 300,
    maxHeight: 460,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { color: colors.text, fontWeight: '700' },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  actionText: { color: colors.text, fontSize: fontSize.md },
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.xs,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.bgElevated,
    borderRadius: radius.sm,
    padding: 2,
    gap: 2,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: radius.sm - 2,
  },
  segmentItemActive: { backgroundColor: colors.surfaceElevated },
  segmentText: { color: colors.textSecondary, fontSize: fontSize.sm },
  segmentTextActive: { color: colors.text, fontWeight: '600' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgElevated,
    borderRadius: radius.sm,
    padding: 2,
  },
  stepButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: radius.sm - 2,
    backgroundColor: colors.surfaceElevated,
  },
  stepText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  stepValue: {
    minWidth: 44,
    textAlign: 'center',
    color: colors.text,
    fontSize: fontSize.sm,
    fontVariant: ['tabular-nums'],
  },
  props: { gap: spacing.sm },
  propRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  propLabel: { color: colors.textSecondary, fontSize: fontSize.sm },
  propValue: { color: colors.text, fontSize: fontSize.sm, flexShrink: 1, textAlign: 'right' },
});
