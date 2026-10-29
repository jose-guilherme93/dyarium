/**
 * Rotulos do andamento da analise. Puro e testavel.
 *
 * O modelo le um bloco por vez e o documento e composto no codigo; como o
 * usuario espera minutos em uma passada local, a ficha mostra o que esta
 * acontecendo em vez de um spinner mudo. As frases sao curtas e trocam ao
 * longo dos blocos, e cada secao aparece na ficha assim que tem conteudo.
 */

export type AnalysisStage = 'queued' | 'loading' | 'reading' | 'sentence';

const READING_LABELS = [
  'Lendo a nota...',
  'Definindo pesos...',
  'Pensando melhor sobre as pessoas...',
  'Avaliando os lugares...',
  'Entendendo as emoções...',
  'Lendo as decisões e tarefas...',
  'Reunindo os momentos...',
];

/** Rotulo da fase de leitura; muda a cada bloco para o tempo parecer vivo. */
export function readingLabel(blockIndex: number): string {
  const index = Math.max(0, Math.trunc(blockIndex)) % READING_LABELS.length;
  return READING_LABELS[index];
}

const QUEUED_LABEL = 'Na fila...';
const LOADING_LABEL = 'Carregando modelo...';
const SENTENCE_LABEL = 'Escrevendo a frase...';

/** Rotulo do servidor: o app acompanha o tempo, sem inventar etapa pontual. */
const SERVER_LABELS = [
  'Enviado ao servidor...',
  'Lendo a nota...',
  'Pensando melhor sobre as pessoas...',
  'Avaliando os lugares...',
  'Entendendo as emoções...',
  'Montando as métricas...',
  'Recebendo o resultado...',
];

export function serverLabel(elapsedMs: number): string {
  const step = Math.max(0, Math.floor(elapsedMs / 6000));
  return SERVER_LABELS[Math.min(step, SERVER_LABELS.length - 1)];
}

export interface StageLabelInput {
  stage: AnalysisStage | null;
  /** Blocos ja lidos, para escolher a frase e completar o contador. */
  read?: number;
  total?: number;
  /** Tempo desde o pedido ao servidor, quando a analise roda la. */
  serverElapsedMs?: number;
}

/** Frase mostrada ao lado do indicador de carregamento. */
export function stageLabel(input: StageLabelInput): string {
  const { stage, read = 0, total = 0, serverElapsedMs } = input;
  if (stage === 'queued') return QUEUED_LABEL;
  if (stage === 'loading') return LOADING_LABEL;
  if (stage === 'sentence') return SENTENCE_LABEL;
  if (serverElapsedMs !== undefined) return serverLabel(serverElapsedMs);
  const label = readingLabel(read);
  return total > 0 ? `${label} ${read} de ${total}` : label;
}
