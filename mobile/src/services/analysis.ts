/**
 * Busca no servidor a analise que ja existe de uma nota e guarda no aparelho.
 * Nao dispara analise nenhuma: le o que o servidor ja produziu (GET). Sem rede
 * ou sem analise, devolve null e o cache local continua valendo.
 */

import { ApiError, DyariumApi, type FetchLike, type ServerAnalysis } from '@/core/api';

import {
  deleteCachedServerAnalysis,
  listCachedAnalyses,
  saveCachedAnalyses,
} from './db';
import { loadServerConfig } from './secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

export interface NoteAnalysisTarget {
  entryId: string;
  title: string;
  recordedAt: string;
}

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
        },
      ]);
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
    }
    // Falta de rede e esperada: quem chamou decide mostrar o cache que tiver.
    return null;
  }
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
