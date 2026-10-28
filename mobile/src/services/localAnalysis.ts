/**
 * Engine local de analise com llama.rn (llama.cpp / GGUF).
 *
 * O modulo nativo e carregado tarde e protegido: antes do development build ele
 * nao existe, entao a tela de benchmark continua abrindo e avisa que a analise
 * local so fica disponivel depois do proximo build.
 */

import * as Device from 'expo-device';
import { File } from 'expo-file-system';

import {
  analysisNoteContent,
  buildAnalysisMessages,
  interpretationOrOriginal,
  parseAnalysisJson,
  ANALYSIS_SCHEMA,
} from '@/core/analysisPrompt';
import { modelFitsDevice, type AnalysisModelInfo } from '@/core/analysisModels';
import { effectiveAuthor } from '@/core/author';
import type { Recording } from '@/core/types';
import {
  cancelActivity,
  failActivity,
  finishActivity,
  startActivity,
  updateActivity,
  type ActivityAction,
} from './activity';
import { analysisModelFilePath } from './analysisModels';
import { loadAuthorSettings } from './authorSettings';
import {
  acquireHeavyWork,
  registerEngineReleaser,
  reserveEngine,
  type HeavyLease,
} from './heavyWork';
import { startForegroundTask, stopForegroundTask } from '../../modules/foreground-task';
import { notifyActivity, notifyIfHidden } from './notifications';

export interface TokenData {
  token: string;
  content?: string;
}

interface CompletionTimings {
  prompt_per_second?: number;
  predicted_per_second?: number;
  prompt_ms?: number;
  predicted_ms?: number;
  prompt_n?: number;
  predicted_n?: number;
}

interface CompletionResult {
  text?: string;
  content?: string;
  truncated?: boolean;
  timings?: CompletionTimings;
}

interface LlamaContextHandle {
  completion(
    params: Record<string, unknown>,
    callback?: (data: TokenData) => void,
  ): Promise<CompletionResult>;
  stopCompletion(): Promise<void>;
  /** Limpa o KV cache entre conversas; sem isso a proxima herda a anterior. */
  clearCache?(clearData?: boolean): Promise<void>;
  release(): Promise<void>;
}

interface LlamaModule {
  initLlama(
    params: Record<string, unknown>,
    onProgress?: (progress: number) => void,
  ): Promise<LlamaContextHandle>;
}

export interface AnalysisTimings {
  promptPerSecond: number;
  predictedPerSecond: number;
  promptMs: number;
  predictedMs: number;
  promptTokens: number;
  predictedTokens: number;
}

export interface AnalysisRunResult {
  text: string;
  wallMs: number;
  truncated: boolean;
  timings: AnalysisTimings | null;
}

export interface AnalysisRunOptions {
  lowPower?: boolean;
  maxTokens?: number;
  /** Schema JSON pedido ao modelo; padrao: o da analise. */
  schema?: Record<string, unknown>;
  onToken?(token: string): void;
  /** Recarrega o modelo antes de gerar (contexto limpo de ponta a ponta). */
  fresh?: boolean;
  /** Acao exibida no centro de atividade se a analise falhar. */
  failureAction?: ActivityAction;
}

export interface AnalysisNoteResult {
  content: ReturnType<typeof analysisNoteContent>;
  run: AnalysisRunResult;
  parsed: ReturnType<typeof parseAnalysisJson>;
}

// O aparelho e pequeno e a inferencia divide os nucleos com a interface. Quatro
// threads deixavam a nota (e a navegacao) travada por dezenas de segundos
// enquanto o modelo gerava; duas mantem o app respondendo. O modo de economia
// usa uma thread e demora mais, mas quase nao aparece.
const MAX_THREADS = 2;
const LOW_POWER_THREADS = 1;
const DEFAULT_CONTEXT = 4096;
const STOP_WORDS = ['</s>', '<|end|>', '<|im_end|>', '<|endoftext|>', '<|eot_id|>', '<|end_of_text|>'];

/** Threads da inferencia local (exportado para o diagnostico e os testes). */
export function analysisThreads(lowPower = false): number {
  return lowPower ? LOW_POWER_THREADS : MAX_THREADS;
}

let loaded: {
  modelId: string;
  context: LlamaContextHandle;
  threads: number;
} | null = null;

/**
 * Depois da ultima geracao o modelo fica residente por um tempo curto. Passar
 * uma revisao inteira logo depois da analise precisa dele quente; deixar o
 * modelo parado na memoria para sempre e o que empurra o Android a encerrar o
 * app em segundo plano.
 */
const IDLE_RELEASE_MS = 20_000;
let idleRelease: ReturnType<typeof setTimeout> | null = null;

