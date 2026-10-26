/**
 * Monta a nota local a partir de uma entrada (e da sua nota) vindas do servidor.
 * Puro: concentra o mapeamento para testar sem rede nem banco.
 *
 * O corpo ja vem em markdown (formato canonico dos dois lados): nao ha conversao
 * nenhuma aqui. `versions` e a versao de cada campo, guardada para o servidor
 * conseguir recusar uma gravacao que sobrescreveria trabalho de outro lugar.
 */

import type { ServerEntry, ServerNote } from './api';
import { DEFAULT_NOTEBOOK_ID } from './notebooks';
import type { Recording, RecordingSource } from './types';

function toSource(entry: ServerEntry): RecordingSource {
  // O servidor guarda `share` para audio importado; sem isso, audio e microfone
  // sao indistinguiveis depois de um pull em outro aparelho.
  if (entry.source === 'share') return 'share';
  return entry.content_type ? 'microphone' : 'text';
}

/**
 * Entrada sem nada (sem titulo, sem audio e sem corpo): nao vale trazer para o
 * app. Evita que entradas vazias (criadas em background) apareçam como notas.
 */
export function isBlankServerEntry(entry: ServerEntry, note?: ServerNote): boolean {
  return (
    entry.title.trim() === '' &&
    entry.content_type === '' &&
    (note?.content_markdown ?? '').trim() === ''
  );
}

/**
 * Notas locais que o servidor confirmou como apagadas (estao na lixeira dele).
 *
 * Duas travas contra perder dado:
 * - A ausencia na lista de entradas NAO basta: se o servidor for reinstalado, ou
 *   o banco voltar de um backup antigo, tudo pareceria apagado e o app limparia o
 *   aparelho inteiro. So apagamos o que o servidor diz que apagou.
 * - A exclusao precisa ser mais nova que a ultima mudanca local. Uma nota
 *   restaurada de um backup (`updatedAt` = agora) sobrevive a uma exclusao
 *   anterior a ela, mesmo que o app esteja offline e ainda nao tenha reafirmado a
 *   nota no servidor.
 */
export function recordingsDeletedOnServer(
  local: Recording[],
  deletedAt: Map<string, string>,
): Recording[] {
  return local.filter((recording) => {
    if (recording.status !== 'completed' || !recording.entryId) return false;
    const deleted = deletedAt.get(recording.entryId);
    if (!deleted) return false;
    const deletedTime = Date.parse(deleted);
    const localTime = Date.parse(recording.updatedAt);
    if (Number.isNaN(deletedTime) || Number.isNaN(localTime)) return false;
    return deletedTime > localTime;
  });
}

/**
 * Linhas locais que apontam para a mesma entrada do servidor. Acontece quando o
 * mesmo audio e importado duas vezes: o servidor deduplica por SHA-256 e devolve
 * a entrada existente, mas o aparelho ficava com duas notas (dois cartoes) para
 * a mesma entrada. So remove linhas **limpas** (sem edicao pendente): com
 * qualquer pendencia, as duas ficam e o sync decide, para nao perder trabalho.
 */
export function duplicateEntryRecordings(local: Recording[]): Recording[] {
  const groups = new Map<string, Recording[]>();
  for (const recording of local) {
    if (!recording.entryId || recording.status !== 'completed') continue;
    const group = groups.get(recording.entryId) ?? [];
    group.push(recording);
    groups.set(recording.entryId, group);
  }
  const remove: Recording[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const clean = group.filter(
      (recording) =>
        !recording.noteDirty &&
        !recording.notebookDirty &&
        !recording.tagsDirty &&
        !recording.archivedDirty &&
        (recording.syncConflict?.length ?? 0) === 0,
    );
    if (clean.length < 2) continue;
    // Prefere a linha com o audio local; entre iguais, a atualizada por ultimo.
    clean.sort((a, b) => {
      const localA = a.filePath ? 1 : 0;
      const localB = b.filePath ? 1 : 0;
      if (localA !== localB) return localB - localA;
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });
    remove.push(...clean.slice(1));
  }
  return remove;
}

