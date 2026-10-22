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

import { whisperLanguage } from '@/core/transcription';
import type { Recording, TranscriptSegment } from '@/core/types';

import { audioDecodeAvailable, decodeToWav } from '../../modules/audio-decode';
import {
  startForegroundTask,
  stopForegroundTask,
  updateForegroundTask,
} from '../../modules/foreground-task';
import { getRecording, listRecordings, upsertRecording } from './db';
import { ensureNotificationPermission, notify } from './notifications';
import { emitRecording } from './uploaderLoop';
import { loadPrefs } from './secure';
import { modelFilePath } from './transcriptionModels';
import { pushTranscript } from './transcriptSync';
import {
  loadWhisper,
  localTranscriptionAvailable,
  willTranscribeLocally,
  type WhisperContext,
  type WhisperModule,
  type WhisperSegment,
} from './whisper';

export { localTranscriptionAvailable };

// O aparelho e pequeno: 4 threads de whisper saturam os nucleos e a interface
// trava enquanto a nota transcreve. Duas threads transcrevem um pouco mais
// devagar, mas o app continua respondendo (digitar, rolar, tocar audio).
const MAX_THREADS = 2;
/** Intervalo minimo entre gravacoes parciais (evita re-render a cada trecho). */
const PERSIST_THROTTLE_MS = 1200;

const contexts = new Map<string, WhisperContext>();
const running = new Set<string>();
// Gravacoes ja tentadas nesta sessao: evita re-disparar/entrar em loop. Um novo
// disparo so acontece reabrindo o app.
const attempted = new Set<string>();

// Progresso (0..100) por gravacao, em memoria: a UI acompanha sem gravar no banco.
const progressValues = new Map<string, number>();
const progressListeners = new Map<string, Set<(percent: number) => void>>();
const runningListeners = new Map<string, Set<(running: boolean) => void>>();
/** Pedido de parada por gravacao (a janela atual termina e o loop para). */
const cancelled = new Set<string>();
/** Handle nativo da janela em andamento, para parar na hora quando possivel. */
const activeRuns = new Map<string, { stop: () => Promise<void> }>();
/** A notificacao de progresso esta na tela (o servico em primeiro plano roda). */
let foregroundOn = false;

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
export async function stopTranscription(id: string): Promise<void> {
  cancelled.add(id);
  const run = activeRuns.get(id);
  if (!run) return;
  try {
    await run.stop();
  } catch {
    // a janela pode ja ter terminado
  }
}

function setProgress(id: string, percent: number): void {
  const next = Math.max(0, Math.min(100, percent));
  const previous = progressValues.get(id);
  // O whisper reporta varias vezes por porcento. A tela inteira re-renderiza a
  // cada aviso; notificar so quando o inteiro muda evita jank durante a leitura.
  if (previous !== undefined && Math.floor(previous) === Math.floor(next)) return;
  progressValues.set(id, next);
  progressListeners.get(id)?.forEach((listener) => listener(next));
  if (foregroundOn) {
    // A barra de notificacoes e o unico lugar onde o progresso aparece com o
    // app em segundo plano; o texto acompanha a mesma porcentagem da nota.
    updateForegroundTask('Transcrevendo nota', `${Math.round(next)}% concluído`, Math.round(next));
  }
}

/** Libera os contextos do whisper (ao apagar/trocar de modelo). */
export async function releaseTranscriptionContexts(): Promise<void> {
  const loaded = [...contexts.values()];
  contexts.clear();
  for (const context of loaded) {
    try {
      await context.release();
    } catch {
      // ja liberado
    }
  }
}

async function getContext(
  whisper: WhisperModule,
  modelId: string,
  filePath: string,
): Promise<WhisperContext> {
  const existing = contexts.get(modelId);
  if (existing) return existing;
  const context = await whisper.initWhisper({ filePath });
  contexts.set(modelId, context);
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

/** Caminho do WAV temporario (cache) usado na transcricao. */
function wavPathFor(id: string): string {
  const dir = new Directory(Paths.cache, 'whisper');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return new File(dir, `${id}.wav`).uri;
}

/** Janela de cada chamada do whisper. O checkpoint fica no fim da janela. */
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
  const dir = new Directory(Paths.cache, 'whisper');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return new File(dir, `${id}.chunk.wav`).uri;
}

