/**
 * Card de audio do corpo da nota.
 *
 * Uma faixa de altura fixa: o card mede 182 dp em qualquer estado, entao a nota
 * nao pula quando a transcricao chega, quando o player abre ou quando a
 * transcricao falha. Sao tres faixas com altura reservada: topo (38), onda ou
 * transporte (40) e texto (63).
 *
 * A transcricao sincronizada nao aparece aqui: ela vive atras de
 * `onOpenTranscript`, e o card mostra so as tres primeiras linhas do texto.
 * Quem toca e o player unico do app, passado pela tela da nota: o card nao cria
 * um player proprio (dois players tocavam o mesmo audio e cada um tinha o seu
 * botao de play).
 */

import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayerStatus, type AudioPlayer } from 'expo-audio';
import {
  ActivityIndicator,
  View,
} from 'react-native';
import { Text } from '@/components/AppText';

import { AudioTransport } from '@/components/AudioTransport';
import { AudioWaveform } from '@/components/AudioWaveform';
import { Press } from '@/components/Press';
import { formatDuration } from '@/core/format';
import type { NoteAudioNode } from '@/core/noteDocument';
import type { TranscriptSegment } from '@/core/types';
import { baseColors, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

/** Altura do card e das faixas que a compoem. */
const CARD_HEIGHT = 182;
const TOP_ROW_HEIGHT = 38;
const CONTROL_BAND_HEIGHT = 40;
const TEXT_BAND_HEIGHT = 63;
/** Linhas da previa (13/19) que cabem na faixa de texto. */
const PREVIEW_LINES = 3;
const PREVIEW_LINE_HEIGHT = 19;

export interface NoteAudioCardProps {
  node: NoteAudioNode;
  /** Transcricao do audio, quando houver. */
  transcript?: string;
  /** Segmentos com minutagem: alimentam a onda e o transporte. */
  segments?: TranscriptSegment[];
  /** Este e o audio que esta no player agora. */
  active?: boolean;
  /** Player unico do app (so quando `active`). */
  player?: AudioPlayer | null;
  /** Trecho inicial quando a reproducao comecou pela transcricao. */
  startMs?: number | null;
  /** Progresso (0..100) da transcricao, enquanto ela roda. */
  transcribingPercent?: number;
  /** Transcricao pedida e ainda sem andamento (ex.: feita no servidor). */
  transcribingWait?: boolean;
  /** A ultima tentativa de transcricao falhou: mostra o aviso e o tentar de novo. */
  transcribeError?: boolean;
  /** Ha modelo local e a nota ainda nao tem transcricao? */
  canTranscribe?: boolean;
  onTranscribe?: () => void;
  onStopTranscribe?: () => void;
  /** Toca este audio do inicio. */
  onPlay?: () => void;
  /** Toca este audio a partir de um trecho (audio parado). */
  onPlayFrom?: (startMs: number) => void;
  onOpenTranscript?: () => void;
  onEditTranscript?: (startMs: number) => void;
  onRemove?: () => void;
}

/**
 * Tempo do audio no topo do card.
 *
 * Componente proprio para o tick do player re-renderizar so este texto, e nao o
 * card inteiro (que arrastaria a onda junto varias vezes por segundo).
 */
function AudioClock({ player, durationMs }: { player: AudioPlayer; durationMs: number }) {
  const styles = useThemedStyles(baseStyles);
  const status = useAudioPlayerStatus(player);
  const total = status.duration > 0 ? status.duration : Math.max(0, durationMs) / 1000;

  return (
    <Text style={styles.audioDuration} numberOfLines={1} testID="audio-clock">
      {`${formatDuration((status.currentTime || 0) * 1000)} / ${formatDuration(total * 1000)}`}
    </Text>
  );
}

/** Audio do documento: player entre os trechos de texto. */
export function NoteAudioCard({
  node,
  transcript,
  segments,
  active = false,
  player,
  startMs,
  transcribingPercent,
  transcribingWait = false,
  transcribeError = false,
  canTranscribe,
  onTranscribe,
  onStopTranscribe,
  onPlay,
  onPlayFrom,
  onOpenTranscript,
  onEditTranscript,
  onRemove,
}: NoteAudioCardProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const transcribing = transcribingPercent !== undefined || transcribingWait;
  // O erro cede o lugar ao progresso: uma nova tentativa ja esta rodando.
  const failed = transcribeError && !transcribing;
  // O transporte so existe com o player, mesmo que o card esteja ativo (o
  // player e criado pela tela da nota).
  const attached = active ? player ?? null : null;

  // Sem o texto final, os segmentos ainda dizem o que foi falado: a previa nao
  // fica vazia so porque a transcricao chegou em outro campo.
  const preview =
    transcript?.trim() ||
    segments
      ?.map((segment) => (segment.revised ?? segment.text).trim())
      .filter(Boolean)
      .join(' ') ||
    null;

  const percent =
    transcribingPercent !== undefined
      ? Math.min(100, Math.max(0, Math.round(transcribingPercent)))
      : null;

  return (
    <View testID="audio-card" style={styles.audioCard}>
      <View style={styles.audioRow} testID="audio-band-top">
        {active ? (
          // Tocando, o play sai de cena e vira so indicacao de estado: o unico
          // controle fica no transporte, logo abaixo.
          <View
            style={[styles.audioPlay, styles.audioIndicator]}
            testID="audio-indicator"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Ionicons name="pulse" size={18} color={colors.textSecondary} />
          </View>
        ) : (
          <Press style={styles.audioPlay} onPress={onPlay} accessibilityLabel="Tocar áudio">
            <Ionicons
              name="play"
              size={18}
              color={colors.text}
              style={{ marginLeft: 2 }}
            />
          </Press>
        )}
        <View style={styles.audioInfo}>
          <Text style={styles.audioTitle} numberOfLines={1}>Áudio</Text>
          {attached ? (
            <AudioClock player={attached} durationMs={node.durationMs} />
          ) : (
            <Text style={styles.audioDuration} numberOfLines={1}>
              {node.durationMs > 0 ? formatDuration(node.durationMs) : 'Duração desconhecida'}
            </Text>
          )}
        </View>
        <View style={styles.audioActions}>
          {failed ? null : transcribing ? (
            <Press
              style={styles.iconButton}
              onPress={onStopTranscribe}
              accessibilityLabel="Parar transcrição"
              hitSlop={6}
            >
              <Ionicons name="stop-circle-outline" size={18} color={colors.textSecondary} />
            </Press>
          ) : canTranscribe && onTranscribe ? (
            <Press
              style={styles.iconButton}
              onPress={onTranscribe}
              accessibilityLabel="Transcrever áudio"
              hitSlop={6}
            >
              <Ionicons name="text-outline" size={18} color={colors.textSecondary} />
            </Press>
          ) : (
            <View style={styles.iconButton}>
              <Ionicons name="mic-outline" size={17} color={colors.textTertiary} />
            </View>
          )}
          <Press
            style={styles.iconButton}
            onPress={onRemove}
            accessibilityLabel="Remover áudio"
            hitSlop={6}
          >
            <Ionicons name="trash-outline" size={17} color={colors.textTertiary} />
          </Press>
        </View>
      </View>

      <View style={styles.controlBand} testID="audio-band-control">
        {attached ? (
          <AudioTransport
            compact
            player={attached}
            seed={node.ref}
            durationMs={node.durationMs}
            startMs={startMs}
            segments={segments}
            transcript={transcript}
            onOpenTranscript={onOpenTranscript}
            onEditTranscript={onEditTranscript}
          />
        ) : (
          // Parado, a onda continua ali: tocar nela ja toca o audio dali, sem
          // precisar abrir a transcricao so para escolher um ponto.
          <AudioWaveform
            seed={node.ref}
            current={0}
            duration={node.durationMs / 1000}
            segments={segments}
            height={CONTROL_BAND_HEIGHT}
            label="Ouvir a partir de"
            onSeek={(seconds) => onPlayFrom?.(Math.round(seconds * 1000))}
          />
        )}
      </View>

      <View style={styles.textBand} testID="audio-band-text">
        {failed ? (
          <View style={styles.statusRow} testID="audio-transcribe-error">
            <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
            <Text style={[styles.statusText, styles.statusTextDanger]} numberOfLines={1}>
              Falha na transcrição
            </Text>
            <Press
              style={[styles.retry, !onTranscribe && styles.retryDisabled]}
              onPress={onTranscribe}
              disabled={!onTranscribe}
              accessibilityLabel="Tentar de novo"
              hitSlop={6}
            >
              <Ionicons name="refresh" size={16} color={colors.danger} />
              <Text style={styles.retryText}>Tentar</Text>
            </Press>
          </View>
        ) : transcribing ? (
          <View style={styles.progressBlock}>
            <View style={styles.transcribing} testID="audio-transcribing">
              <ActivityIndicator size="small" color={colors.textSecondary} />
              <Text style={styles.audioHint} numberOfLines={1}>
                Transcrevendo{percent !== null && percent > 0 ? ` ${percent}%` : '...'}
              </Text>
            </View>
            {percent !== null ? (
              <View style={styles.progressTrack} testID="audio-transcribing-progress">
                <View style={[styles.progressFill, { width: `${percent}%` }]} />
              </View>
            ) : null}
          </View>
        ) : preview ? (
          onOpenTranscript ? (
            // O texto e o proprio atalho para a transcricao completa (onde cada
            // frase e a minutagem podem ser editadas), como era antes.
            <Press onPress={onOpenTranscript} accessibilityLabel="Abrir transcrição completa">
              <Text
                style={styles.audioTranscript}
                numberOfLines={PREVIEW_LINES}
                testID="audio-transcript"
              >
                {preview}
              </Text>
            </Press>
          ) : (
            <Text
              style={styles.audioTranscript}
              numberOfLines={PREVIEW_LINES}
              testID="audio-transcript"
            >
              {preview}
            </Text>
          )
        ) : (
          <View style={styles.emptyRow} testID="audio-empty">
            <Ionicons name="text-outline" size={16} color={colors.textTertiary} />
            <Text style={styles.emptyText} numberOfLines={1}>Sem transcrição</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const baseStyles = defineStyles({
  audioCard: {
    // Uma altura so: as tres faixas abaixo somam exatamente o que fica
    // reservado, entao nada muda de tamanho entre os estados.
    height: CARD_HEIGHT,
    backgroundColor: baseColors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    overflow: 'hidden',
  },
  audioRow: {
    height: TOP_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  audioPlay: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: baseColors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioIndicator: { opacity: 0.7 },
  audioInfo: { flex: 1, minWidth: 0, gap: 2 },
  audioActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlBand: { height: CONTROL_BAND_HEIGHT, justifyContent: 'center' },
  textBand: { height: TEXT_BAND_HEIGHT, justifyContent: 'center', overflow: 'hidden' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { flexShrink: 1, color: baseColors.textSecondary, fontSize: 13 },
  statusTextDanger: { color: baseColors.danger },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: 28,
    paddingHorizontal: 6,
    borderRadius: radius.sm,
  },
  retryDisabled: { opacity: 0.4 },
  retryText: { color: baseColors.danger, fontSize: 12, fontWeight: '700' },
  audioTitle: { color: baseColors.text, fontSize: 15, fontWeight: '600' },
  audioDuration: {
    color: baseColors.textSecondary,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  progressBlock: { gap: spacing.xs },
  transcribing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  audioHint: { color: baseColors.textSecondary, fontSize: 12 },
  progressTrack: {
    height: 2,
    borderRadius: 1,
    backgroundColor: baseColors.surfaceElevated,
    overflow: 'hidden',
  },
  progressFill: { height: 2, backgroundColor: baseColors.accent },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  emptyText: { color: baseColors.textSecondary, fontSize: 13 },
  audioTranscript: {
    color: baseColors.textSecondary,
    fontSize: 13,
    lineHeight: PREVIEW_LINE_HEIGHT,
  },
});
