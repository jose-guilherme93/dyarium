/**
 * Reafirma no servidor as notas que acabaram de ser restauradas de um backup.
 *
 * Por que existe: apagar uma nota no app apaga a entrada no servidor (exclusao
 * logica). Se o usuario restaura um backup para trazer a nota de volta, o
 * servidor continua achando que ela esta apagada — e o proximo pull a removeria
 * de novo, perdendo-a para sempre. Antes de qualquer sincronizacao, cada nota
 * restaurada e reafirmada aqui:
 *
 * - O servidor ainda tem a entrada na lixeira: desfaz a exclusao (barato, e a
 *   nota volta inteira, com audio e imagens).
 * - O servidor nao conhece mais a entrada (foi limpa de vez, ou o servidor e
 *   novo): recria a entrada com o mesmo id e marca o corpo da nota para subir.
 *
 * Best-effort: sem servidor configurado nao faz nada, e uma falha de rede nao
 * apaga nada localmente (so fica para a proxima vez).
 */

import { ApiError, DyariumApi, type FetchLike } from '@/core/api';
import type { Recording } from '@/core/types';

import { upsertRecording } from './db';
import { loadServerConfig } from './secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

export interface ReassertResult {
  /** Notas que o servidor tinha na lixeira e voltaram a viver. */
  restored: number;
  /** Notas que o servidor nao tinha mais e foram recriadas (texto/titulo). */
  recreated: number;
  /** Notas com entrada em dia (nada a fazer). */
  unchanged: number;
  /** Falhas (sem rede, por exemplo): a nota local continua intacta. */
  failed: number;
}

/** Estado do servidor para uma nota que acabou de ser restaurada. */
export type RemoteEntryState = 'restored' | 'recreated' | 'unchanged' | 'failed';

/**
 * Reafirma uma entrada no servidor e devolve o que aconteceu. `restoreEntry`
 * primeiro (barato e preserva midia); se o servidor nao conhecer mais a entrada,
 * recria com o mesmo id — o id vem do backup, entao a nota nao duplica.
 */
export async function reassertEntry(
  api: DyariumApi,
  recording: Recording,
): Promise<RemoteEntryState> {
  const entryId = recording.entryId;
  if (!entryId) return 'unchanged';
  try {
    await api.restoreEntry(entryId);
    return 'restored';
  } catch (error) {
    // 404: a entrada nao existe mais (limpa ou servidor novo). Qualquer outra
    // falha (rede) e apenas adiada.
    if (!isNotFound(error)) return 'failed';
  }
  try {
    await api.createTextEntry({
      id: entryId,
      client_key: entryId,
      title: recording.title,
      recorded_at: recording.recordedAt,
      created_at: recording.createdAt,
      text: recording.text ?? '',
      notebook_id: recording.notebookId,
    });
    return 'recreated';
  } catch {
    return 'failed';
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/**
 * Reafirma todas as notas restauradas. Todas entram na fila de sincronizacao: o
 * backup e a versao mais nova do conteudo, entao titulo, data e corpo vao de novo
 * para o servidor (e as imagens voltam a subir junto). Devolve o resumo para a
 * tela de backup.
 */
export async function reassertNotesOnServer(recordings: Recording[]): Promise<ReassertResult> {
  const result: ReassertResult = { restored: 0, recreated: 0, unchanged: 0, failed: 0 };
  const config = await loadServerConfig();
  if (!config) return result;
  const api = new DyariumApi(config, doFetch);

  for (const recording of recordings) {
    const state = await reassertEntry(api, recording);
    result[state] += 1;
    if (state === 'restored' || state === 'recreated') {
      await upsertRecording({ ...recording, noteDirty: true }).catch(() => undefined);
    }
  }
  return result;
}
