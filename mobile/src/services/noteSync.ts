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

/**
 * Envia titulo/data (entrada) e o documento da nota. Devolve o id da nota
 * (existente ou recem-criada) para o chamador persistir localmente.
 */
export async function syncNote(note: Recording): Promise<string | undefined> {
  if (!note.entryId) return undefined;
  const config = await loadServerConfig();
  if (!config) return undefined;
  const api = new DyariumApi(config, doFetch);

  await api.updateEntry(note.entryId, {
    title: note.title,
    recorded_at: note.recordedAt,
  });

  const document = markdownToBlocks(
    await resolveLocalAttachments(note.entryId, note.id, note.text ?? ''),
  );

  if (note.noteId) {
    await api.updateNote(note.noteId, note.title, document);
    return note.noteId;
  }

  const existing = await api.listNotes(note.entryId);
  if (existing.length > 0) {
    await api.updateNote(existing[0].id, note.title, document);
    return existing[0].id;
  }

  const created = await api.createNote(note.entryId, note.title, document);
  return created.id;
}
