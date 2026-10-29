/**
 * Modelos de analise local no aparelho (arquivos GGUF do llama.cpp).
 * Baixados em runtime para `Paths.document/analysis-models`.
 *
 * O download confere o tamanho exato do catalogo e usa uma revisao fixa do
 * Hugging Face. A conferencia SHA-256 entra na fase de endurecimento, quando o
 * modelo ja estiver validado pelo benchmark.
 */

import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import {
  ANALYSIS_MODELS,
  analysisModelById,
  analysisModelUrl,
  type AnalysisModelInfo,
} from '@/core/analysisModels';
import { cancelActivity, failActivity, finishActivity, startActivity, updateActivity } from './activity';

const DIR_NAME = 'analysis-models';

/**
 * O `expo-file-system` nao existe no navegador: `new Directory(Paths.document)`
 * estoura e derruba a tela que pergunta por modelos. No web nao existe modelo
 * no aparelho, entao a resposta e sempre "nenhum".
 */
function localModels(): boolean {
  return Platform.OS !== 'web';
}

export function analysisModelsDirectory(): Directory {
  const dir = new Directory(Paths.document, DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Caminho `file://` do arquivo de um modelo (exista ou nao). */
export function analysisModelFilePath(id: string): string | null {
  const model = analysisModelById(id);
  if (!model || !localModels()) return null;
  return new File(analysisModelsDirectory(), model.fileName).uri;
}

export interface InstalledAnalysisModel {
  id: string;
  bytes: number;
}

/** Modelos de analise ja baixados no aparelho. */
export function installedAnalysisModels(): InstalledAnalysisModel[] {
  if (!localModels()) return [];
  const entries = analysisModelsDirectory().list();
  const out: InstalledAnalysisModel[] = [];
  for (const info of ANALYSIS_MODELS) {
    const entry = entries.find((item) => item.name === info.fileName);
    if (!entry) continue;
    try {
      const size = new File(entry.uri).size;
      // Um download interrompido pode deixar arquivo parcial: so conta como
      // instalado quando o tamanho bate com o catalogo.
      if (size !== info.sizeBytes) continue;
      out.push({ id: info.id, bytes: size });
    } catch {
      // arquivo ilegivel: ignora
    }
  }
  return out;
}

export function isAnalysisModelInstalled(id: string): boolean {
  return installedAnalysisModels().some((model) => model.id === id);
}

/**
 * Modelo que a proxima analise vai usar: o escolhido quando esta baixado, senao
 * o primeiro instalado. Null quando nao ha nenhum — o chamador diz o porque em
 * vez de nao fazer nada.
 */
export function resolveAnalysisModel(preferred: string): AnalysisModelInfo | null {
  const installed = installedAnalysisModels().map((model) => model.id);
  const selected = analysisModelById(preferred);
  if (selected && installed.includes(selected.id)) return selected;
  if (installed.length === 0) return null;
  return analysisModelById(installed[0]) ?? null;
}

export function installedAnalysisModelsBytes(): number {
  return installedAnalysisModels().reduce((sum, model) => sum + model.bytes, 0);
}

export interface DownloadAnalysisModelOptions {
  onProgress?(ratio: number): void;
  signal?: AbortSignal;
}

function availableDiskSpace(): number | null {
  try {
    return Paths.availableDiskSpace;
  } catch {
    return null;
  }
}

/**
 * Baixa um modelo de analise e devolve o caminho local. Se ja existir, nao
 * reescreve. O tamanho e conferido depois do download; arquivo incompleto e
 * apagado para nao ser usado por engano.
 */
export async function downloadAnalysisModel(
  id: string,
  options: DownloadAnalysisModelOptions = {},
): Promise<string> {
  const info = analysisModelById(id);
  if (!info) throw new Error('modelo desconhecido');
  if (!localModels()) throw new Error('modelo local nao existe no navegador');

  const destination = new File(analysisModelsDirectory(), info.fileName);
  if (destination.exists && destination.size === info.sizeBytes) return destination.uri;
  if (destination.exists) destination.delete();

  const free = availableDiskSpace();
  if (free !== null && free > 0 && free < info.sizeBytes * 1.2) {
    throw new Error('espaco insuficiente');
  }

  const activity = `download:analysis:${id}`;
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', forwardAbort);
  startActivity({
    id: activity,
    kind: 'download',
    title: `Modelo ${info.label}`,
    detail: 'Baixando modelo de análise',
    progress: 0,
    action: { label: 'Tentar de novo', run: () => downloadAnalysisModel(id) },
    stop: { label: 'Parar', run: () => controller.abort() },
  });

  try {
    const file = await File.downloadFileAsync(analysisModelUrl(info), destination, {
      idempotent: true,
      signal: controller.signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        if (totalBytes <= 0) return;
        const ratio = Math.min(1, bytesWritten / totalBytes);
        options.onProgress?.(ratio);
        updateActivity(activity, { progress: ratio * 100 });
      },
    });

    if (file.size !== info.sizeBytes) {
      if (file.exists) file.delete();
      throw new Error('modelo incompleto');
    }
    finishActivity(activity, 'Modelo de análise pronto');
    return file.uri;
  } catch (error) {
    if (controller.signal.aborted) cancelActivity(activity, 'Download interrompido');
    else failActivity(activity, 'Não foi possível baixar o modelo');
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}

export function deleteAnalysisModel(id: string): void {
  const info: AnalysisModelInfo | undefined = analysisModelById(id);
  if (!info || !localModels()) return;
  const file = new File(analysisModelsDirectory(), info.fileName);
  if (file.exists) file.delete();
}
