/**
 * Analise vinda do servidor: busca quando ha atualizacao, guarda no banco e
 * avisa a tela. Nunca e o caminho de exibicao — a ficha le sempre o cache do
 * aparelho, que e atualizado por este modulo.
 *
 * Duas entradas:
 * - `syncServerAnalyses` roda junto do pull: compara o `analysis_at` que veio
 *   na lista de entradas com o ultimo valor ja buscado e importa o que mudou.
 * - `requestServerAnalysis` dispara uma analise remota a pedido do usuario.
 *   O pedido leva so o id da entrada; o texto ja esta no servidor.
 */

import {
  ApiError,
  DyariumApi,
  type FetchLike,
  type ServerAnalysis,
  type ServerEntry,
  type SyncManifestEntry,
} from '@/core/api';
import type { Recording } from '@/core/types';

import { emitAnalysis } from './analysisFeed';
import {
  deleteCachedServerAnalysis,
  getAnalysisSyncAt,
  getAnalysisSyncAtEnv,
  getCachedAnalysis,
  listCachedAnalyses,
  saveCachedAnalyses,
  setAnalysisSyncAt,
  setAnalysisSyncAtEnv,
  type CachedAnalysis,
} from './db';
import { loadServerConfig } from './secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

export interface NoteAnalysisTarget {
  entryId: string;
  title: string;
  recordedAt: string;
}

/**
 * Uma analise do servidor, guardada no aparelho. Devolve null quando ainda nao
 * existe (404) ou quando a rede falhou; quem chamou decide se tenta de novo.
 */
export async function fetchNoteAnalysis(
  target: NoteAnalysisTarget,
): Promise<ServerAnalysis | null> {
  try {
    const config = await loadServerConfig();
    if (!config) return null;

    const api = new DyariumApi(config, doFetch);
    const analysis = await api.getAnalysis(target.entryId);

    try {
      await saveCachedAnalyses([
        {
          entryId: target.entryId,
          title: target.title,
          recordedAt: target.recordedAt,
          analysis,
          origin: 'server',
        },
      ]);
      emitAnalysis(target.entryId);
    } catch {
      // Cache local e best-effort: a analise ainda pode ser mostrada agora.
    }

    return analysis;
  } catch (error) {
    // 404: o servidor nao tem mais analise desta nota (por exemplo, o audio e
    // a transcricao foram apagados). A copia do servidor no aparelho precisa
    // cair junto; senao a nota mostra a medida de um texto que nao existe.
    if (error instanceof ApiError && error.status === 404) {
      await deleteCachedServerAnalysis(target.entryId).catch(() => undefined);
      emitAnalysis(target.entryId);
    }
    // Falta de rede e esperada: quem chamou decide mostrar o cache que tiver.
    return null;
  }
}

/**
 * Importa as analises que mudaram desde o ultimo pull. A lista de entradas ja
 * traz `analysis_at`; so as entradas cujo valor mudou sao buscadas. Best-effort
 * e idempotente: falha de rede deixa para o proximo pull.
 */
export async function syncServerAnalyses(entries: ServerEntry[]): Promise<number> {
  const config = await loadServerConfig();
  if (!config) return 0;
  const api = new DyariumApi(config, doFetch);
  let imported = 0;
  if (__DEV__) {
    const comAnalise = entries.filter((entry) => Boolean(entry.analysis_at)).length;
    console.warn('ana: entradas', entries.length, 'com analysis_at', comAnalise);
  }
  let marcados = 0;
  let locais = 0;
  let falhas = 0;
  // Busca tudo primeiro e grava de uma vez: uma transacao por analise segurava
  // a conexao do SQLite por segundos e travava a leitura do mapa que abria.
  const pending: CachedAnalysis[] = [];
  const markers: { id: string; at: string }[] = [];

  for (const entry of entries) {
    if (!entry.id || !entry.analysis_at) continue;
    const sourceAt = entry.analysis_at;
    const last = await getAnalysisSyncAt(entry.id);
    if (last === sourceAt) {
      marcados += 1;
      continue;
    }

    // Analise feita no aparelho vence: nao vale gastar rede nem sobrescrever.
    const cached = await getCachedAnalysis(entry.id).catch(() => null);
    if (cached?.origin === 'local') {
      locais += 1;
      await setAnalysisSyncAt(entry.id, sourceAt);
      continue;
    }
    // Analise do servidor ja guardada, sem marcador (backup restaurado): a
    // copia local e a deste ambiente. Carimba em vez de baixar de novo; quando
    // `analysis_at` mudar, a versao nova e buscada normalmente.
    if (!last && cached) {
      await setAnalysisSyncAt(entry.id, sourceAt);
      continue;
    }

    try {
      const analysis = await api.getAnalysis(entry.id);
      pending.push({
        entryId: entry.id,
        title: entry.title,
        recordedAt: entry.recorded_at ?? entry.created_at,
        analysis,
        origin: 'server',
      });
      markers.push({ id: entry.id, at: sourceAt });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        // A atualizacao era de uma analise que ja nao existe.
        await deleteCachedServerAnalysis(entry.id).catch(() => undefined);
        await setAnalysisSyncAt(entry.id, sourceAt);
        emitAnalysis(entry.id);
      } else {
        falhas += 1;
        if (__DEV__ && falhas <= 3) {
          console.warn(
            'ana: falha ao buscar',
            entry.id,
            error instanceof ApiError ? `${error.status} ${error.code ?? ''}` : String(error),
          );
        }
      }
      // Rede/5xx: o marcador fica como esta e o proximo pull tenta de novo.
    }
  }

  if (pending.length > 0) {
    // Se a gravacao falhar, nenhum marcador sobe: o proximo pull tenta de novo.
    await saveCachedAnalyses(pending);
    for (const marker of markers) {
      await setAnalysisSyncAt(marker.id, marker.at);
      emitAnalysis(marker.id);
    }
    imported = pending.length;
  }
  if (__DEV__) console.warn('ana: importadas', imported, 'marcadas', marcados, 'locais', locais, 'falhas', falhas);
  return imported;
}

