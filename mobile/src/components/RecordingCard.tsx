import { memo, useMemo } from 'react';
import { StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';

import { TagChip } from '@/components/TagChip';
import { formatDuration, formatStamp, noteDateIso } from '@/core/format';
import { markdownPreview } from '@/core/richText';
import { displayTitle } from '@/core/title';
import { checkpointPercent } from '@/core/transcription';
import { hasFinalTranscript, type Recording } from '@/core/types';
import { useRenderCount } from '@/dev/perf';
import { useTranscriptionProgress, useTranscriptionRunning } from '@/state/useTranscriptionProgress';
import {
  designIcon,
  designRadius,
  designSpace,
  designType,
} from '@/theme/design';

import { Icon, type IconName } from '@/ui/icons';
import { useDesign } from '@/ui/useDesign';

interface RecordingCardProps {
  recording: Recording;
  /** Abre a tela da nota. */
  onOpen?: (noteId: string) => void;
  /** Toque longo: abre as opcoes perto do dedo (arquivar, apagar, propriedades). */
  onLongPress?: (item: Recording, anchor: { x: number; y: number }) => void;
  /** Nome do caderno, mostrado na busca global. */
  notebookLabel?: string;
  /** Linha compacta da home, sem cartao arredondado e com divisor. */
  dense?: boolean;
  /** Trabalho pesado rodando nesta nota: icone + porcentagem no canto. */
  busy?: {
    kind: 'transcription' | 'analysis';
    percent?: number;
    queued?: boolean;
    remote?: boolean;
  } | null;
  /** Glifo a esquerda (variante A da lista Recentes). */
  glyphIcon?: IconName;
  glyphColor?: string;
}

/**
 * Linha da lista. Sem botao de play nem tres pontinhos: o audio so toca dentro
 * da nota, e as opcoes abrem com um toque longo.
 *
 * A linha densa tem duas linhas de texto e o estado a direita; o cartao (busca
 * e biblioteca) mantem a mesma anatomia com superficie em volta.
 */
export const RecordingCard = memo(function RecordingCard({
  recording,
  onOpen,
  onLongPress,
  notebookLabel,
  dense = false,
  busy = null,
  glyphIcon,
  glyphColor,
}: RecordingCardProps) {
  const colors = useDesign();

  useRenderCount('RecordingCard');
  const hasAudio = Boolean(recording.filePath);
  const tags = recording.tags ?? [];
  // O card mostra uma linha, mas a lista re-renderiza varios cards por ciclo:
  // converter a nota inteira a cada render custava caro na home.
  const preview = useMemo(
    () => markdownPreview(hasAudio ? recording.transcript : recording.text),
    [hasAudio, recording.transcript, recording.text],
  );
  // Transcricao em andamento: mostra um icone discreto + porcentagem no canto.
  // `pending` sozinho e um checkpoint salvo (parado ou falho); "Transcrevendo"
  // so quando a passada esta rodando de verdade.
  const pendingTranscript =
    hasAudio && recording.transcriptStatus === 'pending' && !hasFinalTranscript(recording);
  const running = useTranscriptionRunning(recording.id, pendingTranscript);
  const transcribing = pendingTranscript && running;
  const livePercent = useTranscriptionProgress(recording.id, transcribing);
  const percent = livePercent > 0 ? Math.round(livePercent) : checkpointPercent(recording);
  const badge =
    busy ?? (transcribing ? { kind: 'transcription' as const, percent } : null);
  const remote = badge?.remote === true;
  const badgeLabel = remote
    ? 'No servidor'
    : badge?.queued
      ? 'Na fila'
      : badge?.kind === 'analysis'
        ? 'Analisando'
        : 'Transcrevendo';
  const badgeIcon: IconName = remote
    ? 'cloud'
    : badge?.queued
      ? 'clock'
      : badge?.kind === 'analysis'
        ? 'chart'
        : 'sync';
  const badgeColor = remote
    ? colors.textMuted
    : badge?.kind === 'analysis'
      ? colors.info
      : colors.primary;

  const showGlyph = glyphIcon != null;

  return (
    <View
      style={[
        styles.wrap,
        dense
          ? [styles.wrapDense, { borderBottomColor: colors.line }]
          : { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line },
      ]}
    >
      <Press
        style={[
          styles.content,
          dense ? styles.contentDense : null,
          showGlyph ? styles.contentWithGlyph : null,
        ]}
        onPress={() => onOpen?.(recording.id)}
        onLongPress={(event: GestureResponderEvent) =>
          onLongPress?.(recording, { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY })
        }
        delayLongPress={350}
      >
        {showGlyph ? (
          <View style={[styles.glyph, { borderColor: colors.line }]}>
            <Icon
              name={glyphIcon}
              size={designIcon.sm}
              color={glyphColor ?? colors.textMuted}
            />
          </View>
        ) : null}

        <View style={[styles.body, dense ? styles.bodyDense : null]}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
              {displayTitle(recording)}
            </Text>
            {badge ? (
              <View
                style={[styles.badge, { borderColor: badgeColor }]}
                accessibilityLabel={`${badgeLabel}${
                  badge.percent !== undefined ? ` ${Math.round(badge.percent)}%` : ''
                }`}
              >
                <Icon name={badgeIcon} size={9} color={badgeColor} />
                {badge.percent !== undefined && !remote ? (
                  <Text style={[styles.badgeText, { color: badgeColor }]}>
                    {Math.round(badge.percent)}%
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>

          <View style={styles.subRow}>
            <Icon
              name={hasAudio ? 'mic' : 'doc'}
              size={9}
              color={colors.textMuted}
            />
            {recording.source === 'share' ? (
              <Icon name="cloud" size={9} color={colors.info} />
            ) : null}
            {recording.durationMs ? (
              <Text style={[styles.sub, { color: colors.textMuted }]}>
                {formatDuration(recording.durationMs)}
              </Text>
            ) : null}
            {recording.archived ? (
              <Text style={[styles.sub, { color: colors.textMuted }]}>· arquivada</Text>
            ) : null}
            {notebookLabel ? (
              <Text style={[styles.sub, { color: colors.textMuted }]} numberOfLines={1}>
                · {notebookLabel}
              </Text>
            ) : null}
            <View style={styles.grow} />
            <Text style={[styles.stamp, { color: colors.textMuted }]}>
              {formatStamp(noteDateIso(recording))}
            </Text>
          </View>

          {tags.length > 0 ? (
            <View style={styles.tags}>
              {tags.slice(0, 2).map((tag) => (
                <TagChip key={tag.toLowerCase()} name={tag} size="sm" />
              ))}
              {tags.length > 2 ? (
                <Text style={[styles.more, { color: colors.textMuted }]}>
                  +{tags.length - 2}
                </Text>
              ) : null}
            </View>
          ) : null}

          {preview ? (
            <Text style={[styles.preview, { color: colors.textMuted }]} numberOfLines={1}>
              {preview}
            </Text>
          ) : null}
        </View>
      </Press>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    borderRadius: designRadius.surface,
    overflow: 'hidden',
  },
  wrapDense: {
    borderRadius: 0,
    borderBottomWidth: 1,
  },
  content: { padding: designSpace.s8, gap: designSpace.s2 },
  contentDense: { paddingHorizontal: designSpace.s12, paddingVertical: designSpace.s6 },
  contentWithGlyph: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: designSpace.s8,
  },
  glyph: {
    width: 22,
    height: 22,
    borderRadius: designRadius.control,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: designSpace.s2 },
  bodyDense: { gap: designSpace.s2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: designSpace.s6 },
  title: {
    flex: 1,
    fontSize: designType.body.size,
    fontWeight: '500',
    lineHeight: designType.body.size * designType.body.lineHeight,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpace.s2,
    borderWidth: 1,
    borderRadius: designRadius.control,
    paddingHorizontal: designSpace.s4,
    height: 16,
  },
  badgeText: {
    fontSize: 9,
    fontVariant: ['tabular-nums'],
  },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: designSpace.s4 },
  sub: {
    fontSize: designType.mono.size,
    fontVariant: ['tabular-nums'],
  },
  stamp: {
    fontSize: designType.mono.size,
    fontVariant: ['tabular-nums'],
  },
  tags: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpace.s2,
    flexWrap: 'wrap',
    marginTop: designSpace.s2,
  },
  more: { fontSize: 9, fontWeight: '500' },
  grow: { flex: 1 },
  preview: {
    fontSize: designType.mono.size,
    marginTop: designSpace.s2,
  },
});
