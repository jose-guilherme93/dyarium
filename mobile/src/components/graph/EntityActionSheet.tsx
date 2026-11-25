/**
 * Menu rapido da entidade (estilo do lapis do prototipo). Nao toca no banco:
 * recebe a entidade e callbacks e apenas dispara a acao escolhida.
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text, TextInput } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { Press } from '@/components/Press';
import { Ionicons } from '@expo/vector-icons';

import { kindLabel, type EntityKind, type GraphEntity } from '@/core/graphModel';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

import { GraphIcon } from './GraphIcon';

const KINDS: EntityKind[] = ['person', 'place', 'theme', 'decision'];

interface EntityActionSheetProps {
  entity: GraphEntity | null;
  visible: boolean;
  busy?: boolean;
  error?: string | null;
  onClose(): void;
  onName?(): void;
  onOpenName?(): void;
  onEditName?(): void;
  /** Abre o editor completo no campo de icone. */
  onOpenIcon?(): void;
  onClaimSelf?(): void;
  onKind?(kind: EntityKind): void;
  onLabel?(label: string): void;
  onDelete?(): void;
  onType?(): void;
  onOpenType?(): void;
  onOpenKind?(): void;
  onEditType?(): void;
  onOpenEditor?(): void;
  /** Abre ja com o tipo expandido (usado por "não é isso?"). */
  initialExpandedType?: boolean;
  expandType?: boolean;
  typeExpanded?: boolean;
  startExpanded?: boolean;
  startInType?: boolean;
}

export function EntityActionSheet({
  entity,
  visible,
  busy = false,
  error = null,
  onClose,
  onName,
  onOpenName,
  onEditName,
  onOpenIcon,
  onClaimSelf,
  onKind,
  onLabel,
  onDelete,
  onType,
  onOpenType,
  onOpenKind,
  onEditType,
  onOpenEditor,
  initialExpandedType,
  expandType,
  typeExpanded: typeExpandedProp,
  startExpanded,
  startInType,
}: EntityActionSheetProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();
  const [typeOpen, setTypeOpen] = useState(
    Boolean(
      initialExpandedType ??
        expandType ??
        typeExpandedProp ??
        startExpanded ??
        startInType,
    ),
  );
  const [label, setLabel] = useState(entity?.label ?? '');

  // (sem efeito: estado inicial cobre os props de expansao)

  if (!entity) return null;

  const openType = () => {
    setTypeOpen(true);
    onType?.();
    onOpenType?.();
    onOpenKind?.();
    onEditType?.();
    onOpenEditor?.();
  };

  const trimmedLabel = label.trim();
  const canSaveLabel = Array.from(trimmedLabel).length <= 80 && !busy;

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

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Press
        style={styles.actionDestructive}
        onPress={() => {
          onDelete?.();
          onClose();
        }}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Excluir"
      >
        <Ionicons name="trash-outline" size={16} color={baseColors.danger} />
        <Text style={styles.actionDestructiveText}>Excluir</Text>
      </Press>

      <Press
        style={styles.action}
        onPress={() => {
          (onOpenName ?? onName ?? onEditName)?.();
          onClose();
        }}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Nome real / mesclar"
      >
        <Ionicons name="create-outline" size={16} color={colors.textSecondary} />
        <Text style={styles.actionText}>Nome real / mesclar</Text>
      </Press>

      <Press
        style={styles.action}
        onPress={openType}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Tipo e rótulo"
      >
        <Ionicons name="pricetags-outline" size={16} color={colors.textSecondary} />
        <Text style={styles.actionText}>Tipo e rótulo</Text>
      </Press>

      {typeOpen ? (
        <View style={styles.typeBlock}>
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
        </View>
      ) : null}

      <Press
        style={styles.action}
        onPress={() => {
          onOpenIcon?.();
          onClose();
        }}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Ícone"
      >
        <Ionicons name="color-palette-outline" size={16} color={colors.textSecondary} />
        <Text style={styles.actionText}>Ícone</Text>
      </Press>

      {entity.kind === 'person' ? (
        <Press
          style={styles.action}
          onPress={() => onClaimSelf?.()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Sou eu"
        >
          <Ionicons name="person-circle-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.actionText}>Sou eu</Text>
        </Press>
      ) : null}

      <Press
        style={styles.notThis}
        onPress={openType}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="não é isso?"
      >
        <Ionicons name="help-circle-outline" size={16} color={colors.textTertiary} />
        <Text style={styles.notThisText}>não é isso?</Text>
      </Press>
    </BottomSheet>
  );
}

const baseStyles = defineStyles({
  card: { gap: spacing.sm, maxHeight: '82%' },
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
  error: { color: baseColors.danger, fontSize: fontSize.sm },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: baseColors.surface,
  },
  actionText: { color: baseColors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  actionDestructive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: baseColors.dangerSoft,
  },
  actionDestructiveText: { color: baseColors.danger, fontSize: fontSize.sm, fontWeight: '700' },
  typeBlock: { gap: spacing.sm, paddingLeft: spacing.sm },
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
  notThis: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  notThisText: { color: baseColors.textTertiary, fontSize: fontSize.xs, fontWeight: '600' },
});