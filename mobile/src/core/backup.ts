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

import type { Notebook } from './notebooks';
import type { Recording } from './types';

export const BACKUP_VERSION = 3;
/**
 * Versoes de manifesto que este app ainda le. A 2 nao tinha o estado local
 * (analises e mapa); restaurar uma pasta antiga continua funcionando, so que
 * sem esse estado — ele nunca esteve no arquivo.
 */
export const BACKUP_READABLE_VERSIONS: readonly number[] = [2, 3];
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
  /** Hash SHA-256 do texto da nota (hex), para conferir integridade ao restaurar. */
  textSha256?: string;
  files: BackupFile[];
}

/**
 * Analise guardada no aparelho. A chave e a da analise: id local da nota
 * antes do upload, entry id depois (a mesma que `analyses.entry_id` usa).
 */
export interface BackupAnalysis {
  entryId: string;
  title: string;
  recordedAt: string;
  /** JSON da analise, como veio do servidor ou do modelo local. */
  payload: string;
  fetchedAt: string;
  origin: 'local' | 'server';
  contentHash?: string;
}

/** Bloco ja lido da analise local, para retomar sem chamar o modelo de novo. */
export interface BackupAnalysisChunk {
  entryId: string;
  blockIndex: number;
  blockHash: string;
  promptVersion: number;
  model: string;
  status: string;
  dropped: number;
  payload: string;
  updatedAt: string;
}