/** Maior fim de segmento (checkpoint de uma transcricao antiga sem campo). */
function lastSegmentEnd(segments: TranscriptSegment[]): number {
  let end = 0;
  for (const segment of segments) {
    if (segment.end_ms > end) end = segment.end_ms;
  }
  return end;
}


/**
 * Transcreve a gravacao no aparelho. Idempotente por gravacao: grava o texto a
 * cada trecho (progressivo) e marca `hasTranscript` ao final.
 */
export async function transcribeLocally(id: string): Promise<void> {
  if (running.has(id) || attempted.has(id)) return;
  const recording = await getRecording(id);
  if (!recording?.filePath) return;
  if (recording.hasTranscript && recording.transcriptStatus === 'ready') return;

  const prefs = await loadPrefs();
  const modelId = prefs.transcriptionModel;
  if (!modelId) return;
  const modelPath = modelFilePath(modelId);
  if (!modelPath || !new File(modelPath).exists) return;

  const whisper = loadWhisper();
  if (!whisper || !audioDecodeAvailable()) return;

  setRunning(id, true);
  cancelled.delete(id);
  attempted.add(id);
  if (__DEV__) console.log('[perf] transcricao.comecou', { id, ms: Date.now() });

  const priorSegments = recording.transcriptSegments ?? [];
  const priorCheckpoint =
    recording.transcriptCheckpointMs ?? (priorSegments.length > 0 ? lastSegmentEnd(priorSegments) : 0);
  let checkpoint = Math.max(0, priorCheckpoint);
  // Segmentos de uma janela interrompida ficam de fora: ela sera transcrita de
  // novo a partir do checkpoint (no maximo 60 s repetidos, nunca a nota inteira).
  let committed = priorSegments.filter((segment) => segment.start_ms < checkpoint);
  const knownDuration = recording.durationMs ?? 0;
  setProgress(id, knownDuration > 0 ? Math.min(100, (checkpoint / knownDuration) * 100) : 0);

  void ensureNotificationPermission();
  await persist(recording, {
    transcriptStatus: 'pending',
    transcriptOrigin: 'local',
    transcriptCheckpointMs: checkpoint,
    transcriptSegments: committed,
    transcript: committed.map((segment) => segment.text).join(' ').trim() || undefined,
  });
  // Mantem o processo vivo e mostra o progresso na barra de notificacoes.
  // Duas threads deixam o app utilizavel mesmo com a nota aberta.
  startForegroundTask('Transcrevendo nota', '0% concluído', 0);
  foregroundOn = true;
  const wavPath = wavPathFor(id);
  const chunkPath = chunkPathFor(id);

  // Fila de gravacoes parciais: garante que o estado final (ready) seja sempre o
  // ultimo gravado. Sem isso, um persist parcial atrasado sobrescrevia para
  // "pending" e a transcricao era re-disparada (loop).
  let chain: Promise<unknown> = Promise.resolve();
  const queuePersist = (patch: Partial<Recording>) => {
    chain = chain.then(() => persist(recording, patch));
  };
  const textOf = (segments: TranscriptSegment[]) =>
    segments.map((segment) => segment.text).join(' ').trim();

  try {
    await decodeToWav(recording.filePath, wavPath);
    const durationMs = wavDurationMs(wavPath);
    if (durationMs <= 0) {
      throw new Error('wav sem dados');
    }
    const context = await getContext(whisper, modelId, modelPath);
    setProgress(id, Math.min(100, (checkpoint / durationMs) * 100));

    let language = recording.transcriptLanguage ?? '';
    let lastPersist = 0;
    while (checkpoint < durationMs - 5 && !cancelled.has(id)) {
      const slice = await writeWavRange(wavPath, chunkPath, checkpoint, checkpoint + CHUNK_MS);
      if (slice.endMs <= slice.startMs) break;
      const chunkStart = slice.startMs;
      const chunkEnd = slice.endMs;
      const partial: TranscriptSegment[] = [];

      const { promise, stop } = context.transcribe(chunkPath, {
        language: whisperLanguage(prefs.transcriptionLanguage),
        maxThreads: MAX_THREADS,
        onProgress: (percent) => {
          const done = chunkStart + (Math.max(0, Math.min(100, percent)) / 100) * (chunkEnd - chunkStart);
          setProgress(id, Math.min(100, (done / durationMs) * 100));
        },
        onNewSegments: (event) => {
          partial.push(...toSegments(event.segments, chunkStart));
          // Grava no maximo a cada PERSIST_THROTTLE_MS: evita re-render da nota
          // a cada trecho, mas o texto aparece progressivo.
          const now = Date.now();
          if (now - lastPersist < PERSIST_THROTTLE_MS) return;
          lastPersist = now;
          queuePersist({
            transcript: textOf([...committed, ...partial]),
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

      const result = await promise;
      language = result.language || language;
      committed = [...committed, ...toSegments(result.segments, chunkStart)];
      checkpoint = chunkEnd;
      queuePersist({
        transcript: textOf(committed),
        transcriptSegments: committed,
        transcriptStatus: 'pending',
        transcriptOrigin: 'local',
        transcriptCheckpointMs: checkpoint,
      });
      // Durable antes da proxima janela: se o app morrer agora, retoma daqui.
      activeRuns.delete(id);
      await chain.catch(() => undefined);
    }

    await chain.catch(() => undefined);
    // Cancelada pelo usuario: o que ja foi transcrito fica salvo como pending
    // (checkpoint), nao como concluido.
    if (cancelled.has(id)) throw new Error('transcricao cancelada');
    setProgress(id, 100);
    await persist(recording, {
      transcript: textOf(committed),
      transcriptLanguage: language || recording.transcriptLanguage,
      transcriptSegments: committed,
      transcriptCheckpointMs: durationMs,
      transcriptStatus: 'ready',
      transcriptOrigin: 'local',
      hasTranscript: true,
    });
    // Avisa o servidor (best-effort) para ele nao transcrever de novo e mostrar
    // o texto no dashboard. Se o entryId ainda nao existir, tenta apos o upload.
    await pushTranscript(id);
    await notifyTranscriptionDone();
  } catch {
    // Falhou no meio: guarda o que ja foi transcrito e o ponto de retomada.
    // A proxima abertura do app continua daqui em vez de recomecar do zero.
    await chain.catch(() => undefined);
    await persist(recording, {
      transcript: textOf(committed),
      transcriptSegments: committed,
      transcriptCheckpointMs: checkpoint,
      transcriptStatus: 'pending',
      transcriptOrigin: 'local',
    });
  } finally {
    const wav = new File(wavPath);
    if (wav.exists) wav.delete();
    const chunk = new File(chunkPath);
    if (chunk.exists) chunk.delete();
    activeRuns.delete(id);
    cancelled.delete(id);
    setRunning(id, false);
    foregroundOn = false;
    stopForegroundTask();
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
    pending = list.filter((r) => Boolean(r.filePath) && !r.hasTranscript).length;
  } catch {
    // sem banco: notifica generico
  }
  if (pending === 0) {
    await notify('Tudo transcrito', 'Todas as notas com áudio têm transcrição.');
  } else {
    await notify('Nota transcrita', 'A transcrição ficou pronta.');
  }
}

/**
 * Transcreve no aparelho as gravacoes pendentes (audio sem transcricao). Usado
 * como retomada quando o app e acordado em segundo plano.
 */
export async function transcribePendingLocally(): Promise<void> {
  if (!(await willTranscribeLocally())) return;
  let list: Recording[] = [];
  try {
    list = await listRecordings();
  } catch {
    return;
  }
  for (const recording of list) {
    if (!recording.filePath || recording.hasTranscript || running.has(recording.id)) continue;
    await transcribeLocally(recording.id);
  }
}

/**
 * Dispara a transcricao local quando faz sentido: ligada nas configuracoes, com
 * modelo baixado e com modulo nativo presente. Caso contrario, nao faz nada (o
 * servidor continua sendo a via).
 */
export async function maybeTranscribeLocally(id: string): Promise<void> {
  if (!(await willTranscribeLocally())) return;
  const recording = await getRecording(id);
  if (!recording?.filePath) return;
  if (recording.hasTranscript && recording.transcriptStatus === 'ready') return;
  await transcribeLocally(id);
}
