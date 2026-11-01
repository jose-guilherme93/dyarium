/**
 * Motor de reconciliacao por ambiente.
 *
 * Cada servidor da lista e um par: o que so existe la desce, o que so existe
 * aqui sobe, o que foi apagado vira tombstone. Nunca apaga por ausencia. O
 * conteudo de notas que existem nos dois lados fica com o caminho normal do app
 * (fila e pull do ambiente primario); aqui o foco e a uniao e a exclusao.
 *
 * Um ambiente por vez, um upload por vez. Falha de um nao impede os outros.
 */

import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

import { DyariumApi, type FetchLike, type ServerNotebook, type SyncManifestEntry } from '@/core/api';
import { DEFAULT_NOTEBOOK_ID } from '@/core/notebooks';
import { syncNoteWith, applySyncResult } from '@/core/noteSync';
import { entryToRecording, isBlankServerEntry, mergeServerNote } from '@/core/pull';
import { stableAttachmentId } from '@/core/id';
import { planReconcile, type LocalNote } from '@/core/sync';
import type { Recording } from '@/core/types';
import { uploadRecording } from '@/core/uploader';

import {
  getCachedAnalysis,
  getRecording,
  listRecordings,
  upsertRecording,
  acquireLock,
  releaseLock,
} from '@/services/db';
import { observeVersion } from '@/services/clock';
import { syncEntitiesFor } from '@/services/entitySync';
import { uploadFileIO } from '@/services/files';
import { publishMetricsTo } from '@/services/metricsSync';
import { listNotebooks, deleteLocalNotebook, upsertNotebookFromServer } from '@/services/notebooks';
import { clientOwnsAnalysis } from '@/services/processing';
import { loadServers, saveServers, type StoredServer } from '@/services/secure';
import { clientOwnsTranscription } from '@/services/whisper';
import { pushTranscriptToServer } from '@/services/transcriptSync';
import { syncServerTranscriptsFor } from '@/services/transcripts';
import { pushAnalysisToServer, syncServerAnalysesFor } from '@/services/analysis';

import { ensureBodyAttachments, uploadAudioFromPeer } from './media';

import {
  getEntrySync,
  listEntrySync,
  listNotebookSync,
  listTombstones,
  putTombstone,
  removeTombstone,
  touchServerSync,
  upsertEntrySync,
  upsertNotebookSync,
  upsertServer,
  type EntrySyncRow,
} from './state';

const doFetch = globalThis.fetch as unknown as FetchLike;

const ENGINE_LOCK = 'sync-engine';
// Uma copia inicial de um acervo grande pode durar minutos. O lock protege
// contra uma segunda passada no mesmo aparelho; se o processo morrer, ele
// expira e a proxima abertura retoma pelos offsets ja gravados.
const ENGINE_TTL_MS = 5 * 60 * 1000;

export interface SyncSummary {
  serverId: string;
  pulled: number;
  pushed: number;
  deleted: number;
  restored: number;
  failed: number;
  error?: string;
}

let running = false;

/** Reconcilia todos os ambientes configurados, um por vez. */
export async function reconcileAllServers(): Promise<SyncSummary[]> {
  if (running) return [];
  running = true;
  const lock = await acquireLock(ENGINE_LOCK, ENGINE_TTL_MS).catch(() => null);
  if (!lock) {
    running = false;
    return [];
  }
  try {
    const servers = await loadServers();
    const summaries: SyncSummary[] = [];
    for (const server of servers) {
      summaries.push(await reconcileServer(server).catch((error: unknown) => ({
        serverId: server.id || server.baseUrl,
        pulled: 0,
        pushed: 0,
        deleted: 0,
        restored: 0,
        failed: 0,
        error: error instanceof Error ? error.message : 'falha ao sincronizar',
      })));
    }
    return summaries;
  } finally {
    await releaseLock(ENGINE_LOCK, lock).catch(() => undefined);
    running = false;
  }
}

