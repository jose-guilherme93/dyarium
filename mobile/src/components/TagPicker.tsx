import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  View,
} from 'react-native';
import { Text, TextInput } from '@/components/AppText';
import { Press } from '@/components/Press';

import { BottomSheet } from '@/components/BottomSheet';
import { TagChip } from '@/components/TagChip';
import { listTagBank } from '@/services/tagAdmin';
import { tagColor } from '@/core/tags';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

interface TagPickerProps {
  visible: boolean;
  selected: string[];
  /** Tags locais conhecidas (mesmo sem servidor), para sugerir offline. */
  knownTags: string[];
  onClose(): void;
  onSave(tags: string[]): void;
}

export function TagPicker({ visible, selected, knownTags, onClose, onSave }: TagPickerProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const [query, setQuery] = useState('');
  const [bank, setBank] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>(selected);

  useEffect(() => {
    if (!visible) return;
    // Sincroniza com a nota ao abrir o seletor.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPicked(selected);
    setQuery('');
    let alive = true;
    listTagBank()
      .then((tags) => {
        if (alive) setBank(tags.map((tag) => tag.name));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [visible, selected]);

  const all = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const name of [...picked, ...bank, ...knownTags]) {
      const key = name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(name.trim());
    }
    return out.sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  }, [picked, bank, knownTags]);

  const term = query.trim();
  const filtered = term
    ? all.filter((name) => name.toLowerCase().includes(term.toLowerCase()))
    : all;
  const exact = all.some((name) => name.toLowerCase() === term.toLowerCase());
  const canCreate = term.length > 0 && !exact;

  const toggle = (name: string) => {
    const key = name.toLowerCase();
    setPicked((prev) =>
      prev.some((item) => item.toLowerCase() === key)
        ? prev.filter((item) => item.toLowerCase() !== key)
        : [...prev, name],
    );
  };

  const create = () => {
    if (!term) return;
    setPicked((prev) =>
      prev.some((item) => item.toLowerCase() === term.toLowerCase()) ? prev : [...prev, term],
    );
    setQuery('');
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} cardStyle={styles.card} testID="tag-picker">
      <View style={styles.header}>
        <Text style={styles.title}>Tags</Text>
        <Press onPress={() => onSave(picked)} accessibilityLabel="Concluir tags">
          <Text style={styles.done}>Concluir</Text>
        </Press>
      </View>

      {/* A faixa de selecionadas tem altura fixa. Antes ela so existia com
          tags marcadas, e marcar a primeira (ou remover a ultima) mudava a
          altura do cartao no meio da interacao. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.pickedRow}
        contentContainerStyle={styles.picked}
      >
        {picked.length > 0 ? (
          picked.map((name) => (
            <TagChip key={name.toLowerCase()} name={name} onRemove={() => toggle(name)} />
          ))
        ) : (
          <Text style={styles.pickedEmpty}>Nenhuma tag marcada</Text>
        )}
      </ScrollView>

      <View style={styles.search}>
        <Ionicons name="search" size={16} color={colors.textTertiary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar ou criar tag"
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.accent}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={canCreate ? create : undefined}
        />
      </View>

      <ScrollView
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {canCreate ? (
          <Press style={styles.row} onPress={create}>
            <View style={[styles.dot, { backgroundColor: tagColor(term) }]} />
            <Text style={styles.create} numberOfLines={1}>
              Criar “{term}”
            </Text>
            <Ionicons name="add" size={18} color={colors.accent} />
          </Press>
        ) : null}
        {filtered.map((name) => {
          const active = picked.some((item) => item.toLowerCase() === name.toLowerCase());
          return (
            <Press key={name.toLowerCase()} style={styles.row} onPress={() => toggle(name)}>
              <View style={[styles.dot, { backgroundColor: tagColor(name) }]} />
              <Text style={styles.name} numberOfLines={1}>
                {name}
              </Text>
              {active ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
            </Press>
          );
        })}
        {filtered.length === 0 && !canCreate ? (
          <Text style={styles.empty}>Nenhuma tag ainda. Digite para criar a primeira.</Text>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

const baseStyles = defineStyles({
  card: {
    padding: spacing.xl,
    maxHeight: '82%',
    gap: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: baseColors.text, fontSize: fontSize.lg, fontWeight: '700' },
  done: { color: baseColors.accent, fontSize: fontSize.md, fontWeight: '700' },
  pickedRow: { height: 32, flexGrow: 0 },
  picked: { gap: spacing.sm, paddingRight: spacing.xl, alignItems: 'center' },
  pickedEmpty: { color: baseColors.textTertiary, fontSize: fontSize.sm },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: baseColors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    height: 40,
  },
  input: { flex: 1, color: baseColors.text, fontSize: fontSize.sm, paddingVertical: 0 },
  // Altura fixa: filtrar ou receber o banco do servidor nao muda o tamanho da
  // folha no meio da interacao; o que nao cabe rola.
  list: { height: 220, flexShrink: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { flex: 1, color: baseColors.text, fontSize: fontSize.md },
  create: { flex: 1, color: baseColors.text, fontSize: fontSize.md, fontStyle: 'italic' },
  empty: { color: baseColors.textTertiary, fontSize: fontSize.sm, padding: spacing.md },
});
