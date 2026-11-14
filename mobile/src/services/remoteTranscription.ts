/**
 * Acompanhamento de transcricao feita fora do aparelho.
 *
 * O servidor nao informa a porcentagem de um job; o que o app sabe e que a
 * nota esta na fila dele. O centro de atividade e o card da nota mostram esse
 * estado como "No servidor", sem inventar um numero. Quando o texto chega pelo
 * sync, a atividade fecha.
 */

import { displayTitle } from '@/core/title';
import type { Recording } from '@/core/types';

import {
  cancelActivity,
  failActivity,
  finishActivity,
  isActivityRunning,
  startActivity,
} from './activity';

export function transcriptionActivityId(recordingId: string): string {
  return `transcription:${recordingId}`;
}

/** Marca a nota como "no servidor" (idempotente: nao reinicia o cronometro). */
export function trackServerTranscription(recording: Recording): void {
  if (!recording.entryId) return;
  const id = transcriptionActivityId(recording.id);
  if (isActivityRunning(id)) return;
  startActivity({
    id,
    kind: 'transcription',
    title: displayTitle(recording),
    detail: 'No servidor',
    // Nao cancela o job do servidor; so para de acompanhar no aparelho.
    stop: {
      label: 'Parar de acompanhar',
      run: () => cancelActivity(id, 'Segue no servidor'),
    },
  });
}

/** O texto chegou: fecha a atividade com o mesmo id da transcricao. */
export function finishServerTranscription(recordingId: string): void {
  const id = transcriptionActivityId(recordingId);
  if (isActivityRunning(id)) finishActivity(id, 'Transcrição pronta');
}

/** O servidor recusou o pedido: a atividade termina como erro. */
export function failServerTranscription(recordingId: string, detail: string): void {
  const id = transcriptionActivityId(recordingId);
  if (isActivityRunning(id)) {
    // A tela da nota oferece tentar de novo; a atividade nao carrega a acao.
    failActivity(id, detail);
  }
}
