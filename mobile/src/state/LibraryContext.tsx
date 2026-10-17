import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { newId } from '@/core/id';
import { buildDraftNote, buildTextNote, noteHasContent } from '@/core/note';
import { markQueued } from '@/core/queue';
import { isUploadable, needsNoteSync, needsTranscript, type Recording } from '@/core/types';
import { bumpRender } from '@/dev/perf';
import { deleteRecordingRow, getRecording, listRecordings, upsertRecording } from '@/services/db';
import { deleteServerEntry } from '@/services/entries';
import { deleteSessionFiles } from '@/services/files';
import { pullServerEntries } from '@/services/pull';
import { fetchTranscriptsOnce } from '@/services/transcripts';
import { emitRecording, observeUploads, runUploadQueueOnce } from '@/services/uploaderLoop';

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
  /** Remove o audio local de notas ja sincronizadas (o audio continua no servidor). */
  freeSyncedAudio(): Promise<number>;
  retry(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Dispara a fila agora (envio manual). */
  kick(): void;
  /** Traz notas do servidor (pull) e atualiza a lista. */
  pull(): void;
}

const LibraryContext = createContext<LibraryValue | null>(null);

/**
 * Mescla a lista lida do banco com a atual, reutilizando os objetos que nao
 * mudaram (mesmo id/updatedAt/status). Assim um refresh que encontra uma unica
 * nota alterada re-renderiza so o card dela, nao os 46. `updatedAt` muda a cada
 * escrita.
 */
function mergeRecordings(prev: Recording[], next: Recording[]): Recording[] {
  const byId = new Map(prev.map((r) => [r.id, r]));
  let identical = prev.length === next.length;
  const merged = next.map((item, index) => {
    const old = byId.get(item.id);
    if (old && old.updatedAt === item.updatedAt && old.status === item.status) {
      if (prev[index] !== old) identical = false;
      return old;
    }
    identical = false;
    return item;
  });
  return identical ? prev : merged;
}

/** Enquanto houver itens na fila, tenta enviar neste intervalo. */
const WORKER_INTERVAL_MS = 15_000;

