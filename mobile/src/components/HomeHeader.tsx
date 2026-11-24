import { StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/AppText';

import { HomeActivityButton } from '@/components/HomeActivityButton';
import { Press } from '@/components/Press';
import type { Notebook } from '@/core/notebooks';
import {
  designControl,
  designIcon,
  designRadius,
  designSpace,
  designType,
} from '@/theme/design';

import { Icon } from '@/ui/icons';
import { useDesign } from '@/ui/useDesign';

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
  onOpenMap(): void;
  onOpenCalendar(): void;
  onOpenActivity(): void;
  onOpenSettings(): void;
}

/**
 * Cabecalho compacto da home. O caderno vira um botao de icone (o nome grande
 * saiu) e a busca so ocupa espaco quando o usuario pede.
 *
 * Nada saiu daqui na migracao: caderno e troca, estado de sync com ponto,
 * atividade, calendario, mapa, busca e opcoes continuam no mesmo lugar.
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
  onOpenMap,
  onOpenCalendar,
  onOpenActivity,
  onOpenSettings,
}: HomeHeaderProps) {
  const colors = useDesign();
  const recent = !notebook;
  const syncGlyph = syncState === 'syncing' ? 'sync' : 'cloud';
  const syncColor = syncState === 'error' ? colors.danger : colors.textMuted;

  return (
    <View>
      <View style={styles.header}>
        <Press
          style={styles.notebook}
          onPress={onOpenNotebooks}
          accessibilityRole="button"
          accessibilityLabel={
            recent
              ? 'Recentes. Escolher caderno'
              : `Caderno ${notebook.name}. Trocar de caderno`
          }
        >
          <Icon
            name={recent ? 'clock' : 'book'}
            size={designIcon.box}
            color={notebook?.color || colors.textMuted}
          />
          <Text style={[styles.notebookName, { color: colors.text }]} numberOfLines={1}>
            {notebook?.name ?? 'Recentes'}
          </Text>
          <Icon name="chevron" size={designIcon.sm} color={colors.textMuted} />
        </Press>

        <View style={styles.actions}>
          <Press
            style={styles.iconButton}
            hitSlop={4}
            onPress={onOpenSync}
            accessibilityLabel="Sincronização"
          >
            <Icon name={syncGlyph} size={designIcon.box} color={syncColor} />
            {syncState !== 'ok' ? (
              <View
                style={[
                  styles.syncDot,
                  {
                    backgroundColor:
                      syncState === 'error' ? colors.danger : colors.primary,
                    borderColor: colors.surface,
                  },
                ]}
              />
            ) : null}
          </Press>
          <HomeActivityButton onPress={onOpenActivity} />
          <Press
            style={styles.iconButton}
            hitSlop={4}
            onPress={onOpenCalendar}
            accessibilityLabel="Calendário"
          >
            <Icon name="calendar" size={designIcon.box} color={colors.text} />
          </Press>
          <Press
            style={styles.iconButton}
            hitSlop={4}
            onPress={onOpenMap}
            accessibilityLabel="Mapa de relações"
          >
            <Icon name="network" size={designIcon.box} color={colors.text} />
          </Press>
          <Press
            style={styles.iconButton}
            hitSlop={4}
            onPress={onToggleSearch}
            accessibilityLabel={searchOpen ? 'Fechar busca' : 'Buscar notas'}
          >
            <Icon
              name="search"
              size={designIcon.box}
              color={searchOpen ? colors.primary : colors.text}
            />
          </Press>
          <Press
            style={styles.iconButton}
            hitSlop={4}
            onPress={onOpenSettings}
            accessibilityLabel="Opções"
          >
            <Icon name="gear" size={designIcon.box} color={colors.text} />
          </Press>
        </View>
      </View>

      {searchOpen ? (
        <View
          style={[
            styles.searchWrap,
            { backgroundColor: colors.surfaceAlt, borderColor: colors.line },
          ]}
        >
          <Icon name="search" size={designIcon.sm} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={onChangeQuery}
            placeholder={searchPlaceholder}
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.primary}
            style={[styles.searchInput, { color: colors.text }]}
            autoFocus
            returnKeyType="search"
            accessibilityLabel="Buscar notas"
          />
          {query ? (
            <Press onPress={() => onChangeQuery('')} accessibilityLabel="Limpar busca" hitSlop={8}>
              <Icon name="close" size={designIcon.sm} color={colors.textMuted} />
            </Press>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: designSpace.s4,
    paddingHorizontal: designSpace.s4,
    paddingVertical: designSpace.s2,
  },
  notebook: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: designSpace.s6,
    flexShrink: 1,
    minHeight: 40,
    paddingHorizontal: designSpace.s4,
  },
  notebookName: {
    flexShrink: 1,
    fontSize: designType.body.size,
    fontWeight: '600' as const,
  },
  actions: { flexDirection: 'row' as const, alignItems: 'center' as const },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  syncDot: {
    position: 'absolute' as const,
    top: 6,
    right: 6,
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1,
  },
  searchWrap: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: designSpace.s6,
    marginHorizontal: designSpace.s6,
    marginBottom: designSpace.s4,
    paddingHorizontal: designSpace.s8,
    height: designControl.lg,
    borderRadius: designRadius.control,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: designType.body.size,
    paddingVertical: 0,
  },
});
