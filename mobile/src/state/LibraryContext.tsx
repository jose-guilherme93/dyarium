import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { newId } from '@/core/id';
import { buildDraftNote, buildTextNote, noteHasContent } from '@/core/note';
import { markQueued } from '@/core/queue';
import { isUploadable, needsTranscript, type Recording } from '@/core/types';
import { deleteRecordingRow, getRecording, listRecordings, upsertRecording } from '@/services/db';
import { deleteSessionFiles } from '@/services/files';
import { syncNote } from '@/services/noteSync';
import { fetchTranscriptsOnce } from '@/services/transcripts';
import { observeUploads, runUploadQueueOnce } from '@/services/uploaderLoop';

import { useSettings } from './SettingsContext';

interface LibraryValue {
  recordings: Recording[];
  ready: boolean;
  refresh(): Promise<void>;
  /** Coloca uma gravacao recem-finalizada na fila e dispara o envio. */
  enqueue(recording: Recording): Promise<void>;
  /** Cria uma nota somente texto e a coloca na fila. */
  createTextNote(input: { title: string; text: string; recordedAt?: string }): Promise<Recording>;
  /** Cria um rascunho vazio de nota (nao entra na fila ainda). */
  createDraftNote(): Promise<Recording>;
  /** Salva titulo/texto da nota (autosave). */
  updateNote(id: string, patch: { title?: string; text?: string }): Promise<void>;
  /** Anexa um audio gravado a uma nota. */
  attachAudio(id: string, audio: Recording): Promise<void>;
  /** Ao sair da nota: envia rascunho com conteudo (ou descarta vazio) e sincroniza editados. */
  submitNote(id: string): Promise<void>;
  /** Arquiva/desarquiva a nota (sai da lista principal). */
  archiveNote(id: string): Promise<void>;
  unarchiveNote(id: string): Promise<void>;
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

  useEffect(() => {
    if (!ready) return;
    kick();
    pullTranscripts();
  }, [ready, kick, pullTranscripts]);

  useEffect(() => {
    if (!config) return;
    kick();
    pullTranscripts();
  }, [config, kick, pullTranscripts]);

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
      }
    });
    return () => subscription.remove();
  }, [kick, pullTranscripts]);

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

  const createTextNote = useCallback(
    async (input: { title: string; text: string; recordedAt?: string }) => {
      const note = buildTextNote({
        id: newId('note_'),
        title: input.title,
        text: input.text,
        recordedAt: input.recordedAt,
        now: new Date(),
      });
      await upsertRecording(note);
      setRecordings((prev) => [note, ...prev]);
      kick();
      return note;
    },
    [kick],
  );

  const createDraftNote = useCallback(async () => {
    const note = buildDraftNote({ id: newId('note_'), now: new Date() });
    await upsertRecording(note);
    setRecordings((prev) => [note, ...prev]);
    return note;
  }, []);

  const updateNote = useCallback(
    async (id: string, patch: { title?: string; text?: string }) => {
      const current = await getRecording(id);
      if (!current) return;
      const updated: Recording = { ...current, ...patch, updatedAt: new Date().toISOString() };
      await upsertRecording(updated);
      setRecordings((prev) => prev.map((r) => (r.id === id ? updated : r)));
    },
    [],
  );

  const attachAudio = useCallback(async (id: string, audio: Recording) => {
    const current = await getRecording(id);
    if (!current) return;
    const updated: Recording = {
      ...current,
      dir: audio.dir,
      filePath: audio.filePath,
      segmentCount: audio.segmentCount,
      durationMs: audio.durationMs,
      sizeBytes: audio.sizeBytes,
      source: 'microphone',
      updatedAt: new Date().toISOString(),
    };
    await upsertRecording(updated);
    setRecordings((prev) => prev.map((r) => (r.id === id ? updated : r)));
  }, []);

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

  const submitNote = useCallback(
    async (id: string) => {
      const current = (await getRecording(id)) ?? recordings.find((r) => r.id === id);
      if (!current) return;
      if (current.status === 'draft') {
        if (!noteHasContent(current)) {
          await remove(id);
          return;
        }
        // Nota so de texto: o texto ja e o conteudo (nao ha transcricao a esperar).
        const ready: Recording = current.filePath
          ? current
          : { ...current, transcript: current.text, transcriptStatus: 'ready' };
        await enqueue(ready);
        return;
      }
      if (current.status === 'completed') {
        void syncNote(current).catch(() => undefined);
      }
    },
    [recordings, enqueue, remove],
  );

  const setArchived = useCallback(async (id: string, archived: boolean) => {
    const current = await getRecording(id);
    if (!current) return;
    const updated: Recording = {
      ...current,
      archived: archived || undefined,
      updatedAt: new Date().toISOString(),
    };
    await upsertRecording(updated);
    setRecordings((prev) => prev.map((r) => (r.id === id ? updated : r)));
  }, []);

  const archiveNote = useCallback((id: string) => setArchived(id, true), [setArchived]);
  const unarchiveNote = useCallback((id: string) => setArchived(id, false), [setArchived]);

  const value = useMemo<LibraryValue>(
    () => ({
      recordings,
      ready,
      refresh,
      enqueue,
      createTextNote,
      createDraftNote,
      updateNote,
      attachAudio,
      submitNote,
      archiveNote,
      unarchiveNote,
      retry,
      remove,
      kick,
    }),
    [
      recordings,
      ready,
      refresh,
      enqueue,
      createTextNote,
      createDraftNote,
      updateNote,
      attachAudio,
      submitNote,
      archiveNote,
      unarchiveNote,
      retry,
      remove,
      kick,
    ],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryValue {
  const value = useContext(LibraryContext);
  if (!value) throw new Error('useLibrary deve ser usado dentro de LibraryProvider');
  return value;
}
