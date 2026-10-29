import { Ionicons } from '@expo/vector-icons';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';
import { Screen } from '@/components/Screen';
import type { AuthorRole } from '@/core/types';
import { titleFontSize } from '@/core/format';
import {
  clampFontSize,
  type NoteFontFamily,
  type NoteFontWeight,
  type NoteTypography,
} from '@/core/typography';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

export interface NoteProperty {
  label: string;
  value: string;
}

interface NoteMenuProps {
  visible: boolean;
  title: string;
  properties: NoteProperty[];
  /** Autor efetivo da nota; vazio mostra o padrao do app. */
  author?: AuthorRole;
  /** A nota tem escolha propria (nao esta seguindo o padrao). */
  authorExplicit?: boolean;
  /** Texto curto do padrao: "padrão: dono" ou "padrão: sem autor". */
  authorHint?: string;
  onChangeAuthor?(author: AuthorRole): void;
  typography: NoteTypography;
  onChangeTypography(next: NoteTypography): void;
  onClose(): void;
  onShare(): void;
}

const AUTHOR_OPTIONS: { value: AuthorRole; label: string }[] = [
  { value: 'self', label: 'Eu' },
  { value: 'other', label: 'Outros' },
  { value: 'mixed', label: 'Eu e outros' },
];

const FAMILY_OPTIONS: { value: NoteFontFamily; label: string }[] = [
  { value: 'system', label: 'Inter' },
  { value: 'serif', label: 'Serifada' },
  { value: 'mono', label: 'Mono' },
];

const WEIGHT_OPTIONS: { value: NoteFontWeight; label: string }[] = [
  { value: 'light', label: 'Leve' },
  { value: 'regular', label: 'Normal' },
  { value: 'bold', label: 'Forte' },
];

function Segment<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  const styles = useThemedStyles(baseStyles);

  return (
    <View style={styles.segment}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Press
            key={option.value}
            style={[styles.segmentItem, active && styles.segmentItemActive]}
            onPress={() => onChange(option.value)}
            accessibilityLabel={option.label}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
              {option.label}
            </Text>
          </Press>
        );
      })}
    </View>
  );
}

/**
 * Configuracoes da nota: tela inteira, separada da analise.
 *
 * A analise tem tela propria (botao de IA); aqui ficam apenas os ajustes da
 * nota que ja existiam: compartilhar, tipografia, autor e propriedades.
 */
export function NoteMenu({
  visible,
  title,
  properties,
  author,
  authorExplicit = false,
  authorHint = '',
  onChangeAuthor,
  typography,
  onChangeTypography,
  onClose,
  onShare,
}: NoteMenuProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();
  const shown = title.trim() || 'Nota sem título';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <Screen>
        <View style={styles.header}>
          <Press
            style={styles.iconButton}
            onPress={onClose}
            accessibilityLabel="Fechar configurações"
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Press>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>Configurações</Text>
            <Text
              style={styles.headerSubtitle}
              numberOfLines={1}
              accessibilityLabel={`Nota ${shown}`}
            >
              {shown}
            </Text>
          </View>
        </View>

        <ScrollView
          testID="note-menu-scroll"
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Press style={styles.action} onPress={onShare} accessibilityLabel="Compartilhar nota">
            <Ionicons name="share-outline" size={19} color={colors.text} />
            <Text style={styles.actionText}>Compartilhar nota</Text>
          </Press>

          <Text style={styles.sectionLabel}>Fonte</Text>
          <Segment
            value={typography.family}
            options={FAMILY_OPTIONS}
            onChange={(family) => onChangeTypography({ ...typography, family })}
          />

          <Text style={styles.sectionLabel}>Tamanho</Text>
          <View style={styles.stepper}>
            <Press
              style={styles.stepButton}
              onPress={() =>
                onChangeTypography({ ...typography, size: clampFontSize(typography.size - 1) })
              }
              accessibilityLabel="Diminuir fonte"
            >
              <Text style={styles.stepText}>A-</Text>
            </Press>
            <Text style={styles.stepValue}>{typography.size}</Text>
            <Press
              style={styles.stepButton}
              onPress={() =>
                onChangeTypography({ ...typography, size: clampFontSize(typography.size + 1) })
              }
              accessibilityLabel="Aumentar fonte"
            >
              <Text style={styles.stepText}>A+</Text>
            </Press>
          </View>

          <Text style={styles.sectionLabel}>Peso</Text>
          <Segment
            value={typography.weight}
            options={WEIGHT_OPTIONS}
            onChange={(weight) => onChangeTypography({ ...typography, weight })}
          />

          {onChangeAuthor ? (
            <>
              <Text style={styles.sectionLabel}>Autor</Text>
              <Segment
                value={author ?? ''}
                options={AUTHOR_OPTIONS}
                onChange={onChangeAuthor}
              />
              <View style={styles.authorRow}>
                <Text style={styles.authorHint}>{authorHint}</Text>
                {authorExplicit ? (
                  <Press
                    onPress={() => onChangeAuthor('')}
                    accessibilityLabel="Usar o padrão de autor"
                  >
                    <Text style={styles.authorReset}>usar padrão</Text>
                  </Press>
                ) : null}
              </View>
            </>
          ) : null}

          <Text style={styles.sectionLabel}>Propriedades</Text>
          <View style={styles.props}>
            {properties.map((property) => (
              <View key={property.label} style={styles.propRow}>
                <Text style={styles.propLabel}>{property.label}</Text>
                <Text style={styles.propValue} numberOfLines={1}>
                  {property.value}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </Screen>
    </Modal>
  );
}

const baseStyles = defineStyles({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.border,
  },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, gap: 2 },
  headerTitle: {
    color: baseColors.text,
    fontWeight: '700',
    fontSize: titleFontSize('Configurações', 22, 15),
  },
  headerSubtitle: { color: baseColors.textTertiary, fontSize: fontSize.xs },
  scroll: { flex: 1 },
  content: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.border,
  },
  actionText: { color: baseColors.text, fontSize: fontSize.md },
  sectionLabel: {
    color: baseColors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.xs,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: baseColors.bgElevated,
    borderRadius: radius.sm,
    padding: 2,
    gap: 2,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: radius.sm - 2,
  },
  segmentItemActive: { backgroundColor: baseColors.surfaceElevated },
  segmentText: { color: baseColors.textSecondary, fontSize: fontSize.sm },
  segmentTextActive: { color: baseColors.text, fontWeight: '600' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: baseColors.bgElevated,
    borderRadius: radius.sm,
    padding: 2,
  },
  stepButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: radius.sm - 2,
    backgroundColor: baseColors.surfaceElevated,
  },
  stepText: { color: baseColors.text, fontSize: fontSize.sm, fontWeight: '700' },
  stepValue: {
    minWidth: 44,
    textAlign: 'center',
    color: baseColors.text,
    fontSize: fontSize.sm,
    fontVariant: ['tabular-nums'],
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  authorHint: {
    flex: 1,
    color: baseColors.textTertiary,
    fontSize: fontSize.xs,
  },
  authorReset: {
    color: baseColors.accent,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  props: { gap: spacing.sm },
  propRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  propLabel: { color: baseColors.textSecondary, fontSize: fontSize.sm },
  propValue: { color: baseColors.text, fontSize: fontSize.sm, flexShrink: 1, textAlign: 'right' },
});
