import { useCallback } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';
import { Screen } from '@/components/Screen';
import { formatBytes } from '@/core/format';
import { back } from '@/services/appNavigation';
import { useDrive } from '@/state/useDrive';
import { useLibrary } from '@/state/LibraryContext';
import {
  designFocus,
  designFont,
  designIcon,
  designMark,
  designRadius,
  designRow,
  designSpace,
  designState,
  designType,
} from '@/theme/design';
import { Icon } from '@/ui/icons';
import { useDesign } from '@/ui/useDesign';

function relativeShort(iso: string | undefined): string {
  if (!iso) return '—';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ontem';
  return `há ${days} d`;
}

function initialsOf(profile: { name: string; email: string } | null): string {
  const source = (profile?.name || profile?.email || '').trim();
  if (!source) return '?';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function PerfilScreen() {
  const colors = useDesign();
  const drive = useDrive();
  const { recordings } = useLibrary();
  const aliveCount = recordings.filter((r) => !r.deletedAt).length;

  const handleSync = useCallback(() => {
    drive.clearError();
    void drive.sync();
  }, [drive]);

  const handleConnect = useCallback(() => {
    drive.clearError();
    void drive.connect();
  }, [drive]);

  const handleDisconnect = useCallback(() => {
    void drive.disconnect();
  }, [drive]);

  const connected = drive.status === 'connected';
  const expired = drive.status === 'expired';
  // "Sair desta conta" so faz sentido quando existe conta: conectada, vencida
  // ou com perfil conhecido. Sem conta, a tela oferece apenas conectar/trocar.
  const hasAccount =
    connected || expired || Boolean(drive.profile?.name || drive.profile?.email);
  const summary = drive.summary;

  // O estado vive na forma da marca ao lado do rotulo; o valor continua sendo
  // o dado do Drive, nao uma frase repetindo o estado.
  const driveMark = connected
    ? { backgroundColor: colors.success, borderColor: colors.success }
    : expired
      ? { backgroundColor: 'transparent', borderColor: colors.warning }
      : {
          backgroundColor: 'transparent',
          borderColor: colors.textMuted,
          borderStyle: 'dashed' as const,
        };
  const driveStateLabel = connected
    ? 'Conectado'
    : expired
      ? 'Sessão vencida'
      : 'Sem conta';
  const driveValue =
    (connected || expired) && summary
      ? `${formatBytes(summary.bytes ?? 0)} · ${summary.notes ?? 0} notas`
      : '— notas';
  const primaryLabel = drive.busy
    ? 'SINCRONIZANDO'
    : connected
      ? 'SINCRONIZAR'
      : 'CONECTAR';

  return (
    <Screen>
      <View style={[styles.header, { borderBottomColor: colors.line }]}>
        <Press
          onPress={() => back()}
          style={styles.back}
          accessibilityLabel="Voltar"
          accessibilityRole="button"
        >
          <Icon name="back" size={designIcon.lg} color={colors.text} />
        </Press>
        <Text style={[styles.title, { color: colors.text }]}>Perfil</Text>
        <View style={styles.spacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {drive.error ? (
          <Text style={[styles.errorLine, { color: colors.danger }]}>{drive.error}</Text>
        ) : null}

        <View style={styles.identity}>
          <View testID="perfil-avatar" style={styles.avatar}>
            {drive.profile?.picture ? (
              <Image
                source={{ uri: drive.profile.picture }}
                style={[styles.avatarImage, { borderColor: colors.line }]}
              />
            ) : (
              <View
                style={[
                  styles.avatarInitials,
                  { backgroundColor: colors.surfaceAlt, borderColor: colors.line },
                ]}
              >
                <Text style={[styles.avatarText, { color: colors.text }]}>
                  {initialsOf(drive.profile)}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.identityText}>
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
              {drive.profile?.name || 'Sem conta'}
            </Text>
            <Text style={[styles.email, { color: colors.textMuted }]} numberOfLines={1}>
              {drive.profile?.email || '—'}
            </Text>
          </View>
        </View>

        <View
          testID="perfil-drive-card"
          style={[
            styles.card,
            { backgroundColor: colors.surfaceAlt, borderColor: colors.line },
          ]}
        >
          <View style={[styles.cardRow, { borderBottomColor: colors.line }]}>
            <View style={styles.cardKey}>
              <Text style={[styles.cardLabel, { color: colors.textMuted }]}>Google Drive</Text>
              <View
                testID="perfil-drive-mark"
                style={[styles.mark, driveMark]}
                accessible
                accessibilityRole="image"
                accessibilityLabel={driveStateLabel}
              />
            </View>
            <Text style={[styles.cardValue, { color: colors.text }]} numberOfLines={1}>
              {driveValue}
            </Text>
          </View>
          <View style={[styles.cardRow, { borderBottomColor: colors.line }]}>
            <Text style={[styles.cardLabel, { color: colors.textMuted }]}>Último envio</Text>
            <Text style={[styles.cardValue, { color: colors.text }]}>
              {relativeShort(summary?.at)}
            </Text>
          </View>
          <View style={[styles.cardRow, styles.cardRowLast]}>
            <Text style={[styles.cardLabel, { color: colors.textMuted }]}>No aparelho</Text>
            <Text style={[styles.cardValue, { color: colors.text }]}>{aliveCount}</Text>
          </View>
        </View>

        <View style={styles.actions}>
          <Press
            style={[
              styles.button,
              {
                backgroundColor: colors.primary,
                borderColor: colors.primary,
                opacity: drive.busy ? designState.disabled : 1,
              },
            ]}
            onPress={connected ? handleSync : handleConnect}
            disabled={drive.busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: drive.busy, busy: drive.busy }}
          >
            <Text style={[styles.buttonLabel, { color: colors.surface }]}>{primaryLabel}</Text>
          </Press>
          <Press
            style={[
              styles.button,
              {
                backgroundColor: colors.surfaceAlt,
                borderColor: colors.line,
                opacity: drive.busy ? designState.disabled : 1,
              },
            ]}
            onPress={handleConnect}
            disabled={drive.busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: drive.busy }}
          >
            <Text style={[styles.buttonLabel, { color: colors.text }]}>TROCAR DE CONTA</Text>
          </Press>
        </View>

        {hasAccount ? (
          <Press
            testID="perfil-signout"
            style={[styles.signout, { borderTopColor: colors.line }]}
            onPress={handleDisconnect}
            disabled={drive.busy}
            accessibilityRole="button"
            accessibilityLabel="Sair desta conta"
            accessibilityState={{ disabled: drive.busy }}
          >
            <Text style={[styles.signoutText, { color: colors.danger }]}>Sair desta conta</Text>
          </Press>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    height: designRow.touch,
    paddingHorizontal: designSpace.s16,
    borderBottomWidth: designFocus.width,
  },
  back: {
    width: designRow.touch,
    height: designRow.touch,
    alignItems: 'center',
    justifyContent: 'center',
    marginStart: -designSpace.s12,
  },
  title: {
    flex: 1,
    fontFamily: designFont.semibold,
    fontSize: designType.title.size,
    lineHeight: Math.round(designType.title.size * designType.title.lineHeight),
    letterSpacing: designType.title.letterSpacing,
    fontWeight: 'normal',
    textAlign: 'center',
  },
  spacer: { width: designRow.touch, height: designRow.touch },
  content: {
    flexGrow: 1,
    paddingHorizontal: designSpace.s16,
    paddingBottom: designSpace.s16,
    gap: designSpace.s8,
  },
  errorLine: {
    fontSize: designType.body.size,
    lineHeight: Math.round(designType.body.size * 1.4),
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpace.s12,
    paddingTop: designSpace.s12,
    paddingBottom: designSpace.s8,
  },
  avatar: { width: designRow.touch, height: designRow.touch },
  avatarImage: {
    width: designRow.touch,
    height: designRow.touch,
    borderRadius: designRadius.surface,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatarInitials: {
    width: designRow.touch,
    height: designRow.touch,
    borderRadius: designRadius.surface,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: designFont.semibold,
    fontSize: designType.title.size,
    fontWeight: 'normal',
  },
  identityText: { flex: 1, minWidth: 0, gap: designSpace.s2 },
  name: {
    fontFamily: designFont.semibold,
    fontSize: designType.title.size,
    lineHeight: Math.round(designType.title.size * designType.title.lineHeight),
    fontWeight: 'normal',
  },
  email: {
    fontFamily: designFont.monoStack,
    fontSize: designType.mono.size,
    lineHeight: Math.ceil(designType.mono.size * 1.3),
    fontVariant: ['tabular-nums'],
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: designRadius.surface,
    paddingHorizontal: designSpace.s12,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: designSpace.s12,
    minHeight: designRow.touch,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cardRowLast: { borderBottomWidth: 0 },
  cardKey: { flexDirection: 'row', alignItems: 'center', gap: designSpace.s6 },
  cardLabel: {
    fontSize: designType.body.size,
    lineHeight: Math.round(designType.body.size * designType.body.lineHeight),
  },
  cardValue: {
    flexShrink: 1,
    fontFamily: designFont.monoStack,
    fontSize: designType.mono.size,
    lineHeight: Math.ceil(designType.mono.size * 1.3),
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  mark: {
    width: designMark.size,
    height: designMark.size,
    borderRadius: designMark.size / 2,
    borderWidth: designMark.stroke,
  },
  actions: {
    gap: designSpace.s8,
    paddingTop: designSpace.s8,
  },
  button: {
    height: designRow.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designRadius.control,
    borderWidth: designFocus.width,
  },
  buttonLabel: {
    fontSize: designType.label.size,
    lineHeight: Math.round(designType.label.size * designType.title.lineHeight),
    fontWeight: '600',
    letterSpacing: designType.label.letterSpacing,
    textTransform: 'uppercase',
  },
  signout: {
    height: designRow.touch,
    justifyContent: 'center',
    marginTop: 'auto',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  signoutText: {
    fontSize: designType.body.size,
    lineHeight: Math.round(designType.body.size * designType.body.lineHeight),
  },
});
