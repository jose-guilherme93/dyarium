/**
 * Transcricao no aparelho com whisper.rn (whisper.cpp).
 *
 * O app grava AAC em ADTS; o modulo nativo local decodifica para WAV 16 kHz mono
 * e o whisper transcreve o WAV. Modulos nativos tem `require` tardio e protegido
 * — no build atual eles nao existem, entao a transcricao local fica indisponivel
 * e o app segue usando o servidor, sem quebrar.
 *
 * O resultado e gravado no SQLite a cada trecho (origem `local`), entao o texto
 * aparece progressivamente na nota e sobrevive a fechar o app.
 */

import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { AppState } from 'react-native';

import { hasTranscribableTail, whisperLanguage } from '@/core/transcription';
import { displayTitle } from '@/core/title';
import { hasFinalTranscript, shouldAutoTranscribe, type Recording, type TranscriptSegment } from '@/core/types';

import { audioDecodeAvailable, decodeToWav } from '../../modules/audio-decode';
import {
  startForegroundTask,
  stopForegroundTask,
  updateForegroundTask,
} from '../../modules/foreground-task';
import { cancelActivity, failActivity, finishActivity, startActivity, updateActivity } from './activity';
import { DeepgramError, transcribeDeepgramWindow } from './deepgram';
import { getRecording, listRecordings, upsertRecording } from './db';
import {
  acquireHeavyWork,
  registerEngineReleaser,
  registerTranscriptionPause,
  reserveEngine,
} from './heavyWork';
import { ensureNotificationPermission, notifyIfHidden } from './notifications';
import { emitRecording } from './uploaderLoop';
import { loadPrefs, loadProviderKey } from './secure';
import { resolveTranscriptionModel, modelFilePath } from './transcriptionModels';
import { pushTranscript } from './transcriptSync';
import { transcribeRecordingOnServer } from './transcripts';
import {
  loadWhisper,
  localTranscriptionAvailable,
  transcriptionPlace,
  willTranscribeLocally,
  type WhisperContext,
  type WhisperModule,
  type WhisperSegment,
} from './whisper';
import { DEFAULT_DEEPGRAM_MODEL } from '@/core/providers';

export { localTranscriptionAvailable, willTranscribeLocally };

// O aparelho e pequeno: 4 threads de whisper saturam os nucleos e a interface
// trava enquanto a nota transcreve. Duas threads transcrevem um pouco mais
// devagar, mas o app continua respondendo (digitar, rolar, tocar audio).
const MAX_THREADS = 2;
/**
 * Intervalo minimo entre gravacoes parciais (evita re-render a cada trecho).
 * A nota aberta nao pode perder digitacao enquanto o texto progride: cada
 * gravacao atualiza a biblioteca e re-renderiza a tela, entao 3 s e o menor
 * intervalo que ainda parece progressivo sem atrapalhar quem escreve.
 */
const PERSIST_THROTTLE_MS = 3000;
/**
 * Tempo que o modelo do whisper fica quente depois de uma passada. Uma nota
 * seguinte aproveita o mesmo contexto; parado, ele sai da memoria para o
 * Android nao encerrar o app em segundo plano.
 */
const CONTEXT_IDLE_RELEASE_MS = 20_000;

const contexts = new Map<string, WhisperContext>();
const running = new Set<string>();

// Progresso (0..100) por gravacao, em memoria: a UI acompanha sem gravar no banco.
const progressValues = new Map<string, number>();
const progressListeners = new Map<string, Set<(percent: number) => void>>();
const runningListeners = new Map<string, Set<(running: boolean) => void>>();
/** Pedido de parada por gravacao (a janela atual termina e o loop para). */
const cancelled = new Set<string>();

/**
 * Notas que o usuario parou nesta sessao. O boot nao tenta de novo sozinho:
 * uma transcricao lenta nao pode virar um laco a cada abertura. O botao
 * "Transcrever" limpa a marca e tenta na hora.
 */
const manualStops = new Set<string>();
/** Handle nativo da janela em andamento, para parar na hora quando possivel. */
const activeRuns = new Map<string, { stop: () => Promise<void> }>();
/** A notificacao de progresso esta na tela (o servico em primeiro plano roda). */
let foregroundOn = false;
let contextReleaseTimer: ReturnType<typeof setTimeout> | null = null;

function cancelContextRelease(): void {
  if (contextReleaseTimer) clearTimeout(contextReleaseTimer);
  contextReleaseTimer = null;
}

function scheduleContextRelease(): void {
  cancelContextRelease();
  contextReleaseTimer = setTimeout(() => {
    contextReleaseTimer = null;
    if (running.size > 0) return;
    void releaseTranscriptionContexts();
  }, CONTEXT_IDLE_RELEASE_MS);
}

