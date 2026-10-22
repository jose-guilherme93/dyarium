import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { concatenateSegments } from '@/core/concat';
import { newId } from '@/core/id';
import { markRecorded } from '@/core/queue';
import { formatTitle, toRecordedAt } from '@/core/title';
import type { Recording } from '@/core/types';
import { bumpRender } from '@/dev/perf';
import { listRecordings, upsertRecording } from '@/services/db';
import { concatIO, outputFileUri, sessionDirUri, storeSegment } from '@/services/files';
import { ensureNotificationPermission } from '@/services/notifications';

import { useLibrary } from './LibraryContext';

/** Duracao de cada segmento: limita a perda no pior caso e da checkpoints. */
export const SEGMENT_MS = 60_000;

const RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  directory: 'document',
  isMeteringEnabled: true,
  extension: '.aac',
  sampleRate: 48_000,
  numberOfChannels: 1,
  bitRate: 128_000,
  android: {
    ...RecordingPresets.HIGH_QUALITY.android,
    outputFormat: 'aac_adts',
    audioEncoder: 'aac',
    extension: '.aac',
    sampleRate: 48_000,
  },
};

interface RecordingValue {
  active: Recording | null;
  error: string | null;
  busy: boolean;
  /** Gravacao pausada (o tempo da pausa nao conta). */
  paused: boolean;
  pause(): void;
  unpause(): void;
  start(): Promise<void>;
  /**
   * Finaliza a gravacao. Por padrao enfileira; com `enqueue: false` devolve a
   * nota pronta sem enviar (para anexar a uma nota em composicao).
   */
  stop(options?: { enqueue?: boolean }): Promise<Recording | null>;
  /** Continua uma gravacao interrompida, mantendo o horario de inicio original. */
  resume(id: string): Promise<void>;
  /** Finaliza (concatena) uma gravacao interrompida e a coloca na fila. */
  finalizeInterrupted(id: string): Promise<void>;
}

/**
 * Medidas ao vivo da gravacao (tempo e nivel).
 *
 * Separadas do contexto principal de proposito: elas mudam varias vezes por
 * segundo. A home e as outras telas so precisam de `start`/`stop`, entao nao
 * podem re-renderizar a lista inteira a cada amostra do microfone.
 */
interface RecordingLiveValue {
  elapsedMs: number;
  level: number;
}

const RecordingContext = createContext<RecordingValue | null>(null);
const RecordingLiveContext = createContext<RecordingLiveValue | null>(null);

function normalizeLevel(metering?: number): number {
  if (metering === undefined || Number.isNaN(metering)) return 0;
  // metering vem em dB (aprox. -160..0); mapeia para 0..1
  const clamped = Math.max(-60, Math.min(0, metering));
  return (clamped + 60) / 60;
}

