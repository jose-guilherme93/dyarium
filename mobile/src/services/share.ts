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
  type ImportDraft,
  type ShareAudioPayload,
} from '@/core/import';

import { copySharedAudio, fileModifiedMs, sessionDirUri } from './files';

export interface PreparedShare {
  drafts: ImportDraft[];
  /** Quantos audios vieram alem do limite e foram ignorados. */
  ignored: number;
}

function toPayload(payload: {
  contentUri: string | null;
  contentMimeType: string | null;
  originalName: string | null;
  contentSize: number | null;
}): ShareAudioPayload | null {
  if (!payload.contentUri) return null;
  return {
    uri: payload.contentUri,
    mimeType: payload.contentMimeType,
    name: payload.originalName,
    size: payload.contentSize,
  };
}

/**
 * Le os audios compartilhados, limita a MAX_SHARED_FILES e monta os rascunhos.
 * Os payloads sao consumidos no fim para nao reabrir a revisao a cada montagem.
 */
export async function prepareSharedAudios(now = new Date()): Promise<PreparedShare> {
  const resolved = await getResolvedSharedPayloadsAsync();
  const audios = resolved
    .filter((payload) => payload.contentType === 'audio')
    .map(toPayload)
    .filter((payload): payload is ShareAudioPayload => payload !== null);

  const selected = audios.slice(0, MAX_SHARED_FILES);
  const ignored = Math.max(0, audios.length - selected.length);

  const drafts: ImportDraft[] = [];
  for (const payload of selected) {
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
        const copied = await copySharedAudio(payload.uri, id, analysis.extension);
        if (copied.size > 0) {
          draft.id = id;
          draft.dir = dir;
          draft.filePath = copied.uri;
          draft.sizeBytes = copied.size;
          draft.fileName = buildShareFileName(analysis.title, analysis.extension);
        } else {
          draft.supported = false;
          draft.reason = 'Não foi possível ler o áudio.';
        }
      } catch {
        draft.supported = false;
        draft.reason = 'Não foi possível copiar o áudio.';
      }
    }

    drafts.push(draft);
  }

  clearSharedPayloads();
  return { drafts, ignored };
}