/** Acompanha o progresso da transcricao de uma gravacao. */
export function subscribeTranscriptionProgress(
  id: string,
  listener: (percent: number) => void,
): () => void {
  const set = progressListeners.get(id) ?? new Set();
  set.add(listener);
  progressListeners.set(id, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) progressListeners.delete(id);
  };
}

export function transcriptionProgress(id: string): number {
  return progressValues.get(id) ?? 0;
}

/** A transcricao desta gravacao esta rodando agora? */
export function isTranscribing(id: string): boolean {
  return running.has(id);
}

/** Acompanha inicio/fim da transcricao (para o botao do card). */
export function subscribeTranscriptionRunning(
  id: string,
  listener: (running: boolean) => void,
): () => void {
  const set = runningListeners.get(id) ?? new Set();
  set.add(listener);
  runningListeners.set(id, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) runningListeners.delete(id);
  };
}

function setRunning(id: string, value: boolean): void {
  if (running.has(id) === value) return;
  if (value) running.add(id);
  else running.delete(id);
  runningListeners.get(id)?.forEach((listener) => listener(value));
}

/**
 * Para a transcricao desta gravacao.
 *
 * O checkpoint ja gravado fica valido: a proxima execucao (manual ou em
 * segundo plano) retoma de onde parou. O botao do card usa isto para o usuario
 * nunca ficar preso a uma transcricao longa.
 */
export async function stopTranscription(
  id: string,
  options: { manual?: boolean } = {},
): Promise<void> {
  cancelled.add(id);
  // So a parada pedida pelo usuario marca a nota: uma pausa interna (watchdog,
  // analise) nao pode impedir a retomada no proximo boot.
  if (options.manual !== false) manualStops.add(id);
  updateActivity(activityId(id), { detail: 'Parando após o trecho atual' });
  const run = activeRuns.get(id);
  if (!run) {
    setRunning(id, false);
    return;
  }
  // O nativo pode ignorar o pedido de parada; o botao nao pode continuar
  // dizendo "Transcrevendo" por causa disso.
  await Promise.race([
    run.stop().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ]);
  setRunning(id, false);
}

// Analise/revisao pedida pelo usuario tem prioridade: a transcricao em curso
// para no fim desta janela (o checkpoint fica salvo) em vez de disputar CPU e
// memoria com o llama.
registerTranscriptionPause(() => {
  for (const id of [...running]) void stopTranscription(id, { manual: false });
});

registerEngineReleaser('whisper', releaseTranscriptionContexts);

/** Id estavel da atividade: parar/retomar a mesma nota nao cria duas linhas. */
function activityId(id: string): string {
  return `transcription:${id}`;
}

function setProgress(id: string, percent: number): void {
  const next = Math.max(0, Math.min(100, percent));
  const previous = progressValues.get(id);
  // O whisper reporta varias vezes por porcento. A tela inteira re-renderiza a
  // cada aviso; notificar so quando o inteiro muda evita jank durante a leitura.
  if (previous !== undefined && Math.floor(previous) === Math.floor(next)) return;
  progressValues.set(id, next);
  progressListeners.get(id)?.forEach((listener) => listener(next));
  updateActivity(activityId(id), { progress: next });
  if (foregroundOn) {
    // A barra de notificacoes e o unico lugar onde o progresso aparece com o
    // app em segundo plano; o texto acompanha a mesma porcentagem da nota.
    updateForegroundTask(
      'Transcrevendo',
      `${Math.round(next)}% concluído`,
      Math.round(next),
    );
  }
}

let releasingContexts: Promise<void> | null = null;
/** Pedido de liberacao que chegou com uma passada em andamento. */
let releaseRequested = false;
/** Modelo em uso pela passada atual; nunca e liberado debaixo do whisper. */
let activeModelId: string | null = null;

/** Libera os contextos do whisper (ao apagar/trocar de modelo ou por ociosidade). */
export function releaseTranscriptionContexts(): Promise<void> {
  cancelContextRelease();
  const active = activeModelId;
  // Nunca solta um contexto em uso: o modulo nativo nao sobrevive a isso. Ele
  // fica para o fim da passada, quando `releaseRequested` e aplicado.
  const keep = active ? contexts.get(active) : undefined;
  const loaded: WhisperContext[] = [];
  for (const [modelId, context] of contexts) {
    if (modelId !== active) loaded.push(context);
  }
  contexts.clear();
  if (keep && active) contexts.set(active, keep);
  if (keep) releaseRequested = true;
  if (loaded.length === 0) return releasingContexts ?? Promise.resolve();
  // Um novo carregamento espera a liberacao em andamento: dois modelos do
  // whisper residentes ao mesmo tempo tambem pesam.
  const task = (async () => {
    for (const context of loaded) {
      try {
        await context.release();
      } catch {
        // ja liberado
      }
    }
  })();
  releasingContexts = task;
  return task.finally(() => {
    if (releasingContexts === task) releasingContexts = null;
  });
}