/**
 * Entrada do servidor (com a nota) virada em gravacao local. O corpo vem em
 * markdown: o app guarda exatamente o texto que o dashboard mostra.
 *
 * Duracao e tamanho tambem vem do servidor: sem isso, uma nota criada no desktop
 * aparecia no celular com 0:00 e sem peso, porque o audio mora so aqui.
 */
export function entryToRecording(entry: ServerEntry, note?: ServerNote): Recording {
  return {
    id: entry.id,
    title: entry.title,
    recordedAt: entry.recorded_at ?? entry.created_at,
    dir: '',
    segmentCount: 0,
    status: 'completed',
    offset: 0,
    attempts: 0,
    entryId: entry.id,
    noteId: note?.id,
    source: toSource(entry),
    contentType: entry.content_type || undefined,
    // Sem esta referencia, a tela de transcricao de uma nota puxada do servidor
    // nao acha o audio e fica sem player.
    serverAttachmentId: entry.primary_attachment_id ?? entry.audios?.[0]?.id,
    durationMs: entry.duration_seconds > 0 ? Math.round(entry.duration_seconds * 1000) : undefined,
    sizeBytes: entry.size_bytes > 0 ? entry.size_bytes : undefined,
    // O servidor ainda pode estar transcrevendo; `services/transcripts` busca o
    // texto quando ele estiver pronto. Nota escrita (sem audio) nao tem
    // transcricao: marcar como pendente faria o app pedir /transcript para
    // sempre.
    transcriptStatus: entry.content_type.startsWith('audio/') ? 'pending' : undefined,
    text: note?.content_markdown ?? '',
    archived: entry.archived,
    notebookId: entry.notebook_id || DEFAULT_NOTEBOOK_ID,
    tags: entry.tags && entry.tags.length > 0 ? entry.tags : undefined,
    titleVersion: entry.versions?.title,
    recordedAtVersion: entry.versions?.recorded_at,
    bodyVersion: note?.body_version,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
  };
}

function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].map((tag) => tag.toLowerCase()).sort();
  const right = [...b].map((tag) => tag.toLowerCase()).sort();
  return left.every((tag, index) => tag === right[index]);
}

/** O servidor gravou depois da ultima edicao local? */
function serverIsNewer(version: string | undefined, localUpdatedAt: string): boolean {
  if (!version) return false;
  const server = Date.parse(version);
  const local = Date.parse(localUpdatedAt);
  if (Number.isNaN(server) || Number.isNaN(local)) return false;
  return server > local;
}

/**
 * Aplica na nota local o que mudou no servidor (edicao feita no dashboard).
 *
 * Nota limpa: qualquer versao diferente e do servidor e entra. Nota suja (edicao
 * pendente ou conflito): so entra o campo que o servidor gravou **depois** da
 * ultima edicao local — a ultima edicao vence. Se a edicao local for mais nova,
 * ela fica e o sync reenvia (o corpo vai sem versao, entao sempre grava).
 *
 * Quando o corpo muda, `note` e obrigatoria: a listagem traz a versao, nao o texto.
 */
