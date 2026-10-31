/**
 * Reconciliacao das entidades do mapa com os ambientes conectados.
 *
 * O mapa funciona sem isto: le sempre o SQLite local. Este modulo empurra as
 * edicoes feitas no aparelho (renomear, icone, "sou eu") e traz o catalogo de
 * cada ambiente, para que uma renomeacao feita no painel apareca aqui e chegue
 * aos outros servidores. Toda falha e best-effort: sem rede, a outbox guarda a
 * operacao para o proximo pull.
 *
 * Entidades nascem da analise de cada ambiente, entao os ids nao sao os mesmos:
 * o encontro e pelo nome (e pelos aliases). Por isso o catalogo nao "sobrescreve
 * o local"; a edicao mais nova vence e a diferenca e empurrada de volta com o
 * nome que aquele ambiente conhece.
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
  type EntityPush,
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

/** Empurra uma diferenca que o catalogo daquele ambiente ainda nao tem. */
async function pushDifference(api: DyariumApi, item: EntityPush): Promise<void> {
  const name = item.renameTo ?? item.name;
  if (item.renameTo && item.renameTo !== item.name) {
    await api.renameEntity(item.kind, item.name, item.renameTo);
  }
  if (item.icon !== undefined) {
    await api.setEntityIcon(item.kind, name, item.icon);
  }
}

const running = new Map<string, Promise<void>>();

/**
 * Reconciliacao do ambiente primario, usada pelo pull periodico. Duas chamadas
 * concorrentes (pull e tela) compartilham a mesma execucao para nao duplicar
 * PATCH.
 */
export function syncEntities(): Promise<void> {
  return keyed('primary', async () => {
    const config = await loadServerConfig();
    if (!config) return;
    await run(new DyariumApi(config, doFetch), true);
  });
}

/**
 * O mesmo trabalho para um ambiente especifico. O primario apaga a outbox
 * depois de subir (e o fluxo antigo, que o pull usa); nos demais ela fica, para
 * o primario continuar sendo quem confirma a operacao.
 */
export function syncEntitiesFor(
  api: DyariumApi,
  serverId: string,
  primary = false,
): Promise<void> {
  return keyed(serverId, () => run(api, primary));
}

function keyed(key: string, job: () => Promise<void>): Promise<void> {
  const existing = running.get(key);
  if (existing) return existing;
  const started = job().finally(() => {
    running.delete(key);
  });
  running.set(key, started);
  return started;
}

async function run(api: DyariumApi, primary: boolean): Promise<void> {
  if (primary) {
    // O primario apaga cada operacao depois de subir; reler a cada volta mantem
    // o mesmo ritmo de antes e libera a outbox para a tela.
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
  } else {
    // Nos demais ambientes a outbox fica: quem confirma a operacao e o primario.
    // Uma passada so, senao o mesmo PATCH se repetiria para sempre.
    for (const item of await listEntityOutbox(100)) {
      try {
        await push(api, item);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) continue;
        await markEntityOutboxAttempt(item.id, 'falha ao sincronizar entidade');
        return;
      }
    }
  }

  const catalog = await api.getEntityCatalog();
  await applyRemoteOwnerAliases(catalog.ownerAliases);
  const remaining = await listEntityOutbox(100);
  const pendingIds = new Set(remaining.map((item) => item.entityId));
  const remote = catalog.entities
    .map(remoteState)
    .filter((item): item is RemoteEntityState => Boolean(item));
  const differences = await applyRemoteEntities(remote, pendingIds);
  for (const difference of differences) {
    await pushDifference(api, difference).catch((error) => {
      // 404: a entidade foi mesclada/apagada la; a proxima leitura reconcilia.
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    });
  }
}