/** Intervalo de busca da transcricao enquanto houver alguma pendente. */
const TRANSCRIPT_INTERVAL_MS = 8_000;

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { config } = useSettings();
  bumpRender('LibraryProvider');
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    bumpRender('recordings.changed');
  }, [recordings]);

  // Espelho sempre atual das gravacoes, para callbacks estaveis (sem depender
  // do array em si) — evita re-render das linhas da lista.
  const recordingsRef = useRef<Recording[]>([]);
  useEffect(() => {
    recordingsRef.current = recordings;
  }, [recordings]);

  const refresh = useCallback(async () => {
    bumpRender('refresh.called');
    const list = await listRecordings();
    // Reutiliza os itens inalterados: so o card que mudou re-renderiza.
    setRecordings((prev) => mergeRecordings(prev, list));
  }, []);

  const kick = useCallback(() => {
    bumpRender('kick.called');
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
  const hasPending = recordings.some((r) => isUploadable(r) || needsNoteSync(r));
  const hasPendingTranscripts = recordings.some(needsTranscript);

  const pullTranscripts = useCallback(() => {
    bumpRender('transcripts.called');
    void fetchTranscriptsOnce().then(refresh).catch(() => undefined);
  }, [refresh]);

  // Traz notas do servidor para o app (best-effort). Se nada novo chegou, nao
  // mexe na lista local.
  const pullServer = useCallback(() => {
    bumpRender('pullserver.called');
    void pullServerEntries()
      .then((added) => {
        if (added > 0) return refresh();
        return undefined;
      })
      .catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    if (!ready) return;
    kick();
    pullTranscripts();
    pullServer();
  }, [ready, kick, pullTranscripts, pullServer]);

  useEffect(() => {
    if (!config) return;
    kick();
    pullTranscripts();
    pullServer();
  }, [config, kick, pullTranscripts, pullServer]);

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
        pullServer();
      }
    });
    return () => subscription.remove();
  }, [kick, pullTranscripts, pullServer]);

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
    // A nota nasce 100% local. A entrada no servidor e criada no envio (sync),
    // com o id temporal da nota — o app nao depende do servidor pra existir.
    const note = buildDraftNote({ id: newId('note_'), now: new Date() });
    await upsertRecording(note);
    setRecordings((prev) => [note, ...prev]);
    return note;
  }, []);

  const updateNote = useCallback(
    async (id: string, patch: { title?: string; text?: string }) => {
      const current = await getRecording(id);
      if (!current) return;
      const changed =
        (patch.title !== undefined && patch.title !== current.title) ||
        (patch.text !== undefined && patch.text !== current.text);
      const updated: Recording = {
        ...current,
        ...patch,
        // Numa nota ja enviada, so marca o que mudou: o autosave tambem roda no
        // mount e nao pode enfileirar um reenvio a toa.
        noteDirty: current.status === 'completed' && changed ? true : current.noteDirty,
        updatedAt: new Date().toISOString(),
      };
      // Persiste sem re-renderizar o app inteiro a cada autosave; a lista se
      // atualiza no refresh ao sair da nota.
      await upsertRecording(updated);
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
      const current = recordingsRef.current.find((r) => r.id === id);
      if (!current) return;
      const requeued = markQueued(
        { ...current, nextAttemptAt: undefined, lastError: undefined },
        new Date(),
      );
      await upsertRecording(requeued);
      setRecordings((prev) => prev.map((r) => (r.id === id ? requeued : r)));
      kick();
    },
    [kick],
  );

  const remove = useCallback(
    async (id: string) => {
      const current = recordingsRef.current.find((r) => r.id === id);
      if (current) {
        deleteSessionFiles(current.id);
        // Apaga tambem no servidor, para nao ressuscitar no proximo pull.
        if (current.entryId) {
          void deleteServerEntry(current.entryId).catch(() => undefined);
        }
      }
      await deleteRecordingRow(id);
      setRecordings((prev) => prev.filter((r) => r.id !== id));
    },
    [],
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
        // Edicao local numa nota ja enviada: persiste o flag e deixa o worker da
        // fila enviar. Sobrevive a fechar o app e reenvia quando houver rede.
        const updated: Recording = {
          ...current,
          noteDirty: true,
          updatedAt: new Date().toISOString(),
        };
        await upsertRecording(updated);
        setRecordings((prev) => prev.map((r) => (r.id === id ? updated : r)));
        kick();
      }
    },
    [recordings, enqueue, remove, kick],
  );

  const setArchived = useCallback(async (id: string, archived: boolean) => {
    const current = await getRecording(id);
    if (!current) return;
    const updated: Recording = {
      ...current,
      archived: archived || undefined,
      // Arquivar e uma propriedade da nota, entao vai para o servidor como o
      // resto: a nota fica suja para o sync levar.
      noteDirty: current.entryId ? true : current.noteDirty,
      updatedAt: new Date().toISOString(),
    };
    await upsertRecording(updated);
    setRecordings((prev) => prev.map((r) => (r.id === id ? updated : r)));
  }, []);

  const archiveNote = useCallback((id: string) => setArchived(id, true), [setArchived]);
  const unarchiveNote = useCallback((id: string) => setArchived(id, false), [setArchived]);

  const freeSyncedAudio = useCallback(async () => {
    const list = await listRecordings();
    let freed = 0;
    for (const recording of list) {
      if (recording.status !== 'completed' || !recording.filePath) continue;
      deleteSessionFiles(recording.id);
      const updated: Recording = {
        ...recording,
        filePath: undefined,
        dir: '',
        sizeBytes: undefined,
        updatedAt: new Date().toISOString(),
      };
      await upsertRecording(updated);
      emitRecording(updated);
      freed += 1;
    }
    await refresh();
    return freed;
  }, [refresh]);

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
      freeSyncedAudio,
      retry,
      remove,
      kick,
      pull: pullServer,
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
      freeSyncedAudio,
      retry,
      remove,
      kick,
      pullServer,
    ],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryValue {
  const value = useContext(LibraryContext);
  if (!value) throw new Error('useLibrary deve ser usado dentro de LibraryProvider');
  return value;
}
