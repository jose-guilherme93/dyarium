/**
 * Anexos (imagens) local-first.
 *
 * A imagem vive no aparelho desde a captura e so sobe quando o sync roda. Para
 * exibir no editor usamos o proprio arquivo local (`file://`), nunca um data URI
 * base64: o componente nativo le o arquivo e o mantem em cache, entao abrir a
 * nota nao depende de rede nem de recomprimir bytes na thread de JS. O audio
 * local segue o mesmo caminho.
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
  localAudioName,
  mimeFromName,
  resolveLocalAttachmentRefs,
  resolveLocalAudioRefs,
  type AttachmentResolution,
} from '@/core/attachments';
import { newId } from '@/core/id';
import { extractImageUrls } from '@/core/richText';
import { uploadRecording } from '@/core/uploader';

import { uploadFileIO, sessionDirectory } from './files';
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
  name = `${newId('img_')}.${extensionOf(mime)}`,
): Promise<string> {
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
    invalidateAttachmentIndex();
  } catch {
    // cache best-effort: sem ele a exibicao cai no arquivo local ou no download
  }
}

// Extensoes que o app grava no cache. A busca e por arquivo direto (poucos
// `exists`), nunca por `Directory.list()`: listar a pasta inteira na thread de
// JS travava a abertura da nota quando o cache crescia.
const ATTACHMENT_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'heic',
  'avif',
  'bmp',
  'aac',
  'adts',
  'm4a',
  'mp3',
  'wav',
  'ogg',
  'flac',
  'webm',
  'mp4',
];
const cachedUris = new Map<string, string>();

export function invalidateAttachmentIndex(): void {
  cachedUris.clear();
}

/** Arquivo de cache ja existente para um anexo, ou null. */
export function cachedAttachmentUri(id: string): string | null {
  const known = cachedUris.get(id);
  if (known) {
    try {
      if (new File(known).exists) return known;
    } catch {
      // arquivo sumiu/ilegivel: procura de novo abaixo
    }
    cachedUris.delete(id);
  }

  const dir = attachmentsDir();
  for (const extension of ATTACHMENT_EXTENSIONS) {
    try {
      const file = new File(dir, `${id}.${extension}`);
      if (!file.exists) continue;
      cachedUris.set(id, file.uri);
      return file.uri;
    } catch {
      // extensao ilegivel: tenta a proxima
    }
  }
  return null;
}

