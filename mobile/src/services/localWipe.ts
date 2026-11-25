/**
 * Apaga os dados locais de uma conta do Drive: banco, audios, imagens e capas
 * em cache. So roda depois de o retrato ser sincronizado e conferido (ver
 * `driveLeave`); nada aqui decide sobre a conta.
 *
 * Os modelos baixados (whisper, analise) ficam: nao pertencem a conta e baixa-los
 * de novo custaria centenas de megabytes.
 */

import { Directory, File, Paths } from 'expo-file-system';

import { invalidateAttachmentIndex } from './attachments';
import { invalidateSessionSnapshot } from './graphData';
import { wipeLocalDatabase } from './db';

/** Pastas de midia do diario que podem existir nos documentos ou no cache. */
const DOCUMENT_DIRS = ['recordings', 'Audio'];
const CACHE_DIRS = ['attachments', 'Audio', 'dyarium-restore', 'covers'];

function deleteDirectory(dir: Directory): void {
  try {
    if (dir.exists) dir.delete();
  } catch {
    // arquivo em uso ou ja removido: a proxima limpeza tenta de novo
  }
}

/** Arquivos temporarios de sincronizacao (`sync-<id>.<ext>`) no cache. */
function deleteSyncTemps(): void {
  try {
    for (const entry of new Directory(Paths.cache).list()) {
      if (!(entry instanceof File)) continue;
      if (!entry.name.startsWith('sync-')) continue;
      try {
        entry.delete();
      } catch {
        // idem
      }
    }
  } catch {
    // cache ilegivel: nada a limpar
  }
}

/** Limpa a midia local do diario. Nao toca no banco nem na sessao. */
export function wipeLocalFiles(): void {
  for (const name of DOCUMENT_DIRS) deleteDirectory(new Directory(Paths.document, name));
  for (const name of CACHE_DIRS) deleteDirectory(new Directory(Paths.cache, name));
  deleteSyncTemps();
  invalidateAttachmentIndex();
  invalidateSessionSnapshot();
}

/** Banco + arquivos: o cache local inteiro da conta. */
export async function wipeLocalAccountData(): Promise<void> {
  await wipeLocalDatabase();
  wipeLocalFiles();
}
