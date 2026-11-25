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
/** Depois deste tempo, confere se o seek sobreviveu a preparacao da fonte. */
const SEEK_CONFIRM_MS = 350;
/** Diferenca tolerada entre a posicao pedida e a posicao real (segundos). */
const SEEK_TOLERANCE_S = 1;

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
 * `currentStatus` e um retrato atualizado a cada 250 ms: depois de `replace`,
 * ele ainda pode dizer `isLoaded` da fonte **anterior**, e o seek caia no meio
 * do buffering (e era descartado quando o ADTS terminava de abrir). Por isso,
 * quando a fonte acabou de mudar, lemos o estado vivo do player (`isLoaded`),
 * que e consultado na thread principal depois do proprio `replace`.
 *
 * Fora da troca de fonte, o status em cache serve; a propriedade `isLoaded`
 * fica falsa quando o audio **terminou**, e um seek a partir do fim e valido.
 */
function isReady(player: AudioPlayer, freshSource: boolean): boolean {
  if (freshSource) return player.isLoaded === true;
  return player.currentStatus?.isLoaded === true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitReady(player: AudioPlayer, freshSource: boolean): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (isReady(player, freshSource)) return true;
    await sleep(READY_POLL_MS);
  }
  return isReady(player, freshSource);
}

/** Confere, com a fonte ja preparada, se a posicao pedida ficou de pe. */
function reached(player: AudioPlayer, target: number): boolean {
  const current = player.currentTime;
  return Number.isFinite(current) && Math.abs(current - target) <= SEEK_TOLERANCE_S;
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
  options: { autoplay?: boolean; freshSource?: boolean } = {},
): Promise<void> {
  if (!Number.isFinite(seconds)) return;
  const target = Math.max(0, seconds);
  const freshSource = options.freshSource === true;
  const started = Date.now();
  if (target > 0) await waitReady(player, freshSource);
  const readyAt = Date.now();
  await player.seekTo(target);
  const afterFirst = player.currentTime;
  // Toca na hora: se a fonte ainda estava preparando e jogou a posicao de
  // volta, a conferencia abaixo corrige em ~350 ms sem deixar o toque mudo.
  if (options.autoplay) startPlayer(player);
  if (target > 0 && freshSource) {
    // O ADTS monta a tabela de posicoes durante a preparacao. Se o seek foi
    // pedido cedo demais, a posicao volta para 0 quando a fonte abre; confere
    // depois desse instante e pede de novo. Uma segunda tentativa, agora com a
    // fonte pronta, e o que faltava para a minutagem fixar.
    await sleep(SEEK_CONFIRM_MS);
    if (!reached(player, target)) {
      await waitReady(player, true);
      await player.seekTo(target);
    }
  }
  if (__DEV__ && !process.env.JEST_WORKER_ID) {
    console.log(
      `[audio] seek ${target.toFixed(1)}s fresh=${freshSource} pronto=${readyAt - started}ms ` +
        `depois=${afterFirst.toFixed(1)}s final=${player.currentTime.toFixed(1)}s`,
    );
  }
}