/** Reconcilia um ambiente. Devolve o que mudou, para a tela mostrar progresso. */
export async function reconcileServer(server: StoredServer): Promise<SyncSummary> {
  const api = new DyariumApi({ baseUrl: server.baseUrl, token: server.token }, doFetch);
  const version = await api.version();
  if (!version.instance_id) {
    throw new Error('servidor sem identidade (instance_id); atualize o servidor');
  }
  if (version.sync_contract && version.sync_contract !== '1') {
    throw new Error(`contrato de sincronizacao ${version.sync_contract} nao suportado`);
  }
  const serverId = version.instance_id;
  const contract = version.sync_contract ?? '1';
  const createdAt = new Date().toISOString();

  await upsertServer({
    id: serverId,
    baseUrl: server.baseUrl,
    label: server.label ?? '',
    contract,
    createdAt,
  });
  // Preenche o id real no SecureStore sem reordenar a lista (o primeiro e o
  // primario usado pelo sync legado).
  if (server.id !== serverId || server.contract !== contract) {
    const list = await loadServers();
    const next = list.map((item) =>
      item.baseUrl === server.baseUrl ? { ...item, id: serverId, contract } : item,
    );
    await saveServers(next);
  }

  const remote = await fetchManifest(api, 'entries');
  const deleted = await fetchManifest(api, 'deleted');
  await syncNotebooks(api, serverId);
  const local = await listRecordings(true);
  const allServers = await loadServers();
  const propagate = allServers.length > 1;
  const singleServer = allServers.length === 1;
  const isPrimary = allServers.length > 0 && allServers[0].baseUrl === server.baseUrl;
  // Mapa e painel sao por ambiente: cada servidor tem o proprio catalogo e as
  // proprias metricas. O app e o elo, nao um espelho de um so. O primario ja
  // sincroniza o mapa no pull periodico; aqui ficam os demais.
  if (!isPrimary) await syncEntitiesFor(api, serverId).catch(() => undefined);
  await publishMetricsTo(api).catch(() => undefined);
  const rows = await listEntrySync(serverId);
  await backfillSyncRows(serverId, remote, local, rows);
  const syncByRecording = new Map<string, EntrySyncRow>(
    rows.map((row) => [row.recordingId, row]),
  );

  const localNotes: LocalNote[] = local.map((recording) => {
    const sync = syncByRecording.get(recording.id);
    const localFlags = Boolean(
      recording.noteDirty ||
        recording.notebookDirty ||
        recording.tagsDirty ||
        recording.archivedDirty ||
        recording.authorDirty,
    );
    // Sem linha de sync, a nota e nova naquele ambiente: o plano a coloca em
    // `push` pelo proprio id. Com linha, qualquer mudanca depois do ultimo
    // acordo (edicao local ou versao puxada de outro ambiente) volta a subir.
    const movedSinceSync =
      sync && Date.parse(recording.updatedAt) > Date.parse(sync.syncedAt ?? '');
    return {
      id: recording.id,
      entryId: recording.entryId ?? sync?.remoteEntryId,
      deletedAt: recording.deletedAt,
      updatedAt: recording.updatedAt,
      updatedHlc: recording.updatedHlc,
      status: recording.status,
      dirty: Boolean(sync && (localFlags || movedSinceSync)),
    };
  });
  const plan = planReconcile({
    remoteLive: remote,
    remoteDeleted: deleted,
    local: localNotes,
    syncByRecording: new Map(
      rows.map((row) => [
        row.recordingId,
        {
          remoteEntryId: row.remoteEntryId,
          bodyHash: row.syncedBodyHash,
          versions: {
            title: row.titleVersion,
            recorded_at: row.recordedAtVersion,
            body: row.bodyVersion,
          },
          deletedAt: row.deletedAt,
        },
      ]),
    ),
  });

  const summary: SyncSummary = {
    serverId,
    pulled: 0,
    pushed: 0,
    deleted: 0,
    restored: 0,
    failed: 0,
  };
  const byRemoteId = new Map(remote.map((entry) => [entry.id, entry]));
  const byLocalId = new Map(local.map((recording) => [recording.id, recording]));

  for (const remoteId of plan.pull) {
    const entry = byRemoteId.get(remoteId);
    if (!entry) continue;
    try {
      const changed = await pullEntry(api, entry, serverId, propagate);
      if (changed) summary.pulled += 1;
    } catch {
      summary.failed += 1;
    }
  }

  for (const recordingId of plan.push) {
    const recording = byLocalId.get(recordingId);
    if (!recording) continue;
    try {
      const sync = syncByRecording.get(recordingId);
      // Se o ambiente nao tem mais a entrada (servidor reinstalado, banco
      // restaurado de um backup antigo), o estado antigo nao pode impedir a
      // recriacao: cria com o mesmo id em vez de so tentar atualizar.
      const remoteId = sync?.remoteEntryId ?? recording.entryId ?? recording.id;
      const stillThere = byRemoteId.has(remoteId);
      await pushRecording(
        api,
        recording,
        stillThere ? sync : undefined,
        serverId,
        singleServer,
        stillThere ? (byRemoteId.get(remoteId)?.attachment_ids ?? []) : [],
      );
      summary.pushed += 1;
    } catch (error) {
      summary.failed += 1;
      await recordSyncError(serverId, recordingId, error);
    }
  }

  // Transcricoes que mudaram naquele ambiente. O mapa e por id remoto; a
  // leitura e fresca porque o push/pull acima pode ter acabado de criar notas.
  {
    const freshRows = await listEntrySync(serverId);
    const freshRecordings = await listRecordings(true);
    const byRecordingId = new Map(freshRecordings.map((item) => [item.id, item]));
    const byRemoteEntry = new Map<string, Recording>();
    for (const row of freshRows) {
      if (!row.remoteEntryId) continue;
      const item = byRecordingId.get(row.recordingId);
      if (item) byRemoteEntry.set(row.remoteEntryId, item);
    }
    await syncServerTranscriptsFor(api, serverId, remote, byRemoteEntry, isPrimary).catch(() => undefined);
    await syncServerAnalysesFor(api, serverId, remote, byRemoteEntry, isPrimary).catch(() => undefined);
  }

  for (const item of plan.tombstone) {
    const recording = byLocalId.get(item.recordingId);
    if (!recording || !item.deletedAt) continue;
    const sync = syncByRecording.get(item.recordingId);
    const remoteId = sync?.remoteEntryId ?? recording.entryId ?? item.recordingId;
    await upsertRecording({ ...recording, deletedAt: item.deletedAt });
    await putTombstone({
      id: remoteId,
      kind: 'entry',
      deletedAt: item.deletedAt,
      origin: serverId,
    });
    summary.deleted += 1;
  }

  for (const item of plan.pushDelete) {
    try {
      await api.deleteEntry(item.remoteEntryId);
    } catch (error) {
      // 404: a exclusao ja chegou por outro caminho; o estado desejado vale.
      if (statusOf(error) !== 404) {
        summary.failed += 1;
        continue;
      }
    }
    const sync = syncByRecording.get(item.recordingId);
    await upsertEntrySync({
      serverId,
      recordingId: item.recordingId,
      remoteEntryId: item.remoteEntryId,
      noteId: sync?.noteId,
      uploadOffset: sync?.uploadOffset ?? 0,
      syncedAt: new Date().toISOString(),
      deletedAt: item.deletedAt,
      tombstonePushedAt: new Date().toISOString(),
    });
    summary.deleted += 1;
  }

  // Exclusoes que ja perderam a linha local (a lixeira purgou o conteudo): o
  // tombstone permanente ainda precisa chegar a cada ambiente.
  const orphanTombstones = await listTombstones('entry');
  const pushedTombstones = new Set(
    rows.filter((row) => row.tombstonePushedAt).map((row) => row.remoteEntryId),
  );
  const liveEntryIds = new Set(local.map((recording) => recording.entryId).filter(Boolean));
  for (const tombstone of orphanTombstones) {
    if (pushedTombstones.has(tombstone.id)) continue;
    if (liveEntryIds.has(tombstone.id)) continue;
    try {
      await api.deleteEntry(tombstone.id);
    } catch (error) {
      if (statusOf(error) !== 404) {
        summary.failed += 1;
        continue;
      }
    }
    await upsertEntrySync({
      serverId,
      recordingId: tombstone.id,
      remoteEntryId: tombstone.id,
      uploadOffset: 0,
      deletedAt: tombstone.deletedAt,
      tombstonePushedAt: new Date().toISOString(),
    });
    summary.deleted += 1;
  }

  for (const item of plan.restore) {
    try {
      await api.restoreEntry(item.remoteEntryId);
    } catch (error) {
      if (statusOf(error) === 404) {
        // A entrada nao existe mais naquele ambiente: recria com o mesmo id.
        const recording = byLocalId.get(item.recordingId);
        if (recording) {
          if (recording.filePath && recording.source !== 'text') {
            const sync = syncByRecording.get(recording.id);
            await pushRecording(api, recording, sync, serverId, singleServer, []);
          } else {
            await api.createTextEntry({
              id: item.remoteEntryId,
              title: recording.title,
              recorded_at: recording.recordedAt,
              created_at: recording.createdAt,
              notebook_id: recording.notebookId,
            });
          }
        }
      } else {
        summary.failed += 1;
        continue;
      }
    }
    const recording = byLocalId.get(item.recordingId);
    if (recording?.deletedAt) {
      await upsertRecording({ ...recording, deletedAt: undefined });
    }
    await removeTombstone(item.remoteEntryId, 'entry');
    summary.restored += 1;
  }

  await touchServerSync(serverId, new Date().toISOString());
  return summary;
}

