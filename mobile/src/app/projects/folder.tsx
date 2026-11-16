import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  buildProjectTree,
  daySeries,
  folderAggregate,
  itemKindCounts,
  pathLabel,
  type ProjectTreeFolderNode,
  type ProjectTreeSessionNode,
} from '@/core/projetoLog';
import type { Recording } from '@/core/types';
import { back, push } from '@/services/appNavigation';
import { getRecording } from '@/services/db';
import { useLibrary } from '@/state/LibraryContext';
import {
  designIcon,
  designRow,
  designSpace,
  designTree,
} from '@/theme/design';
import { ItemLine } from '@/ui/projects/ItemLine';
import { KindMeter, kindSequence } from '@/ui/projects/KindMeter';
import { SessionsAxis, type SessionAxisBar } from '@/ui/projects/SessionsAxis';
import { instant, itensLabel, sessionName, stamp } from '@/ui/projects/format';
import { StateMark } from '@/ui/projects/StateMark';
import { typeStyles } from '@/ui/projects/texts';
import { useDesign } from '@/ui/useDesign';

/**
 * Agregado da pasta (maquina + caminho): sessoes, itens e commits em numero,
 * composicao por kind, sessoes no eixo de tempo real e a lista que abre cada
 * nota de sessao.
 */

/** Primeira e ultima dia de atividade de uma sessao, para o eixo real. */
function sessionSpan(node: ProjectTreeSessionNode): { from: string; to: string } {
  const days = daySeries(node.session.items);
  if (days.length > 0) {
    return { from: days[0].date, to: days[days.length - 1].date };
  }
  return { from: node.session.date, to: node.session.date };
}

