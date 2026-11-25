/**
 * O que esta rodando numa nota, venha de onde vier.
 *
 * A porcentagem so existe quando o motor roda no aparelho (ou online, por
 * janela). Trabalho no servidor nao tem numero: entra como estado de espera,
 * com o mesmo cuidado de quem roda aqui.
 */

import type { ActivityKind } from '@/services/activity';
import { activityDestination } from '@/services/activity';
import { useActivities } from '@/state/useActivities';

export interface NoteWork {
  kind: Extract<ActivityKind, 'transcription' | 'analysis'>;
  /** 0..100 quando o motor reporta; ausente no servidor. */
  percent?: number;
  /** Texto curto do estado ("No servidor", "Transcrevendo trecho 2 de 9"). */
  detail?: string;
  /** O trabalho esta fora do aparelho. */
  remote: boolean;
  /** Ainda sem porcentagem (fila do servidor ou espera). */
  waiting: boolean;
}

export function workForNote(
  activities: ReturnType<typeof useActivities>,
  noteId: string | undefined,
): NoteWork | null {
  if (!noteId) return null;
  let best: NoteWork | null = null;
  for (const activity of activities) {
    if (activity.status !== 'running') continue;
    if (activity.kind !== 'transcription' && activity.kind !== 'analysis') continue;
    const destination = activityDestination(activity);
    if (!destination || destination.noteId !== noteId) continue;
    const next: NoteWork = {
      kind: activity.kind,
      percent: activity.progress,
      detail: activity.detail,
      remote: activity.detail === 'No servidor',
      waiting: activity.progress === undefined,
    };
    // Se duas atividades da mesma nota coexistem, mostra a que tem numero.
    if (!best || (next.percent ?? -1) > (best.percent ?? -1)) best = next;
  }
  return best;
}

/** Atalho com inscricao no centro de atividade. */
export function useNoteWork(noteId: string | undefined): NoteWork | null {
  const activities = useActivities();
  return workForNote(activities, noteId);
}
