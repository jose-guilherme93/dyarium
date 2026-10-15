/**
 * Anexos (imagens) local-first.
 *
 * No markdown do app a imagem e referenciada de duas formas:
 * - `local:<arquivo>`: ainda so existe no aparelho;
 * - `attachment:<id>`: ja esta no servidor (bloco `image` com `attachmentId`,
 *   que e como o dashboard guarda a imagem).
 *
 * A resolucao (`local:` -> `attachment:`) acontece no sync; a exibicao converte
 * qualquer uma das referencias num data URI (arquivo local ou anexo baixado).
 */

import { Directory, File, FileMode, Paths } from 'expo-file-system';

import { DyariumApi, type FetchLike } from '@/core/api';
import { bytesToBase64 } from '@/core/base64';
import { extractImageUrls } from '@/core/richText';
import { newId } from '@/core/id';

import { sessionDirectory } from './files';
import { loadServerConfig } from './secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

const LOCAL_PREFIX = 'local:';
const ATTACHMENT_PREFIX = 'attachment:';

export function isLocalAttachment(ref: string): boolean {
  return ref.startsWith(LOCAL_PREFIX);
}

export function localAttachmentName(ref: string): string {
  return ref.slice(LOCAL_PREFIX.length);
}

export function attachmentRefId(ref: string): string {
  return ref.slice(ATTACHMENT_PREFIX.length);
}

export function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'heic':
      return 'image/heic';
    default:
      return 'image/jpeg';
  }
}

function extensionOf(mime: string): string {
  const ext = mime.split('/')[1]?.split(';')[0]?.trim().toLowerCase();
  return ext || 'jpg';
}

function extFor(mime: string): string {
  const ext = mime.split('/')[1]?.split(';')[0]?.trim().toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext || 'jpg';
}

function mimeForExt(ext: string): string {
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
}

function toDataUri(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/** Salva a imagem na pasta da nota e devolve o nome do arquivo. */
export async function saveLocalImage(
  noteId: string,
  bytes: Uint8Array,
  mime: string,
): Promise<string> {
  const name = `${newId('img_')}.${extensionOf(mime)}`;
  const file = new File(sessionDirectory(noteId), name);
  if (!file.exists) file.create({ intermediates: true, overwrite: true });
  const handle = file.open(FileMode.Append);
  try {
    handle.writeBytes(bytes);
  } finally {
    handle.close();
  }
  return name;
}

/** Le a imagem local como bytes (para previa ou upload). */
export async function readLocalImage(noteId: string, name: string): Promise<Uint8Array> {
  const buffer = await new File(sessionDirectory(noteId), name).arrayBuffer();
  return new Uint8Array(buffer);
}

/** Sobe a imagem local e devolve o id do anexo no servidor. */
export async function uploadLocalImage(entryId: string, noteId: string, name: string): Promise<string> {
  const config = await loadServerConfig();
  if (!config) throw new Error('sem servidor configurado');
  const api = new DyariumApi(config, doFetch);
  const bytes = await readLocalImage(noteId, name);
  const attachment = await api.uploadAttachment(entryId, bytes, mimeFromName(name));
  return attachment.id;
}

/**
 * Troca as referencias locais (`local:...`) por `attachment:<id>`, subindo o que
 * faltar. O que falhar permanece local para tentar no proximo sync.
 */
export async function resolveLocalAttachments(
  entryId: string | undefined,
  noteId: string,
  markdown: string,
): Promise<string> {
  if (!entryId || !markdown.includes(LOCAL_PREFIX)) return markdown;
  const matches = [...markdown.matchAll(/!\[([^\]]*)\]\(local:([^)\s]+)\)/g)];
  let out = markdown;
  for (const match of matches) {
    const [full, alt, name] = match;
    try {
      const id = await uploadLocalImage(entryId, noteId, name);
      out = out.replace(full, `![${alt}](${ATTACHMENT_PREFIX}${id})`);
    } catch {
      // sem rede: mantem local e tenta no proximo sync
    }
  }
  return out;
}

/** Le a imagem local como data URI. */
export async function localImageDataUri(noteId: string, name: string): Promise<string | null> {
  try {
    const bytes = await readLocalImage(noteId, name);
    return toDataUri(mimeFromName(name), bytes);
  } catch {
    return null;
  }
}

/** Cache local de anexos do servidor: baixa uma vez, reusa nas proximas aberturas. */
const CACHE_DIR = 'attachments';

function cacheDir(): Directory {
  const dir = new Directory(Paths.cache, CACHE_DIR);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

const memoryCache = new Map<string, string>();

/** Anexo do servidor (por id) como data URI, usando cache em disco. */
export async function attachmentDataUri(id: string): Promise<string | null> {
  const inMemory = memoryCache.get(id);
  if (inMemory) return inMemory;

  const dir = cacheDir();
  const cached = dir.list().find((entry) => entry.name.startsWith(`${id}.`));
  if (cached) {
    try {
      const ext = cached.name.split('.').pop() ?? 'jpg';
      const buffer = await new File(cached.uri).arrayBuffer();
      const dataUri = toDataUri(mimeForExt(ext), new Uint8Array(buffer));
      memoryCache.set(id, dataUri);
      return dataUri;
    } catch {
      // cache corrompido: cai para o download
    }
  }

  const config = await loadServerConfig();
  if (!config) return null;
  try {
    const url = `${config.baseUrl.replace(/\/+$/, '')}/api/v1/attachments/${id}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${config.token}` } });
    if (!res.ok) return null;
    const type = res.headers.get('Content-Type') ?? 'image/jpeg';
    const bytes = new Uint8Array(await res.arrayBuffer());

    const file = new File(dir, `${id}.${extFor(type)}`);
    if (!file.exists) file.create({ intermediates: true, overwrite: true });
    const handle = file.open(FileMode.Append);
    try {
      handle.writeBytes(bytes);
    } finally {
      handle.close();
    }

    const dataUri = toDataUri(type, bytes);
    memoryCache.set(id, dataUri);
    return dataUri;
  } catch {
    return null;
  }
}

/**
 * Mapa referencia -> fonte de exibicao para as imagens do markdown:
 * `local:` vira data URI do arquivo; `attachment:<id>` (ou URL de anexo) e
 * baixado com o token.
 */
export async function resolveImageSources(
  noteId: string,
  markdown: string,
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const ref of extractImageUrls(markdown)) {
    if (isLocalAttachment(ref)) {
      const dataUri = await localImageDataUri(noteId, localAttachmentName(ref));
      if (dataUri) map[ref] = dataUri;
    } else if (ref.startsWith(ATTACHMENT_PREFIX)) {
      const dataUri = await attachmentDataUri(attachmentRefId(ref));
      if (dataUri) map[ref] = dataUri;
    } else {
      const fromUrl = /\/api\/v1\/attachments\/([A-Za-z0-9_-]+)/.exec(ref);
      if (fromUrl) {
        const dataUri = await attachmentDataUri(fromUrl[1]);
        if (dataUri) map[ref] = dataUri;
      }
    }
  }
  return map;
}
