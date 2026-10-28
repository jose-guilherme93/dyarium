/**
 * Fonte de audio unica: o app toca um audio por vez. Antes de dar play, o player
 * que estiver tocando e pausado. Evita a nota e a transcricao tocarem juntas.
 */

import type { AudioPlayer } from 'expo-audio';

let active: AudioPlayer | null = null;

/** Pausa o player anterior (se houver) e marca este como o unico ativo. */
export function requestAudioFocus(player: AudioPlayer): void {
  if (active && active !== player) {
    try {
      active.pause();
    } catch {
      // player ja liberado: ignora
    }
  }
  active = player;
}

export function releaseAudioFocus(player: AudioPlayer): void {
  if (active === player) active = null;
}