/**
 * Preenche o estado por ambiente para notas que ja existem nos dois lados.
 *
 * Isso acontece uma vez, na primeira conexao com um servidor que ja tem o
 * acervo (o caso de atualizar o app com notas ja sincronizadas). O manifesto ja
 * traz versoes e hash do corpo, entao nao e preciso baixar 250 notas so para
 * descobrir que elas sao iguais. Nota que nao esta no manifesto fica sem linha
 * e entra em `push` pela uniao.
 */
async function backfillSyncRows(
  serverId: string,
  remote: SyncManifestEntry[],
  local: Recording[],
  rows: EntrySyncRow[],
): Promise<void> {
  const known = new Set(rows.map((row) => row.recordingId));
  const byId = new Map(remote.map((entry) => [entry.id, entry]));
  for (const recording of local) {
    if (!recording.entryId || recording.status !== 'completed' || known.has(recording.id)) {
      continue;
    }
    const entry = byId.get(recording.entryId);
    if (!entry) continue;
    const row: EntrySyncRow = {
      serverId,
      recordingId: recording.id,
      remoteEntryId: entry.id,
      noteId: recording.noteId,
      uploadOffset: 0,
      // A versao que o app ja conhecia, nao a do manifesto: se o ambiente
      // mudou desde o ultimo sync, a comparacao precisa enxergar a diferenca.
      titleVersion: recording.titleVersion ?? '',
      recordedAtVersion: recording.recordedAtVersion ?? '',
      bodyVersion: recording.bodyVersion ?? '',
      attachmentRefs: JSON.stringify(recording.attachments ?? {}),
      primaryAttachmentId: recording.serverAttachmentId ?? entry.primary_attachment_id,
      syncedTitle: entry.title ?? recording.title,
      syncedRecordedAt: entry.recorded_at ?? recording.recordedAt,
      syncedBodyHash: entry.body_hash ?? '',
      syncedNotebookId: entry.notebook_id ?? recording.notebookId ?? DEFAULT_NOTEBOOK_ID,
      syncedTags: JSON.stringify(entry.tags ?? recording.tags ?? []),
      syncedArchived: entry.archived ? 1 : 0,
      syncedAuthor: entry.author ?? recording.author ?? '',
      syncedAt: entry.updated_at,
    };
    rows.push(row);
    await upsertEntrySync(row);
  }
}

