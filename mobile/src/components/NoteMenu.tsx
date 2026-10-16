import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { titleFontSize } from '@/core/format';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

export interface NoteProperty {
  label: string;
  value: string;
}

interface NoteMenuProps {
  visible: boolean;
  title: string;
  properties: NoteProperty[];
  onClose(): void;
  onShare(): void;
}

/**
 * Menu de configuracoes da nota (tres pontinhos no topo): titulo (fonte que
 * encolhe quando e longo), compartilhar e a ficha com as propriedades.
 */
export function NoteMenu({ visible, title, properties, onClose, onShare }: NoteMenuProps) {
  const shown = title.trim() || 'Nota sem titulo';
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fechar menu">
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.handle} />
          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            <Text
              style={[styles.title, { fontSize: titleFontSize(shown, 24, 15) }]}
              numberOfLines={2}
            >
              {shown}
            </Text>

            <Pressable
              style={styles.action}
              onPress={onShare}
              accessibilityLabel="Compartilhar nota"
            >
              <Ionicons name="share-outline" size={20} color={colors.text} />
              <Text style={styles.actionText}>Compartilhar nota</Text>
            </Pressable>

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
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    maxHeight: '80%',
    gap: spacing.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
  },
  title: { color: colors.text, fontWeight: '700', lineHeight: 30 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  actionText: { color: colors.text, fontSize: fontSize.lg },
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  props: { gap: spacing.sm },
  propRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg },
  propLabel: { color: colors.textSecondary, fontSize: fontSize.md },
  propValue: { color: colors.text, fontSize: fontSize.md, flexShrink: 1, textAlign: 'right' },
});
