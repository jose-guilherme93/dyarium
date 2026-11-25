import { Ionicons } from '@expo/vector-icons';
import { memo, useMemo, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, TextInput, View } from 'react-native';

import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';
import { Screen } from '@/components/Screen';
import {
  MONTHS,
  WEEKDAY_LABELS,
  dayKey,
  groupNotesByDay,
  noteTimeLabel,
  notesInOtherYears,
} from '@/core/calendar';
import { DEFAULT_NOTEBOOK_ID, bookNotebookIds, noteNotebooks } from '@/core/notebooks';
import { recordingNotebookId } from '@/core/notebookFilter';
import { displayTitle } from '@/core/title';
import type { Recording } from '@/core/types';
import { back, push } from '@/services/appNavigation';
import { useLibrary } from '@/state/LibraryContext';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

const WEEKDAY_NAMES = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
];

/** Altura fixa de cada dia: seis semanas sempre, sem esticar para a tela. */
const CELL_HEIGHT = 38;
const WEEKDAY_HEIGHT = 22;
const GRID_HEIGHT = WEEKDAY_HEIGHT + CELL_HEIGHT * 6;

function readableDot(color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  const hex = color.replace('#', '');
  if (hex.length !== 6) return fallback;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.42 ? fallback : color;
}

interface MonthGridProps {
  year: number;
  month: number;
  width: number;
  height: number;
  today: string;
  byDay: Map<string, Recording[]>;
  onOpenDay(key: string): void;
}

/**
 * Uma pagina do calendario: a grade de um mes. Fica montada so enquanto esta
 * perto da tela (a FlatList virtualiza), e so o dia de hoje recebe destaque.
 */
const MonthGrid = memo(function MonthGrid({
  year,
  month,
  width,
  height,
  today,
  byDay,
  onOpenDay,
}: MonthGridProps) {
  const styles = useThemedStyles(baseStyles);
  const first = new Date(year, month, 1);
  // A pagina comeca no dia 1, no canto superior esquerdo. A ordem dos rotulos
  // acompanha o primeiro dia do mes, para a coluna continuar dizendo a verdade.
  const offset = (first.getDay() + 6) % 7;
  const labels = [
    ...WEEKDAY_LABELS.slice(offset),
    ...WEEKDAY_LABELS.slice(0, offset),
  ];
  const total = new Date(year, month + 1, 0).getDate();
  // Sempre seis semanas na pagina: a celula tem a mesma altura em qualquer
  // mes, com uma linha vazia no fim quando o mes cabe em cinco.
  const slots = Array.from({ length: 42 }, (_, index) =>
    index < total ? dayKey(new Date(year, month, index + 1)) : null,
  );
  const rows: (string | null)[][] = [];
  for (let index = 0; index < slots.length; index += 7) {
    rows.push(slots.slice(index, index + 7));
  }

  return (
    <View style={{ width, height }}>
      <View style={styles.weekdays}>
        {labels.map((label) => (
          <Text key={label} style={styles.weekdayLabel}>
            {label}
          </Text>
        ))}
      </View>
      <View style={styles.pageGrid}>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.week}>
            {row.every((slot) => slot === null)
              ? null
              : row.map((key, columnIndex) => {
                  if (!key) {
                    return <View key={`blank-${columnIndex}`} style={styles.cell} />;
                  }
                  const day = Number(key.slice(8, 10));
                  const list = byDay.get(key) ?? [];
                  const isToday = key === today;
                  return (
                    <Press
                      key={key}
                      onPress={() => onOpenDay(key)}
                      accessibilityLabel={`${day} de ${MONTHS[month]}, ${list.length} ${
                        list.length === 1 ? 'nota' : 'notas'
                      }`}
                      style={styles.cell}
                    >
                      <View style={[styles.daynum, isToday && styles.daynumToday]}>
                        <Text
                          style={[styles.daynumText, isToday && styles.daynumTextToday]}
                        >
                          {day}
                        </Text>
                      </View>
                      {list.length > 0 ? (
                        <Text style={styles.cellCount}>+{list.length}</Text>
                      ) : null}
                    </Press>
                  );
                })}
          </View>
        ))}
      </View>
    </View>
  );
});


/**
 * Calendario das notas.
 *
 * As paginas sao meses numa FlatList horizontal com paging nativo: o gesto e o
 * deslize sao do proprio sistema, sem animacao em JavaScript. Cada dia mostra
 * as notas daquele dia; tocar abre a folha do dia, de onde a nota abre no
 * editor ou nasce uma nota nova. So o dia de hoje fica destacado.
 */
