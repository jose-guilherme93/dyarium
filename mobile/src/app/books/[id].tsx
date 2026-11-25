import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';
import { Screen } from '@/components/Screen';
import {
  bookPages,
  bookProgress,
  bookWords,
  chapterGroups,
  chapterNumber,
  formatWords,
  orderedChapters,
} from '@/core/books';
import { noteStats } from '@/core/noteStats';
import type { Recording } from '@/core/types';
import { back, push } from '@/services/appNavigation';
import { useLibrary } from '@/state/LibraryContext';
import {
  designFont,
  designIcon,
  designMark,
  designMeter,
  designRadius,
  designRow,
  designSpace,
  designType,
  type DesignColors,
} from '@/theme/design';
import { useDesign } from '@/ui/useDesign';

const COVER_WIDTH = 132;
const COVER_HEIGHT = (COVER_WIDTH * 21) / 14;
const DEFAULT_COVER = '#b8c4c8';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** Texto legível sobre a cor da capa (fundo claro → escuro, fundo escuro → claro). */
function coverInk(color: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return '#f6f4ef';
  const value = Number.parseInt(match[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#211e1a' : '#f6f4ef';
}

function romanPart(index: number): string {
  return ROMAN[index] ?? String(index + 1);
}

function nounLabel(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${formatWords(count)} ${nounLabel(count, singular, plural)}`;
}

function wordCountLabel(count: number): string {
  return countLabel(count, 'palavra', 'palavras');
}

function kindPrefix(kind?: string): string {
  if (kind === 'front') return 'F';
  if (kind === 'back') return 'P';
  return '';
}

function partTitle(part: Recording, index: number): string {
  const title = part.title.trim();
  if (title.startsWith('Parte')) return title;
  return `Parte ${romanPart(index)} · ${title}`;
}

function chapterWordCount(chapter: Recording): number {
  return noteStats(chapter.text ?? '').words;
}

function isTextEmpty(chapter: Recording): boolean {
  return chapterWordCount(chapter) === 0 && !(chapter.text ?? '').trim();
}

function statusDotStyle(status: string | undefined, colors: DesignColors) {
  if (status === 'done') {
    return { backgroundColor: colors.success };
  }
  if (status === 'revising') {
    return { backgroundColor: colors.warning };
  }
  return {
    backgroundColor: 'transparent',
    borderWidth: designMark.stroke,
    borderColor: colors.textMuted,
  };
}

function StatusDot({ status }: { status?: string }) {
  const colors = useDesign();
  return (
    <View
      style={[
        styles.statusDot,
        statusDotStyle(status, colors),
      ]}
    />
  );
}

export default function BookScreen() {
  const colors = useDesign();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { notebooks, recordings } = useLibrary();

  const notebook = useMemo(
    () => notebooks.find((item) => item.id === id && item.kind === 'book'),
    [notebooks, id],
  );

  const chapters = useMemo(
    () => orderedChapters(recordings.filter((recording) => recording.notebookId === id)),
    [recordings, id],
  );

  const words = useMemo(() => bookWords(chapters), [chapters]);
  const pages = useMemo(() => bookPages(words), [words]);
  const progress = useMemo(
    () => bookProgress(words, notebook?.goalWords ?? 0),
    [words, notebook?.goalWords],
  );

  const continueChapter = useMemo(() => {
    const notDone = chapters.find(
      (chapter) => chapter.chapterKind === 'chapter' && chapter.chapterStatus !== 'done',
    );
    return notDone ?? chapters.find((chapter) => chapter.chapterKind === 'chapter');
  }, [chapters]);

  const groups = useMemo(() => chapterGroups(chapters), [chapters]);

  const openNote = (noteId: string) => {
    push({ pathname: '/note/[id]', params: { id: noteId } });
  };

  const header = (
    <Press
      onPress={() => back()}
      style={styles.backRow}
      accessibilityRole="button"
      accessibilityLabel="Voltar para cadernos"
    >
      <Ionicons name="chevron-back" size={20} color={colors.primary} />
      <Text style={[styles.backText, { color: colors.primary }]}>Cadernos</Text>
    </Press>
  );

  if (!notebook) {
    return (
      <Screen>
        {header}
        <View testID="book-empty" style={styles.empty}>
          <Ionicons name="library-outline" size={designIcon.lg} color={colors.textMuted} />
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>Livro não encontrado</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      {header}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <View
          style={[
            styles.cover,
            {
              width: COVER_WIDTH,
              height: COVER_HEIGHT,
              backgroundColor: notebook.color || DEFAULT_COVER,
            },
          ]}
          // A capa real do cofre ainda não é baixada no app.
        >
          <Text style={[styles.coverKind, { color: coverInk(notebook.color || DEFAULT_COVER) }]}>Livro</Text>
          <Text
            style={[styles.coverTitle, { color: coverInk(notebook.color || DEFAULT_COVER) }]}
            numberOfLines={3}
          >
            {notebook.name}
          </Text>
          {notebook.subtitle ? (
            <Text style={[styles.coverFoot, { color: coverInk(notebook.color || DEFAULT_COVER) }]} numberOfLines={1}>
              {notebook.subtitle}
            </Text>
          ) : null}
        </View>

        <View style={styles.head}>
          <Text testID="book-title" style={[styles.display, { color: colors.text }]} numberOfLines={2}>
            {notebook.name}
          </Text>
          <Text style={[styles.byline, { color: colors.textMuted }]}>
            {notebook.author && notebook.subtitle
              ? `por ${notebook.author} · ${notebook.subtitle}`
              : notebook.author
                ? `por ${notebook.author}`
                : notebook.subtitle ?? ''}
          </Text>
        </View>

        <View testID="book-stats" style={styles.stats}>
          <Stat value={String(chapters.filter((c) => c.chapterKind === 'chapter').length)} label={nounLabel(chapters.filter((c) => c.chapterKind === 'chapter').length, 'capítulo', 'capítulos')} />
          <Text style={[styles.muted, { color: colors.textMuted }]}>·</Text>
          <Stat value={formatWords(words)} label={nounLabel(words, 'palavra', 'palavras')} />
          <Text style={[styles.muted, { color: colors.textMuted }]}>·</Text>
          <Stat value={`≈${pages}`} label={nounLabel(pages, 'página', 'páginas')} />
        </View>

        {notebook.goalWords ? (
          <View testID="book-goal" style={styles.goal}>
            <View style={[styles.track, { backgroundColor: colors.line }]}>
              <View
                style={[
                  styles.fill,
                  { backgroundColor: colors.primary, width: `${progress}%` },
                ]}
              />
            </View>
            <Text style={[styles.mono, { color: colors.textMuted }]}>{progress}%</Text>
            <Text style={[styles.muted, { color: colors.textMuted }]}>
              da meta de {wordCountLabel(notebook.goalWords)}
            </Text>
          </View>
        ) : null}

        {continueChapter ? (
          <Press
            testID="continue-row"
            onPress={() => openNote(continueChapter.id)}
            style={[styles.continue, { backgroundColor: colors.surfaceRaised }]}
            accessibilityRole="button"
            accessibilityLabel={`Continuar no Capítulo ${chapterNumber(
              chapters,
              continueChapter.id,
            )}, ${continueChapter.title}`}
          >
            <StatusDot status={continueChapter.chapterStatus} />
            <View style={styles.continueMain}>
              <Text style={[styles.continueLabel, { color: colors.textMuted }]}>Continuar no</Text>
              <Text style={[styles.continueTitle, { color: colors.text }]}>
                Capítulo {chapterNumber(chapters, continueChapter.id)} · {continueChapter.title}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.primary} />
          </Press>
        ) : null}

        {groups.length === 0 ? (
          <View testID="book-empty" style={styles.empty}>
            <Ionicons name="library-outline" size={designIcon.lg} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>Nenhum capítulo</Text>
          </View>
        ) : (
          groups.map((group, groupIndex) => {
            const partIndex = groups.slice(0, groupIndex).filter((g) => g.part).length;
            return (
              <View key={groupIndex} style={styles.group}>
                {group.part ? (
                  <View testID={`part-row-${groupIndex}`} style={styles.partRow}>
                    <Text
                      style={[styles.partTitle, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {partTitle(group.part, partIndex)}
                    </Text>
                  </View>
                ) : null}
                {group.items.map((chapter) => {
                  const number = chapterNumber(chapters, chapter.id);
                  const wordsInChapter = chapterWordCount(chapter);
                  const empty = isTextEmpty(chapter);
                  return (
                    <Press
                      testID={`chapter-row-${chapter.id}`}
                      key={chapter.id}
                      onPress={() => openNote(chapter.id)}
                      style={[styles.chapter, { backgroundColor: colors.surfaceRaised }]}
                      accessibilityRole="button"
                      accessibilityLabel={`${
                        chapter.chapterKind === 'chapter' ? `Capítulo ${number}` : kindPrefix(chapter.chapterKind)
                      }, ${chapter.title}${empty ? ', vazio' : `, ${formatWords(wordsInChapter)} palavras`}`}
                    >
                      <Text style={[styles.chapterNum, { color: colors.textMuted }]}>
                        {chapter.chapterKind === 'chapter' ? number : kindPrefix(chapter.chapterKind)}
                      </Text>
                      <View style={styles.chapterMain}>
                        <View style={styles.chapterTop}>
                          <Text
                            style={[styles.chapterTitle, { color: colors.text }]}
                            numberOfLines={1}
                          >
                            {chapter.title}
                          </Text>
                          <StatusDot status={chapter.chapterStatus} />
                        </View>
                        <Text style={[styles.chapterMeta, { color: colors.textMuted }]}>
                          {empty ? 'vazio' : `${formatWords(wordsInChapter)} palavras`}
                        </Text>
                        {chapter.chapterSynopsis ? (
                          <Text
                            style={[styles.chapterSynopsis, { color: colors.textMuted }]}
                            numberOfLines={1}
                          >
                            {chapter.chapterSynopsis}
                          </Text>
                        ) : null}
                      </View>
                    </Press>
                  );
                })}
              </View>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const colors = useDesign();
  return (
    <View style={styles.stat}>
      <Text style={[styles.mono, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.muted, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpace.s4,
    minHeight: designRow.touch,
    paddingHorizontal: designSpace.s16,
  },
  backText: {
    fontFamily: designFont.regular,
    fontSize: designType.body.size,
    fontWeight: designType.body.weight,
    lineHeight: designType.body.size * designType.body.lineHeight,
  },
  scroll: {
    paddingHorizontal: designSpace.s16,
    paddingBottom: designSpace.s16,
  },
  cover: {
    alignSelf: 'center',
    borderRadius: designRadius.surface,
    alignItems: 'center',
    justifyContent: 'center',
    padding: designSpace.s12,
    marginBottom: designSpace.s16,
  },
  coverKind: {
    fontFamily: designFont.regular,
    fontSize: designType.label.size,
    fontWeight: designType.label.weight,
    lineHeight: designType.label.size * designType.label.lineHeight,
    letterSpacing: designType.label.letterSpacing,
    textTransform: 'uppercase',
    opacity: 0.8,
    marginBottom: 'auto',
  },
  coverTitle: {
    fontFamily: designFont.semibold,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 18 * 1.15,
    letterSpacing: -0.01,
    textAlign: 'center',
    marginVertical: 'auto',
  },
  coverFoot: {
    fontFamily: designFont.regular,
    fontSize: designType.mono.size,
    lineHeight: designType.mono.size * designType.mono.lineHeight,
    opacity: 0.85,
    marginTop: 'auto',
  },
  head: {
    alignItems: 'center',
    marginBottom: designSpace.s16,
  },
  display: {
    fontFamily: designFont.semibold,
    fontSize: designType.display.size,
    fontWeight: designType.display.weight,
    lineHeight: designType.display.size * designType.display.lineHeight,
    letterSpacing: designType.display.letterSpacing,
    textAlign: 'center',
  },
  byline: {
    fontFamily: designFont.regular,
    fontSize: designType.body.size,
    lineHeight: designType.body.size * designType.body.lineHeight,
    textAlign: 'center',
    marginTop: designSpace.s4,
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: designSpace.s8,
    marginBottom: designSpace.s12,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: designSpace.s4,
  },
  goal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designMeter.gap,
    marginBottom: designSpace.s16,
  },
  track: {
    flex: 1,
    height: designMeter.height,
    borderRadius: designMeter.height,
    overflow: 'hidden',
  },
  fill: {
    height: designMeter.height,
    borderRadius: designMeter.height,
  },
  continue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpace.s12,
    minHeight: designRow.touch,
    padding: designSpace.s12,
    borderRadius: designRadius.surface,
    marginBottom: designSpace.s16,
  },
  continueMain: {
    flex: 1,
    gap: designSpace.s2,
  },
  continueLabel: {
    fontFamily: designFont.regular,
    fontSize: designType.body.size,
    lineHeight: designType.body.size * designType.body.lineHeight,
  },
  continueTitle: {
    fontFamily: designFont.semibold,
    fontSize: designType.title.size,
    fontWeight: designType.title.weight,
    lineHeight: designType.title.size * designType.title.lineHeight,
  },
  group: {
    gap: designSpace.s6,
    marginBottom: designSpace.s16,
  },
  partRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpace.s8,
    paddingHorizontal: designSpace.s12,
    paddingTop: designSpace.s12,
    paddingBottom: designSpace.s8,
  },
  partTitle: {
    fontFamily: designFont.semibold,
    fontSize: designType.body.size,
    fontWeight: designType.body.weight,
    lineHeight: designType.body.size * designType.body.lineHeight,
  },
  chapter: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: designSpace.s12,
    minHeight: designRow.touch,
    paddingHorizontal: designSpace.s12,
    paddingVertical: designSpace.s8,
    borderRadius: designRadius.surface,
  },
  chapterNum: {
    width: 22,
    textAlign: 'right',
    fontFamily: designFont.regular,
    fontSize: designType.mono.size,
    lineHeight: designType.mono.size * designType.mono.lineHeight,
    letterSpacing: designType.mono.letterSpacing,
    fontVariant: ['tabular-nums'],
    paddingTop: 1,
  },
  chapterMain: {
    flex: 1,
    gap: designSpace.s2,
  },
  chapterTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpace.s8,
  },
  chapterTitle: {
    flex: 1,
    fontFamily: designFont.semibold,
    fontSize: designType.body.size,
    fontWeight: designType.body.weight,
    lineHeight: designType.body.size * designType.body.lineHeight,
  },
  chapterMeta: {
    fontFamily: designFont.regular,
    fontSize: designType.mono.size,
    lineHeight: designType.mono.size * designType.mono.lineHeight,
    letterSpacing: designType.mono.letterSpacing,
    fontVariant: ['tabular-nums'],
  },
  chapterSynopsis: {
    fontFamily: designFont.regular,
    fontSize: designType.body.size,
    lineHeight: designType.body.size * 1.35,
  },
  empty: {
    alignItems: 'center',
    gap: designSpace.s12,
    paddingTop: designRow.touch * 2,
  },
  emptyText: {
    fontFamily: designFont.regular,
    fontSize: designType.body.size,
    lineHeight: designType.body.size * designType.body.lineHeight,
  },
  statusDot: {
    width: designMark.size,
    height: designMark.size,
    borderRadius: designMark.size / 2,
  },
  label: {
    fontFamily: designFont.regular,
    fontSize: designType.label.size,
    fontWeight: designType.label.weight,
    lineHeight: designType.label.size * designType.label.lineHeight,
    letterSpacing: designType.label.letterSpacing,
    textTransform: 'uppercase',
  },
  mono: {
    fontFamily: designFont.regular,
    fontSize: designType.mono.size,
    lineHeight: designType.mono.size * designType.mono.lineHeight,
    letterSpacing: designType.mono.letterSpacing,
    fontVariant: ['tabular-nums'],
  },
  muted: {
    fontFamily: designFont.regular,
    fontSize: designType.body.size,
    lineHeight: designType.body.size * designType.body.lineHeight,
  },
});