async function fetchManifest(
  api: DyariumApi,
  kind: 'entries' | 'deleted',
): Promise<SyncManifestEntry[]> {
  const out: SyncManifestEntry[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const result = await api.syncManifest(kind, 500, cursor);
    out.push(...result.items);
    if (!result.next_cursor) return out;
    cursor = result.next_cursor;
  }
  // Lista truncada nao pode virar ausencia: sem a pagina final, a uniao e a
  // exclusao ficam incompletas. Melhor falhar o ambiente e tentar de novo do
  // que criar duplicatas ou apagar nota por omissao.
  throw new Error('manifesto de sync truncado; tente novamente');
}

/**
 * Cadernos primeiro: uma nota que aponta para um caderno que ainda nao existe
 * naquele ambiente seria recusada com 422. O id e do criador, entao o mesmo
 * caderno vale em todos.
 */
async function syncNotebooks(api: DyariumApi, serverId: string): Promise<void> {
  const response = await api.syncManifest('notebooks', 500);
  const remote = (response.items as unknown as ServerNotebook[]).filter(
    (item) => item && typeof item.id === 'string',
  );
  const remoteById = new Map(remote.map((item) => [item.id, item]));
  const remoteDeleted = (response.deleted ?? []) as unknown as {
    id: string;
    deleted_at: string;
  }[];
  const local = await listNotebooks();
  const localById = new Map(local.map((notebook) => [notebook.id, notebook]));
  const localTombstones = await listTombstones('notebook');
  const tombstoneById = new Map(localTombstones.map((tomb) => [tomb.id, tomb]));
  const syncRows = await listNotebookSync(serverId);
  const pushedTombstones = new Set(
    syncRows.filter((row) => row.tombstonePushedAt).map((row) => row.notebookId),
  );
  const deletedLocally = new Set<string>();
  const now = new Date().toISOString();

  // 1. Caderno vivo no ambiente que nao existe aqui. Se ha um tombstone local
  // mais novo, a exclusao local vence; senao, o caderno desce.
  for (const item of remote) {
    if (localById.has(item.id)) continue;
    const tomb = tombstoneById.get(item.id);
    if (tomb && Date.parse(tomb.deletedAt) > Date.parse(item.updated_at)) {
      try {
        await api.deleteNotebook(item.id);
      } catch (error) {
        if (statusOf(error) !== 404) throw error;
      }
      await upsertNotebookSync({
        serverId,
        notebookId: item.id,
        deletedAt: tomb.deletedAt,
        tombstonePushedAt: now,
      });
      continue;
    }
    await upsertNotebookFromServer({
      id: item.id,
      name: item.name,
      color: item.color,
      isDefault: item.is_default,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      dirty: false,
      synced: true,
    });
    if (tomb) await removeTombstone(item.id, 'notebook');
  }

  // 2. Tombstone do ambiente. Mais novo que o caderno local apaga aqui; mais
  // velho que uma edicao local e restaurado la.
  for (const tomb of remoteDeleted) {
    if (!tomb.id || !tomb.deleted_at) continue;
    const notebook = localById.get(tomb.id);
    if (!notebook) {
      await putTombstone({
        id: tomb.id,
        kind: 'notebook',
        deletedAt: tomb.deleted_at,
        origin: serverId,
      });
      continue;
    }
    if (Date.parse(notebook.updatedAt) > Date.parse(tomb.deleted_at)) {
      await api.createNotebook({ id: notebook.id, name: notebook.name, color: notebook.color });
      await removeTombstone(tomb.id, 'notebook');
      continue;
    }
    await putTombstone({
      id: tomb.id,
      kind: 'notebook',
      deletedAt: tomb.deleted_at,
      origin: serverId,
    });
    await deleteLocalNotebook(tomb.id);
    deletedLocally.add(tomb.id);
  }

  // 3. Exclusoes locais que aquele ambiente ainda nao viu.
  for (const tomb of localTombstones) {
    if (pushedTombstones.has(tomb.id)) continue;
    if (localById.has(tomb.id)) continue;
    try {
      await api.deleteNotebook(tomb.id);
    } catch (error) {
      if (statusOf(error) !== 404) continue;
    }
    await upsertNotebookSync({
      serverId,
      notebookId: tomb.id,
      deletedAt: tomb.deletedAt,
      tombstonePushedAt: now,
    });
  }

  // 4. Cadernos locais: cria no ambiente ou atualiza nome/cor.
  for (const notebook of local) {
    if (notebook.isDefault || deletedLocally.has(notebook.id)) continue;
    const exists = remoteById.get(notebook.id);
    if (exists) {
      if (exists.name !== notebook.name || exists.color !== notebook.color) {
        await api.updateNotebook(notebook.id, { name: notebook.name, color: notebook.color });
      }
    } else {
      await api.createNotebook({
        id: notebook.id,
        name: notebook.name,
        color: notebook.color,
      });
    }
    await upsertNotebookSync({
      serverId,
      notebookId: notebook.id,
      syncedName: notebook.name,
      syncedColor: notebook.color,
      syncedAt: now,
    });
  }
}

