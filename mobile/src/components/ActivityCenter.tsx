import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FastModal } from '@/components/FastModal';
import { Press } from '@/components/Press';
import {
  clearFinishedActivities,
  markActivitiesSeen,
  type Activity,
  type ActivityKind,
  type ActivityStatus,
} from '@/services/activity';
import { useActivities } from '@/state/useActivities';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

interface ActivityCenterProps {
  visible: boolean;
  onClose(): void;
}

const KIND_META: Record<
  ActivityKind,
  {
    icon: keyof typeof Ionicons.glyphMap;
    color: string;
    soft: string;
    label: string;
  }
> = {
  transcription: {
    icon: 'mic-outline',
    color: colors.accent,
    soft: colors.accentSoft,
    label: 'Transcrição',
  },
  analysis: {
    icon: 'sparkles-outline',
    color: colors.info,
    soft: colors.infoSoft,
    label: 'Análise',
  },
  backup: {
    icon: 'cloud-upload-outline',
    color: colors.success,
    soft: colors.successSoft,
    label: 'Backup',
  },
  restore: {
    icon: 'cloud-download-outline',
    color: colors.warning,
    soft: colors.warningSoft,
    label: 'Restauração',
  },
  download: {
    icon: 'download-outline',
    color: colors.accent,
    soft: colors.accentSoft,
    label: 'Download',
  },
};

function statusMeta(status: Exclude<ActivityStatus, 'running'>): {
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
  const meta = KIND_META[item.kind];
  const running = item.status === 'running';
  const percent =
    running && item.progress !== undefined ? Math.round(item.progress) : undefined;
  const status = item.status === 'running' ? null : statusMeta(item.status);
  const action =
    !running && (item.status === 'error' || item.status === 'cancelled')
      ? item.action
      : undefined;

  return (
    <View style={styles.row}>
      <View style={[styles.kindIcon, { backgroundColor: meta.soft }]}>
        <Ionicons name={meta.icon} size={17} color={meta.color} />
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
                { width: `${percent}%`, backgroundColor: meta.color },
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
  return <Text style={styles.section}>{children}</Text>;
}

/**
 * Centro de atividade compacto da home: mostra o que esta sendo feito agora e
 * as ultimas tarefas concluidas, sem tirar o usuario da tela.
 */
export function ActivityCenter({ visible, onClose }: ActivityCenterProps) {
  const activities = useActivities();
  const running = activities.filter((item) => item.status === 'running');
  const finished = activities.filter((item) => item.status !== 'running');
  const unread = finished.some((item) => !item.seen);

  useEffect(() => {
    if (visible && unread) markActivitiesSeen();
  }, [visible, unread]);

  return (
    <FastModal visible={visible} onRequestClose={onClose}>
      <Press style={styles.backdrop} onPress={onClose}>
        <Press style={styles.card} onPress={() => undefined}>
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
        </Press>
      </Press>
    </FastModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
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
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  subtitle: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
  clear: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '600', paddingTop: 3 },
  list: { flexGrow: 0 },
  listContent: { paddingBottom: spacing.xs },
  section: {
    color: colors.textTertiary,
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
    borderTopColor: colors.border,
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
  rowTitle: { flex: 1, color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  percent: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  detail: { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 18 },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.surfaceElevated,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  progressFill: { height: 3, borderRadius: 2 },
  action: { alignSelf: 'flex-start', paddingVertical: 3, marginTop: 2 },
  actionText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '600' },
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
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  emptyTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  emptyText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 19,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
});
