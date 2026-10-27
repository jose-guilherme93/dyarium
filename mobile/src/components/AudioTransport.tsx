/**
 * Transporte do audio que esta tocando: play/pause, tempo, onda e a previa da
 * transcricao.
 *
 * Um unico player (o do app) alimenta este componente. A posicao mostrada
 * acompanha o dedo e segura o alvo por um instante depois do seek, para a onda
 * nao voltar enquanto o player nao alcanca o ponto pedido. O seek entra direto
 * no player: quando a fonte acabou de ser apontada, a troca e o seek ficam na
 * mesma fila da thread principal, entao tocar num trecho logo depois de abrir o
 * audio nao o joga de volta ao comeco.
 */

import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayerStatus, type AudioPlayer } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import {
  View,
} from 'react-native';
import { Text } from '@/components/AppText';

import { AudioWaveform } from '@/components/AudioWaveform';
import { Press } from '@/components/Press';
import { SyncedTranscript } from '@/components/SyncedTranscript';
import { formatDuration } from '@/core/format';
import type { TranscriptSegment } from '@/core/types';
import { playPlayer, seekPlayer } from '@/services/playback';
import { baseColors, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

/** Quanto tempo o alvo do seek fica na onda esperando o player alcancar. */
const HOLD_MS = 1200;
/** Distancia (s) a partir da qual consideramos que o player chegou ao alvo. */
const REACHED = 0.6;

interface AudioTransportProps {
  player: AudioPlayer;
  /** Semente da onda: a referencia do audio (mesma onda em qualquer tela). */
  seed: string;
  /** Duracao conhecida do audio, usada antes de o player carregar. */
  durationMs: number;
  /** Posicao inicial (quando o toque veio de um trecho da transcricao). */
  startMs?: number | null;
  segments?: TranscriptSegment[];
  onOpenTranscript?: () => void;
  onEditTranscript?: (startMs: number) => void;
}

export function AudioTransport({
  player,
  seed,
  durationMs,
  startMs,
  segments,
  onOpenTranscript,
  onEditTranscript,
}: AudioTransportProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const status = useAudioPlayerStatus(player);
  const [scrub, setScrub] = useState<number | null>(null);
  /** Alvo do ultimo seek: a onda mostra esse ponto enquanto o player nao
   * reporta a posicao nova. O timer solta o alvo depois de HOLD_MS. */
  const [hold, setHold] = useState<number | null>(startMs != null ? startMs / 1000 : null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );

  const current = status.currentTime || 0;
  const held = hold !== null && Math.abs(current - hold) > REACHED ? hold : null;
  const shown = scrub ?? held ?? current;

  const holdAt = (seconds: number) => {
    setHold(seconds);
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => setHold(null), HOLD_MS);
  };

  const seek = (seconds: number, autoplay = false) => {
    holdAt(seconds);
    void seekPlayer(player, seconds, { autoplay }).catch(() => undefined);
  };

  const duration = status.duration > 0 ? status.duration : Math.max(0, durationMs) / 1000;

  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    playPlayer(player);
  };

  return (
    <View style={styles.transport}>
      <View style={styles.row}>
        <Press
          onPress={toggle}
          accessibilityLabel={status.playing ? 'Pausar' : 'Tocar'}
          hitSlop={8}
        >
          <Ionicons name={status.playing ? 'pause' : 'play'} size={18} color={colors.text} />
        </Press>
        <Text style={styles.time}>
          {formatDuration(shown * 1000)} / {formatDuration(duration * 1000)}
        </Text>
      </View>
      <AudioWaveform
        seed={seed}
        current={shown}
        duration={duration}
        segments={segments}
        // Parado (ou no fim), tocar na onda ja toca dali; tocando, so pula.
        onSeek={(seconds) => seek(seconds, !status.playing)}
        onScrubChange={setScrub}
      />
      {segments && segments.length > 0 ? (
        <SyncedTranscript
          player={player}
          segments={segments}
          onOpen={onOpenTranscript}
          onSeek={(start) => seek(start / 1000, true)}
          onEdit={onEditTranscript}
        />
      ) : null}
    </View>
  );
}

const baseStyles = defineStyles({
  transport: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  time: { color: baseColors.text, fontSize: 13, fontVariant: ['tabular-nums'] },
});
