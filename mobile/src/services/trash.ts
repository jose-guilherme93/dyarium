/**
 * Limpeza da lixeira local.
 *
 * A nota apagada continua no banco (e com o audio no aparelho) durante a janela
 * de 7 dias, para poder ser restaurada sem depender do servidor. Passado o
 * prazo, o audio e a linha somem de vez. Roda no boot do app e ao abrir a
 * lixeira, em vez de um job em segundo plano: e barato e nao acorda o aparelho.
 */

import { isTrashExpired } from '@/core/trash';

import { deleteRecordingRow, listTrashedRecordings } from './db';
import { deleteSessionFiles } from './files';

export async function purgeExpiredTrash(now = Date.now()): Promise<number> {
  const trashed = await listTrashedRecordings();
  let purged = 0;
  for (const recording of trashed) {
    if (!recording.deletedAt || !isTrashExpired(recording.deletedAt, now)) continue;
    deleteSessionFiles(recording.id);
    await deleteRecordingRow(recording.id);
    purged += 1;
  }
  return purged;
}
