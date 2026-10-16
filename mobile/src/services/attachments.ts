/**
 * Anexos (imagens) local-first.
 *
 * A imagem vive no aparelho desde a captura e so sobe quando o sync roda. Para
 * exibir no editor usamos o proprio arquivo local (`file://`), nunca um data URI
 * base64: o WebView le o arquivo nativamente e o guarda em cache, entao abrir a
 * nota nao depende de rede nem de recomprimir bytes na thread de JS.
 *
 * Depois que uma imagem sobe, guardamos uma copia em `attachments/<id>.<ext>` no
 * cache. Assim notas ja sincronizadas continuam abrindo pelo arquivo local em
 * vez de baixar do servidor de novo.
 */

import { Directory, File, FileMode, Paths } from 'expo-file-system';

import { DyariumApi, type FetchLike } from '@/core/api';
import {
  ATTACHMENT_PREFIX,
  attachmentIdFromUrl,
  attachmentRefId,
  isLocalAttachment,
  localAttachmentName,
  mimeFromName,
  resolveLocalAttachmentRefs,
  type AttachmentResolution,
} from '@/core/attachments';
import { newId } from '@/core/id';
import { extractImageUrls } from '@/core/richText';

import { sessionDirectory } from './files';
import { loadServerConfig } from './secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

function extensionOf(mime: string): string {
  const ext = mime.split('/')[1]?.split(';')[0]?.trim().toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext || 'jpg';
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

/** URI `file://` da imagem local, ou null quando o arquivo nao existe mais. */
export function localImageUri(noteId: string, name: string): string | null {
  try {
    const file = new File(sessionDirectory(noteId), name);
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

/** Diretorio de cache dos anexos do servidor. */
const CACHE_DIR = 'attachments';

function attachmentsDir(): Directory {
  const dir = new Directory(Paths.cache, CACHE_DIR);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Copia a imagem local para o cache do anexo (por id), para exibir sem baixar. */
async function cacheLocalCopy(noteId: string, name: string, id: string): Promise<void> {
  try {
    const dir = attachmentsDir();
    const extension = name.split('.').pop()?.toLowerCase() || 'jpg';
    const destination = new File(dir, `${id}.${extension}`);
    if (destination.exists) return;
    const source = new File(sessionDirectory(noteId), name);
    if (!source.exists) return;
    await source.copy(destination);
  } catch {
    // cache best-effort: sem ele a exibicao cai no arquivo local ou no download
  }
}

/** Arquivo de cache ja existente para um anexo, ou null. */
export function cachedAttachmentUri(id: string): string | null {
  try {
    const cached = attachmentsDir()
      .list()
      .find((entry) => entry.name.startsWith(`${id}.`));
    return cached ? cached.uri : null;
  } catch {
    return null;
  }
}

/** Baixa o anexo do servidor para o cache e devolve a URI local. */
async function downloadAttachment(id: string): Promise<string | null> {
  const config = await loadServerConfig();
  if (!config) return null;
  try {
    const url = `${config.baseUrl.replace(/\/+$/, '')}/api/v1/attachments/${id}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${config.token}` } });
    if (!res.ok) return null;
    const type = res.headers.get('Content-Type') ?? 'image/jpeg';
    const bytes = new Uint8Array(await res.arrayBuffer());

    const dir = attachmentsDir();
    const file = new File(dir, `${id}.${extensionOf(type)}`);
    if (!file.exists) file.create({ intermediates: true, overwrite: true });
    const handle = file.open(FileMode.Append);
    try {
      handle.writeBytes(bytes);
    } finally {
      handle.close();
    }
    return file.uri;
  } catch {
    return null;
  }
}

/** URI local de um anexo do servidor: usa o cache e, se faltar, baixa uma vez. */
export async function attachmentUri(id: string): Promise<string | null> {
  return cachedAttachmentUri(id) ?? downloadAttachment(id);
}

/** Sobe a imagem local e devolve o id do anexo no servidor. */
export async function uploadLocalImage(entryId: string, noteId: string, name: string): Promise<string> {
  const config = await loadServerConfig();
  if (!config) throw new Error('sem servidor configurado');
  const api = new DyariumApi(config, doFetch);
  const bytes = await readLocalImage(noteId, name);
  const attachment = await api.uploadAttachment(entryId, bytes, mimeFromName(name));
  // Deixa a copia local acessivel por id, para exibir sem baixar depois.
  await cacheLocalCopy(noteId, name, attachment.id);
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
  known: Record<string, string> = {},
): Promise<AttachmentResolution> {
  if (!entryId) return { markdown, attachments: { ...known } };
  return resolveLocalAttachmentRefs(markdown, known, (name) =>
    uploadLocalImage(entryId, noteId, name),
  );
}

/**
 * Mapa referencia -> fonte de exibicao (`file://`) para as imagens do markdown:
 * `local:` sai da pasta da nota; `attachment:<id>` (ou URL de anexo) sai do
 * cache local e so baixa do servidor quando ainda nao existe no aparelho.
 */
export async function resolveImageSources(
  noteId: string,
  markdown: string,
  attachments: Record<string, string> = {},
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  await Promise.all(
    extractImageUrls(markdown).map(async (ref) => {
      let uri: string | null = null;
      if (isLocalAttachment(ref)) {
        const name = localAttachmentName(ref);
        uri = localImageUri(noteId, name);
        // Arquivo local sumiu (ex.: liberou espaco): usa o anexo ja subido.
        if (!uri && attachments[name]) uri = await attachmentUri(attachments[name]);
      } else if (ref.startsWith(ATTACHMENT_PREFIX)) {
        uri = await attachmentUri(attachmentRefId(ref));
      } else {
        const id = attachmentIdFromUrl(ref);
        if (id) uri = await attachmentUri(id);
      }
      if (uri) map[ref] = uri;
    }),
  );
  return map;
}
