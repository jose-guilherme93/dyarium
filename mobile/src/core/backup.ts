/**
 * Backup local: manifesto + regras puras. O IO (pastas/arquivos) fica no
 * servico; aqui so a estrutura, a ordem e os nomes, para testar de verdade.
 *
 * Layout na pasta escolhida (SAF):
 *   manifest.json                 (a lista, em ordem, com hash de cada arquivo)
 *   <id>__<md5>__<arquivo>        (audio/imagem, um por arquivo)
 *
 * O nome da midia leva o md5 do conteudo: reexecutar o backup nao reescreve o
 * que ja existe, e arquivos antigos (nao referenciados) podem ser apagados sem
 * risco de apagar dado valido. O manifesto e escrito por ultimo, entao um
 * backup interrompido nao invalida o anterior.
 */

import type { Recording } from './types';

export const BACKUP_VERSION = 2;
export const BACKUP_MANIFEST = 'manifest.json';
/** Separador entre partes do nome (ids e nomes originais nao usam `__`). */
export const BACKUP_SEP = '__';

export interface BackupFile {
  /** Nome unico no backup (com id da nota e hash do conteudo). */
  name: string;
  /** Nome original, usado ao restaurar na pasta da nota. */
  originalName: string;
  /** md5 do conteudo, conferido ao restaurar. */
  md5: string;
  size: number;
}

export interface BackupNote {
  /** A nota, sem os caminhos absolutos (refeitos no restore). */
  recording: Recording;
  /** Nome original do audio, quando a nota tem audio. */
  audioFile?: string;
  files: BackupFile[];
}

export interface BackupManifest {
  version: number;
  createdAt: string;
  /** Versao do app que gerou o backup. */
  appVersion?: string;
  /** Notas em ordem cronologica (mais antiga primeiro). */
  notes: BackupNote[];
}

/** Nome de uma midia de backup: `<id>__<md5 de 32 hex>__<nome>`. */
const MEDIA_NAME = /^.+__[0-9a-f]{32}__.+$/;

export function backupMediaName(noteId: string, md5: string, originalName: string): string {
  return `${noteId}${BACKUP_SEP}${md5}${BACKUP_SEP}${originalName}`;
}

/** Reconhece um nome de midia do proprio backup (para limpeza). */
export function isBackupMediaName(name: string): boolean {
  return MEDIA_NAME.test(name);
}

/** Ordem "certa": mais antiga primeiro, como uma linha do tempo. */
export function orderForBackup(recordings: Recording[]): Recording[] {
  return [...recordings].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

/** Reordena as notas do manifesto (garante a ordem mesmo se o arquivo for editado). */
export function orderNotesForRestore(notes: BackupNote[]): BackupNote[] {
  return [...notes].sort((a, b) =>
    a.recording.recordedAt.localeCompare(b.recording.recordedAt),
  );
}

/** Nome do arquivo a partir de um uri/caminho (sem query). */
export function baseName(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  const clean = uri.split('?')[0];
  const name = clean.slice(clean.lastIndexOf('/') + 1);
  return name || undefined;
}

/**
 * Nome do arquivo a partir de um uri de documento SAF. O ultimo segmento vem
 * codificado (ex.: `primary%3ADownload%2Ffoo.aac`), entao decodifica antes.
 */
export function nameFromDocumentUri(uri: string): string {
  const clean = decodeURIComponent(uri.split('?')[0]);
  return clean.slice(clean.lastIndexOf('/') + 1);
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Codifica bytes em base64 (para escrever binario via API SAF, em chunks). */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const has1 = i + 1 < bytes.length;
    const has2 = i + 2 < bytes.length;
    const b1 = has1 ? bytes[i + 1] : 0;
    const b2 = has2 ? bytes[i + 2] : 0;
    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out += has1 ? BASE64_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += has2 ? BASE64_ALPHABET[b2 & 63] : '=';
  }
  return out;
}

/** Junta um diretorio e um nome num uri (evita barra dupla). */
export function joinUri(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

export function buildManifest(
  notes: BackupNote[],
  now: Date,
  appVersion?: string,
): BackupManifest {
  return { version: BACKUP_VERSION, createdAt: now.toISOString(), appVersion, notes };
}

function parseFile(raw: unknown): BackupFile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const f = raw as Record<string, unknown>;
  if (typeof f.name !== 'string' || typeof f.originalName !== 'string' || typeof f.md5 !== 'string') {
    return null;
  }
  return {
    name: f.name,
    originalName: f.originalName,
    md5: f.md5,
    size: typeof f.size === 'number' ? f.size : 0,
  };
}

/**
 * Le o manifesto. Devolve null se o JSON for invalido ou de versao incompativel
 * (so aceita a versao atual — um backup antigo nunca foi gravavel).
 */
export function parseManifest(json: string): BackupManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== BACKUP_VERSION || !Array.isArray(obj.notes)) return null;

  const notes: BackupNote[] = [];
  for (const rawNote of obj.notes) {
    if (typeof rawNote !== 'object' || rawNote === null) continue;
    const note = rawNote as Record<string, unknown>;
    const recording = note.recording as Recording | undefined;
    if (!recording || typeof recording.id !== 'string') continue;
    const files: BackupFile[] = [];
    if (Array.isArray(note.files)) {
      for (const rawFile of note.files) {
        const file = parseFile(rawFile);
        if (file) files.push(file);
      }
    }
    notes.push({
      recording,
      audioFile: typeof note.audioFile === 'string' ? note.audioFile : undefined,
      files,
    });
  }

  return {
    version: BACKUP_VERSION,
    createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : '',
    appVersion: typeof obj.appVersion === 'string' ? obj.appVersion : undefined,
    notes,
  };
}

/**
 * Refaz os caminhos locais da nota restaurada e normaliza um status de gravacao
 * interrompida (nao faz sentido num backup).
 */
export function toRestoredRecording(
  recording: Recording,
  dirUri: string,
  audioFile?: string,
): Recording {
  const status =
    recording.status === 'recording' || recording.status === 'interrupted'
      ? 'recorded'
      : recording.status;
  return {
    ...recording,
    dir: dirUri,
    filePath: audioFile ? joinUri(dirUri, audioFile) : undefined,
    status,
  };
}