export default function CalendarScreen() {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();
  const { recordings, notebooks, createTextNote } = useLibrary();
  const now = new Date();
  const today = dayKey(now);
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [selected, setSelected] = useState(today);
  const [draft, setDraft] = useState('');
  const [pageWidth, setPageWidth] = useState(0);
  const [front, setFront] = useState<'a' | 'b'>('a');
  const [dir, setDir] = useState<'next' | 'prev'>('next');
  const [aX] = useState(() => new Animated.Value(0));
  const [bX] = useState(() => new Animated.Value(0));
  const touchX = useRef(0);
  const swipeDone = useRef(false);

  const scoped = useMemo(() => {
    const books = bookNotebookIds(notebooks);
    return recordings.filter(
      (note) =>
        !note.deletedAt && !note.archived && !books.has(recordingNotebookId(note)),
    );
  }, [recordings, notebooks]);

  const byDay = useMemo(() => groupNotesByDay(scoped), [scoped]);

  const notebookById = useMemo(
    () => new Map(noteNotebooks(notebooks).map((notebook) => [notebook.id, notebook])),
    [notebooks],
  );

  // Cor de cada nota resolvida uma vez por carga, nao a cada pagina montada.
  const dotById = useMemo(() => {
    const map = new Map<string, string>();
    for (const note of scoped) {
      map.set(
        note.id,
        readableDot(
          notebookById.get(recordingNotebookId(note))?.color,
          colors.textSecondary,
        ),
      );
    }
    return map;
  }, [scoped, notebookById, colors.textSecondary]);

  const valueOf = (slot: 'a' | 'b') => (slot === 'a' ? aX : bX);
  const frontValue = () => valueOf(front);
  const backValue = () => valueOf(front === 'a' ? 'b' : 'a');
  const sideOf = (d: 'next' | 'prev') => (d === 'next' ? 1 : -1);
  const standby = new Date(cursor.year, cursor.month + sideOf(dir), 1);

  // Trocar de mes nao mexe no dia escolhido: o painel so muda quando o usuario
  // toca num dia.
  const shiftMonth = (delta: number) => {
    const date = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: date.getFullYear(), month: date.getMonth() });
  };

  const placeIdle = (width: number) => {
    frontValue().setValue(0);
    backValue().setValue(sideOf(dir) * width);
  };

  // Uma unica animacao para setas e deslize: a camada da frente sai, a de tras
  // entra, e a que saiu (ja fora da tela) e reposicionada sem ninguem ver.
  const commit = (delta: 1 | -1, wanted: 'next' | 'prev') => {
    const width = pageWidth;
    if (width <= 0) return;
    const out = frontValue();
    const incoming = backValue();
    const timing = (value: Animated.Value, toValue: number) =>
      Animated.timing(value, {
        toValue,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
    Animated.parallel([timing(out, -delta * width), timing(incoming, 0)]).start(
      ({ finished }) => {
        if (!finished) return;
        const oldFront = front;
        setFront(oldFront === 'a' ? 'b' : 'a');
        shiftMonth(delta);
        valueOf(oldFront).setValue(sideOf(wanted) * width);
      },
    );
  };

  const slideTo = (delta: 1 | -1) => {
    const width = pageWidth;
    if (width <= 0) return;
    const wanted = delta > 0 ? 'next' : 'prev';
    if (wanted !== dir) {
      setDir(wanted);
      backValue().setValue(sideOf(wanted) * width);
      // Um quadro para o React montar o mes vizinho antes da animacao.
      requestAnimationFrame(() => commit(delta, wanted));
      return;
    }
    commit(delta, wanted);
  };

  const dragXOf = (pageX: number) => pageX - touchX.current;
  const endSwipe = (pageX: number) => {
    if (swipeDone.current) return;
    swipeDone.current = true;
    const dx = dragXOf(pageX);
    if (dx <= -48) slideTo(1);
    else if (dx >= 48) slideTo(-1);
  };

  const openDay = (key: string) => {
    setSelected(key);
    setDraft('');
  };

  const goToday = () => {
    setCursor({ year: now.getFullYear(), month: now.getMonth() });
    setSelected(today);
    setDraft('');
    placeIdle(pageWidth);
  };

  const openNote = (note: Recording) => {
    push(`/note/${note.id}`);
  };

  // Nota nasce sempre com a data de geracao: escrever so vale para hoje.
  const canWrite = selected === today;
  const selectedDate = new Date(`${selected}T12:00:00`);
  const dayNotes = byDay.get(selected) ?? [];
  const otherYears = useMemo(() => notesInOtherYears(scoped, selected), [scoped, selected]);

  const write = () => {
    const title = draft.trim();
    if (!title || !canWrite) return;
    setDraft('');
    void createTextNote({
      title,
      text: '',
      notebookId: DEFAULT_NOTEBOOK_ID,
    });
  };

  const dotColor = (note: Recording) => dotById.get(note.id) ?? colors.textSecondary;

  return (
    <Screen>
      <View style={styles.head}>
        <Press onPress={back} style={styles.iconButton} accessibilityLabel="Voltar">
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Press>
        <View style={styles.monthWrap}>
          <Text style={styles.month}>{MONTHS[cursor.month]}</Text>
          <Text style={styles.year}>{cursor.year}</Text>
        </View>
        <View style={styles.nav}>
          <Press
            onPress={() => slideTo(-1)}
            style={styles.iconButton}
            accessibilityLabel="Mês anterior"
          >
            <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
          </Press>
          <Press
            onPress={() => slideTo(1)}
            style={styles.iconButton}
            accessibilityLabel="Próximo mês"
          >
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Press>
          <Press onPress={goToday} style={styles.todayButton} accessibilityLabel="Hoje">
            <Text style={styles.todayText}>hoje</Text>
          </Press>
        </View>
      </View>

      <View
        style={styles.gridGutter}
        onTouchStart={(event) => {
          touchX.current = event.nativeEvent.pageX;
          swipeDone.current = false;
        }}
        onMoveShouldSetResponder={(event) =>
          Math.abs(dragXOf(event.nativeEvent.pageX)) > 12
        }
        onResponderRelease={(event) => endSwipe(event.nativeEvent.pageX)}
        onResponderTerminationRequest={() => true}
      >
        <View
          style={[styles.grid, { opacity: pageWidth > 0 ? 1 : 0 }]}
          onLayout={(event) => {
            const width = Math.round(event.nativeEvent.layout.width);
            if (!width || width === pageWidth) return;
            setPageWidth(width);
            placeIdle(width);
          }}
        >
          {(['a', 'b'] as const).map((slot) => {
            const isFront = slot === front;
            const year = isFront ? cursor.year : standby.getFullYear();
            const month = isFront ? cursor.month : standby.getMonth();
            return (
              <Animated.View
                key={slot}
                style={[
                  styles.page,
                  {
                    width: pageWidth,
                    transform: [{ translateX: slot === 'a' ? aX : bX }],
                  },
                ]}
              >
                <MonthGrid
                  year={year}
                  month={month}
                  width={pageWidth}
                  height={GRID_HEIGHT}
                  today={today}
                  byDay={byDay}
                  onOpenDay={openDay}
                />
              </Animated.View>
            );
          })}
        </View>
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHead}>
          <View>
            <Text style={styles.panelWeekday}>
              {WEEKDAY_NAMES[selectedDate.getDay()]}
            </Text>
            <Text style={styles.panelDate}>
              {selectedDate.getDate()} de {MONTHS[selectedDate.getMonth()]}
              {selectedDate.getFullYear() !== now.getFullYear()
                ? ` de ${selectedDate.getFullYear()}`
                : ''}
            </Text>
          </View>
          <Text style={styles.panelCount}>
            {dayNotes.length} {dayNotes.length === 1 ? 'nota' : 'notas'}
          </Text>
        </View>

        <ScrollView
          style={styles.panelScroll}
          contentContainerStyle={styles.panelContent}
          keyboardShouldPersistTaps="handled"
        >
          {dayNotes.length === 0 ? <Text style={styles.empty}>—</Text> : null}
          {dayNotes.map((note) => (
            <View key={note.id} style={styles.noteRow}>
              <Press
                onPress={() => openNote(note)}
                style={styles.noteMain}
                accessibilityLabel={`Abrir nota: ${displayTitle(note)}`}
              >
                <Text style={styles.noteTime}>{noteTimeLabel(note)}</Text>
                <View style={styles.noteText}>
                  <Text style={styles.noteTitle} numberOfLines={2}>
                    {displayTitle(note)}
                  </Text>
                  <View style={styles.noteMeta}>
                    <View style={[styles.dot, { backgroundColor: dotColor(note) }]} />
                    <Text style={styles.noteNotebook}>
                      {notebookById.get(recordingNotebookId(note))?.name ?? ''}
                    </Text>
                    {note.segmentCount > 0 ? (
                      <Ionicons name="mic-outline" size={10} color={colors.textTertiary} />
                    ) : null}
                  </View>
                </View>
              </Press>
              <Press
                onPress={() => openNote(note)}
                style={styles.noteOpen}
                accessibilityLabel={`Abrir nota no editor: ${displayTitle(note)}`}
              >
                <Ionicons name="open-outline" size={15} color={colors.textSecondary} />
              </Press>
            </View>
          ))}

          {canWrite ? (
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={write}
              placeholder="escrever"
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.accent}
              style={styles.compose}
              returnKeyType="done"
              accessibilityLabel="Escrever nota neste dia"
            />
          ) : null}

          {otherYears.length > 0 ? (
            <View style={styles.years}>
              <Text style={styles.yearsTitle}>outros anos</Text>
              <View style={styles.timeline}>
                {otherYears.map((group) => (
                  <View key={group.year}>
                    <View style={styles.timelineYear}>
                      <Text style={styles.timelineYearText}>{group.year}</Text>
                      <Text style={styles.timelineCount}>{group.notes.length}</Text>
                    </View>
                    {group.notes.map((note) => (
                      <Press
                        key={note.id}
                        onPress={() => openNote(note)}
                        style={styles.timelineNote}
                        accessibilityLabel={`Abrir nota: ${displayTitle(note)}`}
                      >
                        <Text style={styles.timelineTime}>{noteTimeLabel(note)}</Text>
                        <Text style={styles.timelineTitle} numberOfLines={1}>
                          {displayTitle(note)}
                        </Text>
                      </Press>
                    ))}
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Screen>
  );
}

const baseStyles = defineStyles({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  iconButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  monthWrap: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexShrink: 1 },
  month: { color: baseColors.text, fontSize: fontSize.lg, fontWeight: '600' },
  year: { color: baseColors.textSecondary, fontSize: fontSize.md },
  nav: { flexDirection: 'row', alignItems: 'center', marginLeft: 'auto' },
  todayButton: { height: 30, paddingHorizontal: spacing.sm, justifyContent: 'center' },
  todayText: { color: baseColors.textSecondary, fontSize: fontSize.sm },
  weekdays: {
    flexDirection: 'row',
    alignItems: 'center',
    height: WEEKDAY_HEIGHT,
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: baseColors.border,
  },
  weekdayLabel: {
    flex: 1,
    textAlign: 'center',
    color: baseColors.textTertiary,
    fontSize: 9.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  // Margem lateral: pelicula de borda curva nao pode comer a primeira coluna.
  gridGutter: { height: GRID_HEIGHT, paddingHorizontal: spacing.md },
  grid: { flex: 1, overflow: 'hidden' },
  page: { position: 'absolute', top: 0, left: 0, height: GRID_HEIGHT },
  pageGrid: {},
  week: { height: CELL_HEIGHT, flexDirection: 'row' },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    borderBottomWidth: 0.5,
    borderRightWidth: 0.5,
    borderColor: baseColors.border,
  },
  daynum: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  daynumToday: { borderRadius: 11, backgroundColor: baseColors.text },
  daynumText: { color: baseColors.text, fontSize: fontSize.xs },
  daynumTextToday: { color: baseColors.bg, fontWeight: '600' },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  // A Schibsted precisa de 1.23em de entrelinha; 11px cortava o descendente
  // dos numeros pequenos da celula.
  cellCount: { color: baseColors.textSecondary, fontSize: 9.5, lineHeight: 12 },
  panel: { flex: 1, borderTopWidth: 0.5, borderColor: baseColors.border },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 0.5,
    borderColor: baseColors.border,
  },
  panelWeekday: {
    color: baseColors.textTertiary,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  panelDate: { color: baseColors.text, fontSize: fontSize.md, fontWeight: '600', marginTop: 2 },
  panelCount: { marginLeft: 'auto', color: baseColors.textTertiary, fontSize: fontSize.xs },
  panelScroll: { flex: 1 },
  panelContent: { paddingHorizontal: spacing.sm, paddingTop: spacing.xs, paddingBottom: spacing.xl },
  empty: {
    color: baseColors.textTertiary,
    textAlign: 'center',
    paddingVertical: spacing.xl,
    fontSize: fontSize.sm,
  },
  noteRow: { flexDirection: 'row', alignItems: 'center' },
  noteMain: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.sm,
  },
  noteTime: { color: baseColors.textTertiary, fontSize: fontSize.xs, width: 38, paddingTop: 2 },
  noteText: { flex: 1, gap: 3 },
  noteTitle: { color: baseColors.text, fontSize: fontSize.sm, lineHeight: 19 },
  noteMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  noteNotebook: { color: baseColors.textTertiary, fontSize: fontSize.xs },
  noteOpen: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  compose: {
    marginTop: spacing.sm,
    marginHorizontal: spacing.sm,
    height: 38,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: baseColors.surface,
    color: baseColors.text,
    fontSize: fontSize.sm,
  },
  years: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.sm,
    borderTopWidth: 0.5,
    borderColor: baseColors.border,
  },
  yearsTitle: {
    color: baseColors.textTertiary,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  timeline: { borderLeftWidth: 1, borderColor: baseColors.border, paddingLeft: spacing.md },
  timelineYear: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: 2,
  },
  timelineYearText: { color: baseColors.text, fontSize: fontSize.sm, fontWeight: '600' },
  timelineCount: { marginLeft: 'auto', color: baseColors.textTertiary, fontSize: fontSize.xs },
  timelineNote: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, paddingVertical: 3 },
  timelineTime: { color: baseColors.textTertiary, fontSize: fontSize.xs, width: 34 },
  timelineTitle: { flex: 1, color: baseColors.textSecondary, fontSize: fontSize.xs },
});