/**
 * O mesmo pull de analises, por ambiente. O cache local e unico (a ficha le
 * sempre dele); a analise feita no aparelho vence. O marcador e por
 * `(server_id, entry_id)`.
 */
export async function syncServerAnalysesFor(
  api: DyariumApi,
  serverId: string,
  entries: SyncManifestEntry[],
  byEntry: Map<string, Recording>,
  primary = false,
): Promise<number> {
  let imported = 0;
  for (const entry of entries) {
    if (!entry.id || !entry.analysis_at) continue;
    const sourceAt = entry.analysis_at;
    const last = primary
      ? await getAnalysisSyncAt(entry.id)
      : await getAnalysisSyncAtEnv(serverId, entry.id);
    if (last === sourceAt) continue;

    const recording = byEntry.get(entry.id);
    const localEntryId = recording?.entryId ?? entry.id;
    const cached = await getCachedAnalysis(localEntryId).catch(() => null);
    if (cached?.origin === 'local') {
      if (primary) await setAnalysisSyncAt(entry.id, sourceAt);
      else await setAnalysisSyncAtEnv(serverId, entry.id, sourceAt);
      continue;
    }
    // No ambiente primario, analise ja guardada sem marcador veio dele mesmo.
    if (primary && !last && cached) {
      await setAnalysisSyncAt(entry.id, sourceAt);
      continue;
    }

    try {
      const analysis = await api.getAnalysis(entry.id);
      await saveCachedAnalyses([
        {
          entryId: localEntryId,
          title: recording?.title ?? entry.title ?? '',
          recordedAt: recording?.recordedAt ?? entry.recorded_at ?? entry.created_at,
          analysis,
          origin: 'server',
        },
      ]);
      if (primary) await setAnalysisSyncAt(entry.id, sourceAt);
      else await setAnalysisSyncAtEnv(serverId, entry.id, sourceAt);
      emitAnalysis(localEntryId);
      imported += 1;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        await deleteCachedServerAnalysis(localEntryId).catch(() => undefined);
        if (primary) await setAnalysisSyncAt(entry.id, sourceAt);
        else await setAnalysisSyncAtEnv(serverId, entry.id, sourceAt);
        emitAnalysis(localEntryId);
      }
      // Rede/5xx: o marcador fica como esta e o proximo ciclo tenta de novo.
    }
  }
  return imported;
}

/** Sobe uma analise para um ambiente especifico, com o id de entrada dele. */
export async function pushAnalysisToServer(
  api: DyariumApi,
  entryId: string,
  analysis: ServerAnalysis,
  replace = false,
): Promise<boolean> {
  try {
    const result = await api.putAnalysis(entryId, { ...analysis, replace });
    return result.stored === true;
  } catch {
    return false;
  }
}

/**
 * Pede ao servidor que analise a nota. O servidor faz o ping do provedor antes
 * de enfileirar (409 quando a analise esta desligada, 502 quando o provedor nao
 * responde). Nada do conteudo da nota sai neste pedido.
 */
export async function requestServerAnalysis(entryId: string): Promise<{ status: string }> {
  const config = await loadServerConfig();
  if (!config) throw new ApiError(0, 'no_server', 'servidor nao configurado');
  const api = new DyariumApi(config, doFetch);
  return api.requestAnalysis(entryId);
}

/**
 * So a configuracao local de servidor (sem rede). Usado pela ficha para decidir
 * se o botao remoto aparece.
 */
export async function hasServerConfig(): Promise<boolean> {
  return (await loadServerConfig()) !== null;
}

/**
 * Sobe a analise feita no aparelho para o servidor. Sem `replace`, o servidor
 * so guarda se ainda nao tiver analise — refazer e acao explicita.
 */
export async function pushNoteAnalysis(
  entryId: string,
  analysis: ServerAnalysis,
  replace = false,
): Promise<boolean> {
  try {
    const config = await loadServerConfig();
    if (!config) return false;
    const api = new DyariumApi(config, doFetch);
    const result = await api.putAnalysis(entryId, { ...analysis, replace });
    return result.stored === true;
  } catch {
    // Sem rede ou entrada ainda inexistente no servidor: a proxima conexao
    // tenta de novo (a analise continua salva no aparelho).
    return false;
  }
}

/**
 * Backfill: envia as analises locais que o servidor ainda nao tem. Idempotente
 * (o servidor ignora o que ja existe), entao pode rodar em toda abertura com
 * servidor conectado. Chaves `note_` ficam de fora: a nota ainda nao subiu e
 * nao existe entrada para receber a analise.
 */
export async function pushLocalAnalyses(): Promise<number> {
  const config = await loadServerConfig();
  if (!config) return 0;
  let sent = 0;
  try {
    const cached = await listCachedAnalyses();
    for (const item of cached) {
      if (item.origin !== 'local') continue;
      if (item.entryId.startsWith('note_')) continue;
      if (await pushNoteAnalysis(item.entryId, item.analysis)) sent += 1;
    }
  } catch {
    return sent;
  }
  return sent;
}