async function pullEntry(
  api: DyariumApi,
  entry: SyncManifestEntry,
  serverId: string,
  propagate: boolean,
): Promise<boolean> {
  const [detail, notes] = await Promise.all([api.getEntry(entry.id), api.listNotes(entry.id)]);
  const note = notes[0];
  if (isBlankServerEntry(detail, note)) return false;
  // O relogio do aparelho aprende as versoes deste ambiente: uma edicao local
  // feita depois desta leitura fica mais nova que elas.
  await observeVersion(
    detail.versions?.title,
    detail.versions?.recorded_at,
    detail.versions?.body,
    note?.body_version,
    detail.updated_at,
  );

  const existing = await getRecording(entry.id);
  const markdown = note?.content_markdown ?? '';
  const bodyHash = await hashMarkdown(markdown);
  const sync: EntrySyncRow = {
    serverId,
    recordingId: entry.id,
    remoteEntryId: detail.id,
    noteId: note?.id,
    uploadOffset: 0,
    titleVersion: detail.versions?.title,
    recordedAtVersion: detail.versions?.recorded_at,
    bodyVersion: note?.body_version ?? detail.versions?.body,
    attachmentRefs: JSON.stringify({}),
    primaryAttachmentId: detail.primary_attachment_id ?? detail.audios?.[0]?.id,
    syncedTitle: detail.title,
    syncedRecordedAt: detail.recorded_at ?? detail.created_at,
    syncedBodyHash: bodyHash,
    syncedNotebookId: detail.notebook_id || DEFAULT_NOTEBOOK_ID,
    syncedTags: JSON.stringify(detail.tags ?? []),
    syncedArchived: detail.archived ? 1 : 0,
    syncedAuthor: detail.author ?? '',
    // A marca de "ultimo acordo" e a hora do ambiente, nao a hora local: uma
    // nota com edicao pendente precisa continuar suja quando o estado do
    // servidor for mais antigo que a edicao.
    syncedAt: detail.updated_at,
  };

  if (!existing) {
    const recording = entryToRecording(detail, note);
    await upsertRecording(recording);
    await upsertEntrySync({ ...sync, recordingId: recording.id });
    return true;
  }

  // Nota ja existe: aplica a versao remota pelo mesmo merge do pull. O id
  // primario da gravacao e preservado; as versoes do ambiente ficam na tabela.
  const primaryEntryId = existing.entryId;
  const view: Recording = { ...existing, entryId: detail.id };
  const merged = mergeServerNote(view, detail, note);
  if (merged) {
    const changed = contentChanged(existing, merged);
    await upsertRecording({
      ...merged,
      entryId: primaryEntryId ?? detail.id,
      // Se este nao e o ambiente primario, nao sobrescreve as versoes que o
      // caminho legado usa; a tabela por ambiente guarda as versoes daqui.
      titleVersion: primaryEntryId && primaryEntryId !== detail.id ? existing.titleVersion : merged.titleVersion,
      recordedAtVersion:
        primaryEntryId && primaryEntryId !== detail.id
          ? existing.recordedAtVersion
          : merged.recordedAtVersion,
      bodyVersion:
        primaryEntryId && primaryEntryId !== detail.id ? existing.bodyVersion : merged.bodyVersion,
      // So uma mudanca real de conteudo volta para a fila. Uma versao nova com
      // o mesmo texto (o servidor regravou o que ja estava la) nao pode marcar
      // a nota como suja, senao cada ambiente reenvia e sobe a versao do outro
      // para sempre. Com um unico ambiente, nao ha para onde propagar: o
      // conteudo ja esta local e reenviar so faria o servidor regravar.
      noteDirty: changed && propagate ? true : existing.noteDirty,
    });
  }
  await upsertEntrySync({ ...sync, recordingId: existing.id, noteId: sync.noteId });
  return Boolean(merged);
}