export function RecordingProvider({ children }: { children: ReactNode }) {
  const library = useLibrary();
  bumpRender('RecordingProvider');
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  // O nivel alimenta a waveform, que suaviza entre as amostras. 250 ms basta
  // e evita um getStatus() nativo (e um render do provider) a cada 200 ms.
  const recorderState = useAudioRecorderState(recorder, 250);

  const [active, setActive] = useState<Recording | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);

  const activeRef = useRef<Recording | null>(null);
  const startedAtRef = useRef<number>(0);
  const segmentIndexRef = useRef<number>(0);
  const rotatingRef = useRef(false);
  const startingRef = useRef(false);
  const pausedRef = useRef(false);
  const pausedAtRef = useRef(0);
  const accumulatedPauseRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rotateRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sessoes que ficaram "gravando" apos um crash viram "interrompida".
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await listRecordings();
        for (const r of list) {
          if (r.status === 'recording') {
            await upsertRecording({
              ...r,
              status: 'interrupted',
              updatedAt: new Date().toISOString(),
            });
          }
        }
        if (alive) await library.refresh();
      } catch {
        // Sem banco disponivel: o app segue; a fila fica vazia ate o banco voltar.
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearTimers = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (rotateRef.current) clearInterval(rotateRef.current);
    tickRef.current = null;
    rotateRef.current = null;
  }, []);

  const elapsed = useCallback(() => {
    const reference = pausedRef.current ? pausedAtRef.current : Date.now();
    return Math.max(0, reference - startedAtRef.current - accumulatedPauseRef.current);
  }, []);

  const rotate = useCallback(async () => {
    if (rotatingRef.current || !activeRef.current || pausedRef.current) return;
    rotatingRef.current = true;
    try {
      await recorder.stop();
      const session = activeRef.current;
      if (session) {
        const stored = await storeSegment(
          session.id,
          segmentIndexRef.current,
          recorder.uri ?? undefined,
        );
        if (stored) {
          segmentIndexRef.current += 1;
          const updated: Recording = {
            ...session,
            segmentCount: segmentIndexRef.current,
            updatedAt: new Date().toISOString(),
          };
          activeRef.current = updated;
          setActive(updated);
          await upsertRecording(updated);
        }
      }
      if (activeRef.current) {
        await recorder.prepareToRecordAsync(RECORDING_OPTIONS);
        recorder.record();
      }
    } catch (error) {
      console.warn('[dyarium] rotate error', String(error));
      setError('Falha ao rotacionar o segmento de gravação.');
    } finally {
      rotatingRef.current = false;
    }
  }, [recorder]);

  const startTimers = useCallback(() => {
    clearTimers();
    // O visor mostra segundos: 500 ms e suficiente e reduz os renders da tela
    // durante a gravacao.
    tickRef.current = setInterval(() => {
      setElapsedMs(elapsed());
    }, 500);
    rotateRef.current = setInterval(() => {
      void rotate();
    }, SEGMENT_MS);
  }, [clearTimers, elapsed, rotate]);

  const beginSession = useCallback(
    async (session: Recording, startIndex: number, backgroundRecording = true) => {
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
        // Sem POST_NOTIFICATIONS o Android recusa o foreground service da
        // gravacao. Quem chama decide: com permissao grava em segundo plano;
        // sem ela, grava em primeiro plano em vez de falhar.
        allowsBackgroundRecording: backgroundRecording,
      });
      // Prepara e comeca a gravar ANTES de marcar a sessao como ativa. Se o
      // microfone falhar (ocupado por outro app, permissao revogada), a sessao
      // nao pode ficar presa: o proximo toque em gravar tem de tentar de novo.
      try {
        await recorder.prepareToRecordAsync(RECORDING_OPTIONS);
        recorder.record();
        await upsertRecording(session);
      } catch (error) {
        await recorder.stop().catch(() => undefined);
        throw error;
      }
      activeRef.current = session;
      setActive(session);
      segmentIndexRef.current = startIndex;
      startedAtRef.current = Date.now();
      pausedRef.current = false;
      pausedAtRef.current = 0;
      accumulatedPauseRef.current = 0;
      setPaused(false);
      setElapsedMs(0);
      startTimers();
    },
    [recorder, startTimers],
  );

  const start = useCallback(async () => {
    if (startingRef.current || activeRef.current) return;
    startingRef.current = true;
    setError(null);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError('Permissão de microfone negada.');
        return;
      }
      // O Android exige POST_NOTIFICATIONS para o foreground service da
      // gravacao em segundo plano. Espera a resposta: disparar o pedido e
      // preparar o recorder no mesmo tick fazia o prepare falhar.
      const canRecordInBackground = await ensureNotificationPermission();
      const now = new Date();
      const id = newId('rec_');
      const session: Recording = {
        id,
        title: formatTitle(now),
        recordedAt: toRecordedAt(now),
        dir: sessionDirUri(id),
        segmentCount: 0,
        status: 'recording',
        offset: 0,
        attempts: 0,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      await beginSession(session, 0, canRecordInBackground);
    } catch (error) {
      console.warn('[dyarium] start error', String(error));
      setError('Não foi possível iniciar a gravação.');
    } finally {
      startingRef.current = false;
    }
  }, [beginSession]);

  const stop = useCallback(async (options?: { enqueue?: boolean }): Promise<Recording | null> => {
    const session = activeRef.current;
    if (!session) return null;
    clearTimers();
    setBusy(true);
    setError(null);
    try {
      await recorder.stop();
      const stored = await storeSegment(
        session.id,
        segmentIndexRef.current,
        recorder.uri ?? undefined,
      );
      if (stored) segmentIndexRef.current += 1;

      const durationMs = elapsed();
      const outUri = outputFileUri(session.id);
      const size = await concatenateSegments(sessionDirUri(session.id), outUri, concatIO);

      if (size <= 0) {
        activeRef.current = null;
        setActive(null);
        setElapsedMs(0);
        setError('Nenhum áudio foi capturado. Verifique o microfone e tente de novo.');
        return null;
      }

      const finished = markRecorded(
        {
          ...session,
          segmentCount: segmentIndexRef.current,
          updatedAt: new Date().toISOString(),
        },
        outUri,
        size,
        durationMs,
      );
      await upsertRecording(finished);
      activeRef.current = null;
      setActive(null);
      setElapsedMs(0);
      if (options?.enqueue !== false) await library.enqueue(finished);
      return finished;
    } catch (error) {
      console.warn('[dyarium] stop error', String(error));
      setError('Falha ao finalizar a gravação.');
      return null;
    } finally {
      setBusy(false);
    }
  }, [recorder, library, clearTimers, elapsed]);

  const pause = useCallback(() => {
    if (!activeRef.current || pausedRef.current) return;
    try {
      recorder.pause();
      pausedAtRef.current = Date.now();
      pausedRef.current = true;
      setPaused(true);
      setElapsedMs(elapsed());
    } catch {
      setError('Não foi possível pausar a gravação.');
    }
  }, [recorder, elapsed]);

  const unpause = useCallback(() => {
    if (!activeRef.current || !pausedRef.current) return;
    try {
      accumulatedPauseRef.current += Date.now() - pausedAtRef.current;
      pausedAtRef.current = 0;
      pausedRef.current = false;
      setPaused(false);
      recorder.record();
    } catch {
      setError('Não foi possível retomar a gravação.');
    }
  }, [recorder]);

  const resume = useCallback(
    async (id: string) => {
      if (startingRef.current || activeRef.current) return;
      startingRef.current = true;
      setError(null);
      try {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) {
          setError('Permissão de microfone negada.');
          return;
        }
        const canRecordInBackground = await ensureNotificationPermission();
        const list = await listRecordings();
        const found = list.find((r) => r.id === id);
        if (!found) return;
        const session: Recording = {
          ...found,
          status: 'recording',
          updatedAt: new Date().toISOString(),
        };
        await beginSession(session, found.segmentCount, canRecordInBackground);
      } catch (error) {
        console.warn('[dyarium] resume error', String(error));
        setError('Não foi possível retomar a gravação.');
      } finally {
        startingRef.current = false;
      }
    },
    [beginSession],
  );

  const finalizeInterrupted = useCallback(
    async (id: string) => {
      try {
        const list = await listRecordings();
        const found = list.find((r) => r.id === id);
        if (!found) return;
        const outUri = outputFileUri(id);
        const size = await concatenateSegments(sessionDirUri(id), outUri, concatIO);
        const finished = markRecorded(
          { ...found, updatedAt: new Date().toISOString() },
          outUri,
          size,
          found.durationMs ?? 0,
        );
        await upsertRecording(finished);
        await library.enqueue(finished);
      } catch {
        setError('Falha ao finalizar a gravação interrompida.');
      }
    },
    [library],
  );

  useEffect(() => clearTimers, [clearTimers]);

  const value = useMemo<RecordingValue>(
    () => ({
      active,
      error,
      busy,
      paused,
      pause,
      unpause,
      start,
      stop,
      resume,
      finalizeInterrupted,
    }),
    [
      active,
      error,
      busy,
      paused,
      pause,
      unpause,
      start,
      stop,
      resume,
      finalizeInterrupted,
    ],
  );

  const live = useMemo<RecordingLiveValue>(
    () => ({ elapsedMs, level: normalizeLevel(recorderState.metering) }),
    [elapsedMs, recorderState.metering],
  );

  useEffect(() => {
    bumpRender('recording.value');
  }, [value]);

  useEffect(() => {
    bumpRender('recording.live');
  }, [live]);

  return (
    <RecordingContext.Provider value={value}>
      <RecordingLiveContext.Provider value={live}>{children}</RecordingLiveContext.Provider>
    </RecordingContext.Provider>
  );
}

export function useRecording(): RecordingValue {
  const value = useContext(RecordingContext);
  if (!value) throw new Error('useRecording deve ser usado dentro de RecordingProvider');
  return value;
}

/** Tempo e nivel ao vivo: apenas a tela de gravacao usa isso. */
export function useRecordingLive(): RecordingLiveValue {
  const value = useContext(RecordingLiveContext);
  if (!value) throw new Error('useRecordingLive deve ser usado dentro de RecordingProvider');
  return value;
}
