import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { back, push } from '@/services/appNavigation';
import { useCallback, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';
import { Screen } from '@/components/Screen';
import { placeLabel } from '@/core/processing';
import { countTrashedRecordings } from '@/services/db';
import { useLibrary } from '@/state/LibraryContext';
import { useSettings } from '@/state/SettingsContext';
import { THEMES, THEME_OPTIONS, baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

export default function SettingsScreen() {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const {
    config,
    ready: settingsReady,
    swipeAction,
    setSwipeAction,
    theme,
    setTheme,
    transcriptionPlace,
    analysisPlace,
  } = useSettings();  const { ready, recordings } = useLibrary();
  const archived = recordings.filter((r) => r.archived).length;
  const themeLabel = THEME_OPTIONS.find((option) => option.name === theme)?.label ?? 'Preto';
  const [trashCount, setTrashCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void countTrashedRecordings()
        .then((total) => {
          if (alive) setTrashCount(total);
        })
        .catch(() => undefined);
      return () => {
        alive = false;
      };
    }, []),
  );

  const renderRow = (
    icon: ComponentProps<typeof Ionicons>['name'],
    iconColor: string,
    label: string,
    trailing: ReactNode,
    onPress?: () => void,
    deEmphasized?: boolean,
    last?: boolean,
  ) => {
    const content = (
      <View style={[styles.row, last && styles.rowLast]}>
        <Ionicons name={icon} size={20} color={iconColor} />
        <Text style={[styles.rowLabel, deEmphasized && styles.rowLabelMuted]}>{label}</Text>
        <View style={styles.trailing}>{trailing}</View>
      </View>
    );
    if (onPress) {
      return (
        <Press
          key={label}
          onPress={onPress}
          style={styles.rowLine}
          accessibilityRole="button"
          accessibilityLabel={label}
        >
          {content}
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} style={styles.chevron} />
        </Press>
      );
    }
    return (
      <View key={label} style={styles.rowLine}>
        {content}
      </View>
    );
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Press
          onPress={() => back()}
          style={styles.iconButton}
          accessibilityLabel="Voltar"
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Press>
        <Text style={styles.headerTitle}>Opções</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!ready || !settingsReady ? (
          <ActivityIndicator size="large" color={colors.textSecondary} />
        ) : (
          <>
            <Text style={styles.sectionLabel}>Notas</Text>
            {renderRow(
              'file-tray-full-outline',
              colors.info,
              'Arquivadas',
              <Text style={styles.trailingValue}>{archived}</Text>,
              () => push('/archived'),
            )}
            {renderRow(
              'trash-outline',
              colors.warning,
              'Lixeira',
              <Text style={styles.trailingValue}>{trashCount}</Text>,
              () => push('/trash'),
              false,
              true,
            )}

            <Text style={styles.sectionLabel}>Preferências</Text>
            <View style={styles.rowBlock}>
              <View style={styles.rowHead}>
                <Ionicons name="color-palette-outline" size={20} color={colors.textSecondary} />
                <Text style={styles.rowLabel}>Tema</Text>
                <Text style={styles.trailingValue}>{themeLabel}</Text>
              </View>
              <View style={styles.swatchGroup}>
                {THEME_OPTIONS.map((option) => {
                  const active = theme === option.name;
                  const palette = THEMES[option.name].colors;
                  return (
                    <Press
                      key={option.name}
                      onPress={() => void setTheme(option.name)}
                      style={[styles.swatchButton, active && styles.swatchButtonActive]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={option.label}
                    >
                      <View
                        style={[
                          styles.swatch,
                          { backgroundColor: palette.bg, borderColor: palette.borderStrong },
                        ]}
                      >
                        <View style={[styles.swatchBar, { backgroundColor: palette.surface }]} />
                        <View style={[styles.swatchLine, { backgroundColor: palette.text }]} />
                        {active ? (
                          <Ionicons name="checkmark" size={12} color={palette.accent} style={styles.swatchCheck} />
                        ) : null}
                      </View>
                    </Press>
                  );
                })}
              </View>
            </View>
            <View style={styles.rowBlock}>
              <View style={styles.rowHead}>
                <Ionicons name="swap-horizontal-outline" size={20} color={colors.textSecondary} />
                <Text style={styles.rowLabel}>Arrastar para o lado</Text>
                <Text style={styles.trailingValue}>
                  {swipeAction === 'archive' ? 'Arquivar' : 'Apagar'}
                </Text>
              </View>
              <View style={styles.segment}>
                <Press
                  onPress={() => void setSwipeAction('delete')}
                  style={[styles.segmentItem, swipeAction === 'delete' && styles.segmentActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: swipeAction === 'delete' }}
                  accessibilityLabel="Apagar"
                >
                  <Text style={[styles.segmentText, swipeAction === 'delete' && styles.segmentTextActive]}>
                    Apagar
                  </Text>
                </Press>
                <Press
                  onPress={() => void setSwipeAction('archive')}
                  style={[styles.segmentItem, swipeAction === 'archive' && styles.segmentActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: swipeAction === 'archive' }}
                  accessibilityLabel="Arquivar"
                >
                  <Text style={[styles.segmentText, swipeAction === 'archive' && styles.segmentTextActive]}>
                    Arquivar
                  </Text>
                </Press>
              </View>
            </View>
            <Text style={styles.sectionLabel}>Processamento</Text>
            {renderRow(
              'mic-outline',
              transcriptionPlace === 'server' ? colors.info : colors.textSecondary,
              'Transcrição',
              <Text style={styles.trailingValue}>{placeLabel(transcriptionPlace)}</Text>,
              () => push('/processing'),
            )}
            {renderRow(
              'sparkles-outline',
              analysisPlace === 'server' ? colors.info : colors.textSecondary,
              'Análise',
              <Text style={styles.trailingValue}>{placeLabel(analysisPlace)}</Text>,
              () => push('/processing'),
              false,
              true,
            )}

            <Text style={styles.sectionLabel}>Sistema</Text>
            {renderRow(
              'cloud-outline',
              config ? colors.success : colors.warning,
              'Servidor',
              <Text style={[styles.trailingValue, { color: config ? colors.success : colors.warning }]}>
                {config ? 'Conectado' : 'Não configurado'}
              </Text>,
              () => push('/server'),
              false,
              false,
            )}
            {renderRow(
              'save-outline',
              colors.info,
              'Armazenamento',
              null,
              () => push('/storage'),
            )}
            {renderRow(
              'cloud-download-outline',
              colors.info,
              'Backup local',
              null,
              () => push('/backup'),
            )}
            {renderRow(
              'mic-circle-outline',
              colors.info,
              'Modelos no aparelho',
              null,
              () => push('/transcription'),
            )}
            {renderRow(
              'stats-chart-outline',
              colors.info,
              'Painel',
              null,
              () => push('/dashboard'),
              false,
              true,
            )}

            <Text style={styles.sectionLabel}>Avançado</Text>
            {renderRow(
              'pulse-outline',
              colors.textSecondary,
              'Diagnóstico',
              null,
              () => push('/diagnostics'),
              true,
              true,
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const baseStyles = defineStyles({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: baseColors.text, fontSize: fontSize.lg, fontWeight: '700' },
  content: { padding: spacing.xl, gap: spacing.xs },
  sectionLabel: {
    color: baseColors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  rowLine: { flexDirection: 'row', alignItems: 'center' },
  rowBlock: {
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: baseColors.border,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 32 },
  rowLast: { borderBottomWidth: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 44,
    paddingVertical: spacing.sm,
    flex: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: baseColors.border,
  },
  rowLabel: { color: baseColors.text, fontSize: fontSize.md, fontWeight: '600', flex: 1 },
  rowLabelMuted: { color: baseColors.textSecondary },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  trailingValue: {
    color: baseColors.textTertiary,
    fontSize: fontSize.sm,
    fontWeight: '600',
    fontVariantNumeric: 'tabular-nums',
  },
  chevron: { marginLeft: spacing.sm },
  swatchGroup: { flexDirection: 'row', gap: spacing.sm, marginLeft: 'auto' },
  swatchButton: {
    padding: 2,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchButtonActive: { borderColor: baseColors.accent },
  swatchCheck: { position: 'absolute', right: 2, bottom: 1 },
  swatch: {
    width: 28,
    height: 20,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    justifyContent: 'space-between',
  },
  swatchBar: { height: 3, borderRadius: 2, width: '70%' },
  swatchLine: { height: 2, borderRadius: 2, width: '50%' },
  segment: {
    flexDirection: 'row',
    backgroundColor: baseColors.bgElevated,
    borderRadius: radius.pill,
    padding: 3,
    gap: 3,
  },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.pill, minWidth: 60 },
  segmentActive: { backgroundColor: baseColors.accent },
  segmentText: { color: baseColors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  segmentTextActive: { color: baseColors.onAccent },
  processingBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: baseColors.border,
    paddingTop: spacing.sm,
  },
});