async function pushRecording(
  api: DyariumApi,
  recording: Recording,
  sync: EntrySyncRow | undefined,
  serverId: string,
  singleServer: boolean,
  targetAttachmentIds: string[],
): Promise<void> {
  const remoteId = sync?.remoteEntryId ?? recording.entryId ?? recording.id;
  let primaryAttachmentId = sync?.primaryAttachmentId ?? recording.serverAttachmentId;
  const fileName = recording.fileName ?? `${recording.id}.aac`;
  const attachmentId =
    primaryAttachmentId ?? stableAttachmentId(recording.id, recording.fileName ?? 'audio');

  // So cria entrada/sobe audio quando aquele ambiente ainda nao conhece a
  // nota. Uma edicao posterior manda apenas titulo, corpo e metadados; reenviar
  // o audio a cada tecla seria caro e desnecessario.
  const existingAttachments = new Set(targetAttachmentIds);
  if (!sync?.remoteEntryId) {
    if (recording.filePath && recording.source !== 'text') {
      const [localTranscribe, localAnalysis] = await Promise.all([
        clientOwnsTranscription(),
        clientOwnsAnalysis(),
      ]);
      const result = await uploadRecording(
        {
          clientKey: recording.id,
          filename: fileName,
          contentType: recording.contentType ?? 'audio/aac',
          title: recording.title,
          recordedAt: recording.recordedAt,
          createdAt: recording.createdAt,
          source: recording.source === 'share' ? 'share' : 'upload',
          localPath: recording.filePath,
          sizeBytes: recording.sizeBytes ?? fileSize(recording.filePath),
          durationSeconds: recording.durationMs
            ? Math.max(1, Math.round(recording.durationMs / 1000))
            : undefined,
          localTranscribe,
          localAnalysis,
          entryId: remoteId,
          attachmentId,
          author: recording.author ?? '',
        },
        { api, file: uploadFileIO },
      );
      primaryAttachmentId = result.attachmentId ?? attachmentId;
      if (primaryAttachmentId) existingAttachments.add(primaryAttachmentId);
    } else if (
      recording.serverAttachmentId &&
      (await uploadAudioFromPeer(api, recording, remoteId, recording.serverAttachmentId))
    ) {
      // O audio nao esta mais no aparelho, mas existe em outro ambiente: sobe
      // com o mesmo id da nota e do anexo, e a nota deixa de virar texto.
      primaryAttachmentId = recording.serverAttachmentId;
      existingAttachments.add(primaryAttachmentId);
    } else {
      // Sem arquivo local e sem par que tenha o audio: a nota entra como texto.
      // O corpo/transcricao que existir continua valendo; o audio que ja nao
      // esta em lugar nenhum nao pode ser inventado.
      await api.createTextEntry({
        id: remoteId,
        title: recording.title,
        recorded_at: recording.recordedAt,
        created_at: recording.createdAt,
        notebook_id: recording.notebookId ?? DEFAULT_NOTEBOOK_ID,
      });
    }
  }

  const markdown = recording.text ?? '';
  if (markdown.includes('local:')) {
    // Ainda ha imagem/audio local sem id; o uploader primario resolve e o
    // corpo vai no proximo ciclo.
    return;
  }
  // Garante os bytes de todos os anexos do corpo antes de publicar o texto; o
  // id e o mesmo, entao o markdown nao precisa ser reescrito.
  await ensureBodyAttachments(api, recording, remoteId, existingAttachments);
  const attachments = parseAttachments(sync?.attachmentRefs) ?? recording.attachments ?? {};
  const view: Recording = {
    ...recording,
    entryId: remoteId,
    noteId: sync?.noteId,
    titleVersion: sync?.titleVersion,
    recordedAtVersion: sync?.recordedAtVersion,
    bodyVersion: sync?.bodyVersion,
    attachments,
    // O motor compara o estado local com o ultimo confirmado por ambiente; ao
    // empurrar, manda o estado local inteiro. As flags do caminho legado sao
    // por primario e nao saberiam o que falta nos outros ambientes.
    notebookDirty: true,
    tagsDirty: true,
    archivedDirty: true,
    authorDirty: true,
  };
  const result = await syncNoteWith(api, view, async () => ({
    markdown,
    attachments,
    pending: [],
  }));
  if (!result) return;
  await upsertEntrySync({
    serverId,
    recordingId: recording.id,
    remoteEntryId: remoteId,
    noteId: result.noteId,
    uploadOffset: 0,
    titleVersion: result.versions.title,
    recordedAtVersion: result.versions.recordedAt,
    bodyVersion: result.versions.body,
    attachmentRefs: JSON.stringify({ ...attachments, ...result.attachments }),
    primaryAttachmentId,
    syncedTitle: recording.title,
    syncedRecordedAt: recording.recordedAt,
    syncedBodyHash: await hashMarkdown(markdown),
    syncedNotebookId: recording.notebookId ?? DEFAULT_NOTEBOOK_ID,
    syncedTags: JSON.stringify(recording.tags ?? []),
    syncedArchived: recording.archived ? 1 : 0,
    syncedAuthor: recording.author ?? '',
    syncedAt: new Date().toISOString(),
  });
  // O texto derivado viaja com a nota: uma transcricao feita no aparelho (ou
  // vinda de outro ambiente) tambem precisa existir aqui. A funcao compara o
  // texto antes de enviar e nunca deixa uma copia parcial sobrescrever a
  // completa.
  if ((recording.transcript ?? '').trim() || (recording.transcriptSegments?.length ?? 0) > 0) {
    await pushTranscriptToServer(api, recording, remoteId).catch(() => undefined);
  }
  // Analise feita no aparelho tambem viaja: o servidor guarda a primeira que
  // chegar (sem `replace`), entao reenviar nao sobrescreve trabalho de outro
  // ambiente.
  const analysisKey = recording.entryId ?? recording.id;
  const cachedAnalysis = await getCachedAnalysis(analysisKey).catch(() => null);
  if (cachedAnalysis?.origin === 'local' && cachedAnalysis.analysis) {
    await pushAnalysisToServer(api, remoteId, cachedAnalysis.analysis).catch(() => undefined);
  }
  // Com um unico ambiente, este push e o caminho do primario: limpa as flags e
  // grava as versoes, como o uploader faz. Sem isso a nota continuaria "suja"
  // para sempre e cada reconciliacao reenviaria o mesmo conteudo.
  if (singleServer) {
    const fresh = await getRecording(recording.id);
    if (fresh) {
      await upsertRecording(applySyncResult(fresh, view, result));
    }
  }
}

