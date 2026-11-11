/**
 * Entrada de audio compartilhado por outros apps (Android). Le os payloads
 * resolvidos do expo-sharing, copia os arquivos suportados para o storage do
 * app e devolve rascunhos para a tela de revisao. Nada e persistido nem
 * enfileirado aqui: a revisao confirma antes de ir para a fila.
 */

import { clearSharedPayloads, getResolvedSharedPayloadsAsync } from 'expo-sharing';

import { newId } from '@/core/id';
import {
  MAX_SHARED_FILES,
  analyzeShareAudio,
  buildShareFileName,
  normalizeSharedUri,
  type ImportDraft,
  type ShareAudioPayload,
} from '@/core/import';

import { copySharedAudio, fileModifiedMs, sessionDirUri } from './files';

export interface PreparedShare {
  drafts: ImportDraft[];
  /** Quantos audios vieram alem do limite e foram ignorados. */
  ignored: number;
}

export interface PrepareSharedAudiosOptions {
  /** Progresso incremental: (copiados, total, nomeAtual). */
  onProgress?: (copied: number, total: number, currentName: string) => void;
  /** Rascunho disponivel assim que copiado (para nao bloquear a tela). */
  onDraft?: (draft: ImportDraft) => void;
  /** Teto local em bytes (padrao: 1 GiB ou min(1 GiB, servidor)). */
  maxBytes?: number;
  /** Limite do servidor conhecido pelo app, se houver. */
  maxUploadBytes?: number;
  serverMaxUploadBytes?: number;
}

/** Um gibibyte: teto local padrao de compartilhamento. */
export const MAX_SHARED_BYTES = 1 << 30;

/** Menor entre 1 GiB e o limite do servidor conhecido (quando houver). */
export function sharedByteLimit(serverMax?: number | null): number {
  if (typeof serverMax === 'number' && Number.isFinite(serverMax) && serverMax > 0) {
    return Math.min(MAX_SHARED_BYTES, serverMax);
  }
  return MAX_SHARED_BYTES;
}

function safeSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

function toPayload(payload: {
  contentUri: string | null;
  contentMimeType: string | null;
  originalName: string | null;
  contentSize: number | null;
}): ShareAudioPayload | null {
  if (!payload.contentUri) return null;
  return {
    uri: normalizeSharedUri(payload.contentUri),
    mimeType: payload.contentMimeType,
    name: payload.originalName,
    size: payload.contentSize,
  };
}

/**
 * Le os audios compartilhados, limita a MAX_SHARED_FILES e monta os rascunhos.
 * Os payloads sao consumidos no fim para nao reabrir a revisao a cada montagem.
 */
export async function prepareSharedAudios(
  now: Date = new Date(),
  options: PrepareSharedAudiosOptions = {},
): Promise<PreparedShare> {
  const onProgress = options.onProgress;
  const onDraft = options.onDraft;

  const resolved = await getResolvedSharedPayloadsAsync();
  const audios = resolved
    .filter((payload) => payload.contentType === 'audio')
    .map(toPayload)
    .filter((payload): payload is ShareAudioPayload => payload !== null);

  const selected = audios.slice(0, MAX_SHARED_FILES);
  const ignored = Math.max(0, audios.length - selected.length);

  const cap =
    typeof options.maxBytes === 'number' && Number.isFinite(options.maxBytes) && options.maxBytes > 0
      ? options.maxBytes
      : sharedByteLimit(options.maxUploadBytes ?? options.serverMaxUploadBytes);

  // Valida o teto de bytes ANTES de copiar qualquer coisa.
  for (const payload of selected) {
    const size = safeSize(payload.size);
    if (size > cap) {
      const name = payload.name || payload.uri || 'audio';
      throw new Error(`Arquivo muito grande: ${name} (${size} bytes). Limite ${cap} bytes.`);
    }
  }
  const totalBytes = selected.reduce((sum, payload) => sum + safeSize(payload.size), 0);
  if (totalBytes > cap) {
    throw new Error(
      `Compartilhamento muito grande: ${totalBytes} bytes. Limite ${cap} bytes.`,
    );
  }

  const drafts: ImportDraft[] = [];
  const total = selected.length;
  let copied = 0;
  for (const payload of selected) {
    const currentName = payload.name || payload.uri || 'audio';
    const key = newId('imp_');
    const analysis = analyzeShareAudio(payload, {
      now,
      lastModifiedMs: fileModifiedMs(payload.uri),
    });
    const draft: ImportDraft = {
      key,
      title: analysis.title,
      recordedAt: analysis.recordedAt,
      originalName: analysis.originalName,
      supported: analysis.supported,
      reason: analysis.reason,
      contentType: analysis.contentType,
      extension: analysis.extension,
      date: analysis.date,
      fallbackMs: analysis.fallbackMs,
    };

    if (analysis.supported && analysis.extension) {
      try {
        const id = newId('rec_');
        const dir = sessionDirUri(id);
        const copiedFile = await copySharedAudio(payload.uri, id, analysis.extension);
        if (copiedFile.size > 0) {
          draft.id = id;
          draft.dir = dir;
          draft.filePath = copiedFile.uri;
          draft.sizeBytes = copiedFile.size;
          draft.fileName = buildShareFileName(analysis.title, analysis.extension);
        } else {
          draft.supported = false;
          draft.reason = 'Não foi possível ler o áudio.';
        }
      } catch {
        if (__DEV__) console.warn('[dyarium] falha ao copiar o audio compartilhado');
        draft.supported = false;
        draft.reason = 'Não foi possível copiar o áudio.';
      }
    }

    drafts.push(draft);
    copied += 1;
    onDraft?.(draft);
    // Progresso incremental; callback que lancar nao aborta a copia nem vaza erro.
    try {
      onProgress?.(copied, total, currentName);
    } catch {
      // ignora: progresso e best-effort
    }
  }

  clearSharedPayloads();
  return { drafts, ignored };
}