/**
 * Backup local: manifesto + regras puras. O IO (pastas/arquivos) fica no
 * servico; aqui so a estrutura e a ordem, para testar de verdade.
 *
 * Layout na pasta escolhida:
 *   Dyarium/manifest.json               (a lista, em ordem)
 *   Dyarium/<id>__<arquivo>             (audio, imagens; um por arquivo)
 */

import type { Recording } from './types';

export const BACKUP_VERSION = 1;
export const BACKUP_MANIFEST = 'manifest.json';
export const BACKUP_FOLDER = 'Dyarium';
/** Separador entre o id da nota e o nome original do arquivo. */
export const BACKUP_SEP = '__';

export interface BackupNote {
  /** A nota, sem os caminhos absolutos (refeitos no restore). */
  recording: Recording;
  /** Nome do arquivo de audio, quando a nota tem audio. */
  audioFile?: string;
  /** Nomes originais dos arquivos da nota (audio + imagens). */
  files: string[];
}

export interface BackupManifest {
  version: number;
  createdAt: string;
  /** Notas em ordem cronologica (mais antiga primeiro). */
  notes: BackupNote[];
}

/** Ordem "certa": mais antiga primeiro, como uma linha do tempo. */
export function orderForBackup(recordings: Recording[]): Recording[] {
  return [...recordings].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

export function backupFileName(noteId: string, originalName: string): string {
  return `${noteId}${BACKUP_SEP}${originalName}`;
}

export function originalFileName(noteId: string, backedName: string): string {
  const prefix = `${noteId}${BACKUP_SEP}`;
  return backedName.startsWith(prefix) ? backedName.slice(prefix.length) : backedName;
}

/** Nome do arquivo a partir de um uri/caminho (sem query). */
export function baseName(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  const clean = uri.split('?')[0];
  const name = clean.slice(clean.lastIndexOf('/') + 1);
  return name || undefined;
}

/** Junta um diretorio e um nome num uri (evita barra dupla). */
export function joinUri(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

export function buildManifest(notes: BackupNote[], now: Date): BackupManifest {
  return { version: BACKUP_VERSION, createdAt: now.toISOString(), notes };
}

/** Le o manifesto; devolve null se o JSON for invalido ou incompativel. */
export function parseManifest(json: string): BackupManifest | null {
  try {
    const parsed = JSON.parse(json) as Partial<BackupManifest>;
    if (typeof parsed.version !== 'number' || !Array.isArray(parsed.notes)) return null;
    if (parsed.version > BACKUP_VERSION) return null;
    const notes = parsed.notes.filter(
      (note): note is BackupNote => Boolean(note && note.recording && note.recording.id),
    );
    return {
      version: parsed.version,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : '',
      notes: notes.map((note) => ({ ...note, files: Array.isArray(note.files) ? note.files : [] })),
    };
  } catch {
    return null;
  }
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
