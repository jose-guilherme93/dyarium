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
  elapsedMs: number;
  level: number;
  error: string | null;
  busy: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Continua uma gravacao interrompida, mantendo o horario de inicio original. */
  resume(id: string): Promise<void>;
  /** Finaliza (concatena) uma gravacao interrompida e a coloca na fila. */
  finalizeInterrupted(id: string): Promise<void>;
}

const RecordingContext = createContext<RecordingValue | null>(null);

function normalizeLevel(metering?: number): number {
  if (metering === undefined || Number.isNaN(metering)) return 0;
  // metering vem em dB (aprox. -160..0); mapeia para 0..1
  const clamped = Math.max(-60, Math.min(0, metering));
  return (clamped + 60) / 60;
}

export function RecordingProvider({ children }: { children: ReactNode }) {
  const library = useLibrary();
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 200);

  const [active, setActive] = useState<Recording | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeRef = useRef<Recording | null>(null);
  const startedAtRef = useRef<number>(0);
  const segmentIndexRef = useRef<number>(0);
  const rotatingRef = useRef(false);
  const startingRef = useRef(false);
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

  const rotate = useCallback(async () => {
    if (rotatingRef.current || !activeRef.current) return;
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
      setError('Falha ao rotacionar o segmento de gravacao.');
    } finally {
      rotatingRef.current = false;
    }
  }, [recorder]);

  const startTimers = useCallback(() => {
    clearTimers();
    tickRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 500);
    rotateRef.current = setInterval(() => {
      void rotate();
    }, SEGMENT_MS);
  }, [clearTimers, rotate]);

  const beginSession = useCallback(
    async (session: Recording, startIndex: number) => {
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
        allowsBackgroundRecording: true,
      });
      activeRef.current = session;
      setActive(session);
      segmentIndexRef.current = startIndex;
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      await upsertRecording(session);
      await recorder.prepareToRecordAsync(RECORDING_OPTIONS);
      recorder.record();
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
        setError('Permissao de microfone negada.');
        return;
      }
      await ensureNotificationPermission();
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
      await beginSession(session, 0);
    } catch (error) {
      console.warn('[dyarium] start error', String(error));
      setError('Nao foi possivel iniciar a gravacao.');
    } finally {
      startingRef.current = false;
    }
  }, [beginSession]);

  const stop = useCallback(async () => {
    const session = activeRef.current;
    if (!session) return;
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

      const durationMs = Date.now() - startedAtRef.current;
      const outUri = outputFileUri(session.id);
      const size = await concatenateSegments(sessionDirUri(session.id), outUri, concatIO);

      if (size <= 0) {
        activeRef.current = null;
        setActive(null);
        setElapsedMs(0);
        setError('Nenhum audio foi capturado. Verifique o microfone e tente de novo.');
        return;
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
      await library.enqueue(finished);
    } catch (error) {
      console.warn('[dyarium] stop error', String(error));
      setError('Falha ao finalizar a gravacao.');
    } finally {
      setBusy(false);
    }
  }, [recorder, library, clearTimers]);

  const resume = useCallback(
    async (id: string) => {
      if (startingRef.current || activeRef.current) return;
      startingRef.current = true;
      setError(null);
      try {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) {
          setError('Permissao de microfone negada.');
          return;
        }
        await ensureNotificationPermission();
        const list = await listRecordings();
        const found = list.find((r) => r.id === id);
        if (!found) return;
        const session: Recording = {
          ...found,
          status: 'recording',
          updatedAt: new Date().toISOString(),
        };
        await beginSession(session, found.segmentCount);
      } catch (error) {
        console.warn('[dyarium] resume error', String(error));
        setError('Nao foi possivel retomar a gravacao.');
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
        setError('Falha ao finalizar a gravacao interrompida.');
      }
    },
    [library],
  );

  useEffect(() => clearTimers, [clearTimers]);

  const value = useMemo<RecordingValue>(
    () => ({
      active,
      elapsedMs,
      level: normalizeLevel(recorderState.metering),
      error,
      busy,
      start,
      stop,
      resume,
      finalizeInterrupted,
    }),
    [
      active,
      elapsedMs,
      recorderState.metering,
      error,
      busy,
      start,
      stop,
      resume,
      finalizeInterrupted,
    ],
  );

  return <RecordingContext.Provider value={value}>{children}</RecordingContext.Provider>;
}

export function useRecording(): RecordingValue {
  const value = useContext(RecordingContext);
  if (!value) throw new Error('useRecording deve ser usado dentro de RecordingProvider');
  return value;
}
