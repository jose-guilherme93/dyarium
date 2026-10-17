/**
 * Modelos de analise local no aparelho (arquivos GGUF do llama.cpp).
 * Baixados em runtime para `Paths.document/analysis-models`.
 *
 * O download confere o tamanho exato do catalogo e usa uma revisao fixa do
 * Hugging Face. A conferencia SHA-256 entra na fase de endurecimento, quando o
 * modelo ja estiver validado pelo benchmark.
 */

import { Directory, File, Paths } from 'expo-file-system';

import {
  ANALYSIS_MODELS,
  analysisModelById,
  analysisModelUrl,
  type AnalysisModelInfo,
} from '@/core/analysisModels';

const DIR_NAME = 'analysis-models';

export function analysisModelsDirectory(): Directory {
  const dir = new Directory(Paths.document, DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Caminho `file://` do arquivo de um modelo (exista ou nao). */
export function analysisModelFilePath(id: string): string | null {
  const model = analysisModelById(id);
  if (!model) return null;
  return new File(analysisModelsDirectory(), model.fileName).uri;
}

export interface InstalledAnalysisModel {
  id: string;
  bytes: number;
}

/** Modelos de analise ja baixados no aparelho. */
export function installedAnalysisModels(): InstalledAnalysisModel[] {
  const entries = analysisModelsDirectory().list();
  const out: InstalledAnalysisModel[] = [];
  for (const info of ANALYSIS_MODELS) {
    const entry = entries.find((item) => item.name === info.fileName);
    if (!entry) continue;
    try {
      out.push({ id: info.id, bytes: new File(entry.uri).size });
    } catch {
      // arquivo ilegivel: ignora
    }
  }
  return out;
}

export function isAnalysisModelInstalled(id: string): boolean {
  return installedAnalysisModels().some((model) => model.id === id);
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

  const destination = new File(analysisModelsDirectory(), info.fileName);
  if (destination.exists && destination.size === info.sizeBytes) return destination.uri;
  if (destination.exists) destination.delete();

  const free = availableDiskSpace();
  if (free !== null && free > 0 && free < info.sizeBytes * 1.2) {
    throw new Error('espaco insuficiente');
  }

  const file = await File.downloadFileAsync(analysisModelUrl(info), destination, {
    idempotent: true,
    signal: options.signal,
    onProgress: ({ bytesWritten, totalBytes }) => {
      if (options.onProgress && totalBytes > 0) {
        options.onProgress(Math.min(1, bytesWritten / totalBytes));
      }
    },
  });

  if (file.size !== info.sizeBytes) {
    if (file.exists) file.delete();
    throw new Error('modelo incompleto');
  }
  return file.uri;
}

export function deleteAnalysisModel(id: string): void {
  const info: AnalysisModelInfo | undefined = analysisModelById(id);
  if (!info) return;
  const file = new File(analysisModelsDirectory(), info.fileName);
  if (file.exists) file.delete();
}
