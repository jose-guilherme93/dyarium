import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { markQueued } from '@/core/queue';
import type { Recording } from '@/core/types';
import { deleteRecordingRow, listRecordings, upsertRecording } from '@/services/db';
import { deleteSessionFiles } from '@/services/files';
import { observeUploads, runUploadQueueOnce } from '@/services/uploaderLoop';

interface LibraryValue {
  recordings: Recording[];
  ready: boolean;
  refresh(): Promise<void>;
  /** Coloca uma gravacao recem-finalizada na fila e dispara o envio. */
  enqueue(recording: Recording): Promise<void>;
  retry(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  kick(): void;
}

const LibraryContext = createContext<LibraryValue | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
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
        const next = exists ? prev.map((r) => (r.id === updated.id ? updated : r)) : [updated, ...prev];
        return next;
      });
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

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
      if (!current) return;
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
      if (current) deleteSessionFiles(current.id);
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