async function getContext(
  whisper: WhisperModule,
  modelId: string,
  filePath: string,
): Promise<WhisperContext> {
  const existing = contexts.get(modelId);
  if (existing) {
    activeModelId = modelId;
    cancelContextRelease();
    return existing;
  }
  // Trocar de modelo nao pode deixar o anterior residente: no maximo um
  // contexto de whisper por vez. O modelo em uso so sai no fim da passada.
  if (contexts.size > 0) await releaseTranscriptionContexts();
  // O llama (analise/revisao) nao pode estar residente quando o whisper aloca o
  // modelo: os dois juntos bastam para o Android encerrar o processo.
  await reserveEngine('whisper');
  cancelContextRelease();
  const context = await whisper.initWhisper({ filePath });
  contexts.set(modelId, context);
  activeModelId = modelId;
  return context;
}

async function persist(base: Recording, patch: Partial<Recording>): Promise<void> {
  const current = (await getRecording(base.id)) ?? base;
  const updated: Recording = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await upsertRecording(updated);
  emitRecording(updated);
}

function toSegments(segments: WhisperSegment[], offsetMs = 0): TranscriptSegment[] {
  return segments.map((segment) => ({
    // whisper.cpp mede os tempos em centesimos de segundo.
    start_ms: offsetMs + segment.t0 * 10,
    end_ms: offsetMs + segment.t1 * 10,
    text: segment.text.trim(),
  }));
}

/**
 * Diretorio de trabalho da transcricao.
 *
 * Documentos, nao cache: o sistema pode limpar o cache no meio de uma passada
 * longa, e o WAV decodificado sumiria entre uma janela e a seguinte. Os
 * arquivos sao apagados no fim (ou no inicio da proxima passada da nota).
 */
