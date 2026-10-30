/**
 * Reconciliacao das entidades do mapa com o servidor.
 *
 * O mapa funciona sem isto: le sempre o SQLite local. Este modulo empurra as
 * edicoes feitas no aparelho (renomear, icone, "sou eu") e traz o catalogo do
 * servidor, para que uma renomeacao feita no painel apareca aqui e vice-versa.
 * Toda falha e best-effort: sem rede, a outbox guarda a operacao para o proximo
 * pull.
 */

import { ApiError, DyariumApi, type EntitySummary, type FetchLike } from '@/core/api';

import { loadServerConfig } from './secure';
import {
  applyRemoteEntities,
  applyRemoteOwnerAliases,
  deleteEntityOutbox,
  listEntityOutbox,
  markEntityOutboxAttempt,
  type EntityOutboxItem,
  type RemoteEntityState,
} from './db';

const doFetch = globalThis.fetch as unknown as FetchLike;

function remoteState(summary: EntitySummary): RemoteEntityState | null {
  if (!summary.id) return null;
  return {
    id: summary.id,
    kind: summary.kind,
    name: summary.name,
    icon: summary.icon ?? '',
    updatedAt: summary.updated_at ?? '',
    aliases: summary.aliases ?? [],
  };
}

async function push(api: DyariumApi, item: EntityOutboxItem): Promise<void> {
  switch (item.operation) {
    case 'rename':
      if (item.nextName) await api.renameEntity(item.kind, item.name, item.nextName);
      return;
    case 'icon':
      await api.setEntityIcon(item.kind, item.name, item.icon ?? '');
      return;
    case 'self':
      await api.claimSelf(item.name);
      return;
  }
}

let running: Promise<void> | null = null;

/**
 * Empurra a outbox e aplica o catalogo. Duas chamadas concorrentes (pull e
 * tela) compartilham a mesma execucao para nao duplicar PATCH.
 */
export function syncEntities(): Promise<void> {
  if (running) return running;
  running = run().finally(() => {
    running = null;
  });
  return running;
}

async function run(): Promise<void> {
  const config = await loadServerConfig();
  if (!config) return;
  const api = new DyariumApi(config, doFetch);

  for (let guard = 0; guard < 20; guard += 1) {
    const pending = await listEntityOutbox(1);
    if (pending.length === 0) break;
    const item = pending[0];
    try {
      await push(api, item);
      await deleteEntityOutbox(item.id);
    } catch (error) {
      // 404: a entidade nao existe mais no servidor (ou nasceu so no aparelho);
      // nao ha o que renomear e insistir travaria a fila para sempre.
      if (error instanceof ApiError && error.status === 404) {
        await deleteEntityOutbox(item.id);
        continue;
      }
      await markEntityOutboxAttempt(item.id, 'falha ao sincronizar entidade');
      return;
    }
  }

  const catalog = await api.getEntityCatalog();
  await applyRemoteOwnerAliases(catalog.ownerAliases);
  const remaining = await listEntityOutbox(100);
  const pendingIds = new Set(remaining.map((item) => item.entityId));
  const remote = catalog.entities
    .map(remoteState)
    .filter((item): item is RemoteEntityState => Boolean(item));
  await applyRemoteEntities(remote, pendingIds);
}