async function recordSyncError(
  serverId: string,
  recordingId: string,
  error: unknown,
): Promise<void> {
  const current = await getEntrySync(serverId, recordingId);
  const message = error instanceof Error ? error.message.slice(0, 200) : 'falha ao sincronizar';
  if (!current) {
    await upsertEntrySync({ serverId, recordingId, uploadOffset: 0, lastError: message });
    return;
  }
  await upsertEntrySync({ ...current, lastError: message });
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

function parseAttachments(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // valor antigo/corrompido: segue sem mapa
  }
  return {};
}

/** O merge mudou algo que o usuario ve, ou so a versao do ambiente? */
function contentChanged(a: Recording, b: Recording): boolean {
  return (
    a.title !== b.title ||
    a.recordedAt !== b.recordedAt ||
    (a.text ?? '') !== (b.text ?? '') ||
    (a.notebookId ?? DEFAULT_NOTEBOOK_ID) !== (b.notebookId ?? DEFAULT_NOTEBOOK_ID) ||
    JSON.stringify(a.tags ?? []) !== JSON.stringify(b.tags ?? []) ||
    Boolean(a.archived) !== Boolean(b.archived) ||
    (a.author ?? '') !== (b.author ?? '') ||
    a.serverAttachmentId !== b.serverAttachmentId
  );
}

async function hashMarkdown(markdown: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, markdown);
}

function fileSize(path: string | undefined): number {
  if (!path) return 0;
  try {
    return new File(path).size;
  } catch {
    return 0;
  }
}
