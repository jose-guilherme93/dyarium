/**
 * Tipos do nucleo. Este modulo e puro: nada de imports nativos, para poder ser
 * testado com fakes (ver AGENTS.md, secao de testes).
 */

/**
 * Campo editavel que pode brigar entre o app e o dashboard. Vive aqui (e nao em
 * `api.ts`) porque e propriedade da nota, nao do transporte.
 */
export type ConflictField = 'title' | 'recorded_at' | 'body';

/** Um audio da nota, como o servidor guarda: uma nota pode ter varios. */
export interface ServerAudio {
  id: string;
  content_type: string;
  size_bytes: number;
  duration_seconds: number;
  created_at: string;
  transcript?: {
    text?: string;
    /** Texto cru do whisper, quando o servidor o expoe. */
    raw_text?: string;
    language?: string;
    /** Quem produziu: o caminho do modelo no servidor ou `local` (o app). */
    model?: string;
    segments?: TranscriptSegment[];
  };
}

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
  /** Id do anexo de audio original no servidor (liga a transcricao ao audio). */
  serverAttachmentId?: string;
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
  /** Revisao por IA ja aplicada a transcricao, quando houver. */
  transcriptReview?: TranscriptReview;
  /** Ate onde a transcricao local ja chegou, em ms do audio original. */
  transcriptCheckpointMs?: number;
  /** Ultima pilha de audios lida do servidor (cache local para abrir sem esperar). */
  serverAudios?: ServerAudio[];
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
  /**
   * Nota apagada, esperando o fim da janela da lixeira (7 dias). Enquanto
   * existir, a nota nao aparece em lista nenhuma; o audio local fica guardado
   * para a restauracao e so e liberado quando a janela fecha.
   */
  deletedAt?: string;
  /** Caderno da nota. O padrao ("Notas ao acaso") cobre notas antigas. */
  notebookId?: string;
  /** Tags da nota, na ordem canonica do servidor. */
  tags?: string[];
  /**
   * Nota criada a partir de um trecho de transcricao: guarda a nota de origem
   * e o instante em que o trecho foi falado, para voltar ao ponto exato.
   * Nao vai ao servidor; e uma referencia local.
   */
  captureSourceId?: string;
  captureStartMs?: number;
  /** Caderno alterado localmente e ainda nao enviado. */
  notebookDirty?: boolean;
  /** Tags alteradas localmente e ainda nao enviadas. */
  tagsDirty?: boolean;
  /** Arquivamento alterado localmente e ainda nao enviado. */
  archivedDirty?: boolean;
  /** Edicao local (titulo/texto/imagem) numa nota ja enviada, pendente de sync. */
  noteDirty?: boolean;
  /** Mapa nome local da imagem -> id do anexo no servidor (evita reenviar). */
  attachments?: Record<string, string>;
  /**
   * Versao de cada campo tal como lida do servidor. E o que permite o servidor
   * recusar (409) uma gravacao que sobrescreveria trabalho feito em outro lugar,
   * em vez de aceitar em silencio.
   */
  titleVersion?: string;
  recordedAtVersion?: string;
  bodyVersion?: string;
  /**
   * Campos que o servidor recusou por conflito (409), esperando o usuario
   * escolher qual versao fica. Enquanto isto estiver aqui, a nota nao volta para
   * a fila: repetir a gravacao nao resolveria nada.
   */
  syncConflict?: ConflictField[];
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
  /** Texto original do whisper; nunca sobrescrito pela revisao. */
  text: string;
  /** Revisao da IA, so quando difere de `text`. O leitor mostra este. */
  revised?: string;
  /** Trecho escrito a mao: a revisao nunca toca nele. */
  edited?: boolean;
  /** A passada de revisao chegou neste trecho (mesmo sem mudar nada). */
  reviewed?: boolean;
  /**
   * O trecho foi transformado em tarefa, ideia ou citacao. Fica so no aparelho:
   * e o que desenha o icone ao lado do texto.
   */
  capture?: 'task' | 'idea' | 'quote';
}

