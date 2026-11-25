/**
 * Manifest do cofre v4 (o que o web grava ao lado dos `.enc`).
 *
 * O app usa o manifest para saber quais anexos existem, a que nota pertencem e
 * qual pasta de livro/projeto corresponde a qual caderno. O manifest e claro
 * (sem chave), entao todo campo e tratado como entrada nao confiavel: caminho,
 * id, tamanho e tipo passam por validacao antes de virar download.
 */

export const MANIFEST_VERSION = 4;
export const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
export const MAX_FILES = 200_000;
export const MAX_FILE_BYTES = 300 * 1024 * 1024;
export const MAX_PATH = 512;
export const MAX_FOLDER_NAME = 120;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA = /^[0-9a-fA-F]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const utf8 = new TextEncoder();

const AUDIO_TYPES = new Set([
  'audio/aac',
  'audio/adts',
  'audio/flac',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/x-wav',
]);

const IMAGE_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/heic',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export type VaultEntryKind = 'note' | 'chapter' | 'cover' | 'attachment';

export interface VaultFileEntry {
  path: string;
  id: string;
  kind: VaultEntryKind;
  sha256: string;
  size: number;
  updated_at: string;
  entry_id?: string;
  content_type?: string;
}

export interface VaultManifest {
  version: 3 | 4;
  vault_id?: string;
  updated_at: string;
  files: VaultFileEntry[];
}

export type MediaKind = 'audio' | 'image';

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestError';
  }
}

function bad(message = 'manifest do cofre invalido'): never {
  throw new ManifestError(message);
}

function safeId(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value) || value.includes('..')) bad();
  return value;
}

function safeDate(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) bad();
  if (!Number.isFinite(Date.parse(value))) bad();
  return value;
}

function safePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_PATH ||
    value.startsWith('/') ||
    value.includes('\\') ||
    CONTROL.test(value)
  ) {
    bad();
  }
  const segments = value.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') bad();
  }
  return value;
}

function parseEntry(raw: unknown): VaultFileEntry {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) bad();
  const item = raw as Record<string, unknown>;
  if (typeof item.sha256 !== 'string' || !SHA.test(item.sha256)) bad();
  if (typeof item.size !== 'number' || !Number.isFinite(item.size) || item.size < 0 || item.size > MAX_FILE_BYTES) {
    bad();
  }
  if (item.kind !== 'note' && item.kind !== 'chapter' && item.kind !== 'cover' && item.kind !== 'attachment') {
    bad();
  }
  if (item.entry_id !== undefined) safeId(item.entry_id);
  if (item.content_type !== undefined) {
    if (typeof item.content_type !== 'string' || item.content_type.length > 128 || CONTROL.test(item.content_type)) {
      bad();
    }
  }
  return {
    path: safePath(item.path),
    id: safeId(item.id),
    kind: item.kind,
    sha256: item.sha256,
    size: item.size,
    updated_at: safeDate(item.updated_at),
    ...(item.entry_id !== undefined ? { entry_id: item.entry_id as string } : {}),
    ...(item.content_type !== undefined ? { content_type: item.content_type as string } : {}),
  };
}

/** Le e valida o manifest; v3 e aceito porque cofres antigos nao tem os campos do anexo. */
export function parseVaultManifest(text: string): VaultManifest {
  if (typeof text !== 'string' || utf8.encode(text).length > MAX_MANIFEST_BYTES) bad();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    bad();
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) bad();
  const item = raw as Record<string, unknown>;
  if (item.version !== 3 && item.version !== MANIFEST_VERSION) bad('versao de manifest desconhecida');
  if (!Array.isArray(item.files) || item.files.length > MAX_FILES) bad();
  if (item.vault_id !== undefined) {
    if (typeof item.vault_id !== 'string' || item.vault_id.length > 64 || CONTROL.test(item.vault_id)) bad();
  }
  const seen = new Set<string>();
  const files = item.files.map((file) => {
    const parsed = parseEntry(file);
    if (seen.has(parsed.path)) bad('manifest com caminho repetido');
    seen.add(parsed.path);
    return parsed;
  });
  return {
    version: item.version,
    ...(typeof item.vault_id === 'string' ? { vault_id: item.vault_id } : {}),
    updated_at: safeDate(item.updated_at),
    files,
  };
}

/** Tipo do byte, com o sufixo de parametros removido. */
export function attachmentKind(contentType: string | undefined): MediaKind | null {
  if (!contentType) return null;
  const base = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (AUDIO_TYPES.has(base)) return 'audio';
  if (IMAGE_TYPES.has(base)) return 'image';
  return null;
}

/**
 * Anexos que o app sabe restaurar: v4, com dono, tipo de audio/imagem, dentro
 * de `attachments/` e dentro do teto. Id repetido fica com o primeiro; um
 * arquivo ruim nao impede os outros.
 */
export function restoreAttachments(manifest: VaultManifest): VaultFileEntry[] {
  if (manifest.version < 4) return [];
  const seen = new Set<string>();
  const result: VaultFileEntry[] = [];
  for (const file of manifest.files) {
    if (file.kind !== 'attachment') continue;
    if (!file.path.startsWith('attachments/')) continue;
    if (file.size <= 0) continue;
    if (!file.entry_id) continue;
    if (!attachmentKind(file.content_type)) continue;
    if (seen.has(file.id)) continue;
    seen.add(file.id);
    result.push(file);
  }
  return result;
}

export interface NotebookFolder {
  name: string;
  kind: 'book' | 'mcp';
}

/**
 * Cadernos que aparecem como pasta: `books/<livro>/...` e
 * `projects/<projeto>/...`. O nome do caderno nao viaja em lugar nenhum no
 * cofre v4, entao a pasta e a unica pista; o id vem da nota ou da capa.
 */
export function notebookFolders(
  manifest: VaultManifest,
  noteNotebook: ReadonlyMap<string, string>,
): Map<string, NotebookFolder> {
  const folders = new Map<string, NotebookFolder>();
  for (const file of manifest.files) {
    const segments = file.path.split('/');
    if (segments.length < 3) continue;
    const root = segments[0];
    if (root !== 'books' && root !== 'projects') continue;
    const name = segments[1].trim();
    if (!name || name.length > MAX_FOLDER_NAME || CONTROL.test(name)) continue;
    const notebookId = file.kind === 'cover' ? file.id : noteNotebook.get(file.id);
    if (!notebookId || folders.has(notebookId)) continue;
    folders.set(notebookId, { name, kind: root === 'books' ? 'book' : 'mcp' });
  }
  return folders;
}
