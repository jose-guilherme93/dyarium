/**
 * Sincroniza o titulo, a data e o corpo da nota com o servidor.
 *
 * O corpo vive na nota (recurso filho da entrada), no campo `document` — o
 * mesmo JSON de blocos do BlockNote que o dashboard usa. Aqui o markdown do
 * editor e convertido para blocos na hora de enviar. Best-effort: uma falha
 * nao muda o estado local.
 */

import { DyariumApi, type FetchLike } from '@/core/api';
import { markdownToBlocks } from '@/core/blocks';
import type { Recording } from '@/core/types';

import { resolveLocalAttachments } from './attachments';
import { loadServerConfig } from './secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

export interface SyncNoteResult {
  /** Id da nota (corpo rico) no servidor. */
  noteId: string;
  /** Mapa nome local da imagem -> id do anexo (inclui o que ja subiu antes). */
  attachments: Record<string, string>;
}

/**
 * Envia titulo/data (entrada) e o documento da nota. Devolve o id da nota e o
 * mapa de anexos, para o chamador persistir localmente. `undefined` quando a
 * nota ainda nao tem entrada ou nao ha servidor configurado.
 */
export async function syncNote(note: Recording): Promise<SyncNoteResult | undefined> {
  if (!note.entryId) return undefined;
  const config = await loadServerConfig();
  if (!config) return undefined;
  const api = new DyariumApi(config, doFetch);

  await api.updateEntry(note.entryId, {
    title: note.title,
    recorded_at: note.recordedAt,
  });

  const resolved = await resolveLocalAttachments(
    note.entryId,
    note.id,
    note.text ?? '',
    note.attachments ?? {},
  );
  const document = markdownToBlocks(resolved.markdown);

  if (note.noteId) {
    await api.updateNote(note.noteId, note.title, document);
    return { noteId: note.noteId, attachments: resolved.attachments };
  }

  const existing = await api.listNotes(note.entryId);
  if (existing.length > 0) {
    await api.updateNote(existing[0].id, note.title, document);
    return { noteId: existing[0].id, attachments: resolved.attachments };
  }

  const created = await api.createNote(note.entryId, note.title, document);
  return { noteId: created.id, attachments: resolved.attachments };
}