export function mergeServerNote(
  local: Recording,
  entry: ServerEntry,
  note?: ServerNote,
): Recording | null {
  if (local.status !== 'completed' || !local.entryId || entry.id !== local.entryId) return null;

  const dirty = Boolean(local.noteDirty) || (local.syncConflict?.length ?? 0) > 0;
  const serverBodyVersion = note?.body_version ?? entry.versions?.body;
  const bodyMoved = Boolean(serverBodyVersion) && serverBodyVersion !== local.bodyVersion;
  const titleVersion = entry.versions?.title;
  const titleMoved = Boolean(titleVersion) && titleVersion !== local.titleVersion;
  const recordedVersion = entry.versions?.recorded_at;
  const recordedMoved = Boolean(recordedVersion) && recordedVersion !== local.recordedAtVersion;
  const archivedMoved =
    !local.archivedDirty &&
    typeof entry.archived === 'boolean' &&
    entry.archived !== Boolean(local.archived);
  const serverNotebook = entry.notebook_id || DEFAULT_NOTEBOOK_ID;
  const notebookMoved = !local.notebookDirty && serverNotebook !== (local.notebookId || DEFAULT_NOTEBOOK_ID);
  const serverTags = entry.tags ?? [];
  const tagsMoved = !local.tagsDirty && !sameTags(serverTags, local.tags ?? []);
  const primaryAttachment = entry.primary_attachment_id ?? entry.audios?.[0]?.id;
  const attachmentMoved = Boolean(primaryAttachment) && primaryAttachment !== local.serverAttachmentId;

  // Nota marcada como suja, mas com o mesmo texto do servidor (o editor
  // normaliza espacos ao abrir): nao ha edicao para enviar. Adota a versao do
  // servidor e limpa a pendencia, para nao sobrescrever uma edicao do dashboard.
  if (dirty && note && bodyMoved && (note.content_markdown ?? '').trimEnd() === (local.text ?? '').trimEnd()) {
    return {
      ...local,
      text: note.content_markdown ?? '',
      bodyVersion: serverBodyVersion,
      noteDirty: undefined,
      syncConflict: undefined,
    };
  }

  // A ultima edicao vence: com a nota suja, so o que o servidor gravou depois da
  // ultima edicao local entra. Nota limpa aceita qualquer versao nova.
  const applyBody = bodyMoved && (!dirty || serverIsNewer(serverBodyVersion, local.updatedAt));
  const applyTitle = titleMoved && (!dirty || serverIsNewer(titleVersion, local.updatedAt));
  const applyRecorded = recordedMoved && (!dirty || serverIsNewer(recordedVersion, local.updatedAt));

  // Sem o texto nao da para aplicar a versao nova do corpo: espera o proximo
  // pull em vez de gravar uma versao sem o texto correspondente.
  if (applyBody && !note) return null;
  if (
    !applyBody &&
    !applyTitle &&
    !applyRecorded &&
    !archivedMoved &&
    !notebookMoved &&
    !tagsMoved &&
    !attachmentMoved
  ) {
    return null;
  }

  const serverUpdated = entry.updated_at ? Date.parse(entry.updated_at) : NaN;
  const localUpdated = Date.parse(local.updatedAt);
  const serverIsMoreRecent =
    !Number.isNaN(serverUpdated) && (Number.isNaN(localUpdated) || serverUpdated > localUpdated);

  return {
    ...local,
    // A faixa de recentes usa updatedAt: uma edicao feita no dashboard precisa
    // aparecer como atividade recente aqui tambem.
    updatedAt: serverIsMoreRecent ? entry.updated_at : local.updatedAt,
    ...(attachmentMoved ? { serverAttachmentId: primaryAttachment } : {}),
    ...(applyBody
      ? {
          text: note?.content_markdown ?? '',
          noteId: note?.id ?? local.noteId,
          bodyVersion: serverBodyVersion,
        }
      : {}),
    ...(applyTitle ? { title: entry.title, titleVersion } : {}),
    ...(applyRecorded
      ? { recordedAt: entry.recorded_at ?? entry.created_at, recordedAtVersion: recordedVersion }
      : {}),
    ...(archivedMoved ? { archived: entry.archived } : {}),
    ...(notebookMoved ? { notebookId: serverNotebook, notebookDirty: undefined } : {}),
    ...(tagsMoved ? { tags: serverTags.length > 0 ? serverTags : undefined, tagsDirty: undefined } : {}),
    // Se o corpo veio do servidor, a pendencia local (texto e conflito) acabou.
    // Se so titulo/data vieram, o corpo sujo continua e vai no proximo sync.
    ...(applyBody ? { noteDirty: undefined, syncConflict: undefined } : {}),
    ...(!applyBody && (applyTitle || applyRecorded) ? { syncConflict: undefined } : {}),
  };
}
