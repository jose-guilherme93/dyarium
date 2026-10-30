/**
 * Detalhe da bola escolhida, no mesmo espirito do painel do web: os numeros
 * primeiro e, logo abaixo, os trechos que provam a relacao. A lista e virtual e
 * mostra todas as notas, sem o corte de 12 do servidor.
 */

import { Ionicons } from '@expo/vector-icons';
import { useMemo, type ComponentProps } from 'react';
import {
  FlatList,
  StyleSheet,
  View,
  type ListRenderItemInfo,
} from 'react-native';

import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';
import type { EntityExcerptGroup, EntityNote, EntityPanel } from '@/core/graphPanel';
import { formatExcerptTime, formatNoteDate } from '@/core/graphPanel';
import type { GraphColors } from '@/theme/graph';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

interface EntityDetailProps {
  panel: EntityPanel;
  colors: GraphColors;
  snap: number;
  focused: boolean;
  onOpenNote(entryId: string): void;
  onExpand(): void;
  onRename(): void;
  onIcon(): void;
  onClaimSelf(): void;
}

/** Marca a grafia que fez o trecho casar com a entidade. */
function HighlightedText({ text, term }: { text: string; term: string }) {
  const styles = useThemedStyles(baseStyles);
  const index = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1;
  if (index < 0 || !term) return <Text style={styles.excerptText}>{text}</Text>;
  return (
    <Text style={styles.excerptText}>
      {text.slice(0, index)}
      <Text style={styles.term}>{text.slice(index, index + term.length)}</Text>
      {text.slice(index + term.length)}
    </Text>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(baseStyles);
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Action({
  icon,
  label,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress(): void;
}) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();
  return (
    <Press style={styles.action} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={15} color={colors.textSecondary} />
      <Text style={styles.actionLabel}>{label}</Text>
    </Press>
  );
}

export function EntityDetail({
  panel,
  colors,
  focused,
  onOpenNote,
  onExpand,
  onRename,
  onIcon,
  onClaimSelf,
}: EntityDetailProps) {
  const styles = useThemedStyles(baseStyles);
  const entity = panel.entity;

  const groupsWithExcerpts = useMemo(
    () => new Set(panel.groups.map((group) => group.entryId)),
    [panel.groups],
  );
  const otherNotes = useMemo(
    () => panel.notesList.filter((note) => !groupsWithExcerpts.has(note.entryId)),
    [panel.notesList, groupsWithExcerpts],
  );

  const header = (
    <View style={styles.headerBlock}>
      <View style={styles.stats}>
        <Stat label="Menções" value={String(panel.mentions)} />
        <Stat label="Notas" value={String(panel.notes)} />
        {typeof panel.sentiment === 'number' ? (
          <Stat label="Tom" value={panel.sentiment.toFixed(2)} />
        ) : null}
      </View>
      {panel.lastSeen ? (
        <Text style={styles.seen}>Visto em {formatNoteDate(panel.lastSeen)}</Text>
      ) : null}

      <View style={styles.actions}>
        {!focused ? <Action icon="expand-outline" label="Expandir" onPress={onExpand} /> : null}
        <Action icon="pencil" label="Renomear" onPress={onRename} />
        <Action icon="color-palette-outline" label="Ícone" onPress={onIcon} />
        {entity.kind === 'person' ? (
          <Action icon="person-circle-outline" label="Sou eu" onPress={onClaimSelf} />
        ) : null}
      </View>

      {panel.groups.length > 0 ? (
        <Text style={styles.sectionLabel}>Trechos</Text>
      ) : (
        <Text style={styles.sectionLabel}>Notas</Text>
      )}
    </View>
  );

  const renderGroup = ({ item }: ListRenderItemInfo<EntityExcerptGroup>) => (
    <View style={styles.group}>
      <Press
        style={styles.groupHead}
        onPress={() => onOpenNote(item.entryId)}
        accessibilityRole="button"
        accessibilityLabel={`Abrir ${item.title || 'nota'}`}
      >
        <Text style={styles.groupTitle} numberOfLines={1}>
          {item.title || 'Entrada'}
        </Text>
        <Text style={styles.groupDate}>{formatNoteDate(item.date)}</Text>
      </Press>
      {item.comment ? (
        <Text style={styles.comment} numberOfLines={3}>
          {item.comment}
        </Text>
      ) : null}
      {item.items.map((excerpt, index) => (
        <Press
          key={`${excerpt.source}:${excerpt.startMs ?? 'texto'}:${index}`}
          style={styles.excerpt}
          onPress={() => onOpenNote(excerpt.entryId)}
          accessibilityRole="button"
          accessibilityLabel={`Abrir trecho em ${item.title || 'nota'}`}
        >
          {excerpt.source === 'transcript' ? (
            <Text style={[styles.excerptSource, { color: colors[entity.kind] }]}>
              {formatExcerptTime(excerpt.startMs)}
            </Text>
          ) : (
            <Text style={styles.excerptSource}>texto</Text>
          )}
          <HighlightedText text={excerpt.text} term={excerpt.term} />
        </Press>
      ))}
    </View>
  );

  const renderOtherNote = ({ item }: ListRenderItemInfo<EntityNote>) => (
    <Press
      key={item.entryId}
      style={styles.noteRow}
      onPress={() => onOpenNote(item.entryId)}
      accessibilityRole="button"
      accessibilityLabel={`Abrir ${item.title || 'nota'}`}
    >
      <Text style={styles.noteTitle} numberOfLines={1}>
        {item.title || 'Entrada'}
      </Text>
      <Text style={styles.noteMeta}>
        {formatNoteDate(item.date)} · {item.count}
      </Text>
    </Press>
  );

  return (
    <FlatList
      data={panel.groups}
      keyExtractor={(item) => item.entryId}
      renderItem={renderGroup}
      ListHeaderComponent={header}
      ListEmptyComponent={
        otherNotes.length === 0 ? (
          <Text style={styles.empty}>Sem trechos</Text>
        ) : null
      }
      ListFooterComponent={
        otherNotes.length > 0 ? (
          <View style={styles.otherNotes}>
            <Text style={styles.sectionLabel}>Notas</Text>
            {otherNotes.map((note) => renderOtherNote({ item: note } as ListRenderItemInfo<EntityNote>))}
          </View>
        ) : null
      }
      style={styles.list}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={2}
      maxToRenderPerBatch={3}
      windowSize={5}
      removeClippedSubviews
    />
  );
}

const baseStyles = defineStyles({
  list: { flex: 1 },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  headerBlock: { gap: spacing.sm, paddingBottom: spacing.sm },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: baseColors.surface,
  },
  statValue: {
    color: baseColors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    color: baseColors.textTertiary,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  seen: {
    color: baseColors.textTertiary,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: baseColors.neutralSoft,
  },
  actionLabel: { color: baseColors.textSecondary, fontSize: fontSize.xs, fontWeight: '600' },
  sectionLabel: {
    marginTop: spacing.xs,
    color: baseColors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  group: {
    gap: 6,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: baseColors.border,
  },
  groupHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  groupTitle: { flex: 1, color: baseColors.text, fontSize: fontSize.md, fontWeight: '600' },
  groupDate: { color: baseColors.textTertiary, fontSize: fontSize.xs },
  comment: { color: baseColors.textSecondary, fontSize: fontSize.sm, lineHeight: 19 },
  excerpt: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 4 },
  excerptSource: {
    minWidth: 38,
    color: baseColors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    paddingTop: 2,
  },
  excerptText: { flex: 1, color: baseColors.text, fontSize: fontSize.sm, lineHeight: 20 },
  term: { color: baseColors.accent, fontWeight: '700' },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: baseColors.border,
  },
  noteTitle: { flex: 1, color: baseColors.text, fontSize: fontSize.sm },
  noteMeta: { color: baseColors.textTertiary, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
  otherNotes: { gap: 2, paddingTop: spacing.sm },
  empty: {
    color: baseColors.textTertiary,
    fontSize: fontSize.sm,
    paddingVertical: spacing.xl,
    textAlign: 'center',
  },
});