/** Baixa o anexo do servidor para o cache e devolve a URI local. */
async function downloadAttachment(id: string): Promise<string | null> {
  const config = await loadServerConfig();
  if (!config) return null;
  try {
    const url = `${config.baseUrl.replace(/\/+$/, '')}/api/v1/attachments/${id}`;
    // Sem teto, uma conexao pendurada prendia a imagem para sempre (e o editor
    // ficava sem ela). 15 s e suficiente para uma foto.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${config.token}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
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
    invalidateAttachmentIndex();
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
  if (!entryId) return { markdown, attachments: { ...known }, pending: [] };
  return resolveLocalAttachmentRefs(markdown, known, (name) =>
    uploadLocalImage(entryId, noteId, name),
  );
}

/** URI `file://` de um audio local da nota, ou null quando o arquivo sumiu. */
export function localAudioUri(noteId: string, name: string): string | null {
  try {
    const file = new File(sessionDirectory(noteId), name);
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

/** Content-Type de um audio pela extensao do arquivo. */
export function audioMimeFromName(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'm4a':
    case 'mp4':
      return 'audio/mp4';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
    case 'flac':
      return 'audio/flac';
    case 'webm':
      return 'audio/webm';
    case 'adts':
      return 'audio/aac';
    default:
      return 'audio/aac';
  }
}

/**
 * Sobe um audio que ainda esta `local:` para anexar a uma entrada existente.
 * Usa o mesmo upload resumivel do audio da nota, com `entry_id`: o servidor
 * adiciona o audio a entrada em vez de criar outra.
 */
export async function uploadLocalAudio(
  entryId: string,
  noteId: string,
  name: string,
  durationMs: number,
): Promise<string> {
  const config = await loadServerConfig();
  if (!config) throw new Error('sem servidor configurado');
  const uri = localAudioUri(noteId, name);
  if (!uri) throw new Error('arquivo de audio local indisponivel');
  const api = new DyariumApi(config, doFetch);
  const now = new Date().toISOString();
  const sizeBytes = new File(uri).size;
  const result = await uploadRecording(
    {
      clientKey: `audio:${noteId}:${name}`,
      filename: name,
      contentType: audioMimeFromName(name),
      title: name,
      recordedAt: now,
      createdAt: now,
      localPath: uri,
      sizeBytes,
      durationSeconds: durationMs > 0 ? durationMs / 1000 : undefined,
      entryId,
    },
    { api, file: uploadFileIO },
  );
  if (!result.attachmentId) throw new Error('servidor nao devolveu o anexo do audio');
  return result.attachmentId;
}

/**
 * Troca os audios locais do documento por anexos do servidor. O mapa `known`
 * (nome -> id) evita reenviar o mesmo audio a cada edicao da nota.
 */
export async function resolveLocalAudioAttachments(
  entryId: string | undefined,
  noteId: string,
  markdown: string,
  known: Record<string, string> = {},
): Promise<AttachmentResolution> {
  if (!entryId) return { markdown, attachments: { ...known }, pending: [] };
  return resolveLocalAudioRefs(markdown, known, (name, durationMs) =>
    uploadLocalAudio(entryId, noteId, name, durationMs),
  );
}

/**
 * Mapa referencia -> fonte de exibicao apenas com o que ja esta no aparelho.
 * Nao toca na rede: o editor pode montar imediatamente e as imagens que faltam
 * entram depois, sem segurar a nota no preview de texto.
 */
export function resolveImageSourcesLocal(
  noteId: string,
  markdown: string,
  attachments: Record<string, string> = {},
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const ref of extractImageUrls(markdown)) {
    let uri: string | null = null;
    if (isLocalAttachment(ref)) {
      const name = localAttachmentName(ref);
      uri = localImageUri(noteId, name);
      // Arquivo local sumiu (ex.: liberou espaco): usa o anexo ja subido.
      if (!uri && attachments[name]) uri = cachedAttachmentUri(attachments[name]);
    } else if (ref.startsWith(ATTACHMENT_PREFIX)) {
      uri = cachedAttachmentUri(attachmentRefId(ref));
    } else {
      const id = attachmentIdFromUrl(ref);
      if (id) uri = cachedAttachmentUri(id);
    }
    if (uri) map[ref] = uri;
  }
  return map;
}

/**
 * Fonte exibivel de um audio do documento: arquivo local da nota ou anexo do
 * servidor (cache local e, se faltar, download). Devolve null quando o audio
 * nao esta disponivel.
 */
export async function resolveAudioSource(
  noteId: string,
  ref: string,
  attachments: Record<string, string> = {},
): Promise<string | null> {
  const local = localAudioName(ref);
  if (local) {
    const uri = localAudioUri(noteId, local);
    if (uri) return uri;
    const uploaded = attachments[local];
    return uploaded ? attachmentUri(uploaded) : null;
  }
  if (ref.startsWith(ATTACHMENT_PREFIX)) {
    const id = attachmentRefId(ref);
    // Anexo que veio deste aparelho: o arquivo local ainda e a fonte mais
    // barata, mesmo depois de o marcador virar `attachment:<id>`.
    for (const [name, known] of Object.entries(attachments)) {
      if (known !== id) continue;
      const local = localAudioUri(noteId, name);
      if (local) return local;
    }
    return attachmentUri(id);
  }
  const id = attachmentIdFromUrl(ref);
  return id ? attachmentUri(id) : null;
}

/**
 * Baixa em segundo plano as imagens que ainda nao estao no aparelho e avisa o
 * chamador a cada uma que chega, para o editor trocar o placeholder na hora.
 */
export async function downloadMissingImageSources(
  noteId: string,
  markdown: string,
  attachments: Record<string, string>,
  onFound: (ref: string, uri: string) => void,
): Promise<void> {
  const wanted = new Map<string, string[]>(); // attachment id -> refs
  for (const ref of extractImageUrls(markdown)) {
    let id: string | null = null;
    if (isLocalAttachment(ref)) {
      const name = localAttachmentName(ref);
      if (localImageUri(noteId, name)) continue;
      id = attachments[name] ?? null;
    } else if (ref.startsWith(ATTACHMENT_PREFIX)) {
      id = attachmentRefId(ref);
    } else {
      id = attachmentIdFromUrl(ref) ?? null;
    }
    if (!id || cachedAttachmentUri(id)) continue;
    const refs = wanted.get(id) ?? [];
    refs.push(ref);
    wanted.set(id, refs);
  }
  await Promise.all(
    [...wanted.entries()].map(async ([id, refs]) => {
      const uri = await attachmentUri(id);
      if (!uri) return;
      for (const ref of refs) onFound(ref, uri);
    }),
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
  const map = resolveImageSourcesLocal(noteId, markdown, attachments);
  await downloadMissingImageSources(noteId, markdown, attachments, (ref, uri) => {
    map[ref] = uri;
  });
  return map;
}
