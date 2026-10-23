import { Ionicons } from '@expo/vector-icons';
import { back } from '@/services/appNavigation';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { FastModal } from '@/components/FastModal';
import { Screen } from '@/components/Screen';
import type { ServerTag } from '@/core/api';
import { tagColor } from '@/core/tags';
import { listTagBank, removeTag, renameTag } from '@/services/tagAdmin';
import { useLibrary } from '@/state/LibraryContext';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

export default function TagsScreen() {
  const { pull } = useLibrary();
  const [tags, setTags] = useState<ServerTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rename, setRename] = useState<ServerTag | null>(null);
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTags(await listTagBank());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Carregamento inicial do banco de tags.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const openRename = (tag: ServerTag) => {
    setRename(tag);
    setName(tag.name);
  };

  const doRename = async (merge: boolean) => {
    const target = rename;
    const next = name.trim();
    if (!target || !next) return;
    setRename(null);
    try {
      await renameTag(target.id, next);
      await load();
      pull();
    } catch {
      Alert.alert('Não foi possível renomear', 'Verifique a conexão com o servidor.');
      return;
    }
    if (merge) {
      // A mescla ja aconteceu no servidor; a mensagem so confirma o efeito.
      Alert.alert('Tags mescladas', 'As notas das duas tags agora usam a mesma tag.');
    }
  };

  const saveRename = () => {
    const target = rename;
    const next = name.trim();
    if (!target || !next) return;
    const duplicate = tags.find(
      (tag) => tag.id !== target.id && tag.name.toLowerCase() === next.toLowerCase(),
    );
    if (duplicate) {
      Alert.alert(
        'Tag já existe',
        `“${duplicate.name}” já existe. Mesclar as duas? As notas serão movidas para ela.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Mesclar', onPress: () => void doRename(true) },
        ],
      );
      return;
    }
    void doRename(false);
  };

  const confirmDelete = (tag: ServerTag) => {
    Alert.alert(
      'Excluir tag?',
      `“${tag.name}” será removida de ${tag.entry_count} nota${tag.entry_count === 1 ? '' : 's'}.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: () => {
            void removeTag(tag.id)
              .then(() => load())
              .then(() => pull())
              .catch(() =>
                Alert.alert('Não foi possível excluir', 'Verifique a conexão com o servidor.'),
              );
          },
        },
      ],
    );
  };

  const actions = (tag: ServerTag) => {
    Alert.alert(tag.name, 'O que deseja fazer?', [
      { text: 'Renomear', onPress: () => openRename(tag) },
      { text: 'Excluir', style: 'destructive', onPress: () => confirmDelete(tag) },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => back()} style={styles.iconButton} accessibilityLabel="Voltar">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Tags</Text>
          <Text style={styles.subtitle}>
            {tags.length === 0 ? 'Nenhuma tag' : `${tags.length} tags`}
          </Text>
        </View>
        <View style={styles.iconButton} />
      </View>

      <FlatList
        data={tags}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => openRename(item)}
            onLongPress={() => actions(item)}
            delayLongPress={350}
            accessibilityRole="button"
            accessibilityLabel={`Editar tag ${item.name}`}
          >
            <View style={[styles.dot, { backgroundColor: tagColor(item.name, item.color) }]} />
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.count}>{item.entry_count}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="pricetags-outline" size={30} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>
              {loading ? 'Carregando...' : error ? 'Sem conexão' : 'Nenhuma tag ainda'}
            </Text>
            <Text style={styles.emptyText}>
              {error
                ? 'Conecte ao servidor para renomear ou excluir tags.'
                : 'Crie tags na nota ou no seletor de tags.'}
            </Text>
          </View>
        }
      />

      <FastModal visible={rename !== null} onRequestClose={() => setRename(null)}>
        <Pressable style={styles.backdrop} onPress={() => setRename(null)}>
          <Pressable style={styles.card} onPress={() => undefined}>
            <Text style={styles.cardTitle}>Renomear tag</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Nome da tag"
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.accent}
              style={styles.input}
              autoFocus
              maxLength={60}
              autoCapitalize="none"
            />
            <View style={styles.actions}>
              <Pressable onPress={() => setRename(null)} style={styles.cancel}>
                <Text style={styles.cancelText}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={saveRename}
                style={[styles.save, !name.trim() ? styles.saveOff : null]}
                disabled={!name.trim()}
              >
                <Text style={styles.saveText}>Salvar</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </FastModal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  headerText: { flex: 1, alignItems: 'center' },
  title: { color: colors.text, fontSize: fontSize.xl, fontWeight: '700' },
  subtitle: { color: colors.textTertiary, fontSize: fontSize.xs },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  separator: { height: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { flex: 1, color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  count: { color: colors.textTertiary, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
  empty: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xxxl },
  emptyTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  emptyText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.xl },
  card: { backgroundColor: colors.bgElevated, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.lg },
  cardTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  input: {
    color: colors.text,
    fontSize: fontSize.md,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md },
  cancel: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  cancelText: { color: colors.textSecondary, fontSize: fontSize.md, fontWeight: '600' },
  save: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  saveOff: { opacity: 0.4 },
  saveText: { color: '#FFFFFF', fontSize: fontSize.md, fontWeight: '700' },
});