function workDirectory(): Directory {
  const dir = new Directory(Paths.document, 'whisper-work');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Caminho do WAV decodificado usado na transcricao. */
function wavPathFor(id: string): string {
  return new File(workDirectory(), `${id}.wav`).uri;
}

/** Janela de cada chamada do motor. O checkpoint fica no fim da janela. */
const CHUNK_MS = 60_000;
/** WAV do decoder: PCM 16-bit mono a 16 kHz = 32 bytes por ms. */
const WAV_HEADER_BYTES = 44;
const WAV_BYTES_PER_MS = (16_000 * 2) / 1000;

function readBytesAt(path: string, offset: number, length: number): Uint8Array {
  const handle = new File(path).open(FileMode.ReadOnly);
  try {
    if (offset > 0) handle.offset = offset;
    return handle.readBytes(length);
  } finally {
    handle.close();
  }
}

/** Duracao do WAV decodificado, pelo tamanho do chunk de dados. */
function wavDurationMs(path: string): number {
  try {
    const size = new File(path).size ?? 0;
    return Math.max(0, (size - WAV_HEADER_BYTES) / WAV_BYTES_PER_MS);
  } catch {
    return 0;
  }
}

/**
 * Copia um trecho do WAV para outro arquivo, com header ajustado. E o que
 * permite transcrever em janelas e retomar de um checkpoint sem decodificar o
 * audio original de novo.
 */
async function writeWavRange(
  sourcePath: string,
  targetPath: string,
  fromMs: number,
  toMs: number,
): Promise<{ startMs: number; endMs: number }> {
  const source = new File(sourcePath);
  const dataBytes = Math.max(0, (source.size ?? 0) - WAV_HEADER_BYTES);
  const startByte = Math.min(
    dataBytes,
    Math.max(0, Math.floor((fromMs * WAV_BYTES_PER_MS) / 2) * 2),
  );
  const endByte = Math.min(
    dataBytes,
    Math.max(startByte, Math.ceil((toMs * WAV_BYTES_PER_MS) / 2) * 2),
  );

  const header = readBytesAt(sourcePath, 0, WAV_HEADER_BYTES);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  view.setUint32(4, 36 + (endByte - startByte), true);
  view.setUint32(40, endByte - startByte, true);

  const target = new File(targetPath);
  if (target.exists) target.delete();
  target.create({ intermediates: true, overwrite: true });
  const output = target.open(FileMode.Append);
  try {
    output.writeBytes(header);
    const input = source.open(FileMode.ReadOnly);
    try {
      input.offset = WAV_HEADER_BYTES + startByte;
      let remaining = endByte - startByte;
      while (remaining > 0) {
        const chunk = input.readBytes(Math.min(1 << 20, remaining));
        if (chunk.length === 0) break;
        output.writeBytes(chunk);
        remaining -= chunk.length;
      }
    } finally {
      input.close();
    }
  } finally {
    output.close();
  }
  return {
    startMs: startByte / WAV_BYTES_PER_MS,
    endMs: endByte / WAV_BYTES_PER_MS,
  };
}

function chunkPathFor(id: string): string {
  return new File(workDirectory(), `${id}.chunk.wav`).uri;
}

/** Le um arquivo inteiro (janela de 60 s = ~2 MB). */
function readWholeFile(path: string): Uint8Array {
  const file = new File(path);
  const handle = file.open(FileMode.ReadOnly);
  try {
    return handle.readBytes(file.size ?? 0);
  } finally {
    handle.close();
  }
}

/** Apaga os arquivos de trabalho desta nota, se existirem. */
function deleteWorkFiles(id: string, paths: string[]): void {
  for (const path of paths) {
    if (!path) continue;
    try {
      const file = new File(path);
      if (file.exists) file.delete();
    } catch {
      // arquivo ja removido ou sem permissao: a proxima passada limpa de novo
    }
  }
}

/** Maior fim de segmento (checkpoint de uma transcricao antiga sem campo). */
function lastSegmentEnd(segments: TranscriptSegment[]): number {
  let end = 0;
  for (const segment of segments) {
    if (segment.end_ms > end) end = segment.end_ms;
  }
  return end;
}


/** Motivo de uma transcorrencia que nao terminou. A tela traduz; nada vaza. */
export type TranscriptionFailure =
  | 'no_model'
  | 'no_key'
  | 'invalid_key'
  | 'provider'
  | 'unsupported'
  | 'cancelled'
  | 'engine';

export interface TranscriptionOutcome {
  status: 'ready' | 'pending' | 'skipped';
  reason?: TranscriptionFailure;
}

/** Um pedido de parada da janela em andamento (nativo ou HTTP). */
interface ActiveRun {
  stop(): Promise<void>;
}

function failureReason(error: unknown): TranscriptionFailure {
  if (error instanceof DeepgramError) {
    if (error.code === 'invalid_key') return 'invalid_key';
    if (error.code === 'forbidden') return 'invalid_key';
    return 'provider';
  }
  return 'engine';
}

/** Espera curta entre tentativas de uma janela online. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Watchdog de janela: o prazo reinicia a cada progresso do motor. Nao existe
 * prazo para a passada inteira — um audio de 41 minutos tem 41 janelas e cada
 * uma vale por si. So para quando o motor fica parado de verdade.
 */
function stallGuard(ms: number): {
  promise: Promise<never>;
  tick(): void;
  clear(): void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let rejectFn: ((error: Error) => void) | null = null;
  const promise = new Promise<never>((_, reject) => {
    rejectFn = reject;
  });
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => rejectFn?.(new Error('motor parado')), ms);
  };
  arm();
  return {
    promise,
    tick: arm,
    clear: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Uma janela na Deepgram, com nova tentativa para falha passageira. */
async function onlineWindow(
  id: string,
  input: Parameters<typeof transcribeDeepgramWindow>[0],
): Promise<Awaited<ReturnType<typeof transcribeDeepgramWindow>>> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (cancelled.has(id)) throw new Error('transcricao cancelada');
    try {
      return await transcribeDeepgramWindow(input);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof DeepgramError && error.retryable;
      if (!retryable) throw error;
      await wait(800 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('deepgram falhou');
}

/**
 * Transcreve no aparelho (whisper.cpp). Idempotente por gravacao: grava o texto
 * a cada trecho (progressivo) e marca `hasTranscript` ao final.
 */
export async function transcribeLocally(id: string): Promise<TranscriptionOutcome> {
  return runTranscription(id, 'device');
}

/**
 * Transcreve no provedor online com a chave do aparelho. Mesmas janelas,
 * mesmo checkpoint e mesma retomada do motor local.
 */
export async function transcribeOnline(id: string): Promise<TranscriptionOutcome> {
  return runTranscription(id, 'online');
}

/** Motor conforme o lugar escolhido agora (aparelho ou online). */
export async function transcribeRecording(id: string): Promise<TranscriptionOutcome> {
  const place = await transcriptionPlace();
  if (place.place === 'online') return transcribeOnline(id);
  if (place.place === 'device') return transcribeLocally(id);
  // Servidor (ou desligada): quem comeca a etapa e o outro lado, nunca este.
  return { status: 'skipped', reason: place.place === 'server' ? 'engine' : undefined };
}

async function runTranscription(
  id: string,
  engine: 'device' | 'online',
): Promise<TranscriptionOutcome> {
  if (running.has(id)) return { status: 'skipped', reason: 'engine' };
  // Qualquer pedido explicito (botao, retry) vence uma parada manual anterior.
  manualStops.delete(id);
  const recording = await getRecording(id);
  // Nota apagada: nao tenta transcrever; mantem a atividade no historico
  // marcada como interrompida (so o usuario apaga).
  if (!recording) {
    cancelActivity(activityId(id), 'Nota apagada');
    return { status: 'skipped' };
  }
  if (!recording.filePath) return { status: 'skipped' };
  // Transcricao terminada, local ou do servidor, nao e refeita sozinha.
  if (hasFinalTranscript(recording)) return { status: 'ready' };

  const prefs = await loadPrefs();
  const isOnline = engine === 'online';
  // O modelo vem dos arquivos instalados: preferencia apontando para um id que
  // sumiu do disco nao vira "sem modelo" se outro modelo esta la.
  let model: ReturnType<typeof resolveTranscriptionModel> = null;
  let modelPath: string | null = null;
  if (!isOnline) {
    model = resolveTranscriptionModel(prefs.transcriptionModel);
    modelPath = model ? modelFilePath(model.id) : null;
    if (!model || !modelPath) return { status: 'skipped', reason: 'no_model' };
    if (!new File(modelPath).exists) return { status: 'skipped', reason: 'no_model' };
  }
  const onlineKey = isOnline ? await loadProviderKey('transcription') : null;
  if (isOnline && !onlineKey) return { status: 'skipped', reason: 'no_key' };
  if (!audioDecodeAvailable()) return { status: 'skipped', reason: 'unsupported' };
  const whisper = isOnline ? null : loadWhisper();
  if (!isOnline && !whisper) return { status: 'skipped', reason: 'unsupported' };

  if (__DEV__) console.log('[perf] transcricao.comecou', { id, engine, ms: Date.now() });

  const priorSegments = recording.transcriptSegments ?? [];
  const priorCheckpoint =
    recording.transcriptCheckpointMs ?? (priorSegments.length > 0 ? lastSegmentEnd(priorSegments) : 0);
  let checkpoint = Math.max(0, priorCheckpoint);
  // Segmentos de uma janela interrompida ficam de fora: ela sera transcrita de
  // novo a partir do checkpoint (no maximo 60 s repetidos, nunca a nota inteira).
  let committed = priorSegments.filter((segment) => segment.start_ms < checkpoint);
  const knownDuration = recording.durationMs ?? 0;

  // A atividade nasce antes da fila: um trabalho que espera a vez (ou uma fila
  // travada por um lease antigo) precisa aparecer para o usuario. Sem isto, o
  // toque em "continuar" parecia nao ter feito nada.
  const activity = activityId(id);
  startActivity({
    id: activity,
    kind: 'transcription',
    title: displayTitle(recording),
    detail: checkpoint > 0 ? 'Retomando transcrição' : 'Na fila',
    progress: transcriptionProgress(id) > 0 ? transcriptionProgress(id) : undefined,
    action: { label: 'Tentar de novo', run: () => retryTranscription(id) },
    stop: { label: 'Parar', run: () => stopTranscription(id) },
  });

  // A fila garante um motor por vez. Enquanto espera, a nota pode ter sido
  // transcrita por outro caminho ou o usuario pode ter parado a passada.
  const lease = await acquireHeavyWork('transcription');
  let afterWait: Recording | null = null;
  try {
    afterWait = await getRecording(id);
  } catch {
    cancelActivity(activity, 'Não foi possível ler a nota');
    lease.release();
    return { status: 'skipped', reason: 'engine' };
  }
  if (
    running.has(id) ||
    cancelled.has(id) ||
    !afterWait?.filePath ||
    hasFinalTranscript(afterWait)
  ) {
    cancelled.delete(id);
    cancelActivity(activity, 'Já não precisa');
    lease.release();
    return { status: 'skipped' };
  }
  // A vez chegou com o app ja em segundo plano: nao inicia uma passada nova
  // sem servico em primeiro plano. O checkpoint fica para a proxima abertura.
  if (AppState.currentState !== 'active') {
    cancelled.delete(id);
    cancelActivity(activity, 'Aguardando o app');
    lease.release();
    return { status: 'pending', reason: 'engine' };
  }
  cancelled.delete(id);
  cancelContextRelease();
  setRunning(id, true);
  setProgress(id, knownDuration > 0 ? Math.min(100, (checkpoint / knownDuration) * 100) : 0);
  // Marca a nota como "transcrevendo" so depois de ter a vez: uma nota que
  // ganhou texto final enquanto esperava nao pode voltar para pending.
  try {
    await persist(recording, {
      transcriptStatus: 'pending',
      transcriptOrigin: 'local',
      transcriptCheckpointMs: checkpoint,
      transcriptSegments: committed,
      // Refazer a passada nao apaga o texto que o usuario ja le: ele so e
      // trocado quando o primeiro trecho novo chega.
      transcript: committed.map((segment) => segment.text).join(' ').trim() || recording.transcript,
    });
  } catch {
    setRunning(id, false);
    cancelActivity(activity, 'Não foi possível marcar a nota');
    lease.release();
    return { status: 'skipped', reason: 'engine' };
  }
  // A gravacao do estado pode ter demorado: se o app saiu da frente nesse
  // meio-tempo, nao tenta abrir o servico em primeiro plano a partir do fundo.
  if (AppState.currentState !== 'active') {
    setRunning(id, false);
    cancelActivity(activity, 'Aguardando o app');
    lease.release();
    return { status: 'pending', reason: 'engine' };
  }

  // Mantem o processo vivo e mostra o progresso na barra de notificacoes.
  startForegroundTask('Transcrevendo', recording.title || 'Nota', 0);
  foregroundOn = true;
  // O pedido de permissao pode abrir um dialogo; pedir so depois que o servico
  // ja esta na frente evita que a abertura concorra com o inicio da passada.
  void ensureNotificationPermission();

  // Fila de gravacoes parciais: garante que o estado final (ready) seja sempre o
  // ultimo gravado. Sem isso, um persist parcial atrasado sobrescrevia para
  // "pending" e a transcricao era re-disparada (loop).
  let chain: Promise<unknown> = Promise.resolve();
  const queuePersist = (patch: Partial<Recording>) => {
    chain = chain.then(() => persist(recording, patch));
  };
  const textOf = (segments: TranscriptSegment[]) =>
    segments.map((segment) => segment.text).join(' ').trim();
  /**
   * Texto mais novo ja conhecido da passada. O parcial aparece e sobrevive a
   * uma falha: o catch nao pode regravar o texto antigo por cima dele.
   */
  let latestText = recording.transcript ?? '';

  startActivity({
    id: activity,
    kind: 'transcription',
    title: displayTitle(recording),
    detail: checkpoint > 0 ? 'Retomando transcrição' : 'Preparando áudio',
    progress: transcriptionProgress(id),
    action: { label: 'Tentar de novo', run: () => retryTranscription(id) },
    // O centro de atividade para a passada no fim da janela atual; o
    // checkpoint salvo continua valendo para retomar depois.
    stop: { label: 'Parar', run: () => stopTranscription(id) },
  });

  let wavPath = '';
  let chunkPath = '';
  try {
    wavPath = wavPathFor(id);
    chunkPath = chunkPathFor(id);
    // Restos de uma passada interrompida nao entram nesta: o WAV e decodificado
    // de novo a partir do audio original (que nunca muda).
    deleteWorkFiles(id, [wavPath, chunkPath]);
    await decodeToWav(recording.filePath, wavPath);
    const durationMs = wavDurationMs(wavPath);
    if (durationMs <= 0) {
      throw new Error('wav sem dados');
    }

    let context: WhisperContext | null = null;
    if (isOnline) {
      updateActivity(activity, { detail: 'Conferindo a chave' });
    } else {
      updateActivity(activity, { detail: 'Carregando modelo' });
      context = await getContext(whisper as WhisperModule, (model as NonNullable<typeof model>).id, modelPath as string);
    }
    setProgress(id, Math.min(100, (checkpoint / durationMs) * 100));

    const totalChunks = Math.max(1, Math.ceil(durationMs / CHUNK_MS));
    let language = recording.transcriptLanguage ?? '';
    let lastPersist = 0;
    // Sobra curta demais vira lixo: fecha a passada com o que ja existe em vez
    // de tentar a janela final e ficar preso nela.
    while (hasTranscribableTail(checkpoint, durationMs) && !cancelled.has(id)) {
      const chunkNumber = Math.min(totalChunks, Math.floor(checkpoint / CHUNK_MS) + 1);
      updateActivity(activity, {
        detail: isOnline
          ? `Deepgram · trecho ${chunkNumber} de ${totalChunks}`
          : `Transcrevendo trecho ${chunkNumber} de ${totalChunks}`,
      });
      const slice = await writeWavRange(wavPath, chunkPath, checkpoint, checkpoint + CHUNK_MS);
      if (slice.endMs <= slice.startMs) break;
      const chunkStart = slice.startMs;
      const chunkEnd = slice.endMs;

      if (isOnline) {
        const controller = new AbortController();
        const run: ActiveRun = { stop: async () => controller.abort() };
        activeRuns.set(id, run);
        try {
          const audio = readWholeFile(chunkPath);
          const result = await onlineWindow(id, {
            audio,
            apiKey: onlineKey as string,
            model: prefs.transcriptionOnlineModel || DEFAULT_DEEPGRAM_MODEL,
            language: whisperLanguage(prefs.transcriptionLanguage),
            offsetMs: chunkStart,
            signal: controller.signal,
          });
          language = result.language || language;
          committed = [...committed, ...result.segments];
        } finally {
          activeRuns.delete(id);
        }
      } else if (context) {
        const partial: TranscriptSegment[] = [];
        const guard = stallGuard(90_000);
        const { promise, stop } = context.transcribe(chunkPath, {
          language: whisperLanguage(prefs.transcriptionLanguage),
          maxThreads: MAX_THREADS,
          onProgress: (percent) => {
            // Cada aviso do motor empurra o prazo: so para quem realmente travou.
            guard.tick();
            const done =
              chunkStart + (Math.max(0, Math.min(100, percent)) / 100) * (chunkEnd - chunkStart);
            setProgress(id, Math.min(100, (done / durationMs) * 100));
          },
          onNewSegments: (event) => {
            guard.tick();
            partial.push(...toSegments(event.segments, chunkStart));
            latestText = textOf([...committed, ...partial]) || latestText;
            // Grava no maximo a cada PERSIST_THROTTLE_MS: evita re-render da nota
            // a cada trecho, mas o texto aparece progressivo.
            const now = Date.now();
            if (now - lastPersist < PERSIST_THROTTLE_MS) return;
            lastPersist = now;
            queuePersist({
              transcript: latestText,
              transcriptSegments: [...committed, ...partial],
              transcriptStatus: 'pending',
              transcriptOrigin: 'local',
              // A janela atual ainda nao terminou: retomar daqui re-transcreve
              // este trecho, nunca o anterior.
              transcriptCheckpointMs: checkpoint,
            });
          },
        });
        activeRuns.set(id, { stop });
        try {
          const result = await Promise.race([promise, guard.promise]);
          language = result.language || language;
          committed = [...committed, ...toSegments(result.segments, chunkStart)];
        } finally {
          guard.clear();
          // Se o prazo venceu, o nativo pode continuar rodando; parar aqui
          // libera a thread. Depois de concluido, parar nao tem efeito.
          void stop().catch(() => undefined);
          activeRuns.delete(id);
        }
      }

      latestText = textOf(committed) || latestText;
      checkpoint = chunkEnd;
      setProgress(id, Math.min(100, (checkpoint / durationMs) * 100));
      queuePersist({
        transcript: latestText,
        transcriptSegments: committed,
        transcriptStatus: 'pending',
        transcriptOrigin: 'local',
        transcriptCheckpointMs: checkpoint,
      });
      // Durable antes da proxima janela: se o app morrer agora, retoma daqui.
      await chain.catch(() => undefined);
    }

    await chain.catch(() => undefined);
    // Cancelada pelo usuario: o que ja foi transcrito fica salvo como pending
    // (checkpoint), nao como concluido.
    if (cancelled.has(id)) {
      cancelActivity(activity, 'Transcrição interrompida');
      return { status: 'pending', reason: 'cancelled' };
    }
    updateActivity(activity, { detail: 'Salvando transcrição' });
    setProgress(id, 100);
    await persist(recording, {
      transcript: textOf(committed) || latestText,
      transcriptLanguage: language || recording.transcriptLanguage,
      transcriptSegments: committed,
      transcriptCheckpointMs: durationMs,
      transcriptStatus: 'ready',
      transcriptOrigin: 'local',
      hasTranscript: true,
    });
    finishActivity(activity, 'Transcrição pronta');
    // Avisa o servidor (best-effort) para ele nao transcrever de novo e mostrar
    // o texto no dashboard. Se o entryId ainda nao existir, tenta apos o upload.
    await pushTranscript(id);
    await notifyTranscriptionDone();
    return { status: 'ready' };
  } catch (error) {
    // Falhou no meio: guarda o que ja foi transcrito e o ponto de retomada.
    // A proxima abertura do app continua daqui em vez de recomecar do zero.
    const reason = failureReason(error);
    if (cancelled.has(id)) {
      cancelActivity(activity, 'Transcrição interrompida');
    } else if (reason === 'invalid_key') {
      failActivity(activity, 'Chave do provedor inválida');
    } else {
      failActivity(activity, 'Não foi possível transcrever');
    }
    await chain.catch(() => undefined);
    await persist(recording, {
      transcript: latestText || textOf(committed) || recording.transcript,
      transcriptSegments: committed,
      transcriptCheckpointMs: checkpoint,
      transcriptStatus: 'pending',
      transcriptOrigin: 'local',
    });
    return {
      status: 'pending',
      reason: cancelled.has(id) ? 'cancelled' : reason,
    };
  } finally {
    deleteWorkFiles(id, [wavPath, chunkPath]);
    activeRuns.delete(id);
    cancelled.delete(id);
    activeModelId = null;
    setRunning(id, false);
    foregroundOn = false;
    stopForegroundTask();
    if (releaseRequested) {
      releaseRequested = false;
      void releaseTranscriptionContexts();
    } else {
      // A proxima nota aproveita o modelo quente; sozinho, ele sai depois.
      scheduleContextRelease();
    }
    lease.release();
  }
}

/**
 * Tenta a transcricao de novo depois de uma falha ou interrupcao. O checkpoint
 * salvo continua valendo, entao a retomada nao recomeca o audio inteiro.
 */
export async function retryTranscription(id: string): Promise<void> {
  const place = await transcriptionPlace();
  if (place.place === 'server') {
    // A nota pertence ao servidor: tentar de novo e pedir a fila dele, nunca
    // rodar o motor do aparelho por conta propria.
    const recording = await getRecording(id);
    if (recording) await transcribeRecordingOnServer(recording);
    return;
  }
  await transcribeRecording(id);
}

/**
 * Remove WAVs de trabalho de passadas que morreram com o app. Roda so quando
 * nenhuma passada esta em andamento; o arquivo da nota atual e recriado.
 */
function cleanupStaleWorkFiles(): void {
  if (running.size > 0) return;
  try {
    const dir = workDirectory();
    for (const entry of dir.list()) {
      try {
        const file = new File(entry.uri);
        if (file.exists) file.delete();
      } catch {
        // arquivo em uso ou sem permissao: ignora
      }
    }
  } catch {
    // diretorio ainda nao existe
  }
}

/**
 * Notifica o fim da transcricao. Se nao sobrou nenhum audio sem transcricao,
 * avisa que esta tudo pronto.
 */
async function notifyTranscriptionDone(): Promise<void> {
  let pending = 0;
  try {
    const list = await listRecordings();
    pending = list.filter((r) => Boolean(r.filePath) && !hasFinalTranscript(r)).length;
  } catch {
    // sem banco: notifica generico
  }
  if (pending === 0) {
    await notifyIfHidden('Tudo transcrito', 'Todas as notas com áudio têm transcrição.');
  } else {
    await notifyIfHidden('Nota transcrita', 'A transcrição ficou pronta.');
  }
}

/**
 * Transcreve as gravacoes pendentes que podem comecar sozinhas (audio no
 * aparelho, sem texto final, fora do servidor). Vale para o motor local e para
 * o online escolhido; roda no boot e ao voltar para a frente.
 */
export async function transcribePendingLocally(): Promise<void> {
  if (!(await willTranscribeLocally())) return;
  cleanupStaleWorkFiles();
  let list: Recording[] = [];
  try {
    list = await listRecordings();
  } catch {
    return;
  }
  for (const recording of list) {
    // O Android 12+ nao deixa abrir um servico em primeiro plano a partir do
    // fundo. Sem ele o processo seria encerrado no meio da passada: melhor
    // parar aqui e retomar quando o app voltar.
    if (AppState.currentState !== 'active') break;
    if (running.has(recording.id)) continue;
    // Parada manual nesta sessao: o usuario decidiu parar; o boot nao insiste.
    if (manualStops.has(recording.id)) continue;
    if (!shouldAutoTranscribe(recording)) continue;
    await transcribeRecording(recording.id);
  }
}

/**
 * Dispara a transcricao quando faz sentido: a etapa ligada (aparelho ou
 * online), com o que ela precisa pronto. Caso contrario nao faz nada; quem
 * comeca a etapa e o outro lado, nunca uma troca silenciosa de motor.
 */
export async function maybeTranscribeLocally(id: string): Promise<TranscriptionOutcome> {
  if (!(await willTranscribeLocally())) return { status: 'skipped', reason: 'engine' };
  const recording = await getRecording(id);
  if (!recording?.filePath) return { status: 'skipped' };
  // Transcricao terminada, local ou do servidor, nao e refeita sozinha.
  if (hasFinalTranscript(recording)) return { status: 'ready' };
  return transcribeRecording(id);
}
