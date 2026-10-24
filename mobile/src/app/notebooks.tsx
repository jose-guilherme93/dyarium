import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { back, push } from '@/services/appNavigation';
import { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Press } from '@/components/Press';

import { BottomSheet } from '@/components/BottomSheet';
import { NotebookForm } from '@/components/NotebookForm';
import { RecordingCard } from '@/components/RecordingCard';
import { Screen } from '@/components/Screen';
import { formatStamp } from '@/core/format';
import {
  notebookStats,
  recordingNotebookId,
  searchRecordings,
} from '@/core/notebookFilter';
import { sortNotebooks, type Notebook } from '@/core/notebooks';
import { useLibrary } from '@/state/LibraryContext';
import { useSettings } from '@/state/SettingsContext';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

type FormMode = 'create' | 'rename' | 'color';

export default function NotebooksScreen() {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const { notebooks, recordings, createNotebook, renameNotebook, removeNotebook } = useLibrary();
  const {
    lastNotebookId,
    setLastNotebookId,
    notebooksAlphabetical,
    setNotebooksAlphabetical,
  } = useSettings();
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<{ mode: FormMode; notebook?: Notebook } | null>(null);
  const [actionsNotebook, setActionsNotebook] = useState<Notebook | null>(null);

  const ordered = useMemo(
    () => sortNotebooks(notebooks, notebooksAlphabetical),
    [notebooks, notebooksAlphabetical],
  );
  const term = query.trim();
  const results = useMemo(() => searchRecordings(recordings, term), [recordings, term]);
  // Uma passada pela biblioteca alimenta a contagem e a data de todos os
  // cadernos; antes cada item visivel varria a lista inteira.
  const stats = useMemo(() => notebookStats(recordings), [recordings]);
  const notebookById = useMemo(
    () => new Map(notebooks.map((notebook) => [notebook.id, notebook])),
    [notebooks],
  );

  const canGoBack = router.canGoBack();
  const closeOrHome = () => {
    back();
  };

  const select = async (notebook: Notebook) => {
    await setLastNotebookId(notebook.id);
    back();
  };

  const openNote = (id: string) =>
    push({ pathname: '/note/[id]', params: { id } });

  const confirmDelete = (notebook: Notebook) => {
    const count = stats.get(notebook.id)?.count ?? 0;
    Alert.alert(
      'Excluir caderno?',
      count === 0
        ? `“${notebook.name}” será excluído.`
        : `As ${count} nota${count === 1 ? '' : 's'} de “${notebook.name}” vão para “Notas ao acaso”.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: () => void removeNotebook(notebook.id),
        },
      ],
    );
  };

  const saveForm = async (input: { name: string; color: string }) => {
    if (!form) return;
    const duplicate = notebooks.some(
      (notebook) =>
        notebook.id !== form.notebook?.id &&
        notebook.name.toLowerCase() === input.name.toLowerCase(),
    );
    if (duplicate) {
      Alert.alert('Nome em uso', 'Já existe um caderno com esse nome.');
      return;
    }
    if (form.mode === 'create') {
      const notebook = await createNotebook(input);
      setForm(null);
      await select(notebook);
      return;
    }
    if (!form.notebook) return;
    await renameNotebook(form.notebook.id, input);
    setForm(null);
  };

  const header = (
    <View style={styles.header}>
      {canGoBack ? (
        <Press onPress={closeOrHome} style={styles.iconButton} accessibilityLabel="Voltar">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Press>
      ) : (
        <View style={styles.iconButton} />
      )}
      <View style={styles.headerText}>
        <Text style={styles.title}>Cadernos</Text>
        <Text style={styles.subtitle}>
          {notebooks.length === 1
            ? '1 caderno'
            : `${notebooks.length} cadernos`}
        </Text>
      </View>
      <View style={styles.headerActions}>
        <Press
          onPress={() => void setNotebooksAlphabetical(!notebooksAlphabetical)}
          style={styles.iconButton}
          accessibilityLabel={notebooksAlphabetical ? 'Ordenar por criação' : 'Ordenar A-Z'}
        >
          <Ionicons
            name={notebooksAlphabetical ? 'time-outline' : 'text-outline'}
            size={20}
            color={colors.textSecondary}
          />
        </Press>
        <Press
          onPress={() => setForm({ mode: 'create' })}
          style={styles.iconButton}
          accessibilityLabel="Novo caderno"
        >
          <Ionicons name="add" size={24} color={colors.text} />
        </Press>
      </View>
    </View>
  );

  return (
    <Screen>
      {header}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={colors.textTertiary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar em todos os cadernos"
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.accent}
          style={styles.searchInput}
        />
        {query ? (
          <Press onPress={() => setQuery('')} accessibilityLabel="Limpar busca">
            <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
          </Press>
        ) : null}
      </View>

      {term ? (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => (
            <RecordingCard
              recording={item}
              onOpen={openNote}
              notebookLabel={notebookById.get(recordingNotebookId(item))?.name ?? 'Notas ao acaso'}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={28} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>Nada encontrado</Text>
              <Text style={styles.emptyText}>Tente outro termo ou uma tag.</Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={ordered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => (
            <NotebookRow
              notebook={item}
              active={item.id === lastNotebookId}
              count={stats.get(item.id)?.count ?? 0}
              last={stats.get(item.id)?.lastAt}
              onPress={() => void select(item)}
              onLongPress={() => {
                if (!item.isDefault) setActionsNotebook(item);
              }}
            />
          )}
        />
      )}

      <NotebookForm
        key={form ? `${form.mode}-${form.notebook?.id ?? 'novo'}` : 'fechado'}
        visible={form !== null}
        title={
          form?.mode === 'create'
            ? 'Novo caderno'
            : form?.mode === 'color'
              ? 'Cor do caderno'
              : 'Renomear caderno'
        }
        initialName={form?.notebook?.name ?? ''}
        initialColor={form?.notebook?.color ?? ''}
        onClose={() => setForm(null)}
        onSave={(input) => void saveForm(input)}
      />

      <BottomSheet
        visible={actionsNotebook !== null}
        onClose={() => setActionsNotebook(null)}
        cardStyle={styles.sheet}
      >
        <Text style={styles.sheetTitle}>{actionsNotebook?.name}</Text>
        <Press
          style={styles.sheetRow}
          onPress={() => {
            const notebook = actionsNotebook;
            setActionsNotebook(null);
            if (notebook) setForm({ mode: 'rename', notebook });
          }}
        >
          <Ionicons name="create-outline" size={18} color={colors.text} />
          <Text style={styles.sheetText}>Renomear</Text>
        </Press>
        <Press
          style={styles.sheetRow}
          onPress={() => {
            const notebook = actionsNotebook;
            setActionsNotebook(null);
            if (notebook) setForm({ mode: 'color', notebook });
          }}
        >
          <Ionicons name="color-palette-outline" size={18} color={colors.text} />
          <Text style={styles.sheetText}>Cor</Text>
        </Press>
        <Press
          style={styles.sheetRow}
          onPress={() => {
            const notebook = actionsNotebook;
            setActionsNotebook(null);
            if (notebook) confirmDelete(notebook);
          }}
        >
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
          <Text style={[styles.sheetText, styles.sheetDanger]}>Excluir</Text>
        </Press>
        <Press style={styles.sheetRow} onPress={() => setActionsNotebook(null)}>
          <Text style={styles.sheetText}>Cancelar</Text>
        </Press>
      </BottomSheet>
    </Screen>
  );
}

function NotebookRow({
  notebook,
  active,
  count,
  last,
  onPress,
  onLongPress,
}: {
  notebook: Notebook;
  active: boolean;
  count: number;
  last?: string;
  onPress(): void;
  onLongPress(): void;
}) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  return (
    <Press
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={[styles.row, active ? styles.rowOn : null]}
      accessibilityRole="button"
      accessibilityLabel={`${notebook.name}, ${count} notas`}
    >
      <View
        style={[
          styles.dot,
          { backgroundColor: notebook.color || colors.textTertiary },
        ]}
      />
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={1}>
          {notebook.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {count === 0
            ? 'Sem notas'
            : `${count} nota${count === 1 ? '' : 's'}${
                last ? ` · última em ${formatStamp(last)}` : ''
              }`}
        </Text>
      </View>
      {active ? <Ionicons name="checkmark" size={20} color={colors.accent} /> : null}
    </Press>
  );
}

const baseStyles = defineStyles({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  headerText: { flex: 1 },
  title: { color: baseColors.text, fontSize: fontSize.xl, fontWeight: '700' },
  subtitle: { color: baseColors.textTertiary, fontSize: fontSize.xs },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    backgroundColor: baseColors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    height: 40,
  },
  searchInput: { flex: 1, color: baseColors.text, fontSize: fontSize.sm, paddingVertical: 0 },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  separator: { height: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: baseColors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  rowOn: { backgroundColor: baseColors.surfaceElevated },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowText: { flex: 1, gap: 2 },
  name: { color: baseColors.text, fontSize: fontSize.md, fontWeight: '600' },
  meta: { color: baseColors.textTertiary, fontSize: fontSize.xs },
  sheet: {
    padding: spacing.xl,
    gap: spacing.xs,
  },
  sheetTitle: {
    color: baseColors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  sheetText: { color: baseColors.text, fontSize: fontSize.md, fontWeight: '600' },
  sheetDanger: { color: baseColors.danger },
  empty: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xxxl },
  emptyTitle: { color: baseColors.text, fontSize: fontSize.md, fontWeight: '600' },
  emptyText: { color: baseColors.textSecondary, fontSize: fontSize.sm },
});
