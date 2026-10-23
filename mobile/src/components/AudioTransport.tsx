/**
 * Transporte do audio que esta tocando: play/pause, tempo, barra e a previa da
 * transcricao.
 *
 * Um unico player (o do app) alimenta este componente. A posicao mostrada
 * acompanha o dedo e segura o alvo por um instante depois do seek, para a barra
 * nao voltar enquanto o player nao alcanca o ponto pedido. O seek so e enviado
 * quando a fonte terminou de carregar (`isLoaded`); antes disso ele fica
 * pendente e e aplicado na hora em que carregar.
 */

import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayerStatus, type AudioPlayer } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AudioSeekBar } from '@/components/AudioSeekBar';
import { Press } from '@/components/Press';
import { SyncedTranscript } from '@/components/SyncedTranscript';
import { formatDuration } from '@/core/format';
import type { TranscriptSegment } from '@/core/types';
import { playPlayer } from '@/services/playback';
import { colors, spacing } from '@/theme/tokens';

/** Quanto tempo o alvo do seek fica na barra esperando o player alcancar. */
const HOLD_MS = 1200;
/** Distancia (s) a partir da qual consideramos que o player chegou ao alvo. */
const REACHED = 0.6;

interface AudioTransportProps {
  player: AudioPlayer;
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
  durationMs,
  startMs,
  segments,
  onOpenTranscript,
  onEditTranscript,
}: AudioTransportProps) {
  const status = useAudioPlayerStatus(player);
  const [scrub, setScrub] = useState<number | null>(null);
  /** Alvo do ultimo seek: a barra mostra esse ponto enquanto o player nao
   * reporta a posicao nova. O timer solta o alvo depois de HOLD_MS. */
  const [hold, setHold] = useState<number | null>(startMs != null ? startMs / 1000 : null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Seek que ainda espera a fonte carregar (segundos). */
  const pendingSeek = useRef<number | null>(startMs != null ? startMs / 1000 : null);
  /** Depois do seek pendente, comecar a tocar? */
  const playAfterSeek = useRef(startMs != null);

  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );

  // Seek pedido antes da fonte carregar: aplica quando o player avisa que esta
  // pronto. A barra ja mostra a duracao do metadado, entao esperar pela
  // duracao real deixava o toque sem efeito em AAC.
  useEffect(() => {
    if (pendingSeek.current === null || !status.isLoaded) return;
    const target = pendingSeek.current;
    pendingSeek.current = null;
    // O alvo entra na barra no mesmo instante em que o seek e enviado.
    setHold(target);
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => setHold(null), HOLD_MS);
    void player
      .seekTo(target)
      .then(() => {
        if (playAfterSeek.current) {
          playAfterSeek.current = false;
          playPlayer(player);
        }
      })
      .catch(() => undefined);
  }, [player, status.isLoaded]);

  const current = status.currentTime || 0;
  const held = hold !== null && Math.abs(current - hold) > REACHED ? hold : null;
  const shown = scrub ?? held ?? current;

  const seek = (seconds: number, autoplay = false) => {
    setHold(seconds);
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => setHold(null), HOLD_MS);
    if (status.isLoaded) {
      playAfterSeek.current = false;
      void player
        .seekTo(seconds)
        .then(() => {
          if (autoplay) playPlayer(player);
        })
        .catch(() => undefined);
    } else {
      playAfterSeek.current = autoplay;
      pendingSeek.current = seconds;
    }
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
      <AudioSeekBar
        current={shown}
        duration={duration}
        onSeek={seek}
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

const styles = StyleSheet.create({
  transport: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  time: { color: colors.text, fontSize: 13, fontVariant: ['tabular-nums'] },
});
