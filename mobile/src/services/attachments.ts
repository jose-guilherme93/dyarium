/**
 * Anexos local-first: a imagem e salva na pasta da nota e referenciada no
 * markdown como `att:<arquivo>`. Quando houver servidor e a nota tiver entrada,
 * o upload acontece e a referencia vira a URL do servidor (no sync).
 */

import { Directory, File, FileMode, Paths } from 'expo-file-system';

import { DyariumApi, type FetchLike } from '@/core/api';
import { bytesToBase64 } from '@/core/base64';
import { extractImageUrls } from '@/core/richText';
import { newId } from '@/core/id';

import { sessionDirectory } from './files';
import { loadServerConfig } from './secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

const LOCAL_PREFIX = 'att:';

export function isLocalAttachment(url: string): boolean {
  return url.startsWith(LOCAL_PREFIX);
}

export function localAttachmentName(url: string): string {
  return url.slice(LOCAL_PREFIX.length);
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

/**
 * Sobe a imagem local e devolve a URL do servidor. Requer a entrada ja existir.
 */
export async function uploadLocalImage(entryId: string, noteId: string, name: string): Promise<string> {
  const config = await loadServerConfig();
  if (!config) throw new Error('sem servidor configurado');
  const api = new DyariumApi(config, doFetch);
  const bytes = await readLocalImage(noteId, name);
  const attachment = await api.uploadAttachment(entryId, bytes, mimeFromName(name));
  const base = config.baseUrl.replace(/\/+$/, '');
  return `${base}/api/v1/attachments/${attachment.id}`;
}

/**
 * Substitui as referencias locais (`att:...`) pelas URLs do servidor, subindo o
 * que faltar. Referencias que falharem permanecem locais para tentar de novo.
 */
export async function resolveLocalAttachments(
  entryId: string | undefined,
  noteId: string,
  markdown: string,
): Promise<string> {
  if (!entryId || !markdown.includes(LOCAL_PREFIX)) return markdown;
  const matches = [...markdown.matchAll(/!\[([^\]]*)\]\(att:([^)\s]+)\)/g)];
  let out = markdown;
  for (const match of matches) {
    const [full, alt, name] = match;
    try {
      const url = await uploadLocalImage(entryId, noteId, name);
      out = out.replace(full, `![${alt}](${url})`);
    } catch {
      // sem rede: mantem local e tenta no proximo sync
    }
  }
  return out;
}

/** Le a imagem local como data URI (para exibir no editor). */
export async function localImageDataUri(noteId: string, name: string): Promise<string | null> {
  try {
    const bytes = await readLocalImage(noteId, name);
    return `data:${mimeFromName(name)};base64,${bytesToBase64(bytes)}`;
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

function attachmentIdFromUrl(url: string): string | null {
  const match = /\/api\/v1\/attachments\/([^/?#]+)/.exec(url);
  return match ? match[1] : null;
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

// Cache em memoria da sessao, alem do cache em disco.
const memoryCache = new Map<string, string>();

/** Anexo do servidor como data URI, usando cache em disco (baixa so uma vez). */
export async function attachmentDataUri(url: string): Promise<string | null> {
  const inMemory = memoryCache.get(url);
  if (inMemory) return inMemory;

  const id = attachmentIdFromUrl(url);
  if (!id) return null;

  const dir = cacheDir();
  const cached = dir.list().find((entry) => entry.name.startsWith(`${id}.`));
  if (cached) {
    try {
      const ext = cached.name.split('.').pop() ?? 'jpg';
      const buffer = await new File(cached.uri).arrayBuffer();
      const dataUri = toDataUri(mimeForExt(ext), new Uint8Array(buffer));
      memoryCache.set(url, dataUri);
      return dataUri;
    } catch {
      // cache corrompido: cai para o download
    }
  }

  const config = await loadServerConfig();
  if (!config) return null;
  try {
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
    memoryCache.set(url, dataUri);
    return dataUri;
  } catch {
    return null;
  }
}

/**
 * Monta o mapa URL original -> fonte de exibicao para as imagens do markdown:
 * `att:` vira data URI do arquivo local; anexo do servidor e baixado com o token.
 */
export async function resolveImageSources(
  noteId: string,
  markdown: string,
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const url of extractImageUrls(markdown)) {
    if (isLocalAttachment(url)) {
      const dataUri = await localImageDataUri(noteId, localAttachmentName(url));
      if (dataUri) map[url] = dataUri;
    } else if (/^https?:\/\//i.test(url) && url.includes('/attachments/')) {
      const dataUri = await attachmentDataUri(url);
      if (dataUri) map[url] = dataUri;
    }
  }
  return map;
}
