import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  daySeries,
  parseSessionNote,
  pathLabel,
  type SessionNote,
} from '@/core/projetoLog';
import { back, push } from '@/services/appNavigation';
import { getRecording } from '@/services/db';
import { useLibrary } from '@/state/LibraryContext';
import {
  designControl,
  designIcon,
  designRadius,
  designRow,
  designSpace,
  designTree,
} from '@/theme/design';
import { DayColumns } from '@/ui/projects/DayColumns';
import { ItemLine } from '@/ui/projects/ItemLine';
import { instant, itensLabel, sessionName, stamp } from '@/ui/projects/format';
import { StateMark } from '@/ui/projects/StateMark';
import { typeStyles } from '@/ui/projects/texts';
import { useDesign } from '@/ui/useDesign';

/**
 * Leitura da nota de sessao (fence v2): caminho em mono no cabecalho, nome da
 * sessao como titulo, meta, resumo, itens e — no fim — o grafico de colunas
 * por dia de calendario. Nenhum paragrafo explica a tela; o fence fica oculto.
 */
export default function ProjectSessionScreen() {
  const colors = useDesign();
  const params = useLocalSearchParams<{ notebook?: string; note?: string }>();
  const { recordings } = useLibrary();

  const noteId = params.note ?? '';
  const recording = useMemo(
    () => recordings.find((entry) => entry.id === noteId),
    [recordings, noteId],
  );

  // Uma leitura do relogio por montagem; o estado derivado nao pode mudar a
  // cada render.
  const [now] = useState(() => Date.now());
  const [body, setBody] = useState<string | null>(null);

  useEffect(() => {
    if (!noteId) return undefined;
    let active = true;
    void (async () => {
      try {
        const row = await getRecording(noteId);
        if (active) setBody(row?.text ?? '');
      } catch {
        if (active) setBody('');
      }
    })();
    return () => {
      active = false;
    };
  }, [noteId]);

  const session: SessionNote | null = useMemo(() => {
    if (!noteId || body === null) return null;
    return parseSessionNote(
      { id: noteId, body, updatedAt: recording?.updatedAt },
      now,
    );
  }, [body, noteId, recording, now]);

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
        testID="session-path"
        style={[typeStyles.mono, styles.pathTitle, { color: colors.textMuted }]}
        numberOfLines={1}
        accessibilityLabel={session ? `${session.path}, ${session.machine}` : 'Sessão'}
      >
        {session ? pathLabel(session.path) : 'Sessão'}
      </Text>
      <Pressable
        testID="open-note"
        onPress={() => {
          if (noteId) push({ pathname: '/note/[id]', params: { id: noteId } });
        }}
        style={[styles.noteBtn, { borderColor: colors.line }]}
        accessibilityRole="button"
        accessibilityLabel="Abrir nota"
        hitSlop={designSpace.s4}
      >
        <Text style={[typeStyles.label, { color: colors.textMuted }]}>Nota</Text>
      </Pressable>
    </View>
  );

  if (noteId !== '' && body === null) {
    return (
      <View style={[styles.shell, { backgroundColor: colors.surface }]}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
          {header}
          <View testID="session-loading" pointerEvents="none" accessibilityLabel="Carregando" style={styles.skeleton}>
            {[0, 1, 2].map((row) => (
              <View key={row} style={styles.skeletonRow}>
                <View style={[styles.skeletonLine, { backgroundColor: colors.surfaceAlt }]} />
              </View>
            ))}
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (!session) {
    return (
      <View style={[styles.shell, { backgroundColor: colors.surface }]}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
          {header}
          <View style={styles.empty}>
            <Ionicons name="albums-outline" size={designIcon.lg} color={colors.textMuted} />
            <Text style={[typeStyles.body, { color: colors.textMuted }]}>Sem sessão</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const name = sessionName(recording?.title, session.session);
  const commits = session.commits.length;
  const series = daySeries(session.items);
  const opened = instant(session.opened) || stamp(session.date, session.time);
  const closed = session.closed ? instant(session.closed) : '';

  return (
    <View style={[styles.shell, { backgroundColor: colors.surface }]}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        {header}
        <ScrollView
          testID="session-body"
          style={styles.scroll}
          contentContainerStyle={styles.scrollBody}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.line1}>
            <Text testID="session-name" style={[typeStyles.title, styles.title, { color: colors.text }]}>
              {name}
            </Text>
            <StateMark state={session.state} />
          </View>
          <View style={styles.metaRow}>
            <Text style={[typeStyles.mono, styles.shrink, { color: colors.textMuted }]}>
              {closed ? `${opened} – ${closed}` : opened}
            </Text>
            <Text style={[typeStyles.mono, styles.shrink, { color: colors.textMuted }]}>
              {`· ${session.machine}`}
            </Text>
            <Text style={[typeStyles.mono, { color: colors.textMuted }]}>
              {`· ${itensLabel(session.items.length)}`}
            </Text>
            {commits > 0 ? (
              <Text style={[typeStyles.mono, { color: colors.textMuted }]}>
                {`· ${commits} commits`}
              </Text>
            ) : null}
          </View>

          {session.summary ? (
            <Text testID="session-summary" style={[typeStyles.body, styles.summary, { color: colors.text }]}>
              {session.summary}
            </Text>
          ) : null}

          <View style={[styles.rule, { backgroundColor: colors.line }]} />

          <Text style={[typeStyles.label, styles.sectionLabel, { color: colors.textMuted }]}>
            Itens
          </Text>
          {session.items.length > 0 ? (
            session.items.map((item, at) => (
              <ItemLine
                key={`${item.title}:${at}`}
                item={item}
                onOpen={() => push({ pathname: '/note/[id]', params: { id: noteId } })}
              />
            ))
          ) : (
            <Text style={[typeStyles.mono, { color: colors.textMuted }]}>{itensLabel(0)}</Text>
          )}

          <Text style={[typeStyles.label, styles.sectionLabel, { color: colors.textMuted }]}>
            Itens por dia
          </Text>
          <DayColumns series={series} />
        </ScrollView>
      </SafeAreaView>
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
  noteBtn: {
    height: designControl.sm,
    paddingHorizontal: designControl.padSm,
    borderRadius: designRadius.control,
    borderWidth: designTree.guide,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: { flex: 1 },
  scrollBody: {
    paddingHorizontal: designSpace.s16,
    paddingBottom: designRow.touch,
    gap: designSpace.s4,
  },

  line1: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpace.s8,
    marginTop: designSpace.s8,
  },
  title: { flex: 1 },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: designSpace.s4,
    alignItems: 'center',
  },
  shrink: { flexShrink: 1 },
  summary: { marginTop: designSpace.s8 },

  rule: {
    height: designTree.guide,
    marginTop: designSpace.s12,
    marginBottom: designSpace.s4,
  },
  sectionLabel: {
    marginTop: designSpace.s12,
    marginBottom: designSpace.s2,
  },

  empty: { alignItems: 'center', gap: designSpace.s12, paddingTop: designRow.touch * 3 },

  skeleton: { paddingHorizontal: designSpace.s16, paddingTop: designSpace.s12, gap: designSpace.s8 },
  skeletonRow: { flexDirection: 'row' },
  skeletonLine: {
    height: Math.round(designControl.md / 2),
    flex: 1,
    borderRadius: designRadius.control,
  },
});