export default function ProjectFolderScreen() {
  const colors = useDesign();
  const params = useLocalSearchParams<{ notebook?: string; machine?: string; path?: string }>();

  const machine = params.machine ?? '';
  const path = params.path ?? '';

  const { notebooks, recordings } = useLibrary();

  const mcpNotebook = useMemo(() => {
    const byParam = params.notebook
      ? notebooks.find((notebook) => notebook.id === params.notebook && notebook.kind === 'mcp')
      : undefined;
    return byParam ?? notebooks.find((notebook) => notebook.kind === 'mcp');
  }, [notebooks, params.notebook]);

  const notes = useMemo(
    () =>
      mcpNotebook
        ? recordings.filter((recording) => recording.notebookId === mcpNotebook.id)
        : ([] as Recording[]),
    [recordings, mcpNotebook],
  );

  const [now] = useState(() => Date.now());
  const [bodies, setBodies] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    if (notes.length === 0) return undefined;
    let active = true;
    void (async () => {
      const read = await Promise.all(
        notes.map(async (note) => {
          try {
            const row = await getRecording(note.id);
            return { id: note.id, body: row?.text ?? '' };
          } catch {
            return { id: note.id, body: '' };
          }
        }),
      );
      if (!active) return;
      setBodies(Object.fromEntries(read.map((entry) => [entry.id, entry.body])));
    })();
    return () => {
      active = false;
    };
  }, [notes]);

  const titleByNoteId = useMemo(() => {
    const map: Record<string, string> = {};
    notes.forEach((note) => {
      if (note.title) map[note.id] = note.title;
    });
    return map;
  }, [notes]);

  const folder: ProjectTreeFolderNode | null = useMemo(() => {
    if (bodies === null || !machine || !path) return null;
    const tree = buildProjectTree({
      entries: notes.map((note) => ({ id: note.id, title: note.title })),
      notes: notes.map((note) => ({
        id: note.id,
        title: note.title,
        body: bodies[note.id] ?? '',
        updatedAt: note.updatedAt,
        entryId: note.entryId ?? null,
      })),
      now,
    });
    const machineNode = tree.machines.find((entry) => entry.machine === machine);
    return machineNode?.folders.find((entry) => entry.path === path) ?? null;
  }, [bodies, notes, machine, path, now]);

  const agg = useMemo(() => {
    if (!folder) return null;
    return folderAggregate(folder.sessions.map((node) => node.session));
  }, [folder]);

  const openSession = useCallback(
    (noteId: string) => {
      if (!noteId) return;
      push({
        pathname: '/projects/session',
        params: { notebook: mcpNotebook?.id ?? '', note: noteId },
      });
    },
    [mcpNotebook],
  );

  const header = (
    <View style={styles.header}>
      <Pressable
        testID="back-button"
        onPress={() => back()}
        style={styles.iconButton}
        accessibilityRole="button"
        accessibilityLabel="Voltar"
      >
        <Ionicons name="chevron-back" size={designIcon.lg} color={colors.text} />
      </Pressable>
      <Text
        testID="folder-path"
        style={[typeStyles.mono, styles.pathTitle, { color: colors.textMuted }]}
        numberOfLines={1}
        accessibilityLabel={path !== '' ? `${path}, ${machine}` : 'Pasta'}
      >
        {path !== '' ? pathLabel(path) : 'Pasta'}
      </Text>
      <View style={styles.iconButton} />
    </View>
  );

  if (!agg || !folder) {
    const loading = notes.length > 0 && bodies === null;
    return (
      <View style={[styles.shell, { backgroundColor: colors.surface }]}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
          {header}
          <View style={styles.empty}>
            <Ionicons name="folder-outline" size={designIcon.lg} color={colors.textMuted} />
            <Text style={[typeStyles.body, { color: colors.textMuted }]}>
              {loading ? 'Carregando' : 'Sem pasta'}
            </Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const allItems = agg.sessions.flatMap((session) => session.items);
  const counts = itemKindCounts(allItems);
  const kinds = kindSequence(counts);

  // Barras no eixo real, mais antiga primeiro; a leitura default e a mais nova.
  const bars: SessionAxisBar[] = folder.sessions
    .map((node) => {
      const span = sessionSpan(node);
      return {
        id: node.session.id,
        label: sessionName(titleByNoteId[node.noteId], node.session.session),
        from: span.from,
        to: span.to,
        items: node.session.items.length,
        open: node.session.state !== 'closed',
      };
    })
    .reverse();

  return (
    <View style={[styles.shell, { backgroundColor: colors.surface }]}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        {header}
        <ScrollView
          testID="folder-body"
          style={styles.scroll}
          contentContainerStyle={styles.scrollBody}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.statsRow}>
            <Stat value={agg.sessionCount} label="sessões" testID="stat-sessions" />
            <Stat value={agg.itemCount} label="itens" testID="stat-items" />
            <Stat value={agg.commitCount} label="commits" testID="stat-commits" />
          </View>

          <Text style={[typeStyles.label, styles.sectionLabel, { color: colors.textMuted }]}>
            Itens por kind
          </Text>
          <KindMeter items={allItems} stretch />
          <Text testID="folder-legend" style={[typeStyles.mono, styles.legend, { color: colors.textMuted }]}>
            {kinds.map((kind) => `${counts[kind]} ${kind}`).join(' · ')}
          </Text>

          <Text style={[typeStyles.label, styles.sectionLabel, { color: colors.textMuted }]}>
            Sessões no tempo
          </Text>
          <SessionsAxis bars={bars} />

          <Text style={[typeStyles.label, styles.sectionLabel, { color: colors.textMuted }]}>
            Sessões
          </Text>
          {folder.sessions.map((node) => {
            const name = sessionName(titleByNoteId[node.noteId], node.session.session);
            return (
              <Pressable
                key={node.session.id}
                testID={`folder-session-${node.session.id}`}
                style={[styles.sessRow, { borderBottomColor: colors.line }]}
                onPress={() => openSession(node.noteId)}
                accessibilityRole="button"
                accessibilityLabel={`${name}, ${stamp(node.session.date, node.session.time)}, ${itensLabel(node.session.items.length)}`}
              >
                <Ionicons name="document-text-outline" size={designIcon.md} color={colors.textMuted} />
                <View style={styles.sessMain}>
                  <View style={styles.line1}>
                    <Text style={[typeStyles.body, styles.strong, { color: colors.text }]} numberOfLines={1}>
                      {name}
                    </Text>
                    <StateMark state={node.session.state} />
                  </View>
                  <View style={styles.line2}>
                    <Text style={[typeStyles.mono, styles.shrink, { color: colors.textMuted }]} numberOfLines={1}>
                      {`${instant(node.session.opened) || stamp(node.session.date, node.session.time)} · ${itensLabel(node.session.items.length)}`}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          })}

          <Text style={[typeStyles.label, styles.sectionLabel, { color: colors.textMuted }]}>
            Itens
          </Text>
          {allItems.map((item, at) => (
            <ItemLine
              key={`${item.title}:${at}`}
              item={item}
              onOpen={() => {
                const owner = folder.sessions.find((node) => node.session.items.includes(item));
                if (owner) openSession(owner.noteId);
              }}
            />
          ))}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/** Numero grande com rotulo de uma palavra, como na galeria. */
function Stat({ value, label, testID }: { value: number; label: string; testID: string }) {
  const colors = useDesign();
  return (
    <View style={styles.stat}>
      <Text testID={testID} style={[typeStyles.display, { color: colors.text }]}>
        {value}
      </Text>
      <Text style={[typeStyles.label, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  safe: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: designSpace.s8,
    paddingVertical: designSpace.s6,
    gap: designSpace.s4,
  },
  iconButton: {
    width: designRow.touch,
    height: designRow.touch,
    alignItems: 'center',
    justifyContent: 'center',
    marginStart: -designSpace.s8,
  },
  pathTitle: { flex: 1 },

  scroll: { flex: 1 },
  scrollBody: {
    paddingHorizontal: designSpace.s16,
    paddingBottom: designRow.touch,
    gap: designSpace.s4,
  },

  statsRow: {
    flexDirection: 'row',
    gap: designSpace.s16 * 2,
    marginTop: designSpace.s8,
  },
  stat: { gap: designSpace.s2 },

  sectionLabel: {
    marginTop: designSpace.s12,
    marginBottom: designSpace.s2,
  },
  legend: {},

  sessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpace.s6,
    minHeight: designRow.touch,
    paddingVertical: designSpace.s6,
    borderBottomWidth: designTree.guide,
  },
  sessMain: { flex: 1, gap: designSpace.s2 },
  line1: { flexDirection: 'row', alignItems: 'center', gap: designSpace.s6 },
  line2: { flexDirection: 'row', alignItems: 'center', gap: designSpace.s4 },
  strong: { fontFamily: typeStyles.title.fontFamily },
  shrink: { flexShrink: 1 },

  empty: { alignItems: 'center', gap: designSpace.s12, paddingTop: designRow.touch * 3 },
});
