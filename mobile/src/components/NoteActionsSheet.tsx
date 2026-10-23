import { Ionicons } from '@expo/vector-icons';
import {
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Press } from '@/components/Press';

import { FastModal } from '@/components/FastModal';
import { titleFontSize } from '@/core/format';
import { displayTitle } from '@/core/title';
import type { Recording } from '@/core/types';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

import type { NoteProperty } from './NoteMenu';

interface NoteActionsSheetProps {
  recording: Recording | null;
  properties: NoteProperty[];
  /** Ponto (toque longo) onde o menu deve emergir. */
  anchor?: { x: number; y: number } | null;
  onClose(): void;
  onShare(): void;
  onArchive(): void;
  onDelete(): void;
}

/**
 * Opcoes da nota na lista (toque longo no card). Abre colado ao dedo, como o
 * menu da nota (popover), e nao de baixo. Mesmo visual do menu da nota.
 */
export function NoteActionsSheet({
  recording,
  properties,
  anchor,
  onClose,
  onShare,
  onArchive,
  onDelete,
}: NoteActionsSheetProps) {
  const { width, height } = useWindowDimensions();
  const menuWidth = Math.min(300, width - spacing.xl * 2);
  const opensDown = (anchor?.y ?? 0) < height / 2;
  const left = anchor
    ? Math.max(spacing.lg, Math.min(anchor.x - 24, width - menuWidth - spacing.lg))
    : spacing.lg;
  const placement = anchor
    ? opensDown
      ? { top: Math.min(anchor.y + 10, height - 120) }
      : { bottom: Math.max(height - anchor.y + 10, 120) }
    : { top: 80 };

  const shown = recording ? displayTitle(recording) : '';

  return (
    <FastModal visible={recording != null} onRequestClose={onClose}>
      <Press style={styles.backdrop} onPress={onClose} accessibilityLabel="Fechar menu">
        <Press
          style={[styles.card, { width: menuWidth, left, maxHeight: height * 0.6 }, placement]}
          onPress={() => undefined}
        >
          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            <Text style={[styles.title, { fontSize: titleFontSize(shown, 20, 14) }]} numberOfLines={2}>
              {shown}
            </Text>

            <Press style={styles.action} onPress={onShare} accessibilityLabel="Compartilhar">
              <Ionicons name="share-outline" size={18} color={colors.text} />
              <Text style={styles.actionText}>Compartilhar</Text>
            </Press>

            <Press style={styles.action} onPress={onArchive} accessibilityLabel="Arquivar">
              <Ionicons name="archive-outline" size={18} color={colors.text} />
              <Text style={styles.actionText}>{recording?.archived ? 'Desarquivar' : 'Arquivar'}</Text>
            </Press>

            <Press style={styles.action} onPress={onDelete} accessibilityLabel="Apagar">
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
              <Text style={[styles.actionText, styles.danger]}>Apagar</Text>
            </Press>

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
        </Press>
      </Press>
    </FastModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  card: {
    position: 'absolute',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { color: colors.text, fontWeight: '700' },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  actionText: { color: colors.text, fontSize: fontSize.md },
  danger: { color: colors.danger },
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.xs,
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
