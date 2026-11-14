/**
 * Modelos de transcricao local no aparelho (arquivos ggml do whisper.cpp).
 * Baixados em runtime para `Paths.document/whisper-models`.
 */

import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { TRANSCRIPTION_MODELS, modelById, modelUrl, pickInstalledModel } from '@/core/transcription';
import { cancelActivity, failActivity, finishActivity, startActivity, updateActivity } from './activity';

const DIR_NAME = 'whisper-models';

/**
 * O `expo-file-system` nao existe no navegador: `new Directory(Paths.document)`
 * estoura e derruba a tela que pergunta por modelos. No web nao existe modelo
 * no aparelho, entao a resposta e sempre "nenhum".
 */
function localModels(): boolean {
  return Platform.OS !== 'web';
}

export function modelsDirectory(): Directory {
  const dir = new Directory(Paths.document, DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Caminho `file://` do arquivo de um modelo (exista ou nao). */
export function modelFilePath(id: string): string | null {
  const model = modelById(id);
  if (!model || !localModels()) return null;
  return new File(modelsDirectory(), model.fileName).uri;
}

export interface InstalledModel {
  id: string;
  bytes: number;
}

/** Modelos ja baixados no aparelho. */
export function installedModels(): InstalledModel[] {
  if (!localModels()) return [];
  const entries = modelsDirectory().list();
  const out: InstalledModel[] = [];
  for (const info of TRANSCRIPTION_MODELS) {
    const entry = entries.find((item) => item.name === info.fileName);
    if (!entry) continue;
    try {
      const size = new File(entry.uri).size;
      // O catalogo e aproximado (o arquivo real do whisper.cpp nao tem o mesmo
      // tamanho em bytes): exigir igualdade fazia um modelo baixado nunca
      // contar como instalado. Um parcial obviamente cortado (menos de 90%)
      // fica de fora; download que falha e apagado no proprio catch.
      if (size < info.sizeBytes * 0.9) continue;
      out.push({ id: info.id, bytes: size });
    } catch {
      // arquivo ilegivel: ignora
    }
  }
  return out;
}

export function isModelInstalled(id: string): boolean {
  return installedModels().some((model) => model.id === id);
}

/**
 * Modelo da proxima passada: o escolhido quando esta instalado, senao o
 * primeiro instalado. Nunca devolve um id que nao existe no disco.
 */
export function resolveTranscriptionModel(preferred: string | undefined) {
  return pickInstalledModel(
    preferred,
    installedModels().map((model) => model.id),
  );
}

export function installedModelsBytes(): number {
  return installedModels().reduce((sum, model) => sum + model.bytes, 0);
}

export interface DownloadModelOptions {
  onProgress?(ratio: number): void;
  signal?: AbortSignal;
}

/**
 * Baixa um modelo (se ainda nao existir) e devolve o caminho local. O arquivo
 * fica no diretorio de documentos (nao e apagado pelo sistema).
 */
export async function downloadModel(
  id: string,
  options: DownloadModelOptions = {},
): Promise<string> {
  const info = modelById(id);
  if (!info) throw new Error('modelo desconhecido');
  if (!localModels()) throw new Error('modelo local nao existe no navegador');
  const dir = modelsDirectory();
  const destination = new File(dir, info.fileName);
  if (destination.exists) return destination.uri;

  const activity = `download:transcription:${id}`;
  // O centro de atividade para o download na hora; o arquivo parcial nunca e
  // usado (a integridade e conferida antes de instalar).
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', forwardAbort);
  startActivity({
    id: activity,
    kind: 'download',
    title: `Modelo ${info.label}`,
    detail: 'Baixando modelo de transcrição',
    progress: 0,
    action: { label: 'Tentar de novo', run: () => downloadModel(id) },
    stop: { label: 'Parar', run: () => controller.abort() },
  });

  try {
    const file = await File.downloadFileAsync(modelUrl(info), destination, {
      idempotent: true,
      signal: controller.signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        if (totalBytes <= 0) return;
        const ratio = Math.min(1, bytesWritten / totalBytes);
        options.onProgress?.(ratio);
        updateActivity(activity, { progress: ratio * 100 });
      },
    });
    finishActivity(activity, 'Modelo de transcrição pronto');
    return file.uri;
  } catch (error) {
    if (controller.signal.aborted) cancelActivity(activity, 'Download interrompido');
    else failActivity(activity, 'Não foi possível baixar o modelo');
    // Arquivo parcial nunca fica no diretorio: ele passaria por instalado na
    // proxima abertura e quebraria a transcricao no meio.
    try {
      const partial = new File(dir, info.fileName);
      if (partial.exists) partial.delete();
    } catch {
      // sem permissao para limpar agora: a checagem de tamanho cobre
    }
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}

export function deleteModel(id: string): void {
  const info = modelById(id);
  if (!info || !localModels()) return;
  const file = new File(modelsDirectory(), info.fileName);
  if (file.exists) file.delete();
}
