import { Image, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/AppText';

import type { GoogleProfile } from '@/services/driveAuth';

import { HomeActivityButton } from '@/components/HomeActivityButton';
import { Press } from '@/components/Press';
import type { Notebook } from '@/core/notebooks';
import {
  designControl,
  designFocus,
  designFont,
  designIcon,
  designMark,
  designRadius,
  designRow,
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
  profile?: GoogleProfile | null;
  accountState?: 'connected' | 'expired' | 'off';
  onToggleSearch(): void;
  onChangeQuery(value: string): void;
  onOpenNotebooks(): void;
  onOpenSync(): void;
  onOpenMap(): void;
  onOpenCalendar(): void;
  onOpenActivity(): void;
  onOpenSettings(): void;
  onOpenProfile?(): void;
}

/**
 * Cabecalho da home em duas linhas, como o prototipo: o caderno ocupa a
 * primeira (icone, nome inteiro e chevron) e as seis acoes mais o avatar
 * ocupam a segunda, com alvos de 44. O avatar fica por ultimo e leva a marca
 * do estado da conta dentro dele.
 *
 * Nada saiu daqui na migracao: caderno e troca, estado de sync com ponto,
 * atividade, calendario, mapa, busca, opcoes e perfil continuam na mesma
 * ordem.
 */
export function HomeHeader({
  notebook,
  syncState,
  searchOpen,
  query,
  searchPlaceholder = 'Buscar em todos os cadernos',
  profile = null,
  accountState = 'off',
  onToggleSearch,
  onChangeQuery,
  onOpenNotebooks,
  onOpenSync,
  onOpenMap,
  onOpenCalendar,
  onOpenActivity,
  onOpenSettings,
  onOpenProfile,
}: HomeHeaderProps) {
  const colors = useDesign();
  const recent = !notebook;
  const syncGlyph = syncState === 'syncing' ? 'sync' : 'cloud';
  const syncColor = syncState === 'error' ? colors.danger : colors.textMuted;

  const initials = (() => {
    const source = (profile?.name || profile?.email || '').trim();
    if (!source) return '?';
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  })();

  return (
    <View>
      <View style={styles.header}>
        <Press
          testID="home-header-notebook"
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
            color={colors.textMuted}
          />
          <Text style={[styles.notebookName, { color: colors.text }]}>
            {notebook?.name ?? 'Recentes'}
          </Text>
          <Icon name="chevron" size={designIcon.sm} color={colors.textMuted} />
        </Press>

        <View testID="home-header-actions" style={styles.actions}>
          <Press
            style={styles.iconButton}
            onPress={onOpenSync}
            accessibilityRole="button"
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
            onPress={onOpenCalendar}
            accessibilityRole="button"
            accessibilityLabel="Calendário"
          >
            <Icon name="calendar" size={designIcon.box} color={colors.text} />
          </Press>
          <Press
            style={styles.iconButton}
            onPress={onOpenMap}
            accessibilityRole="button"
            accessibilityLabel="Mapa de relações"
          >
            <Icon name="network" size={designIcon.box} color={colors.text} />
          </Press>
          <Press
            style={styles.iconButton}
            onPress={onToggleSearch}
            accessibilityRole="button"
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
            onPress={onOpenSettings}
            accessibilityRole="button"
            accessibilityLabel="Opções"
          >
            <Icon name="gear" size={designIcon.box} color={colors.text} />
          </Press>
          <Press
            testID="home-header-avatar"
            style={styles.avatarButton}
            onPress={() => onOpenProfile?.()}
            accessibilityLabel="Perfil"
            accessibilityRole="button"
          >
            <View style={styles.avatar}>
              {profile?.picture ? (
                <Image
                  testID="home-header-avatar-photo"
                  source={{ uri: profile.picture }}
                  style={[styles.avatarImage, { borderColor: colors.line }]}
                />
              ) : (
                <View
                  style={[
                    styles.avatarInitials,
                    { backgroundColor: colors.surfaceAlt, borderColor: colors.line },
                  ]}
                >
                  <Text style={[styles.avatarInitialsText, { color: colors.text }]}>
                    {initials}
                  </Text>
                </View>
              )}
              <View
                testID="home-header-state"
                style={[
                  styles.stateMark,
                  accountState === 'connected'
                    ? { backgroundColor: colors.success, borderColor: colors.success }
                    : accountState === 'expired'
                      ? {
                          backgroundColor: 'transparent',
                          borderColor: colors.warning,
                        }
                      : {
                          backgroundColor: 'transparent',
                          borderStyle: 'dashed',
                          borderColor: colors.textMuted,
                        },
                ]}
              />
            </View>
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
    paddingHorizontal: designSpace.s8,
    paddingTop: designSpace.s8,
    gap: designSpace.s2,
  },
  notebook: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: designSpace.s6,
    alignSelf: 'stretch' as const,
    minHeight: designRow.touch,
    borderRadius: designRadius.control,
  },
  notebookName: {
    flex: 1,
    fontFamily: designFont.semibold,
    fontSize: designType.title.size,
    lineHeight: Math.round(designType.title.size * designType.title.lineHeight),
    letterSpacing: designType.title.letterSpacing,
    fontWeight: 'normal' as const,
  },
  actions: {
    // Sete alvos de 44 (seis acoes e o avatar) somam 308; com 8 de margem em
    // cada lado o cabecalho cabe inteiro numa tela de 324 sem encolher nada.
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    alignSelf: 'stretch' as const,
  },
  iconButton: {
    width: designRow.touch,
    height: designRow.touch,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  syncDot: {
    position: 'absolute' as const,
    top: designSpace.s8 + designSpace.s2,
    right: designSpace.s8 + designSpace.s2,
    width: designSpace.s6,
    height: designSpace.s6,
    borderRadius: designRadius.surface,
    borderWidth: designFocus.width,
  },
  avatarButton: {
    width: designRow.touch,
    height: designRow.touch,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  avatar: {
    width: designControl.md,
    height: designControl.md,
    position: 'relative' as const,
  },
  avatarImage: {
    width: designControl.md,
    height: designControl.md,
    borderRadius: designRadius.surface,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatarInitials: {
    width: designControl.md,
    height: designControl.md,
    borderRadius: designRadius.surface,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  avatarInitialsText: {
    fontFamily: designFont.semibold,
    fontSize: designType.label.size,
    lineHeight: Math.round(designType.label.size * designType.title.lineHeight),
    fontWeight: 'normal' as const,
  },
  stateMark: {
    position: 'absolute' as const,
    right: designSpace.s2,
    bottom: designSpace.s2,
    width: designMark.size,
    height: designMark.size,
    borderRadius: designMark.size / 2,
    borderWidth: designMark.stroke,
  },
  searchWrap: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: designSpace.s6,
    marginHorizontal: designSpace.s8,
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
