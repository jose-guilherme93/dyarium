/**
 * Engine local de analise com llama.rn (llama.cpp / GGUF).
 *
 * A nota e lida bloco por bloco: cada paragrafo (ou frase entre pausas) vira
 * uma chamada curta que devolve o contrato do bloco. O documento da nota e
 * composto no codigo, e so o final (uma frase) volta ao modelo. Assim o
 * resultado nao depende do tamanho da nota nem do tamanho do modelo; o que
 * varia e quantos blocos foram lidos.
 *
 * O modulo nativo e carregado tarde e protegido: antes do development build ele
 * nao existe, entao a tela de benchmark continua abrindo e avisa que a analise
 * local so fica disponivel depois do proximo build.
 */

import * as Device from 'expo-device';
import { File } from 'expo-file-system';

import {
  CHUNK_PROMPT_VERSION,
  CHUNK_SCHEMA,
  buildChunkMessages,
  contentWordList,
  groundChunk,
  parseChunkJson,
  type ChunkExtraction,
} from '@/core/analysisChunk';
import {
  composeAnalysis,
  type AnalysisChunkFact,
  type ComposedAnalysis,
} from '@/core/analysisCompose';
import { planAnalysis, type AnalysisBlock, type AnalysisPlan } from '@/core/analysisPlan';
import type { AnalysisStage } from '@/core/analysisStages';
import { analysisContentHash } from '@/core/analysisPrompt';
import {
  SUMMARY_SCHEMA,
  acceptSummary,
  buildSummaryMessages,
  derivedSentence,
  parseSummaryJson,
  summaryDigest,
} from '@/core/analysisSummary';
import { modelFitsDevice, type AnalysisModelInfo } from '@/core/analysisModels';
import { authorLabel } from '@/core/author';
import type { Recording } from '@/core/types';
import {
  cancelActivity,
  finishActivity,
  startActivity,
  updateActivity,
  type ActivityAction,
} from './activity';
import { analysisModelFilePath } from './analysisModels';
import { loadAuthorSettings } from './authorSettings';
import {
  deleteAnalysisChunks,
  listAnalysisChunks,
  listCachedAnalyses,
  saveAnalysisChunks,
  type StoredAnalysisChunk,
} from './db';
import {
  acquireHeavyWork,
  registerEngineReleaser,
  reserveEngine,
  type HeavyLease,
} from './heavyWork';
import { startForegroundTask, stopForegroundTask } from '../../modules/foreground-task';
import { notifyActivity, notifyIfHidden } from './notifications';

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
  completion(params: Record<string, unknown>): Promise<CompletionResult>;
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
  /** Schema JSON pedido ao modelo; padrao: o do bloco de analise. */
  schema?: Record<string, unknown>;
  /** Recarrega o modelo antes de gerar (contexto limpo de ponta a ponta). */
  fresh?: boolean;
  /** Acao exibida no centro de atividade se a analise falhar. */
  failureAction?: ActivityAction;
}

// O aparelho e pequeno e a inferencia divide os nucleos com a interface. Quatro
// threads deixavam a nota (e a navegacao) travada por dezenas de segundos
// enquanto o modelo gerava; duas mantem o app respondendo. O modo de economia
// usa uma thread e demora mais, mas quase nao aparece.
const MAX_THREADS = 2;
const LOW_POWER_THREADS = 1;
const DEFAULT_CONTEXT = 2048;
const STOP_WORDS = [
  '</s>',
  '<|end|>',
  '<|im_end|>',
  '<|endoftext|>',
  '<|eot_id|>',
  '<|end_of_text|>',
];

/**
 * Devolve a vez para a thread de JS. A passada e sequencial de proposito
 * (um bloco por vez), mas o intervalo entre blocos deixa a interface respirar:
 * digitar, rolar e navegar continuam respondendo durante a analise.
 */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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

