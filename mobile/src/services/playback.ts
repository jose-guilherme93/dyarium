/**
 * Controle de play com foco unico e replay: depois que o audio chega ao fim, o
 * player nao reinicia sozinho, entao voltamos ao inicio antes de tocar.
 */

import type { AudioPlayer } from 'expo-audio';

import { isPlaybackFinished } from '@/core/playback';

import { requestAudioFocus } from './audioFocus';

/** De quanto em quanto tempo conferimos se a fonte nova ficou pronta. */
const READY_POLL_MS = 25;
/** Teto da espera pela fonte: nunca deixa o toque sem resposta. */
const READY_TIMEOUT_MS = 4000;

/** Toma o foco e toca, sem mexer na posicao atual. */
export function startPlayer(player: AudioPlayer): void {
  requestAudioFocus(player);
  player.play();
}

/** Toca o player (pausando o anterior). Se acabou, reinicia do zero. */
export function playPlayer(player: AudioPlayer): void {
  if (isPlaybackFinished(player.currentTime, player.duration)) {
    void player
      .seekTo(0)
      .finally(() => startPlayer(player))
      .catch(() => undefined);
    return;
  }
  startPlayer(player);
}

/**
 * A fonte esta pronta para receber um seek?
 *
 * Olhar o status atual do player (e nao um evento) evita o problema do evento
 * antigo: depois de `replace`, um `playbackStatusUpdate` da fonte anterior
 * ainda podia chegar e destravar o seek cedo, na fonte errada.
 */
function isReady(player: AudioPlayer): boolean {
  return player.currentStatus?.isLoaded === true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Espera a fonte carregar de verdade.
 *
 * O ADTS grava a duracao/seek map durante a preparacao. Um `seekTo` pedido no
 * meio do buffering e aceito e depois **descartado** quando a fonte termina de
 * abrir (a posicao volta a 0) - era o "reinicia do comeco" da minutagem. Por
 * isso esperamos o status carregado antes de pedir a posicao.
 */
async function waitReady(player: AudioPlayer): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (isReady(player)) return true;
    await sleep(READY_POLL_MS);
  }
  return isReady(player);
}

/**
 * Pula para `seconds` (segundos) e toca ao chegar.
 *
 * A posicao invalida nao vira 0: um toque mal medido nao pode reiniciar o
 * audio. Pedir o inicio (0) nao espera a fonte: o `play` ja comeca quando ela
 * abrir, e o audio responde na hora.
 */
export async function seekPlayer(
  player: AudioPlayer,
  seconds: number,
  options: { autoplay?: boolean } = {},
): Promise<void> {
  if (!Number.isFinite(seconds)) return;
  const target = Math.max(0, seconds);
  if (target > 0) await waitReady(player);
  await player.seekTo(target);
  if (options.autoplay) startPlayer(player);
}
