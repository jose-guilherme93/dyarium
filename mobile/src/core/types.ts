/**
 * Tipos do nucleo. Este modulo e puro: nada de imports nativos, para poder ser
 * testado com fakes (ver AGENTS.md, secao de testes).
 */

export type RecordingStatus =
  | 'draft' // nota nova, ainda sem conteudo; nao entra na fila
  | 'recording' // sessao ativa, gravando segmentos
  | 'interrupted' // processo morreu no meio; aguarda decisao do usuario
  | 'recorded' // segmentos concatenados, prontos para enfileirar
  | 'queued' // na fila, aguardando envio
  | 'uploading' // enviando chunks
  | 'completed' // entrada criada no servidor
  | 'failed'; // ultima tentativa falhou; ainda retentavel

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
  /** Falha permanente: nao retenta sozinha (erro 4xx); so com retry manual. */
  terminal?: boolean;
  /** Id da entrada criada no servidor. */
  entryId?: string;
  /** Id da nota (corpo rico) no servidor, quando criada. */
  noteId?: string;
  /** Transcricao (local ou do servidor), quando pronta. */
  transcript?: string;
  transcriptLanguage?: string;
  transcriptStatus?: TranscriptStatus;
  /** Ha transcricao pronta (local ou do servidor). */
  hasTranscript?: boolean;
  /** Quem produziu a transcricao. */
  transcriptOrigin?: TranscriptOrigin;
  /** Segmentos da transcricao (cache local, para nao refazer fetch ao abrir). */
  transcriptSegments?: TranscriptSegment[];
  /** Origem do audio (default: gravado no microfone). */
  source?: RecordingSource;
  /** Texto da nota (nota de texto ou anotacao de uma nota de audio). */
  text?: string;
  /** Content-Type usado no upload (default audio/aac para gravacoes). */
  contentType?: string;
  /** Nome enviado ao servidor; a extensao define o formato aceito. */
  fileName?: string;
  /** Marcado quando o servidor encontrou um audio identico (dedupe). */
  duplicate?: boolean;
  /** Nota arquivada: sai da lista principal, mas nao e apagada. */
  archived?: boolean;
  /** Edicao local (titulo/texto/imagem) numa nota ja enviada, pendente de sync. */
  noteDirty?: boolean;
  /** Mapa nome local da imagem -> id do anexo no servidor (evita reenviar). */
  attachments?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export type TranscriptStatus = 'pending' | 'ready' | 'failed';

/** Origem da transcricao: feita no aparelho ou recebida do servidor. */
export type TranscriptOrigin = 'local' | 'server';

/** Trecho da transcricao com a marcacao de tempo no audio original. */
export interface TranscriptSegment {
  start_ms: number;
  end_ms: number;
  text: string;
}

/** De onde veio a nota: gravada no app, importada de outro app ou escrita. */
export type RecordingSource = 'microphone' | 'share' | 'text';

/** Configuracao do servidor (o token nunca e persistido fora do SecureStore). */
export interface ServerConfig {
  baseUrl: string;
  token: string;
}

export const ACTIVE_STATUSES: RecordingStatus[] = ['recording', 'interrupted'];

export function isUploadable(r: Recording): boolean {
  if (r.terminal) return false;
  return (
    r.status === 'queued' ||
    r.status === 'uploading' ||
    r.status === 'failed' ||
    r.status === 'recorded'
  );
}

/**
 * Gravacao enviada que ainda nao tem transcricao pronta. Notas transcritas no
 * aparelho (origem local) nao pedem transcricao ao servidor.
 */
export function needsTranscript(r: Recording): boolean {
  return (
    Boolean(r.entryId) &&
    r.status === 'completed' &&
    r.transcriptOrigin !== 'local' &&
    r.transcriptStatus !== 'ready'
  );
}

/**
 * Nota ja enviada com edicao local pendente: entra na fila para levar o corpo
 * (titulo/texto/imagens) ao servidor. Nao reenvia audio nem cria outra entrada.
 */
export function needsNoteSync(r: Recording): boolean {
  return Boolean(r.entryId) && r.status === 'completed' && Boolean(r.noteDirty);
}

/** Nota somente texto (sem audio): o texto e enviado como conteudo. */
export function isTextNote(r: Recording): boolean {
  return r.source === 'text' && !r.filePath;
}