/**
 * Estado da revisao por IA da transcricao. A chave (modelo + versao do prompt +
 * literal) decide se uma nova analise precisa revisar de novo.
 */
export interface TranscriptReview {
  model: string;
  promptVersion: number;
  literal: boolean;
  /** Estimativa 0-100 da compreensao logica do texto cru; -1 quando ausente. */
  comprehension: number;
  /** Hash do texto cru revisado; muda quando um trecho muda. */
  hash?: string;
  /**
   * Trechos que ficaram sem revisao: a janela falhou ou a trava recusou a
   * resposta do modelo. Sem isso, "revisou e nao mudou nada" e "nao revisou"
   * ficam iguais na tela.
   */
  rejected?: number;
  /** Indice do primeiro trecho que a passada ainda nao alcancou. */
  reviewedThrough?: number;
  /** Trechos que ficaram sem revisao, para o "revisar de novo" mirar neles. */
  rejectedIdx?: number[];
  /** Quando a passada terminou; ausente enquanto ela pode continuar de onde parou. */
  finishedAt?: string;
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
 * aparelho (origem local) nao pedem transcricao ao servidor, e nota sem audio
 * (texto) nunca tem transcricao para buscar.
 */
export function needsTranscript(r: Recording): boolean {
  const hasAudio =
    Boolean(r.filePath) || r.segmentCount > 0 || Boolean(r.contentType?.startsWith('audio/'));
  return (
    hasAudio &&
    Boolean(r.entryId) &&
    r.status === 'completed' &&
    r.transcriptOrigin !== 'local' &&
    r.transcriptStatus !== 'ready'
  );
}

/**
 * A nota ja tem transcricao terminada, venha ela do aparelho ou do servidor.
 * `pending` com texto e uma passada parcial: continua valendo, mas nao conta
 * como terminada (ela retoma do checkpoint).
 */
export function hasFinalTranscript(r: Recording): boolean {
  return r.hasTranscript === true || r.transcriptStatus === 'ready';
}

/**
 * A transcricao local pode comecar sozinha nesta nota?
 *
 * So quando o audio esta no aparelho, nada terminou e a nota nao pertence ao
 * servidor. Uma nota que o servidor transcreveu (ou esta transcrevendo) nunca
 * e refeita no aparelho por iniciativa propria: reabrir o app, baixar um
 * modelo ou ligar a transcricao local nao pode varrer o acervo. O usuario
 * ainda pode pedir a transcricao de uma nota especifica.
 */
export function shouldAutoTranscribe(r: Recording): boolean {
  if (!r.filePath || hasFinalTranscript(r)) return false;
  if (r.transcriptOrigin === 'server') return false;
  // Ja esta no servidor e nao ha marca de posse local: quem transcreve e ele.
  if (r.entryId && r.transcriptOrigin !== 'local') return false;
  return true;
}

/**
 * Nota ja enviada com edicao local pendente: entra na fila para levar o corpo
 * (titulo/texto/imagens) ao servidor. Nao reenvia audio nem cria outra entrada.
 *
 * Uma nota com conflito aberto **nao** entra na fila: reenviar daria 409 de novo,
 * e o que resolve e o usuario escolher (na tela da nota).
 */
export function needsNoteSync(r: Recording): boolean {
  return (
    Boolean(r.entryId) &&
    r.status === 'completed' &&
    Boolean(r.noteDirty || r.notebookDirty || r.tagsDirty || r.archivedDirty) &&
    !hasNoteConflict(r)
  );
}

/** `true` quando o servidor recusou a gravacao e o usuario ainda nao escolheu. */
export function hasNoteConflict(r: Recording): boolean {
  return Boolean(r.syncConflict && r.syncConflict.length > 0);
}

/** Nota somente texto (sem audio): o texto e enviado como conteudo. */
export function isTextNote(r: Recording): boolean {
  return r.source === 'text' && !r.filePath;
}