export interface BackupEntity {
  id: string;
  kind: string;
  name: string;
  label: string;
  icon: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackupEntityAlias {
  id: string;
  entityId: string;
  kind: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackupEntityLink {
  entryId: string;
  entityId: string;
  count: number;
  relation?: string;
  sentiment?: number;
  createdAt: string;
}

export interface BackupOwnerAlias {
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackupEntityRejection {
  kind: string;
  name: string;
  nameKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackupGraphLayout {
  key: string;
  data: string;
  updatedAt: string;
}

/** Ultima versao de transcricao/analise que o aparelho ja trocou com um ambiente. */
export interface BackupSyncMark {
  entryId: string;
  sourceAt: string;
}

/** O mesmo marcador, por ambiente (o app pode conversar com varios). */
export interface BackupEnvSyncMark extends BackupSyncMark {
  serverId: string;
}

/**
 * O que o aparelho sabe e nao esta na nota nem na midia: analises, blocos ja
 * lidos e o estado do mapa (entidades, aliases, vinculos, dono, rejeicoes e
 * posicoes). Sem isto, restaurar um backup devolvia as notas mudas — e o app e
 * um cliente independente, nao um espelho do servidor.
 */
export interface BackupKnowledge {
  analyses: BackupAnalysis[];
  analysisChunks: BackupAnalysisChunk[];
  entities: BackupEntity[];
  entityAliases: BackupEntityAlias[];
  entryEntities: BackupEntityLink[];
  ownerAliases: BackupOwnerAlias[];
  entityRejections: BackupEntityRejection[];
  graphLayout: BackupGraphLayout[];
  /**
   * O que ja foi trocado com cada ambiente. Sem estes marcadores, restaurar
   * faria o app baixar de novo transcricoes e analises que ele ja tem — o
   * oposto de "sincronizar so o que falta".
   */
  transcriptSync: BackupSyncMark[];
  analysisSync: BackupSyncMark[];
  transcriptSyncEnv: BackupEnvSyncMark[];
  analysisSyncEnv: BackupEnvSyncMark[];
  /** Autor/dono: sem o nome, a analise seguinte criaria o dono como pessoa. */
  author?: { ownerName: string; allNotesMine: boolean };
}

export interface BackupManifest {
  version: number;
  createdAt: string;
  /** Versao do app que gerou o backup. */
  appVersion?: string;
  /** Cadernos, para as notas restauradas nao ficarem sem lugar. */
  notebooks?: Notebook[];
  /** Analises e mapa do aparelho. Ausente em manifestos v2. */
  knowledge?: BackupKnowledge;
  /** Notas em ordem cronologica (mais antiga primeiro). */
  notes: BackupNote[];
}

/** Todas as chaves de analise que as notas do backup usam. */
export function backupEntryKeys(
  notes: Pick<BackupNote, 'recording'>[],
): Set<string> {
  const keys = new Set<string>();
  for (const note of notes) {
    if (note.recording.id) keys.add(note.recording.id);
    if (note.recording.entryId) keys.add(note.recording.entryId);
  }
  return keys;
}

/**
 * Corta o conhecimento para as notas que o backup realmente leva. Analise de
 * nota fora do manifesto nao entra: ela ficaria orfa no aparelho restaurado.
 */
export function filterKnowledge(
  knowledge: BackupKnowledge,
  entryKeys: ReadonlySet<string>,
): BackupKnowledge {
  return {
    ...knowledge,
    analyses: knowledge.analyses.filter((item) => entryKeys.has(item.entryId)),
    analysisChunks: knowledge.analysisChunks.filter((item) => entryKeys.has(item.entryId)),
    entryEntities: knowledge.entryEntities.filter((item) => entryKeys.has(item.entryId)),
    transcriptSync: knowledge.transcriptSync.filter((item) => entryKeys.has(item.entryId)),
    analysisSync: knowledge.analysisSync.filter((item) => entryKeys.has(item.entryId)),
    transcriptSyncEnv: knowledge.transcriptSyncEnv.filter((item) => entryKeys.has(item.entryId)),
    analysisSyncEnv: knowledge.analysisSyncEnv.filter((item) => entryKeys.has(item.entryId)),
  };
}

/**
 * Um segmento de caminho seguro. Ids e nomes de arquivo chegam do manifesto,
 * que pode vir de qualquer pasta escolhida pelo usuario: barra, barra invertida,
 * NUL, `.` e `..` escapariam da pasta da nota — e poderiam sobrescrever o banco.
 * Recusar o manifesto e mais seguro do que "limpar" o nome e continuar.
 */
export function isSafePathSegment(value: string): boolean {
  if (!value || value === '.' || value === '..') return false;
  if (value.includes('/') || value.includes('\\') || value.includes('\u0000')) return false;
  return true;
}

export type RestoreEntryVerdict = 'ok' | 'unsafe_id' | 'unsafe_file';

/** Confere todo nome que vira caminho, antes de qualquer escrita da restauracao. */
export function validateRestoreEntry(entry: BackupNote): RestoreEntryVerdict {
  if (!isSafePathSegment(entry.recording.id)) return 'unsafe_id';
  if (entry.audioFile !== undefined && !isSafePathSegment(entry.audioFile)) return 'unsafe_file';
  for (const file of entry.files) {
    if (!isSafePathSegment(file.originalName)) return 'unsafe_file';
  }
  return 'ok';
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
  notebooks?: Notebook[],
  knowledge?: BackupKnowledge,
): BackupManifest {
  return {
    version: BACKUP_VERSION,
    createdAt: now.toISOString(),
    appVersion,
    notebooks,
    knowledge,
    notes,
  };
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Le uma lista de objetos, descartando o que nao passar no parser da linha. */
function parseRows<T>(
  raw: unknown,
  parse: (row: Record<string, unknown>) => T | null,
): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const parsed = parse(item as Record<string, unknown>);
    if (parsed) out.push(parsed);
  }
  return out;
}

function parseSyncMark(row: Record<string, unknown>): BackupSyncMark | null {
  if (typeof row.entryId !== 'string' || typeof row.sourceAt !== 'string') return null;
  return { entryId: row.entryId, sourceAt: row.sourceAt };
}

function parseEnvSyncMark(row: Record<string, unknown>): BackupEnvSyncMark | null {
  if (
    typeof row.serverId !== 'string' ||
    typeof row.entryId !== 'string' ||
    typeof row.sourceAt !== 'string'
  ) {
    return null;
  }
  return { serverId: row.serverId, entryId: row.entryId, sourceAt: row.sourceAt };
}

function parseKnowledge(raw: unknown): BackupKnowledge | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;
  const authorRaw = obj.author;
  let author: BackupKnowledge['author'];
  if (typeof authorRaw === 'object' && authorRaw !== null) {
    const a = authorRaw as Record<string, unknown>;
    if (typeof a.ownerName === 'string') {
      author = { ownerName: a.ownerName, allNotesMine: a.allNotesMine !== false };
    }
  }
  return {
    analyses: parseRows(obj.analyses, (row) => {
      if (typeof row.entryId !== 'string' || typeof row.payload !== 'string') return null;
      return {
        entryId: row.entryId,
        title: text(row.title),
        recordedAt: text(row.recordedAt),
        payload: row.payload,
        fetchedAt: text(row.fetchedAt),
        origin: row.origin === 'local' ? 'local' : 'server',
        contentHash: optionalText(row.contentHash),
      };
    }),
    analysisChunks: parseRows(obj.analysisChunks, (row) => {
      if (typeof row.entryId !== 'string' || typeof row.payload !== 'string') return null;
      return {
        entryId: row.entryId,
        blockIndex: number(row.blockIndex),
        blockHash: text(row.blockHash),
        promptVersion: number(row.promptVersion),
        model: text(row.model),
        status: text(row.status, 'ok'),
        dropped: number(row.dropped),
        payload: row.payload,
        updatedAt: text(row.updatedAt),
      };
    }),
    entities: parseRows(obj.entities, (row) => {
      if (typeof row.id !== 'string' || typeof row.kind !== 'string' || typeof row.name !== 'string') {
        return null;
      }
      return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        label: text(row.label),
        icon: text(row.icon),
        createdAt: text(row.createdAt),
        updatedAt: text(row.updatedAt),
      };
    }),
    entityAliases: parseRows(obj.entityAliases, (row) => {
      if (
        typeof row.id !== 'string' ||
        typeof row.entityId !== 'string' ||
        typeof row.kind !== 'string' ||
        typeof row.name !== 'string'
      ) {
        return null;
      }
      return {
        id: row.id,
        entityId: row.entityId,
        kind: row.kind,
        name: row.name,
        createdAt: text(row.createdAt),
        updatedAt: text(row.updatedAt),
      };
    }),
    entryEntities: parseRows(obj.entryEntities, (row) => {
      if (typeof row.entryId !== 'string' || typeof row.entityId !== 'string') return null;
      return {
        entryId: row.entryId,
        entityId: row.entityId,
        count: number(row.count, 1),
        relation: optionalText(row.relation),
        sentiment: typeof row.sentiment === 'number' ? row.sentiment : undefined,
        createdAt: text(row.createdAt),
      };
    }),
    ownerAliases: parseRows(obj.ownerAliases, (row) => {
      if (typeof row.name !== 'string') return null;
      return {
        name: row.name,
        createdAt: text(row.createdAt),
        updatedAt: text(row.updatedAt),
      };
    }),
    entityRejections: parseRows(obj.entityRejections, (row) => {
      if (
        typeof row.kind !== 'string' ||
        typeof row.name !== 'string' ||
        typeof row.nameKey !== 'string'
      ) {
        return null;
      }
      return {
        kind: row.kind,
        name: row.name,
        nameKey: row.nameKey,
        createdAt: text(row.createdAt),
        updatedAt: text(row.updatedAt),
      };
    }),
    graphLayout: parseRows(obj.graphLayout, (row) => {
      if (typeof row.key !== 'string' || typeof row.data !== 'string') return null;
      return {
        key: row.key,
        data: row.data,
        updatedAt: text(row.updatedAt),
      };
    }),
    transcriptSync: parseRows(obj.transcriptSync, parseSyncMark),
    analysisSync: parseRows(obj.analysisSync, parseSyncMark),
    transcriptSyncEnv: parseRows(obj.transcriptSyncEnv, parseEnvSyncMark),
    analysisSyncEnv: parseRows(obj.analysisSyncEnv, parseEnvSyncMark),
    author,
  };
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
 * Le o manifesto. Devolve null se o JSON for invalido ou de versao que este app
 * nao conhece. A v2 (anterior ao estado local) continua legivel: sem analises e
 * sem mapa, porque nunca estiveram no arquivo.
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
  if (
    typeof obj.version !== 'number' ||
    !BACKUP_READABLE_VERSIONS.includes(obj.version) ||
    !Array.isArray(obj.notes)
  ) {
    return null;
  }

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
      textSha256: typeof note.textSha256 === 'string' ? note.textSha256 : undefined,
      files,
    });
  }

  const notebooks: Notebook[] = [];
  if (Array.isArray(obj.notebooks)) {
    for (const raw of obj.notebooks) {
      if (typeof raw !== 'object' || raw === null) continue;
      const item = raw as Record<string, unknown>;
      if (typeof item.id !== 'string' || typeof item.name !== 'string') continue;
      notebooks.push({
        id: item.id,
        name: item.name,
        color: typeof item.color === 'string' ? item.color : '',
        isDefault: item.isDefault === true,
        kind: item.kind === 'mcp' ? 'mcp' : item.kind === 'book' ? 'book' : 'notes',
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
      });
    }
  }

  return {
    version: obj.version,
    createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : '',
    appVersion: typeof obj.appVersion === 'string' ? obj.appVersion : undefined,
    notebooks: notebooks.length > 0 ? notebooks : undefined,
    knowledge: parseKnowledge(obj.knowledge),
    notes,
  };
}

/**
 * Refaz os caminhos locais da nota restaurada e normaliza um status de gravacao
 * interrompida (nao faz sentido num backup).
 *
 * Restaurar **nao e editar**: o `updatedAt` do backup e o instante real da
 * ultima mudanca e fica como esta, senao a primeira sincronizacao acharia que a
 * biblioteca inteira mudou e reenviaria tudo. O carimbo HLC e refeito por quem
 * grava (ver `clockNow`), que e o que protege a nota de um tombstone antigo.
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
    updatedHlc: undefined,
  };
}
