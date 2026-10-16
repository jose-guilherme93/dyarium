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

import { Directory, File, Paths } from 'expo-file-system';

import { whisperLanguage } from '@/core/transcription';
import type { Recording, TranscriptSegment } from '@/core/types';

import { audioDecodeAvailable, decodeToWav } from '../../modules/audio-decode';
import {
  startForegroundTask,
  stopForegroundTask,
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

const MAX_THREADS = 4;
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

function setProgress(id: string, percent: number): void {
  progressValues.set(id, percent);
  progressListeners.get(id)?.forEach((listener) => listener(percent));
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

function toSegments(segments: WhisperSegment[]): TranscriptSegment[] {
  return segments.map((segment) => ({
    // whisper.cpp mede os tempos em centesimos de segundo.
    start_ms: segment.t0 * 10,
    end_ms: segment.t1 * 10,
    text: segment.text.trim(),
  }));
}

/** Caminho do WAV temporario (cache) usado na transcricao. */
function wavPathFor(id: string): string {
  const dir = new Directory(Paths.cache, 'whisper');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return new File(dir, `${id}.wav`).uri;
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

  running.add(id);
  attempted.add(id);
  setProgress(id, 0);
  void ensureNotificationPermission();
  await persist(recording, { transcriptStatus: 'pending', transcriptOrigin: 'local' });
  // Mantem o processo vivo (e o usuario informado) se ele sair do app.
  startForegroundTask('Transcrevendo nota', 'A transcrição continua em segundo plano.');
  const wavPath = wavPathFor(id);

  // Fila de gravacoes parciais: garante que o estado final (ready) seja sempre o
  // ultimo gravado. Sem isso, um persist parcial atrasado sobrescrevia para
  // "pending" e a transcricao era re-disparada (loop).
  let chain: Promise<unknown> = Promise.resolve();
  const queuePersist = (patch: Partial<Recording>) => {
    chain = chain.then(() => persist(recording, patch));
  };

  try {
    await decodeToWav(recording.filePath, wavPath);
    const context = await getContext(whisper, modelId, modelPath);

    const collected: TranscriptSegment[] = [];
    let lastPersist = 0;
    const { promise } = context.transcribe(wavPath, {
      language: whisperLanguage(prefs.transcriptionLanguage),
      maxThreads: MAX_THREADS,
      onProgress: (percent) => setProgress(id, Math.max(0, Math.min(100, percent))),
      onNewSegments: (event) => {
        collected.push(...toSegments(event.segments));
        // Grava no maximo a cada PERSIST_THROTTLE_MS: evita re-render da nota a
        // cada trecho (o texto aparece progressivo, mas sem travar a abertura).
        const now = Date.now();
        if (now - lastPersist < PERSIST_THROTTLE_MS) return;
        lastPersist = now;
        queuePersist({
          transcript: collected
            .map((segment) => segment.text)
            .join(' ')
            .trim(),
          transcriptSegments: [...collected],
          transcriptStatus: 'pending',
          transcriptOrigin: 'local',
        });
      },
    });

    const result = await promise;
    // Espera os parciais pendentes antes de gravar o estado final.
    await chain.catch(() => undefined);
    setProgress(id, 100);
    await persist(recording, {
      transcript: result.result.trim(),
      transcriptLanguage: result.language,
      transcriptSegments: toSegments(result.segments),
      transcriptStatus: 'ready',
      transcriptOrigin: 'local',
      hasTranscript: true,
    });
    // Avisa o servidor (best-effort) para ele nao transcrever de novo e mostrar
    // o texto no dashboard. Se o entryId ainda nao existir, tenta apos o upload.
    await pushTranscript(id);
    await notifyTranscriptionDone();
  } catch {
    await chain.catch(() => undefined);
    await persist(recording, { transcriptStatus: 'failed', transcriptOrigin: 'local' });
  } finally {
    const wav = new File(wavPath);
    if (wav.exists) wav.delete();
    running.delete(id);
    setProgress(id, 0);
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
