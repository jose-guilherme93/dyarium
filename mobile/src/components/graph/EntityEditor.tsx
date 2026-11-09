/**
 * Editor de uma entidade do mapa: nome, tipo, rotulo, icone e "sou eu".
 *
 * Renomear para um nome que ja existe mescla as duas bolas, como no painel; o
 * editor nao pergunta de novo. "Sou eu" so aparece para pessoa, porque o dono
 * nao e uma bola do mapa: e o centro.
 */

import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Text, TextInput } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { Press } from '@/components/Press';
import { GRAPH_ICONS } from '@/core/graphIcons';
import { kindLabel, type EntityKind, type GraphEntity } from '@/core/graphModel';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

import { GraphIcon } from './GraphIcon';

const KINDS: EntityKind[] = ['person', 'place', 'theme', 'decision'];

interface EntityEditorProps {
  entity: GraphEntity | null;
  visible: boolean;
  busy: boolean;
  error: string | null;
  onClose(): void;
  onRename(name: string): void;
  onIcon(icon: string): void;
  onClaimSelf(): void;
  onKind?(kind: EntityKind): void;
  onLabel?(label: string): void;
  onDelete?(): void;
}

export function EntityEditor({
  entity,
  visible,
  busy,
  error,
  onClose,
  onRename,
  onIcon,
  onClaimSelf,
  onKind,
  onLabel,
  onDelete,
}: EntityEditorProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();
  const [name, setName] = useState(entity?.name ?? '');
  const [label, setLabel] = useState(entity?.label ?? '');

  if (!entity) return null;
  const trimmed = name.trim();
  const trimmedLabel = label.trim();
  const canSave = trimmed.length > 0 && trimmed !== entity.name && !busy;
  const canSaveLabel =
    Array.from(trimmedLabel).length <= 80 && trimmedLabel !== (entity.label ?? '') && !busy;

  return (
    <BottomSheet visible={visible} onClose={onClose} cardStyle={styles.card}>
      <View style={styles.titleRow}>
        <View style={styles.titleIcon}>
          <GraphIcon kind={entity.kind} icon={entity.icon} size={20} color={colors.text} />
        </View>
        <View style={styles.titleText}>
          <Text style={styles.title}>{entity.name}</Text>
          <Text style={styles.kind}>{kindLabel(entity.kind)}</Text>
        </View>
      </View>

      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Nome"
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.accent}
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={() => {
          if (canSave) onRename(trimmed);
        }}
        accessibilityLabel="Nome da entidade"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        label={busy ? 'Salvando' : 'Salvar nome'}
        onPress={() => onRename(trimmed)}
        disabled={!canSave}
        loading={busy}
      />

      <Text style={styles.section}>Tipo</Text>
      <View style={styles.pills}>
        {KINDS.map((kind) => (
          <Press
            key={kind}
            style={[styles.pill, entity.kind === kind ? styles.pillActive : null]}
            onPress={() => onKind?.(kind)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={kindLabel(kind)}
            accessibilityState={{ selected: entity.kind === kind }}
          >
            <Text style={[styles.pillText, entity.kind === kind ? styles.pillTextActive : null]}>
              {kindLabel(kind)}
            </Text>
          </Press>
        ))}
      </View>

      <Text style={styles.section}>Rótulo</Text>
      <TextInput
        style={styles.input}
        value={label}
        onChangeText={(value) => setLabel(value.slice(0, 80))}
        placeholder="escola, gata, personagem"
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.accent}
        autoCorrect={false}
        maxLength={80}
        returnKeyType="done"
        onSubmitEditing={() => {
          if (canSaveLabel && onLabel) onLabel(trimmedLabel);
        }}
        onBlur={() => {
          if (canSaveLabel && onLabel) onLabel(trimmedLabel);
        }}
        accessibilityLabel="Rótulo da entidade"
      />

      <Text style={styles.section}>Ícone</Text>
      <ScrollView
        style={styles.iconScroll}
        contentContainerStyle={styles.icons}
        showsVerticalScrollIndicator={false}
      >
        <Press
          style={[styles.iconButton, !entity.icon ? styles.iconActive : null]}
          onPress={() => onIcon('')}
          accessibilityLabel="Ícone do tipo"
        >
          <GraphIcon kind={entity.kind} size={20} color={colors.text} />
        </Press>
        {Object.entries(GRAPH_ICONS).map(([key, icon]) => (
          <Press
            key={key}
            style={[styles.iconButton, entity.icon === key ? styles.iconActive : null]}
            onPress={() => onIcon(key)}
            accessibilityRole="button"
            accessibilityLabel={icon.label}
          >
            <GraphIcon kind={entity.kind} icon={key} size={20} color={colors.text} />
          </Press>
        ))}
      </ScrollView>

      {entity.kind === 'person' ? (
        <Press
          style={styles.self}
          onPress={onClaimSelf}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Sou eu"
        >
          <Text style={styles.selfText}>Sou eu</Text>
        </Press>
      ) : null}

      <Press
        style={styles.delete}
        onPress={() => onDelete?.()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Excluir entidade"
      >
        <Text style={styles.deleteText}>Excluir entidade</Text>
      </Press>

      <Text style={styles.note}>
        Renomear para um nome existente mescla; o texto das notas nunca muda.
      </Text>
    </BottomSheet>
  );
}

const baseStyles = defineStyles({
  card: { gap: spacing.md, maxHeight: '82%' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  titleIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: baseColors.surface,
  },
  titleText: { flex: 1, gap: 2 },
  title: { color: baseColors.text, fontSize: fontSize.lg, fontWeight: '700' },
  kind: { color: baseColors.textTertiary, fontSize: fontSize.xs, textTransform: 'uppercase', letterSpacing: 0.7 },
  input: {
    height: 48,
    borderRadius: radius.md,
    backgroundColor: baseColors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.borderStrong,
    paddingHorizontal: spacing.md,
    color: baseColors.text,
    fontSize: fontSize.md,
  },
  error: { color: baseColors.danger, fontSize: fontSize.sm },
  section: {
    color: baseColors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: baseColors.neutralSoft,
  },
  pillActive: { backgroundColor: baseColors.accentSoft },
  pillText: { color: baseColors.textSecondary, fontSize: fontSize.xs, fontWeight: '600' },
  pillTextActive: { color: baseColors.accent },
  iconScroll: { maxHeight: 210 },
  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingBottom: spacing.sm },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: baseColors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  iconActive: { borderColor: baseColors.accent, backgroundColor: baseColors.accentSoft },
  self: {
    gap: 2,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: baseColors.border,
  },
  selfText: { color: baseColors.danger, fontSize: fontSize.md, fontWeight: '600' },
  delete: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
    backgroundColor: baseColors.dangerSoft ?? baseColors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.danger,
  },
  deleteText: { color: baseColors.danger, fontSize: fontSize.md, fontWeight: '700' },
  note: { color: baseColors.textTertiary, fontSize: fontSize.xs, lineHeight: 16 },
});