function cancelIdleRelease(): void {
  if (idleRelease) clearTimeout(idleRelease);
  idleRelease = null;
}

function scheduleIdleRelease(): void {
  cancelIdleRelease();
  idleRelease = setTimeout(() => {
    idleRelease = null;
    void releaseAnalysisContext();
  }, IDLE_RELEASE_MS);
}

function loadLlama(): LlamaModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('llama.rn') as LlamaModule;
  } catch {
    return null;
  }
}

/** O build tem o modulo nativo do llama.rn? */
export function localAnalysisAvailable(): boolean {
  return Boolean(loadLlama());
}

/** Carrega (ou reaproveita) o contexto do modelo. */
export async function loadAnalysisContext(
  model: AnalysisModelInfo,
  options: { lowPower?: boolean; contextSize?: number } = {},
): Promise<void> {
  const threads = analysisThreads(options.lowPower);
  if (loaded?.modelId === model.id && loaded.threads === threads) {
    cancelIdleRelease();
    return;
  }
  await releaseAnalysisContext();

  // Um modelo maior que a RAM do aparelho nao e uma Analise lenta: e o
  // processo inteiro encerrado pelo Android. A tela de modelos ja avisa; aqui
  // o limite e efetivo, para nenhum caminho carregar o modelo mesmo assim.
  if (modelFitsDevice(model, Device.totalMemory) === false) {
    throw new Error('modelo grande para a memoria do aparelho');
  }

  const llama = loadLlama();
  const filePath = analysisModelFilePath(model.id);
  if (!llama || !filePath) throw new Error('engine indisponivel');

  const file = new File(filePath);
  if (!file.exists) throw new Error('modelo nao baixado');
  if (file.size !== model.sizeBytes) throw new Error('modelo incompleto');

  // Um motor por vez: o whisper (se estava quente) sai antes de o llama
  // alocar o contexto. Sem isso os dois modelos ficam residentes juntos.
  await reserveEngine('llama');
  cancelIdleRelease();

  const context = await llama.initLlama({
    model: filePath,
    n_ctx: options.contextSize ?? DEFAULT_CONTEXT,
    n_batch: 256,
    n_threads: threads,
    n_gpu_layers: 0,
    use_mmap: true,
    use_mlock: false,
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`carregar modelo: ${message}`);
  });
  loaded = { modelId: model.id, context, threads };
}

let releasing: Promise<void> | null = null;

export function releaseAnalysisContext(): Promise<void> {
  cancelIdleRelease();
  const current = loaded;
  loaded = null;
  if (!current) return releasing ?? Promise.resolve();
  // Guarda a liberacao em andamento: um novo load espera ela terminar em vez
  // de alocar outro modelo enquanto o anterior ainda esta saindo da memoria.
  const task = (async () => {
    try {
      await current.context.release();
    } catch {
      // contexto ja liberado
    }
  })();
  releasing = task;
  return task.finally(() => {
    if (releasing === task) releasing = null;
  });
}

registerEngineReleaser('llama', releaseAnalysisContext);

/** A geracao atual foi parada pelo usuario? */
let stopped = false;

/** A ultima geracao foi parada? (botao da tela ou do centro de atividade) */
export function analysisWasStopped(): boolean {
  return stopped;
}

/** Interrompe a geracao em andamento, se houver. */
export async function stopAnalysis(): Promise<void> {
  stopped = true;
  try {
    await loaded?.context.stopCompletion();
  } catch {
    // nada em andamento
  }
}

/**
 * Corpo da completion enviado ao llama.rn. O schema vem do chamador: a revisao
 * precisa do formato com `segments`, a analise do formato com sentiment/pessoas.
 * Fixa-lo aqui fazia a revisao pedir o schema da analise, e toda janela voltava
 * inutilizavel — sem aviso, e o texto ficava igual ao do whisper.
 */
export function completionRequest(
  messages: ReturnType<typeof buildAnalysisMessages>,
  options: AnalysisRunOptions = {},
) {
  return {
    messages,
    response_format: {
      type: 'json_schema',
      json_schema: { strict: true, schema: options.schema ?? ANALYSIS_SCHEMA },
    },
    // 600 da folga para o JSON fechar; 400 cortava respostas com 3+ temas.
    n_predict: options.maxTokens ?? 600,
    temperature: 0,
    top_k: 40,
    top_p: 0.95,
    stop: STOP_WORDS,
    enable_thinking: false,
  };
}

