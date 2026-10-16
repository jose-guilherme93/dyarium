import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { markQueued } from '@/core/queue';
import { canRetry, isUploadable, needsTranscript, type Recording } from '@/core/types';
import { deleteRecordingRow, listRecordings, upsertRecording } from '@/services/db';
import { deleteSessionFiles } from '@/services/files';
import { deleteRemoteEntry, reconcileOnce } from '@/services/reconcile';
import { fetchTranscriptsOnce } from '@/services/transcripts';
import { observeUploads, runUploadQueueOnce } from '@/services/uploaderLoop';

import { useSettings } from './SettingsContext';

interface LibraryValue {
  recordings: Recording[];
  ready: boolean;
  refresh(): Promise<void>;
  /** Coloca uma gravacao recem-finalizada na fila e dispara o envio. */
  enqueue(recording: Recording): Promise<void>;
  retry(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Dispara a fila agora (envio manual). */
  kick(): void;
}

const LibraryContext = createContext<LibraryValue | null>(null);

/** Enquanto houver itens na fila, tenta enviar neste intervalo. */
const WORKER_INTERVAL_MS = 15_000;

/** Intervalo de busca da transcricao enquanto houver alguma pendente. */
const TRANSCRIPT_INTERVAL_MS = 8_000;

/** Intervalo da reconciliacao com o servidor (notas dos dois lados). */
const RECONCILE_INTERVAL_MS = 60_000;

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { config } = useSettings();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const list = await listRecordings();
    setRecordings(list);
  }, []);

  const kick = useCallback(() => {
    void runUploadQueueOnce().then(refresh).catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    let alive = true;
    listRecordings()
      .then((list) => {
        if (!alive) return;
        setRecordings(list);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setReady(true);
      });
    const unsubscribe = observeUploads((updated) => {
      setRecordings((prev) => {
        const exists = prev.some((r) => r.id === updated.id);
        return exists ? prev.map((r) => (r.id === updated.id ? updated : r)) : [updated, ...prev];
      });
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  // Worker: tenta enviar assim que a fila carrega, quando o servidor e
  // configurado, periodicamente enquanto houver itens, e ao voltar ao app.
  const hasPending = recordings.some(isUploadable);
  const hasPendingTranscripts = recordings.some(needsTranscript);

  const pullTranscripts = useCallback(() => {
    void fetchTranscriptsOnce().then(refresh).catch(() => undefined);
  }, [refresh]);

  const reconcile = useCallback(() => {
    void reconcileOnce()
      .then((changed) => (changed ? refresh() : undefined))
      .catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    if (!ready) return;
    kick();
    pullTranscripts();
    reconcile();
  }, [ready, kick, pullTranscripts, reconcile]);

  useEffect(() => {
    if (!config) return;
    kick();
    pullTranscripts();
    reconcile();
  }, [config, kick, pullTranscripts, reconcile]);

  useEffect(() => {
    if (!config) return undefined;
    const id = setInterval(() => reconcile(), RECONCILE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [config, reconcile]);

  useEffect(() => {
    if (!hasPending) return undefined;
    const id = setInterval(() => kick(), WORKER_INTERVAL_MS);
    return () => clearInterval(id);
  }, [hasPending, kick]);

  useEffect(() => {
    if (!hasPendingTranscripts) return undefined;
    const id = setInterval(() => pullTranscripts(), TRANSCRIPT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [hasPendingTranscripts, pullTranscripts]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        kick();
        pullTranscripts();
        reconcile();
      }
    });
    return () => subscription.remove();
  }, [kick, pullTranscripts, reconcile]);

  const enqueue = useCallback(
    async (recording: Recording) => {
      const queued = markQueued(recording, new Date());
      await upsertRecording(queued);
      setRecordings((prev) => {
        const exists = prev.some((r) => r.id === queued.id);
        return exists ? prev.map((r) => (r.id === queued.id ? queued : r)) : [queued, ...prev];
      });
      kick();
    },
    [kick],
  );

  const retry = useCallback(
    async (id: string) => {
      const current = recordings.find((r) => r.id === id);
      // Nunca reenvia uma gravacao ja enviada: o upload no servidor esta
      // concluido e o complete devolveria 409, derrubando a entrada para falha.
      if (!current || !canRetry(current)) return;
      const requeued = markQueued(
        { ...current, nextAttemptAt: undefined, lastError: undefined },
        new Date(),
      );
      await upsertRecording(requeued);
      setRecordings((prev) => prev.map((r) => (r.id === id ? requeued : r)));
      kick();
    },
    [recordings, kick],
  );

  const remove = useCallback(
    async (id: string) => {
      const current = recordings.find((r) => r.id === id);
      if (!current) return;
      if (current.entryId) {
        try {
          await deleteRemoteEntry(current.entryId);
        } catch {
          // Sem servidor: uma nota que so existe la nao pode sumir apenas daqui,
          // senao reapareceria na proxima reconciliacao.
          if (current.status === 'remote') return;
        }
      }
      if (current.status !== 'remote') deleteSessionFiles(current.id);
      await deleteRecordingRow(id);
      setRecordings((prev) => prev.filter((r) => r.id !== id));
    },
    [recordings],
  );

  const value = useMemo<LibraryValue>(
    () => ({ recordings, ready, refresh, enqueue, retry, remove, kick }),
    [recordings, ready, refresh, enqueue, retry, remove, kick],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryValue {
  const value = useContext(LibraryContext);
  if (!value) throw new Error('useLibrary deve ser usado dentro de LibraryProvider');
  return value;
}
