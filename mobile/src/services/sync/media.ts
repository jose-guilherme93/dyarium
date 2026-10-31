/**
 * Ponte de midia entre ambientes.
 *
 * O corpo da nota referencia `attachment:<id>`, e o id e do criador: o mesmo
 * anexo tem o mesmo id em qualquer ambiente. O que falta e o byte. Quando um
 * ambiente nao tem o objeto, o app baixa decifrado daquele que tem e sobe para
 * o destino com o mesmo id, sem reescrever o corpo.
 *
 * Nada aqui depende de um servidor especifico: a busca tenta todos os
 * ambientes conectados.
 */

import { Directory, File, FileMode, Paths } from 'expo-file-system';

import { DyariumApi } from '@/core/api';
import { uploadRecording } from '@/core/uploader';
import type { Recording } from '@/core/types';

import { cachedAttachmentUri, invalidateAttachmentIndex } from '@/services/attachments';
import { uploadFileIO } from '@/services/files';
import { loadServers } from '@/services/secure';

const REF = /attachment:([A-Za-z0-9_-]+)/g;

export interface MediaBytes {
  bytes: Uint8Array;
  contentType: string;
}

/** Ids de anexo referenciados no corpo, na ordem em que aparecem. */
export function bodyAttachmentIds(markdown: string): string[] {
  const out: string[] = [];
  for (const match of markdown.matchAll(REF)) {
    const id = match[1];
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function isAudioRef(markdown: string, id: string): boolean {
  // `!audio[attachment:<id>]` e audio; `![...](attachment:<id>)` e imagem.
  return new RegExp(`!audio\\[attachment:${id}\\]`).test(markdown);
}

/** Bytes locais ja em cache (imagem exibida ou audio baixado antes). */
async function localBytes(id: string): Promise<MediaBytes | null> {
  const uri = cachedAttachmentUri(id);
  if (!uri) return null;
  try {
    const file = new File(uri);
    const buffer = await file.arrayBuffer();
    const extension = uri.split('.').pop()?.toLowerCase() ?? '';
    return {
      bytes: new Uint8Array(buffer),
      contentType: mimeFromExtension(extension),
    };
  } catch {
    return null;
  }
}

/**
 * Baixa o anexo decifrado de qualquer ambiente que o tenha. Tenta o primeiro
 * da lista (primario) e depois os demais; devolve null quando nenhum tem.
 */
export async function downloadAttachment(id: string): Promise<MediaBytes | null> {
  const local = await localBytes(id);
  if (local) return local;
  const servers = await loadServers();
  for (const server of servers) {
    try {
      const url = `${server.baseUrl.replace(/\/+$/, '')}/api/v1/attachments/${id}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${server.token}` },
      });
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const contentType = res.headers.get('Content-Type') ?? 'application/octet-stream';
      cacheBytes(id, bytes, contentType);
      return { bytes, contentType };
    } catch {
      // ambiente indisponivel: tenta o proximo
    }
  }
  return null;
}

/** Grava uma copia no cache por id, para a proxima exibicao nao baixar de novo. */
function cacheBytes(id: string, bytes: Uint8Array, contentType: string): void {
  try {
    const dir = new Directory(Paths.cache, 'attachments');
    if (!dir.exists) dir.create({ intermediates: true });
    const file = new File(dir, `${id}.${extensionOf(contentType)}`);
    if (file.exists) return;
    file.create({ intermediates: true, overwrite: true });
    const handle = file.open(FileMode.Append);
    try {
      handle.writeBytes(bytes);
    } finally {
      handle.close();
    }
    invalidateAttachmentIndex();
  } catch {
    // cache e otimizacao; sem ele o proximo uso baixa de novo
  }
}

function extensionOf(contentType: string): string {
  const ext = contentType.split('/')[1]?.split(';')[0]?.trim().toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext || 'bin';
}

function mimeFromExtension(extension: string): string {
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
    case 'mp4':
      return 'audio/mp4';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
    case 'aac':
    case 'adts':
      return 'audio/aac';
    case 'flac':
      return 'audio/flac';
    case 'webm':
      return 'audio/webm';
    default:
      return 'application/octet-stream';
  }
}

function tempAudioFile(id: string, extension: string, bytes: Uint8Array): string {
  const file = new File(Paths.cache, `sync-${id}.${extension}`);
  if (file.exists) file.delete();
  file.create({ intermediates: true, overwrite: true });
  const handle = file.open(FileMode.Append);
  try {
    handle.writeBytes(bytes);
  } finally {
    handle.close();
  }
  return file.uri;
}

/**
 * Garante que o ambiente de destino tem todos os anexos que o corpo referencia.
 * Imagem sobe pelo endpoint de imagem; audio adicional usa o upload resumivel,
 * sempre com o id original. O audio principal da nota e tratado pelo upload da
 * propria entrada.
 */
export async function ensureBodyAttachments(
  api: DyariumApi,
  recording: Recording,
  entryId: string,
  existing: Set<string>,
): Promise<void> {
  // O audio principal pode nao estar no corpo (e o conteudo da entrada). Se o
  // destino nao tem o objeto, a ponte sobe com o mesmo id antes do texto.
  const primary = recording.serverAttachmentId;
  if (primary && !existing.has(primary)) {
    if (await uploadAudioFromPeer(api, recording, entryId, primary)) {
      existing.add(primary);
    }
  }

  const markdown = recording.text ?? '';
  for (const id of bodyAttachmentIds(markdown)) {
    if (existing.has(id)) continue;
    const media = await downloadAttachment(id);
    if (!media) continue;
    if (isAudioRef(markdown, id)) {
      const extension = extensionOf(media.contentType);
      const path = tempAudioFile(id, extension, media.bytes);
      try {
        await uploadRecording(
          {
            clientKey: `${recording.id}:${id}`,
            filename: `audio.${extension}`,
            contentType: media.contentType,
            title: recording.title,
            recordedAt: recording.recordedAt,
            createdAt: recording.createdAt,
            localPath: path,
            sizeBytes: media.bytes.length,
            entryId,
            attachmentId: id,
          },
          { api, file: uploadFileIO },
        );
      } finally {
        deleteTemp(path);
      }
    } else {
      await api.uploadAttachment(entryId, media.bytes, media.contentType, id);
    }
    existing.add(id);
  }
}

/** Sobe um audio que so existe em outro ambiente, com o mesmo entry/anexo. */
export async function uploadAudioFromPeer(
  api: DyariumApi,
  recording: Recording,
  entryId: string,
  attachmentId: string,
): Promise<boolean> {
  const media = await downloadAttachment(attachmentId);
  if (!media) return false;
  const extension = extensionOf(media.contentType);
  const path = tempAudioFile(attachmentId, extension, media.bytes);
  try {
    await uploadRecording(
      {
        clientKey: recording.id,
        filename: recording.fileName ?? `audio.${extension}`,
        contentType: media.contentType,
        title: recording.title,
        recordedAt: recording.recordedAt,
        createdAt: recording.createdAt,
        source: recording.source === 'share' ? 'share' : 'upload',
        localPath: path,
        sizeBytes: media.bytes.length,
        durationSeconds: recording.durationMs
          ? Math.max(1, Math.round(recording.durationMs / 1000))
          : undefined,
        entryId,
        attachmentId,
        author: recording.author ?? '',
      },
      { api, file: uploadFileIO },
    );
  } finally {
    deleteTemp(path);
  }
  return true;
}

function deleteTemp(path: string): void {
  try {
    const file = new File(path);
    if (file.exists) file.delete();
  } catch {
    // cache temporario: o sistema limpa depois
  }
}
