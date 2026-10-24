import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Press } from '@/components/Press';
import {
  clearFinishedActivities,
  markActivitiesSeen,
  type Activity,
  type ActivityKind,
  type ActivityStatus,
} from '@/services/activity';
import { useActivities } from '@/state/useActivities';
import { baseColors, fontSize, radius, spacing, type ThemeColors } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

interface ActivityCenterProps {
  visible: boolean;
  onClose(): void;
}

const KIND_META: Record<
  ActivityKind,
  {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
  }
> = {
  transcription: { icon: 'mic-outline', label: 'Transcrição' },
  analysis: { icon: 'sparkles-outline', label: 'Análise' },
  backup: { icon: 'cloud-upload-outline', label: 'Backup' },
  restore: { icon: 'cloud-download-outline', label: 'Restauração' },
  download: { icon: 'download-outline', label: 'Download' },
};

function kindColor(kind: ActivityKind, colors: ThemeColors): { color: string; soft: string } {
  switch (kind) {
    case 'analysis':
      return { color: colors.info, soft: colors.infoSoft };
    case 'backup':
      return { color: colors.success, soft: colors.successSoft };
    case 'restore':
      return { color: colors.warning, soft: colors.warningSoft };
    case 'transcription':
    case 'download':
      return { color: colors.accent, soft: colors.accentSoft };
  }
}

function statusMeta(
  status: Exclude<ActivityStatus, 'running'>,
  colors: ThemeColors,
): {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
} {
  if (status === 'done') return { icon: 'checkmark-circle', color: colors.success };
  if (status === 'cancelled') return { icon: 'stop-circle', color: colors.warning };
  return { icon: 'alert-circle', color: colors.danger };
}

function runAction(item: Activity): void {
  if (!item.action) return;
  try {
    void Promise.resolve(item.action.run()).catch(() => undefined);
  } catch {
    // O produtor registra a falha na propria atividade.
  }
}

function ActivityRow({ item }: { item: Activity }) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const meta = KIND_META[item.kind];
  const palette = kindColor(item.kind, colors);
  const running = item.status === 'running';
  const percent =
    running && item.progress !== undefined ? Math.round(item.progress) : undefined;
  const status = item.status === 'running' ? null : statusMeta(item.status, colors);
  const action =
    !running && (item.status === 'error' || item.status === 'cancelled')
      ? item.action
      : undefined;

  return (
    <View style={styles.row}>
      <View style={[styles.kindIcon, { backgroundColor: palette.soft }]}>
        <Ionicons name={meta.icon} size={17} color={palette.color} />
      </View>

      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {item.title}
          </Text>
          {running ? (
            percent !== undefined ? (
              <Text style={styles.percent}>{percent}%</Text>
            ) : (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            )
          ) : status ? (
            <Ionicons name={status.icon} size={16} color={status.color} />
          ) : null}
        </View>

        <Text style={styles.detail} numberOfLines={2}>
          {item.detail ?? meta.label}
        </Text>

        {percent !== undefined ? (
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${percent}%`, backgroundColor: palette.color },
              ]}
            />
          </View>
        ) : null}

        {action ? (
          <Press
            style={styles.action}
            onPress={() => runAction(item)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`${action.label}: ${item.title}`}
          >
            <Text style={styles.actionText}>{action.label}</Text>
          </Press>
        ) : null}
      </View>
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  const styles = useThemedStyles(baseStyles);

  return <Text style={styles.section}>{children}</Text>;
}

/**
 * Centro de atividade compacto da home: mostra o que esta sendo feito agora e
 * as ultimas tarefas concluidas, sem tirar o usuario da tela.
 */
export function ActivityCenter({ visible, onClose }: ActivityCenterProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const activities = useActivities();
  const running = activities.filter((item) => item.status === 'running');
  const finished = activities.filter((item) => item.status !== 'running');
  const unread = finished.some((item) => !item.seen);

  useEffect(() => {
    if (visible && unread) markActivitiesSeen();
  }, [visible, unread]);

  return (
    <BottomSheet visible={visible} onClose={onClose} cardStyle={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Atividade</Text>
          <Text style={styles.subtitle}>
            {running.length > 0 ? `${running.length} em andamento` : 'Tudo em dia'}
          </Text>
        </View>
        {finished.length > 0 ? (
          <Press
            onPress={clearFinishedActivities}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Limpar concluídas"
          >
            <Text style={styles.clear}>Limpar</Text>
          </Press>
        ) : null}
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {activities.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="pulse-outline" size={26} color={colors.textTertiary} />
            </View>
            <Text style={styles.emptyTitle}>Nada em andamento</Text>
            <Text style={styles.emptyText}>
              Transcrições, análises e backups aparecem aqui enquanto acontecem.
            </Text>
          </View>
        ) : (
          <>
            {running.length > 0 ? <SectionLabel>Em andamento</SectionLabel> : null}
            {running.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}

            {finished.length > 0 ? <SectionLabel>Recentes</SectionLabel> : null}
            {finished.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const baseStyles = defineStyles({
  card: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    maxHeight: '76%',
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  title: { color: baseColors.text, fontSize: fontSize.lg, fontWeight: '700' },
  subtitle: { color: baseColors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
  clear: { color: baseColors.accent, fontSize: fontSize.sm, fontWeight: '600', paddingTop: 3 },
  list: { flexGrow: 0, flexShrink: 1 },
  listContent: { paddingBottom: spacing.xs },
  section: {
    color: baseColors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: baseColors.border,
  },
  kindIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 2 },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 20,
  },
  rowTitle: { flex: 1, color: baseColors.text, fontSize: fontSize.md, fontWeight: '600' },
  percent: {
    color: baseColors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  detail: { color: baseColors.textSecondary, fontSize: fontSize.sm, lineHeight: 18 },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: baseColors.surfaceElevated,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  progressFill: { height: 3, borderRadius: 2 },
  action: { alignSelf: 'flex-start', paddingVertical: 3, marginTop: 2 },
  actionText: { color: baseColors.accent, fontSize: fontSize.sm, fontWeight: '600' },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  emptyIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: baseColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  emptyTitle: { color: baseColors.text, fontSize: fontSize.md, fontWeight: '600' },
  emptyText: {
    color: baseColors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 19,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
});