/** Analisa um texto com o modelo carregado. */
export async function runAnalysis(
  model: AnalysisModelInfo,
  messages: ReturnType<typeof buildAnalysisMessages>,
  options: AnalysisRunOptions = {},
): Promise<AnalysisRunResult> {
  // A analise manual pede um contexto novo: o cache da lib ja se mostrou
  // contaminado entre duas notas (a segunda vinha vazia).
  if (options.fresh) await releaseAnalysisContext();
  await loadAnalysisContext(model, { lowPower: options.lowPower });
  if (!loaded) throw new Error('contexto indisponivel');

  // O llama.rn mantem o cache de prompt entre completions. Sem limpar, a
  // segunda analise herda o contexto da primeira e pode voltar vazia ou com o
  // resultado anterior. Sempre comeca uma conversa nova.
  try {
    await loaded.context.clearCache?.();
  } catch {
    // versao sem suporte ou cache ja limpo: segue para a geracao
  }

  const started = Date.now();
  let result: CompletionResult;
  try {
    result = await loaded.context.completion(
      completionRequest(messages, options),
      options.onToken
        ? (data) => {
            if (data.token) options.onToken?.(data.token);
          }
        : undefined,
    );
  } finally {
    // A proxima janela da revisao (ou a proxima analise) chega antes do prazo e
    // cancela o timer; parado, o modelo sai da memoria sozinho.
    scheduleIdleRelease();
  }

  const timings = result.timings;
  return {
    text: (result.content || result.text || '').trim(),
    wallMs: Date.now() - started,
    truncated: Boolean(result.truncated),
    timings: timings
      ? {
          promptPerSecond: timings.prompt_per_second ?? 0,
          predictedPerSecond: timings.predicted_per_second ?? 0,
          promptMs: timings.prompt_ms ?? 0,
          predictedMs: timings.predicted_ms ?? 0,
          promptTokens: timings.prompt_n ?? 0,
          predictedTokens: timings.predicted_n ?? 0,
        }
      : null,
  };
}

/** Analisa uma nota do app e ja devolve o JSON normalizado. */
export async function analyzeRecording(
  recording: Recording,
  model: AnalysisModelInfo,
  options: AnalysisRunOptions = {},
): Promise<AnalysisNoteResult> {
  const content = analysisNoteContent(recording);
  const authorSettings = await loadAuthorSettings().catch(() => ({
    ownerName: '',
    allNotesMine: true,
  }));
  const author = effectiveAuthor(recording.author, authorSettings.allNotesMine);
  const activity = `analysis:${recording.id}`;
  let tokens = 0;
  stopped = false;
  // Espera a vez: uma transcricao/revisao em andamento e pausada (o gancho de
  // pausa das transcricoes) e o modelo do outro motor e liberado.
  const lease: HeavyLease = await acquireHeavyWork('analysis');

  startActivity({
    id: activity,
    kind: 'analysis',
    title: content.title || 'Sem título',
    detail: 'Preparando modelo',
    action: options.failureAction,
    stop: { label: 'Parar', run: stopAnalysis },
  });
  // Mantem o processo vivo com a tela apagada; o texto da notificacao e a
  // etapa, sem conteudo da nota.
  startForegroundTask('Analisando', content.title || 'Nota', -1);
  void notifyActivity({ stage: 'analyzing', noteTitle: content.title });

  try {
    const run = await runAnalysis(
      model,
      buildAnalysisMessages({
        title: content.title,
        text: content.text,
        recordedAt: recording.recordedAt,
        truncated: content.truncated,
        author,
        ownerName: authorSettings.ownerName,
      }),
      {
        ...options,
        onToken: (token) => {
          tokens += 1;
          options.onToken?.(token);
          // O total de tokens nao e conhecido: o contador e o sinal de que a
          // leitura esta avancando sem atualizar a interface a cada token.
          if (tokens === 1 || tokens % 16 === 0) {
            updateActivity(activity, {
              detail: `Gerando análise · ${tokens} token${tokens === 1 ? '' : 's'}`,
            });
          }
        },
      },
    );
    updateActivity(activity, { detail: 'Concluindo análise' });
    const parsed = parseAnalysisJson(run.text);
    finishActivity(activity, 'Análise pronta');
    void notifyIfHidden('Análise pronta', content.title || 'Nota');
    return {
      content,
      run,
      parsed: parsed ? interpretationOrOriginal(parsed, content.text) : null,
    };
  } catch (error) {
    // Parada pelo usuario nao e falha: o botao do centro dispara stopAnalysis.
    if (stopped) cancelActivity(activity, 'Análise interrompida');
    else failActivity(activity, 'Não foi possível analisar');
    throw error;
  } finally {
    stopForegroundTask();
    lease.release();
  }
}
