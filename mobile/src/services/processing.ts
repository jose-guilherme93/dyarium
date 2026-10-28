/**
 * Decisao de onde cada etapa roda, com o estado real do aparelho: modulo
 * nativo presente, modelo baixado e servidor configurado.
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

import { isAnalysisModelInstalled } from './analysisModels';
import { localAnalysisAvailable } from './localAnalysis';
import { loadPrefs, loadServerConfig } from './secure';
import { transcriptionPlace } from './whisper';

/** O aparelho consegue rodar analise neste build? (flag + motor nativo) */
export function localAnalysisCapable(): boolean {
  return localAnalysisEnabled() && localAnalysisAvailable();
}

export async function analysisPlace(): Promise<ProcessingDecision> {
  const [prefs, server] = await Promise.all([loadPrefs(), loadServerConfig()]);
  return decideProcessing({
    enabled: prefs.analysisEnabled === true,
    serverProcessing: prefs.serverProcessing === true,
    hasServer: Boolean(server),
    deviceCapable: localAnalysisCapable(),
    deviceReady: Boolean(prefs.analysisModel && isAnalysisModelInstalled(prefs.analysisModel)),
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
