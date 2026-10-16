/**
 * Tipos do nucleo. Este modulo e puro: nada de imports nativos, para poder ser
 * testado com fakes (ver AGENTS.md, secao de testes).
 */

export type RecordingStatus =
  | 'recording' // sessao ativa, gravando segmentos
  | 'interrupted' // processo morreu no meio; aguarda decisao do usuario
  | 'recorded' // segmentos concatenados, prontos para enfileirar
  | 'queued' // na fila, aguardando envio
  | 'uploading' // enviando chunks
  | 'completed' // entrada criada no servidor
  | 'failed' // ultima tentativa falhou; ainda retentavel
  | 'dead' // falha permanente; nao retenta sozinha
  | 'remote'; // existe no servidor; o aparelho so mostra (sem arquivo local)

export interface Recording {
  /** Identificador local da gravacao (sessionId). */
  id: string;
  /** Titulo humano, ex.: "10/10/2026 21:30". */
  title: string;
  /** Inicio da gravacao em ISO 8601 UTC. */
  recordedAt: string;
  /** Diretorio da sessao (contem os segmentos). */
  dir: string;
  /** Caminho do arquivo concatenado, quando existir. */
  filePath?: string;
  /** Quantos segmentos ja foram fechados. */
  segmentCount: number;
  /** Duracao aproximada em milissegundos. */
  durationMs?: number;
  /** Tamanho do arquivo concatenado em bytes. */
  sizeBytes?: number;
  status: RecordingStatus;
  /** Id do upload no servidor, quando criado. */
  uploadId?: string;
  /** Bytes ja confirmados pelo servidor. */
  offset: number;
  /** Tentativas de upload ja feitas. */
  attempts: number;
  /** Quando tentar de novo (ISO 8601 UTC). */
  nextAttemptAt?: string;
  /** Ultima mensagem de erro (generica, sem segredo). */
  lastError?: string;
  /** Id da entrada criada no servidor. */
  entryId?: string;
  /** Identidade unica e verificavel da nota (ex.: "sha256:<...>"). */
  originKey?: string;
  /** Transcricao vinda do servidor, quando pronta. */
  transcript?: string;
  transcriptLanguage?: string;
  transcriptStatus?: TranscriptStatus;
  createdAt: string;
  updatedAt: string;
}

export type TranscriptStatus = 'pending' | 'ready' | 'failed';

/** Configuracao do servidor (o token nunca e persistido fora do SecureStore). */
export interface ServerConfig {
  baseUrl: string;
  token: string;
}

export const ACTIVE_STATUSES: RecordingStatus[] = ['recording', 'interrupted'];

export function isUploadable(r: Recording): boolean {
  return (
    r.status === 'queued' ||
    r.status === 'uploading' ||
    r.status === 'failed' ||
    r.status === 'recorded'
  );
}

/** Gravacao enviada que ainda nao tem transcricao pronta nem falhou. */
export function needsTranscript(r: Recording): boolean {
  return (
    Boolean(r.entryId) &&
    (r.status === 'completed' || r.status === 'remote') &&
    r.transcriptStatus !== 'ready' &&
    r.transcriptStatus !== 'failed'
  );
}

/** Estados em que o usuario pode forcar uma nova tentativa de envio. */
export function canRetry(r: Recording): boolean {
  return (
    r.status === 'recorded' ||
    r.status === 'queued' ||
    r.status === 'uploading' ||
    r.status === 'failed' ||
    r.status === 'dead'
  );
}
