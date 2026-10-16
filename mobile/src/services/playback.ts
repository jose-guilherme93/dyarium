/**
 * Controle de play com foco unico e replay: depois que o audio chega ao fim, o
 * player nao reinicia sozinho, entao voltamos ao inicio antes de tocar.
 */

import type { AudioPlayer } from 'expo-audio';

import { isPlaybackFinished } from '@/core/playback';

import { requestAudioFocus } from './audioFocus';

/** Toca o player (pausando o anterior). Se acabou, reinicia do zero. */
export function playPlayer(player: AudioPlayer): void {
  requestAudioFocus(player);
  if (isPlaybackFinished(player.currentTime, player.duration)) {
    void player
      .seekTo(0)
      .finally(() => player.play())
      .catch(() => undefined);
    return;
  }
  player.play();
}
