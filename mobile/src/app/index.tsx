import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useRef } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

import { RecordButton } from '@/components/RecordButton';
import { RecordingCard } from '@/components/RecordingCard';
import { Screen } from '@/components/Screen';
import { Waveform } from '@/components/Waveform';
import { formatDuration } from '@/core/format';
import { groupRecordingsByYear, type RecordingSection } from '@/core/group';
import type { Recording } from '@/core/types';
import { useLibrary } from '@/state/LibraryContext';
import { useRecording } from '@/state/RecordingContext';
import { useSettings } from '@/state/SettingsContext';
import { colors, fontSize, spacing } from '@/theme/tokens';

const PENDING_STATUSES = ['recorded', 'queued', 'uploading', 'failed'];

interface SwipeRowProps {
  children: React.ReactNode;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onAction: () => void;
}

function SwipeRow({ children, label, icon, color, onAction }: SwipeRowProps) {
  const ref = useRef<Swipeable>(null);
  return (
    <Swipeable
      ref={ref}
      overshootRight={false}
      renderRightActions={() => (
        <Pressable
          style={[styles.swipeAction, { backgroundColor: color }]}
          onPress={() => {
            ref.current?.close();
            onAction();
          }}
          accessibilityLabel={label}
        >
          <Ionicons name={icon} size={22} color="#FFFFFF" />
          <Text style={styles.swipeLabel}>{label}</Text>
        </Pressable>
      )}
    >
      {children}
    </Swipeable>
  );
}

export default function RecordScreen() {
  const { recordings, retry, remove, kick, createDraftNote, archiveNote, unarchiveNote } =
    useLibrary();
  const { active, elapsedMs, level, error, busy, start, stop } = useRecording();
  const { swipeAction } = useSettings();

  const recording = Boolean(active);
  const pending = recordings.filter((r) => PENDING_STATUSES.includes(r.status)).length;
  const interrupted = recordings.filter((r) => r.status === 'interrupted').length;

  const activeNotes = recordings.filter((r) => !r.archived);
  const archivedNotes = recordings.filter((r) => r.archived);
  const sections: RecordingSection[] = groupRecordingsByYear(activeNotes);
  if (archivedNotes.length > 0) {
    sections.push({ year: 0, title: 'Arquivadas', data: archivedNotes });
  }

  const handlePress = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    if (recording) await stop();
    else await start();
  };

  const handleAdd = async () => {
    const note = await createDraftNote();
    router.push({ pathname: '/note/[id]', params: { id: note.id } });
  };

  const renderItem = (item: Recording) => {
    const swipeDelete = swipeAction === 'delete';
    return (
      <SwipeRow
        label={swipeDelete ? 'Apagar' : 'Arquivar'}
        icon={swipeDelete ? 'trash-outline' : 'archive-outline'}
        color={swipeDelete ? colors.danger : colors.warning}
        onAction={() => (swipeDelete ? void remove(item.id) : void archiveNote(item.id))}
      >
        <RecordingCard
          recording={item}
          onRetry={() => void retry(item.id)}
          onDelete={() => void remove(item.id)}
          onOpen={() => router.push({ pathname: '/note/[id]', params: { id: item.id } })}
          onArchive={() =>
            item.archived ? void unarchiveNote(item.id) : void archiveNote(item.id)
          }
        />
      </SwipeRow>
    );
  };

  return (
    <Screen style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.largeTitle}>Notas</Text>
          <Text style={styles.headerSub}>
            {recordings.length === 0
              ? 'Nada por aqui ainda'
              : `${activeNotes.length} nota${activeNotes.length === 1 ? '' : 's'}${
                  pending > 0 ? ` · ${pending} na fila` : ''
                }`}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.iconButton}
            onPress={() => router.push('/settings')}
            accessibilityLabel="Opcoes"
          >
            <Ionicons name="settings-outline" size={22} color={colors.text} />
          </Pressable>
          <Pressable
            style={styles.iconButton}
            onPress={() => void handleAdd()}
            accessibilityLabel="Nova nota"
          >
            <Ionicons name="add" size={26} color={colors.text} />
          </Pressable>
        </View>
      </View>

      {recording ? (
        <View style={styles.recordingView}>
          <Text style={styles.timer}>{formatDuration(elapsedMs)}</Text>
          <Waveform active level={level} height={84} color={colors.textSecondary} />
          <Text style={styles.recHint}>Gravando com a tela bloqueada</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      ) : (
        <>
          {interrupted > 0 ? (
            <Pressable style={styles.alert} onPress={() => router.push('/recovery')}>
              <Ionicons name="warning" size={18} color={colors.warning} />
              <Text style={styles.alertText}>
                {interrupted === 1
                  ? 'Uma gravacao foi interrompida'
                  : `${interrupted} gravacoes interrompidas`}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.warning} />
            </Pressable>
          ) : null}

          {pending > 0 ? (
            <Pressable style={styles.queueBar} onPress={kick}>
              <Ionicons name="cloud-upload-outline" size={16} color={colors.accent} />
              <Text style={styles.queueText}>{pending} na fila · Enviar agora</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.accent} />
            </Pressable>
          ) : null}

          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            stickySectionHeadersEnabled={false}
            showsVerticalScrollIndicator={false}
            renderSectionHeader={({ section }) => (
              <Text style={styles.sectionHeader}>{section.title}</Text>
            )}
            renderItem={({ item }) => renderItem(item)}
            ListEmptyComponent={
              <View style={styles.empty}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="document-text-outline" size={30} color={colors.textTertiary} />
                </View>
                <Text style={styles.emptyTitle}>Nenhuma nota</Text>
                <Text style={styles.emptyText}>
                  Toque em + para escrever uma nota ou no botao vermelho para gravar audio.
                </Text>
              </View>
            }
          />
        </>
      )}

      <View style={styles.bottomBar}>
        <RecordButton recording={recording} busy={busy} onPress={handlePress} />
        <Text style={styles.bottomHint}>{recording ? 'Toque para parar' : 'Toque para gravar'}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  headerText: { gap: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  largeTitle: { color: colors.text, fontSize: 34, fontWeight: '700', letterSpacing: 0.3 },
  headerSub: { color: colors.textSecondary, fontSize: fontSize.sm },
  recordingView: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  timer: {
    color: colors.text,
    fontSize: fontSize.display,
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  recHint: { color: colors.textSecondary, fontSize: fontSize.sm },
  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  separator: { height: spacing.sm },
  sectionHeader: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  swipeAction: {
    width: 88,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    borderRadius: 14,
    marginLeft: spacing.sm,
  },
  swipeLabel: { color: '#FFFFFF', fontSize: fontSize.xs, fontWeight: '700' },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    backgroundColor: colors.warningSoft,
    borderRadius: 14,
    padding: spacing.md,
  },
  alertText: { flex: 1, color: colors.warning, fontSize: fontSize.sm, fontWeight: '600' },
  queueBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    backgroundColor: colors.accentSoft,
    borderRadius: 14,
    padding: spacing.md,
  },
  queueText: { flex: 1, color: colors.accent, fontSize: fontSize.sm, fontWeight: '600' },
  empty: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.xxxl },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  emptyText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    lineHeight: 20,
  },
  bottomBar: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  bottomHint: { color: colors.textTertiary, fontSize: fontSize.xs },
});