/** O modelo ja esta carregado? Evita anunciar "carregando" quando esta quente. */
export function isAnalysisModelLoaded(modelId: string): boolean {
  return loaded?.modelId === modelId;
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

  const context = await llama
    .initLlama({
      model: filePath,
      n_ctx: options.contextSize ?? DEFAULT_CONTEXT,
      n_batch: 256,
      n_threads: threads,
      n_gpu_layers: 0,
      use_mmap: true,
      use_mlock: false,
    })
    .catch((error: unknown) => {
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

/**
 * Cada passada tem um id. Parar uma analise nao pode parar a que esta na frente
 * na fila, nem o contrario: o botao do centro de atividade sabe qual passada
 * pertence a ele.
 */
let passSeq = 0;
const stoppedPasses = new Set<number>();
/** Passada que esta usando o modelo agora (a fila e serial). */
let generatingPass = 0;

/** A passada foi parada? Sem id, responde pela ultima iniciada. */
export function analysisWasStopped(passId?: number): boolean {
  return stoppedPasses.has(passId ?? passSeq);
}

/** Interrompe uma passada (sem id: a ultima iniciada). */
export async function stopAnalysis(passId?: number): Promise<void> {
  if (passId !== undefined) {
    stoppedPasses.add(passId);
    // Parar uma passada que ainda espera a vez nao pode abortar a geracao da
    // que esta na frente.
    if (generatingPass !== passId) return;
  } else if (passSeq > 0) stoppedPasses.add(passSeq);
  try {
    await loaded?.context.stopCompletion();
  } catch {
    // nada em andamento
  }
}

/**
 * Corpo da completion enviado ao llama.rn. O schema vem do chamador: a revisao
 * precisa do formato com `segments`, a analise do formato do bloco.
 */
export function completionRequest(
  messages: ReturnType<typeof buildChunkMessages>,
  options: AnalysisRunOptions = {},
) {
  return {
    messages,
    response_format: {
      type: 'json_schema',
      json_schema: { strict: true, schema: options.schema ?? CHUNK_SCHEMA },
    },
    // O bloco devolve poucos itens; 220 cobre o JSON com folga e um bloco nao
    // pode gastar o tempo de uma nota inteira.
    n_predict: options.maxTokens ?? 220,
    // Parametros recomendados pelo cartao do LFM2.5: temperatura baixa (quase
    // deterministica, mas sem o travamento do ganancioso puro) e penalidade
    // suave. Eram 0 e 1.1, que num 230M rendiam listas vazias com facilidade.
    temperature: 0.1,
    top_k: 50,
    top_p: 0.95,
    penalty_repeat: 1.05,
    stop: STOP_WORDS,
    enable_thinking: false,
  };
}

/** Roda uma completion com o modelo carregado. */
export async function runAnalysis(
  model: AnalysisModelInfo,
  messages: ReturnType<typeof buildChunkMessages>,
  options: AnalysisRunOptions = {},
): Promise<AnalysisRunResult> {
  // A analise manual pede um contexto novo: o cache da lib ja se mostrou
  // contaminado entre duas notas (a segunda vinha vazia).
  if (options.fresh) await releaseAnalysisContext();
  await loadAnalysisContext(model, { lowPower: options.lowPower });
  if (!loaded) throw new Error('contexto indisponivel');

  // O llama.rn mantem o cache de prompt entre completions. Sem limpar, a
  // proxima analise herda o contexto da anterior e pode voltar vazia ou com o
  // resultado anterior. Sempre comeca uma conversa nova.
  try {
    await loaded.context.clearCache?.();
  } catch {
    // versao sem suporte ou cache ja limpo: segue para a geracao
  }

  const started = Date.now();
  let result: CompletionResult;
  try {
    // Sem callback de token: cada token atravessaria a ponte nativa para o JS e
    // disputaria a thread da interface com a digitacao. O progresso da tela vem
    // por bloco, e os tokens/tempo vem do `timings` que a propria lib devolve.
    result = await loaded.context.completion(completionRequest(messages, options));
  } finally {
    // A proxima janela da revisao (ou o proximo bloco) chega antes do prazo e
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

export interface AnalysisPassProgress {
  /** Blocos com resultado aceito (lidos agora ou retomados do cache). */
  read: number;
  total: number;
  blockIndex: number;
  /** Tokens gerados ate agora; atualiza por bloco, nunca por token. */
  tokens: number;
  /** Tokens por segundo da geracao ate agora. */
  tokensPerSecond: number;
}

export interface AnalysisPassOptions {
  lowPower?: boolean;
  /** Recomeca do zero: apaga os blocos ja lidos desta nota. */
  restart?: boolean;
  /** Gravacao de cada bloco para retomada; desligado no benchmark. */
  persist?: boolean;
  failureAction?: ActivityAction;
  onProgress?(progress: AnalysisPassProgress): void;
  /** Documento parcial a cada bloco, ja composto. */
  onPartial?(doc: ComposedAnalysis): void;
  /** Etapa da passada: na fila, carregando modelo, lendo ou escrevendo a frase. */
  onStage?(stage: AnalysisStage): void;
  /** Recebe o "parar" desta passada (a tela guarda para o botao Parar). */
  onStopHandle?(stop: () => void): void;
}

export interface AnalysisPassResult {
  doc: ComposedAnalysis;
  plan: AnalysisPlan;
  /** Todos os blocos foram lidos. */
  complete: boolean;
  stopped: boolean;
  /** Blocos que o modelo devolveu sem JSON utilizavel nesta passada. */
  rejected: number;
  /** Itens que o modelo devolveu e a ancoragem descartou (inventados/parafrase). */
  droppedItems: number;
  /** Blocos lidos pelo modelo agora (nao vieram do cache). */
  readNow: number;
  promptTokens: number;
  completionTokens: number;
  predictedPerSecond: number;
  wallMs: number;
  /** Hash de titulo + texto + transcricao. */
  contentHash: string;
}

/** Grafias ja usadas no aparelho, para nao criar duas pessoas com o mesmo nome. */
async function loadKnownEntities(
  entryKey: string,
): Promise<{ people: string[]; places: string[] }> {
  try {
    const items = await listCachedAnalyses();
    const people = new Set<string>();
    const places = new Set<string>();
    for (const item of items) {
      if (item.entryId === entryKey) continue;
      for (const name of item.analysis.people ?? []) {
        if (name.trim() !== '') people.add(name.trim());
      }
      for (const name of item.analysis.places ?? []) {
        if (name.trim() !== '') places.add(name.trim());
      }
      if (people.size >= 200 && places.size >= 200) break;
    }
    return {
      people: [...people].slice(0, 200),
      places: [...places].slice(0, 200),
    };
  } catch {
    return { people: [], places: [] };
  }
}

/**
 * Analisa uma nota inteira. Le so os blocos que ainda nao tem resultado valido
 * para o modelo e o prompt atuais; cada bloco fica gravado, entao parar e
 * continuar nao perde trabalho.
 */
export async function analyzeNote(
  recording: Pick<Recording, 'id' | 'text' | 'transcript' | 'transcriptSegments' | 'author'>,
  model: AnalysisModelInfo,
  options: AnalysisPassOptions & { entryKey: string; title: string },
): Promise<AnalysisPassResult> {
  const entryKey = options.entryKey;
  const persist = options.persist !== false;
  const plan = planAnalysis(recording);
  const contentHash = analysisContentHash({
    title: options.title,
    text: recording.text ?? '',
    transcript: recording.transcript ?? '',
  });
  const authorSettings = await loadAuthorSettings().catch(() => ({
    ownerName: '',
    allNotesMine: true,
  }));
  const author = authorLabel(
    recording.author,
    authorSettings.ownerName,
    authorSettings.allNotesMine,
  );
  const activity = `analysis:${recording.id}`;

  const startedAt = Date.now();
  let promptTokens = 0;
  let completionTokens = 0;
  let predictedMs = 0;
  let readNow = 0;
  let rejected = 0;
  let droppedItems = 0;

  const facts: AnalysisChunkFact[] = [];
  const stored = new Map<number, StoredAnalysisChunk>();
  if (persist && !options.restart) {
    for (const chunk of await listAnalysisChunks(entryKey).catch(() => [])) {
      stored.set(chunk.blockIndex, chunk);
    }
  }
  if (persist && options.restart) {
    await deleteAnalysisChunks(entryKey).catch(() => undefined);
  }
  const known = await loadKnownEntities(entryKey);

  const total = plan.blocks.length;
  const passId = ++passSeq;
  stoppedPasses.delete(passId);
  const stopThisPass = () => void stopAnalysis(passId);
  options.onStopHandle?.(stopThisPass);

  // A atividade nasce antes da fila: com duas analises pedidas, a segunda
  // aparece como "Na fila" em vez de sumir ate a vez dela.
  startActivity({
    id: activity,
    kind: 'analysis',
    title: options.title.trim() || 'Sem título',
    detail: 'Na fila',
    action: options.failureAction,
    stop: { label: 'Parar', run: stopThisPass },
  });
  // Mantem o processo vivo com a tela apagada; o texto da notificacao e a
  // etapa, sem conteudo da nota.
  startForegroundTask('Analisando', options.title.trim() || 'Nota', -1);
  void notifyActivity({ stage: 'analyzing', noteTitle: options.title.trim() });
  options.onStage?.('queued');

  const lease: HeavyLease = await acquireHeavyWork('analysis');
  updateActivity(activity, { detail: total > 0 ? `Preparando ${total} blocos` : 'Preparando' });
  // O primeiro bloco inclui carregar o modelo; se ele ja esta quente, pula a
  // fase de carga.
  options.onStage?.(isAnalysisModelLoaded(model.id) ? 'reading' : 'loading');

  try {
    const compose = (): ComposedAnalysis =>
      composeAnalysis({ blocks: plan.blocks, facts, model: model.id, known });
    let emittedReading = false;
    const report = (blockIndex: number) => {
      const read = facts.length;
      // Depois do primeiro bloco o modelo esta carregado: a ficha troca
      // "Carregando modelo" por "Lendo a nota".
      if (!emittedReading && read > 0) {
        emittedReading = true;
        options.onStage?.('reading');
      }
      updateActivity(activity, {
        detail: `Bloco ${read} de ${total}`,
        progress: total > 0 ? (read / total) * 100 : 0,
      });
      options.onProgress?.({
        read,
        total,
        blockIndex,
        tokens: completionTokens,
        tokensPerSecond: predictedMs > 0 ? (completionTokens * 1000) / predictedMs : 0,
      });
      options.onPartial?.(compose());
    };

    for (const block of plan.blocks) {
      if (analysisWasStopped(passId)) break;

      const cached = stored.get(block.index);
      const valid =
        cached &&
        cached.status === 'ok' &&
        cached.blockHash === block.hash &&
        cached.promptVersion === CHUNK_PROMPT_VERSION &&
        cached.model === model.id;
      if (valid && cached) {
        facts.push({ block, extraction: cached.extraction });
        report(block.index);
        await yieldToUi();
        continue;
      }

      const attempt = await readBlock(block, model, options, options.title, passId);
      if (attempt) {
        promptTokens += attempt.promptTokens;
        completionTokens += attempt.completionTokens;
        predictedMs += attempt.predictedMs;
        droppedItems += attempt.dropped;
        if (attempt.extraction) {
          facts.push({ block, extraction: attempt.extraction });
          readNow += 1;
          if (persist) {
            await saveAnalysisChunks([
              {
                entryId: entryKey,
                blockIndex: block.index,
                blockHash: block.hash,
                promptVersion: CHUNK_PROMPT_VERSION,
                model: model.id,
                status: 'ok',
                dropped: attempt.dropped,
                extraction: attempt.extraction,
              },
            ]).catch(() => undefined);
          }
        } else {
          rejected += 1;
          if (persist) {
            // Fica gravado como recusado: a proxima passada (Continuar) tenta de
            // novo em vez de tratar o bloco como lido.
            await saveAnalysisChunks([
              {
                entryId: entryKey,
                blockIndex: block.index,
                blockHash: block.hash,
                promptVersion: CHUNK_PROMPT_VERSION,
                model: model.id,
                status: 'rejected',
                dropped: 0,
                extraction: emptyExtraction(),
              },
            ]).catch(() => undefined);
          }
        }
      }
      report(block.index);
      // A inferencia roda em threads nativas; aqui devolvemos a vez para a
      // thread de JS entre um bloco e o proximo. Sem isso, uma analise longa
      // segurava toques, navegacao e teclado entre as chamadas.
      await yieldToUi();
    }

    const interrupted = analysisWasStopped(passId);

    // A frase: uma chamada sobre o documento composto, nunca sobre a nota.
    let doc = compose();
    if (!interrupted && doc.blocksTotal > 0 && doc.blocksRead === doc.blocksTotal) {
      updateActivity(activity, { detail: 'Escrevendo a frase' });
      options.onStage?.('sentence');
      generatingPass = passId;
      const sentence = await writeSentence(
        doc,
        plan.blocks,
        { title: options.title, author },
        model,
        options,
      );
      generatingPass = 0;
      promptTokens += sentence.promptTokens;
      completionTokens += sentence.completionTokens;
      predictedMs += sentence.predictedMs;
      doc = {
        ...doc,
        sentence: sentence.text,
        sentenceSource: sentence.source,
      };
    } else if (doc.sentence === '') {
      doc = {
        ...doc,
        sentence: derivedSentence(doc),
        sentenceSource: 'derived',
      };
    }

    if (interrupted) cancelActivity(activity, 'Análise interrompida');
    else if (doc.complete) finishActivity(activity, 'Análise pronta');
    else finishActivity(activity, `Análise parcial · ${doc.blocksRead} de ${doc.blocksTotal}`);
    if (!interrupted && doc.complete) {
      void notifyIfHidden('Análise pronta', options.title.trim() || 'Nota');
    }

    const wallMs = Math.max(0, Date.now() - startedAt);
    return {
      doc,
      plan,
      complete: doc.complete,
      stopped: interrupted,
      rejected,
      droppedItems,
      readNow,
      promptTokens,
      completionTokens,
      predictedPerSecond: predictedMs > 0 ? (completionTokens * 1000) / predictedMs : 0,
      wallMs,
      contentHash,
    };
  } finally {
    // O processo em primeiro plano e a vez na fila saem mesmo se a composicao
    // ou a frase falharem: um erro aqui nao pode deixar o app preso.
    stopForegroundTask();
    lease.release();
    stoppedPasses.delete(passId);
  }
}

function emptyExtraction(): ChunkExtraction {
  return {
    tone: 0,
    emotions: [],
    themes: [],
    people: [],
    places: [],
    events: [],
    decisions: [],
    tasks: [],
    ideas: [],
    epiphanies: [],
    moments: [],
  };
}

interface BlockAttempt {
  extraction: ChunkExtraction | null;
  dropped: number;
  promptTokens: number;
  completionTokens: number;
  predictedMs: number;
}

/**
 * Le um bloco e ancora a resposta no texto.
 *
 * Duas tentativas com o prompt completo (a segunda com mais tokens, para JSON
 * cortado). Se o modelo devolver JSON valido porem sem nenhum item, uma terceira
 * tentativa usa o prompt curto: e o que salva um bloco com um modelo pequeno,
 * que se perde no prompt longo. Bloco curto demais nao paga a terceira chamada.
 * null = nenhum JSON utilizavel em nenhuma tentativa.
 */
async function readBlock(
  block: AnalysisBlock,
  model: AnalysisModelInfo,
  options: AnalysisPassOptions,
  title: string,
  passId: number,
): Promise<BlockAttempt | null> {
  let promptTokens = 0;
  let completionTokens = 0;
  let predictedMs = 0;
  let best: BlockAttempt | null = null;
  const attempts: { maxTokens: number; compact: boolean }[] = [
    { maxTokens: 260, compact: false },
    { maxTokens: 380, compact: false },
  ];
  // Um bloco com pouco conteudo provavelmente nao tem o que extrair; nao vale
  // uma terceira chamada so para confirmar o vazio.
  if (contentWordList(block.text).length >= 12) {
    attempts.push({ maxTokens: 380, compact: true });
  }

  for (const attempt of attempts) {
    generatingPass = passId;
    try {
      const run = await runAnalysis(
        model,
        buildChunkMessages(
          {
            title,
            block: { text: block.text, context: block.context },
          },
          { compact: attempt.compact },
        ),
        {
          lowPower: options.lowPower,
          maxTokens: attempt.maxTokens,
          schema: CHUNK_SCHEMA,
        },
      );
      promptTokens += run.timings?.promptTokens ?? 0;
      completionTokens += run.timings?.predictedTokens ?? 0;
      predictedMs += run.timings?.predictedMs ?? run.wallMs;
      const parsed = parseChunkJson(run.text);
      if (!parsed) continue;
      const grounded = groundChunk(parsed, block.text);
      const result: BlockAttempt = {
        extraction: grounded.extraction,
        dropped: grounded.dropped,
        promptTokens,
        completionTokens,
        predictedMs,
      };
      // Qualquer item ancorado encerra a leitura; vazio vale como resposta, mas
      // ainda pode melhorar com o prompt curto.
      if (extractionHasItems(grounded.extraction)) return result;
      best = best ?? result;
    } catch (error) {
      if (analysisWasStopped(passId)) return null;
      console.warn(
        '[analysis] bloco falhou',
        error instanceof Error ? error.message : 'erro desconhecido',
      );
    } finally {
      if (generatingPass === passId) generatingPass = 0;
    }
  }
  // O diagnostico conta todas as tentativas, nao so a que ficou com o
  // resultado: e o custo real do bloco.
  return best
    ? { ...best, promptTokens, completionTokens, predictedMs }
    : {
        extraction: null,
        dropped: 0,
        promptTokens,
        completionTokens,
        predictedMs,
      };
}

/** O bloco devolveu alguma coisa alem do tom? */
function extractionHasItems(extraction: ChunkExtraction): boolean {
  return (
    extraction.people.length > 0 ||
    extraction.places.length > 0 ||
    extraction.emotions.length > 0 ||
    extraction.themes.length > 0 ||
    extraction.events.length > 0 ||
    extraction.decisions.length > 0 ||
    extraction.tasks.length > 0 ||
    extraction.ideas.length > 0 ||
    extraction.epiphanies.length > 0 ||
    extraction.moments.length > 0
  );
}

/** Uma frase sobre a nota, escrita a partir do documento composto. */
async function writeSentence(
  doc: ComposedAnalysis,
  blocks: AnalysisBlock[],
  input: { title: string; author: string },
  model: AnalysisModelInfo,
  options: AnalysisPassOptions,
): Promise<{
  text: string;
  source: 'model' | 'derived';
  promptTokens: number;
  completionTokens: number;
  predictedMs: number;
}> {
  const digest = summaryDigest(doc, blocks, input);
  const empty = { promptTokens: 0, completionTokens: 0, predictedMs: 0 };
  try {
    const run = await runAnalysis(model, buildSummaryMessages({ digest }), {
      lowPower: options.lowPower,
      maxTokens: 120,
      schema: SUMMARY_SCHEMA,
    });
    const source = [digest.trecho, ...digest.momentos.map((moment) => moment.texto)].join(' ');
    const timing = {
      promptTokens: run.timings?.promptTokens ?? 0,
      completionTokens: run.timings?.predictedTokens ?? 0,
      predictedMs: run.timings?.predictedMs ?? run.wallMs,
    };
    const sentence = parseSummaryJson(run.text);
    if (sentence && acceptSummary(sentence, source, digest)) {
      return { text: sentence, source: 'model', ...timing };
    }
    return { text: derivedSentence(doc), source: 'derived', ...timing };
  } catch {
    return { text: derivedSentence(doc), source: 'derived', ...empty };
  }
}
