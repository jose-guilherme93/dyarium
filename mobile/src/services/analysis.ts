/**
 * Busca no servidor a analise que ja existe de uma nota e guarda no aparelho.
 * Nao dispara analise nenhuma: le o que o servidor ja produziu (GET). Sem rede
 * ou sem analise, devolve null e o cache local continua valendo.
 */

import { ApiError, DyariumApi, type FetchLike, type ServerAnalysis } from '@/core/api';

import { deleteCachedServerAnalysis, saveCachedAnalyses } from './db';
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
