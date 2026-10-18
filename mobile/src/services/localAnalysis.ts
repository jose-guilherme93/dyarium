/**
 * Engine local de analise com llama.rn (llama.cpp / GGUF).
 *
 * O modulo nativo e carregado tarde e protegido: antes do development build ele
 * nao existe, entao a tela de benchmark continua abrindo e avisa que a analise
 * local so fica disponivel depois do proximo build.
 */

import { File } from 'expo-file-system';

import {
  analysisNoteContent,
  buildAnalysisMessages,
  interpretationOrOriginal,
  parseAnalysisJson,
  ANALYSIS_SCHEMA,
} from '@/core/analysisPrompt';
import type { AnalysisModelInfo } from '@/core/analysisModels';
import type { Recording } from '@/core/types';
import { analysisModelFilePath } from './analysisModels';

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
  onToken?(token: string): void;
  /** Recarrega o modelo antes de gerar (contexto limpo de ponta a ponta). */
  fresh?: boolean;
}

export interface AnalysisNoteResult {
  content: ReturnType<typeof analysisNoteContent>;
  run: AnalysisRunResult;
  parsed: ReturnType<typeof parseAnalysisJson>;
}

const MAX_THREADS = 4;
const LOW_POWER_THREADS = 2;
const DEFAULT_CONTEXT = 4096;
const STOP_WORDS = ['</s>', '<|end|>', '<|im_end|>', '<|endoftext|>', '<|eot_id|>', '<|end_of_text|>'];

let loaded: { modelId: string; context: LlamaContextHandle } | null = null;

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
  if (loaded?.modelId === model.id) return;
  await releaseAnalysisContext();

  const llama = loadLlama();
  const filePath = analysisModelFilePath(model.id);
  if (!llama || !filePath) throw new Error('engine indisponivel');

  const file = new File(filePath);
  if (!file.exists) throw new Error('modelo nao baixado');
  if (file.size !== model.sizeBytes) throw new Error('modelo incompleto');

  const context = await llama.initLlama({
    model: filePath,
    n_ctx: options.contextSize ?? DEFAULT_CONTEXT,
    n_batch: 256,
    n_threads: options.lowPower ? LOW_POWER_THREADS : MAX_THREADS,
    n_gpu_layers: 0,
    use_mmap: true,
    use_mlock: false,
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`carregar modelo: ${message}`);
  });
  loaded = { modelId: model.id, context };
}

export async function releaseAnalysisContext(): Promise<void> {
  const current = loaded;
  loaded = null;
  if (!current) return;
  try {
    await current.context.release();
  } catch {
    // contexto ja liberado
  }
}

/** Interrompe a geracao em andamento, se houver. */
export async function stopAnalysis(): Promise<void> {
  try {
    await loaded?.context.stopCompletion();
  } catch {
    // nada em andamento
  }
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
  const result = await loaded.context.completion(
    {
      messages,
      response_format: {
        type: 'json_schema',
        json_schema: { strict: true, schema: ANALYSIS_SCHEMA },
      },
      // 600 da folga para o JSON fechar; 400 cortava respostas com 3+ temas.
      n_predict: options.maxTokens ?? 600,
      temperature: 0,
      top_k: 40,
      top_p: 0.95,
      stop: STOP_WORDS,
      enable_thinking: false,
    },
    options.onToken
      ? (data) => {
          if (data.token) options.onToken?.(data.token);
        }
      : undefined,
  );

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
  const run = await runAnalysis(
    model,
    buildAnalysisMessages({
      title: content.title,
      text: content.text,
      recordedAt: recording.recordedAt,
      truncated: content.truncated,
    }),
    options,
  );
  const parsed = parseAnalysisJson(run.text);
  return {
    content,
    run,
    parsed: parsed ? interpretationOrOriginal(parsed, content.text) : null,
  };
}
