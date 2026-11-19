/**
 * Estrutura do livro vinda do manifesto de sync.
 *
 * O manifesto ja traz `chapter_*`; nao e preciso baixar o detalhe da entrada so
 * para descobrir que a nota virou capitulo. Isso resgata livros sincronizados
 * pela versao antiga, cuja versao nao mudou (o conteudo continua igual) mas o
 * planejamento nunca chegou ao SQLite.
 */

import type { SyncManifestEntry } from '@/core/api';
import {
  chapterFieldsDiffer,
  chapterFieldsOf,
  type ServerChapterFields,
} from '@/core/pull';
import type { Recording } from '@/core/types';

export interface ChapterUpdate {
  recordingId: string;
  fields: ServerChapterFields;
}

/**
 * Compara o planejamento do manifesto com o que esta no aparelho. Devolve so o
 * que difere; nada e baixado nem escrito quando ja esta igual.
 */
export function planChapterUpdates(
  remote: SyncManifestEntry[],
  local: Recording[],
  remoteIdOf: (recording: Recording) => string,
): ChapterUpdate[] {
  const byRemoteId = new Map<string, Recording>();
  for (const recording of local) {
    if (recording.deletedAt || recording.status !== 'completed') continue;
    const remoteId = remoteIdOf(recording);
    if (remoteId) byRemoteId.set(remoteId, recording);
    if (recording.entryId) byRemoteId.set(recording.entryId, recording);
    byRemoteId.set(recording.id, recording);
  }

  const updates: ChapterUpdate[] = [];
  const seen = new Set<string>();
  for (const entry of remote) {
    if (!entry.id) continue;
    const recording = byRemoteId.get(entry.id);
    if (!recording || seen.has(recording.id)) continue;
    const fields = chapterFieldsOf(entry);
    if (!chapterFieldsDiffer(recording, fields)) continue;
    seen.add(recording.id);
    updates.push({ recordingId: recording.id, fields });
  }
  return updates;
}
