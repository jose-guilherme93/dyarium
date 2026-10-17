/**
 * Monta a nota local a partir de uma entrada (e da sua nota) vindas do servidor.
 * Puro: concentra o mapeamento para testar sem rede nem banco.
 *
 * O corpo ja vem em markdown (formato canonico dos dois lados): nao ha conversao
 * nenhuma aqui. `versions` e a versao de cada campo, guardada para o servidor
 * conseguir recusar uma gravacao que sobrescreveria trabalho de outro lugar.
 */

import type { ServerEntry, ServerNote } from './api';
import type { Recording, RecordingSource } from './types';

function toSource(contentType: string): RecordingSource {
  return contentType ? 'microphone' : 'text';
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
    source: toSource(entry.content_type),
    contentType: entry.content_type || undefined,
    durationMs: entry.duration_seconds > 0 ? Math.round(entry.duration_seconds * 1000) : undefined,
    sizeBytes: entry.size_bytes > 0 ? entry.size_bytes : undefined,
    // O servidor ainda pode estar transcrevendo; `services/transcripts` busca o
    // texto quando ele estiver pronto.
    transcriptStatus: entry.content_type ? 'pending' : undefined,
    text: note?.content_markdown ?? '',
    archived: entry.archived,
    titleVersion: entry.versions?.title,
    recordedAtVersion: entry.versions?.recorded_at,
    bodyVersion: note?.body_version,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
  };
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
  const archivedMoved = typeof entry.archived === 'boolean' && entry.archived !== Boolean(local.archived);

  // A ultima edicao vence: com a nota suja, so o que o servidor gravou depois da
  // ultima edicao local entra. Nota limpa aceita qualquer versao nova.
  const applyBody = bodyMoved && (!dirty || serverIsNewer(serverBodyVersion, local.updatedAt));
  const applyTitle = titleMoved && (!dirty || serverIsNewer(titleVersion, local.updatedAt));
  const applyRecorded = recordedMoved && (!dirty || serverIsNewer(recordedVersion, local.updatedAt));

  // Sem o texto nao da para aplicar a versao nova do corpo: espera o proximo
  // pull em vez de gravar uma versao sem o texto correspondente.
  if (applyBody && !note) return null;
  if (!applyBody && !applyTitle && !applyRecorded && !archivedMoved) return null;

  return {
    ...local,
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
    // Se o corpo veio do servidor, a pendencia local (texto e conflito) acabou.
    // Se so titulo/data vieram, o corpo sujo continua e vai no proximo sync.
    ...(applyBody ? { noteDirty: undefined, syncConflict: undefined } : {}),
    ...(!applyBody && (applyTitle || applyRecorded) ? { syncConflict: undefined } : {}),
  };
}
