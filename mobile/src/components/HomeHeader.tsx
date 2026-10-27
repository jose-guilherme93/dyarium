import { Ionicons } from '@expo/vector-icons';
import {
  View,
} from 'react-native';
import { Text, TextInput } from '@/components/AppText';

import { HomeActivityButton } from '@/components/HomeActivityButton';
import { Press } from '@/components/Press';
import type { Notebook } from '@/core/notebooks';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

export type SyncState = 'ok' | 'syncing' | 'error';

interface HomeHeaderProps {
  notebook?: Notebook;
  syncState: SyncState;
  searchOpen: boolean;
  query: string;
  searchPlaceholder?: string;
  onToggleSearch(): void;
  onChangeQuery(value: string): void;
  onOpenNotebooks(): void;
  onOpenSync(): void;
  onOpenActivity(): void;
  onOpenSettings(): void;
}

/**
 * Cabecalho compacto da home. O caderno vira um botao de icone (o nome grande
 * saiu) e a busca so ocupa espaco quando o usuario pede.
 */
export function HomeHeader({
  notebook,
  syncState,
  searchOpen,
  query,
  searchPlaceholder = 'Buscar em todos os cadernos',
  onToggleSearch,
  onChangeQuery,
  onOpenNotebooks,
  onOpenSync,
  onOpenActivity,
  onOpenSettings,
}: HomeHeaderProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const recent = !notebook;
  const syncIcon =
    syncState === 'error'
      ? 'cloud-offline-outline'
      : syncState === 'syncing'
        ? 'cloud-upload-outline'
        : 'cloud-done-outline';
  const syncColor = syncState === 'error' ? colors.danger : colors.textTertiary;

  return (
    <View>
      <View style={styles.header}>
        <Press
          style={styles.notebook}
          onPress={onOpenNotebooks}
          accessibilityRole="button"
          accessibilityLabel={
            recent
              ? 'Páginas recentes. Escolher caderno'
              : `Caderno ${notebook.name}. Trocar de caderno`
          }
        >
          <Ionicons
            name={recent ? 'time-outline' : 'book-outline'}
            size={19}
            color={notebook?.color || colors.textSecondary}
          />
          <Text style={styles.notebookName} numberOfLines={1}>
            {notebook?.name ?? 'Páginas recentes'}
          </Text>
          <Ionicons name="chevron-down" size={14} color={colors.textTertiary} />
        </Press>

        <View style={styles.actions}>
          <Press
            style={styles.iconButton}
            onPress={onOpenSync}
            accessibilityLabel="Sincronização"
          >
            <Ionicons name={syncIcon} size={21} color={syncColor} />
            {syncState !== 'ok' ? (
              <View
                style={[
                  styles.syncDot,
                  { backgroundColor: syncState === 'error' ? colors.danger : colors.accent },
                ]}
              />
            ) : null}
          </Press>
          <HomeActivityButton onPress={onOpenActivity} />
          <Press
            style={styles.iconButton}
            onPress={onToggleSearch}
            accessibilityLabel={searchOpen ? 'Fechar busca' : 'Buscar notas'}
          >
            <Ionicons name="search" size={22} color={searchOpen ? colors.accent : colors.text} />
          </Press>
          <Press
            style={styles.iconButton}
            onPress={onOpenSettings}
            accessibilityLabel="Opções"
          >
            <Ionicons name="settings-outline" size={22} color={colors.text} />
          </Press>
        </View>
      </View>

      {searchOpen ? (
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={15} color={colors.textTertiary} />
          <TextInput
            value={query}
            onChangeText={onChangeQuery}
            placeholder={searchPlaceholder}
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.accent}
            style={styles.searchInput}
            autoFocus
            returnKeyType="search"
            accessibilityLabel="Buscar notas"
          />
          {query ? (
            <Press onPress={() => onChangeQuery('')} accessibilityLabel="Limpar busca" hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
            </Press>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const baseStyles = defineStyles({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  notebook: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    minHeight: 40,
  },
  notebookName: {
    flexShrink: 1,
    color: baseColors.text,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  actions: { flexDirection: 'row', alignItems: 'center' },
  iconButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  syncDot: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: baseColors.bg,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: baseColors.surface,
  },
  searchInput: { flex: 1, color: baseColors.text, fontSize: fontSize.sm, paddingVertical: 0 },
});
