/**
 * Reconciliacao entre as notas do aparelho e as do servidor. Pura: recebe as
 * listas e devolve o plano. Nada de IO aqui, para poder ser testado com fakes.
 *
 * Regra: uma nota e a mesma dos dois lados quando casa por `entryId` (id do
 * servidor) ou, na falta dele, pela identidade de conteudo (`originKey`).
 */

import type { Recording } from './types';

/** Nota como o servidor a devolve em GET /entries. */
export interface RemoteNote {
  id: string;
  originKey?: string;
  title?: string;
  recordedAt?: string | null;
  durationSeconds?: number;
  status?: string;
}

export interface ReconcilePlan {
  /** Notas do servidor ausentes no aparelho: inserir como remotas. */
  insert: RemoteNote[];
  /** Gravacoes locais que sumiram do servidor: subir de novo. */
  reupload: string[];
  /** Linhas remotas locais que ja nao existem no servidor: remover. */
  remove: string[];
}

export function planReconciliation(local: Recording[], remote: RemoteNote[]): ReconcilePlan {
  const byId = new Map(remote.map((note) => [note.id, note]));
  const byOrigin = new Map<string, RemoteNote>();
  for (const note of remote) {
    if (note.originKey) byOrigin.set(note.originKey, note);
  }

  const matched = new Set<string>();
  const reupload: string[] = [];
  const remove: string[] = [];

  for (const rec of local) {
    if (rec.status === 'remote') {
      if (rec.entryId && byId.has(rec.entryId)) {
        matched.add(rec.entryId);
      } else {
        remove.push(rec.id);
      }
      continue;
    }
    if (rec.entryId && byId.has(rec.entryId)) {
      matched.add(rec.entryId);
    } else if (rec.originKey && byOrigin.has(rec.originKey)) {
      matched.add(byOrigin.get(rec.originKey)!.id);
    } else if (rec.entryId) {
      // A gravacao diz ter sido enviada, mas a nota nao esta no servidor.
      reupload.push(rec.id);
    }
  }

  const insert = remote.filter((note) => !matched.has(note.id));
  return { insert, reupload, remove };
}
