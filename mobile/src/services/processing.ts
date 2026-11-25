/**
 * Onde cada etapa roda, com o estado real do aparelho: modulo nativo presente,
 * modelo baixado, servidor conectado e chave do provedor online.
 *
 * A transcricao tem a mesma decisao em `whisper.ts` (para nao criar ciclo de
 * import); aqui fica a analise e o resumo usado pelas telas.
 */

import { localAnalysisEnabled } from '@/core/features';
import {
  clientOwnsStage,
  decideProcessing,
  type ProcessingDecision,
} from '@/core/processing';
import { resolveAnalysisBaseUrl } from '@/core/providers';

import { resolveAnalysisModel } from './analysisModels';
import { localAnalysisAvailable } from './localAnalysis';
import { loadPrefs, loadProviderKey, loadServerConfig } from './secure';
import { transcriptionPlace } from './whisper';

/** O aparelho consegue rodar analise neste build? (flag + motor nativo) */
export function localAnalysisCapable(): boolean {
  return localAnalysisEnabled() && localAnalysisAvailable();
}

export async function analysisPlace(): Promise<ProcessingDecision> {
  const [prefs, server, key] = await Promise.all([
    loadPrefs(),
    loadServerConfig(),
    loadProviderKey('analysis'),
  ]);
  const baseUrl = resolveAnalysisBaseUrl(prefs.analysisProvider, prefs.analysisBaseUrl);
  const model = (prefs.analysisOnlineModel ?? '').trim();
  return decideProcessing({
    place: prefs.analysisPlace ?? 'off',
    hasServer: Boolean(server),
    deviceCapable: localAnalysisCapable(),
    deviceReady: Boolean(resolveAnalysisModel(prefs.analysisModel ?? '')),
    onlineReady: Boolean(key) && baseUrl !== '' && model !== '',
  });
}

export async function clientOwnsAnalysis(): Promise<boolean> {
  return clientOwnsStage((await analysisPlace()).place);
}

export interface ProcessingOverview {
  transcription: ProcessingDecision;
  analysis: ProcessingDecision;
  hasServer: boolean;
}

/** Retrato das duas etapas para a folha de processamento e as Opcoes. */
export async function processingOverview(): Promise<ProcessingOverview> {
  const [transcription, analysis, server] = await Promise.all([
    transcriptionPlace(),
    analysisPlace(),
    loadServerConfig(),
  ]);
  return { transcription, analysis, hasServer: Boolean(server) };
}
