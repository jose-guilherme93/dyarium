/**
 * Reconciliacao entre ambientes independentes: nucleo puro, sem SQLite nem rede.
 *
 * A regra e uniao por identidade. Notas de ids diferentes nunca conflitam; cada
 * uma e criada no ambiente que nao a tem. Para a mesma nota, o manifesto diz o
 * que mudou desde a ultima sincronizacao e o plano so pede o que falta. Ausencia
 * nunca apaga: exclusao so vale quando ha tombstone, e o mais novo vence.
 */

import type { SyncManifestEntry } from './api';
import { versionTime } from './hlc';

/** Ultimo estado confirmado por um ambiente para uma nota. */
export interface EntrySyncSnapshot {
  remoteEntryId?: string;
  bodyHash?: string;
  versions?: { title?: string; recorded_at?: string; body?: string };
  deletedAt?: string;
}

/** Nota local vista pela reconciliacao. */
export interface LocalNote {
  id: string;
  /** Id da entrada no ambiente primario (quando ja enviada). */
  entryId?: string;
  deletedAt?: string;
  updatedAt: string;
  /** Versao da ultima mudanca de conteudo no relogio hibrido. */
  updatedHlc?: string;
  status: string;
  /** Ha alteracao local ainda nao confirmada por aquele ambiente. */
  dirty: boolean;
}

export interface ReconcileInput {
  remoteLive: SyncManifestEntry[];
  remoteDeleted: SyncManifestEntry[];
  local: LocalNote[];
  /** Estado confirmado do ambiente, por id local da nota. */
  syncByRecording: Map<string, EntrySyncSnapshot>;
}

export interface ReconcilePlan {
  /** Ids remotos cujo conteudo precisa ser baixado. */
  pull: string[];
  /** Ids locais que precisam ser criados/atualizados naquele ambiente. */
  push: string[];
  /** Exclusoes remotas a aplicar localmente. */
  tombstone: { recordingId: string; deletedAt: string }[];
  /** Exclusoes locais que aquele ambiente ainda nao viu. */
  pushDelete: { recordingId: string; remoteEntryId: string; deletedAt: string }[];
  /** Notas locais vivas que aquele ambiente tem como apagadas: restaurar la. */
  restore: { recordingId: string; remoteEntryId: string }[];
}

/** Instante de uma data ou de uma versao (hibrida ou RFC3339), em ms. */
function time(value: string | undefined | null): number {
  return versionTime(value);
}

/** O ambiente mudou algo desde a ultima sincronizacao? */
function remoteMoved(remote: SyncManifestEntry, sync: EntrySyncSnapshot | undefined): boolean {
  if (!sync) return true;
  if (remote.body_hash && sync.bodyHash && remote.body_hash !== sync.bodyHash) return true;
  const remoteVersions = remote.versions ?? {};
  const synced = sync.versions ?? {};
  return (
    (remoteVersions.title ?? '') !== (synced.title ?? '') ||
    (remoteVersions.recorded_at ?? '') !== (synced.recorded_at ?? '') ||
    (remoteVersions.body ?? '') !== (synced.body ?? '')
  );
}

/**
 * Monta o plano de um ambiente. Funcao pura: o mesmo manifesto e o mesmo estado
 * local sempre produzem o mesmo plano, o que torna a reconciliacao testavel e
 * segura para reexecutar depois de uma queda.
 */
export function planReconcile(input: ReconcileInput): ReconcilePlan {
  const plan: ReconcilePlan = { pull: [], push: [], tombstone: [], pushDelete: [], restore: [] };
  const liveById = new Map(input.remoteLive.map((entry) => [entry.id, entry]));
  const deletedById = new Map(input.remoteDeleted.map((entry) => [entry.id, entry]));
  const localByRemote = new Map<string, LocalNote>();

  for (const note of input.local) {
    const sync = input.syncByRecording.get(note.id);
    const remoteId = sync?.remoteEntryId ?? note.entryId;
    if (remoteId) localByRemote.set(remoteId, note);
    // O id primario pode diferir do id naquele ambiente; os dois sao chaves
    // validas para reconhecer a mesma nota.
    if (note.entryId) localByRemote.set(note.entryId, note);
    if (note.id) localByRemote.set(note.id, note);
  }

  // O que existe no ambiente e ainda nao existe aqui (ou mudou la).
  for (const remote of input.remoteLive) {
    const local = localByRemote.get(remote.id);
    if (!local) {
      plan.pull.push(remote.id);
      continue;
    }
    if (local.deletedAt) {
      if (time(remote.updated_at) > time(local.deletedAt)) {
        plan.restore.push({ recordingId: local.id, remoteEntryId: remote.id });
      } else {
        plan.pushDelete.push({
          recordingId: local.id,
          remoteEntryId: remote.id,
          deletedAt: local.deletedAt,
        });
      }
      continue;
    }
    const sync = input.syncByRecording.get(local.id);
    if (remoteMoved(remote, sync)) plan.pull.push(remote.id);
    if (local.dirty) plan.push.push(local.id);
  }

  // O que existe aqui e nao existe la: cria. Nunca apaga por ausencia.
  for (const local of input.local) {
    if (local.status !== 'completed') continue;
    const sync = input.syncByRecording.get(local.id);
    const remoteId = sync?.remoteEntryId ?? local.entryId ?? local.id;
    const remote = liveById.get(remoteId);
    const deleted = deletedById.get(remoteId);
    if (local.deletedAt) {
      if (!deleted && !remote) {
        plan.pushDelete.push({
          recordingId: local.id,
          remoteEntryId: remoteId,
          deletedAt: local.deletedAt,
        });
      }
      continue;
    }
    if (!remote && !deleted) {
      plan.push.push(local.id);
      continue;
    }
    if (deleted) {
      if (time(local.updatedHlc ?? local.updatedAt) > time(deleted.deleted_at)) {
        plan.restore.push({ recordingId: local.id, remoteEntryId: remoteId });
      } else {
        plan.tombstone.push({ recordingId: local.id, deletedAt: deleted.deleted_at ?? '' });
      }
    }
  }

  // Tombstones remotos sem par vivo no manifesto (a entrada ja foi purgada).
  for (const deleted of input.remoteDeleted) {
    const local = localByRemote.get(deleted.id);
    if (!local || local.deletedAt) continue;
    if (time(deleted.deleted_at) > time(local.updatedHlc ?? local.updatedAt)) {
      plan.tombstone.push({ recordingId: local.id, deletedAt: deleted.deleted_at ?? '' });
    } else {
      plan.restore.push({ recordingId: local.id, remoteEntryId: deleted.id });
    }
  }

  // Sem duplicatas: o mesmo id pode ser alcancado por mais de um caminho.
  plan.pull = [...new Set(plan.pull)];
  plan.push = [...new Set(plan.push)];
  const seenTombstone = new Set<string>();
  plan.tombstone = plan.tombstone.filter((item) => {
    if (seenTombstone.has(item.recordingId)) return false;
    seenTombstone.add(item.recordingId);
    return true;
  });
  const seenDelete = new Set<string>();
  plan.pushDelete = plan.pushDelete.filter((item) => {
    if (seenDelete.has(item.recordingId)) return false;
    seenDelete.add(item.recordingId);
    return true;
  });
  const seenRestore = new Set<string>();
  plan.restore = plan.restore.filter((item) => {
    if (seenRestore.has(item.recordingId)) return false;
    seenRestore.add(item.recordingId);
    return true;
  });
  return plan;
}
