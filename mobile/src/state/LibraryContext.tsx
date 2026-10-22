import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { newId } from '@/core/id';
import { DEFAULT_NOTEBOOK_ID, sameNotebooks, type Notebook } from '@/core/notebooks';
import { buildDraftNote, buildTextNote, noteHasContent } from '@/core/note';
import { attachAudioToNote, audioRefFromPath, canFreeLocalAudio } from '@/core/noteAudio';
import type { NoteInsertPosition } from '@/core/noteDocument';
import { markQueued } from '@/core/queue';
import { isUploadable, needsNoteSync, needsTranscript, type Recording } from '@/core/types';
import { bumpRender } from '@/dev/perf';
import { deleteRecordingRow, getRecording, listRecordings, upsertRecording } from '@/services/db';
import { deleteServerEntry } from '@/services/entries';
import { deleteSessionAudioFiles, deleteSessionFiles } from '@/services/files';
import {
  deleteLocalNotebook,
  insertLocalNotebook,
  listNotebooks,
  updateLocalNotebook,
} from '@/services/notebooks';
import { pushNotebooks } from '@/services/notebookSync';
import { noteIsOpen } from '@/services/noteVisibility';
import { pullServerEntries } from '@/services/pull';
import { fetchTranscriptsOnce } from '@/services/transcripts';
import { emitRecording, observeUploads, runUploadQueueOnce } from '@/services/uploaderLoop';

import { useSettings } from './SettingsContext';

interface LibraryValue {
  recordings: Recording[];
  notebooks: Notebook[];
  ready: boolean;
  refresh(): Promise<void>;
  refreshNotebooks(): Promise<void>;
  /** Cria um caderno local; o push ao servidor e best-effort. */
  createNotebook(input: { name: string; color?: string }): Promise<Notebook>;
  /** Renomeia/recolore um caderno. */
  renameNotebook(id: string, patch: { name?: string; color?: string }): Promise<void>;
  /** Exclui um caderno; as notas vao para "Notas ao acaso". */
  removeNotebook(id: string): Promise<void>;
  /** Move uma nota de caderno. */
  moveNoteToNotebook(id: string, notebookId: string): Promise<void>;
  /** Substitui as tags da nota. */
  setNoteTags(id: string, tags: string[]): Promise<void>;
  /** Coloca uma gravacao recem-finalizada na fila e dispara o envio. */
  enqueue(recording: Recording): Promise<void>;
  /** Cria uma nota somente texto e a coloca na fila. */
  createTextNote(input: {
    title: string;
    text: string;
    recordedAt?: string;
    notebookId?: string;
  }): Promise<Recording>;
  /** Cria um rascunho vazio de nota (nao entra na fila ainda). */
  createDraftNote(notebookId?: string): Promise<Recording>;
  /** Salva titulo/texto da nota (autosave). */
  updateNote(id: string, patch: { title?: string; text?: string }): Promise<void>;
  /**
   * Anexa um audio gravado a uma nota como no do corpo. `at` e o cursor onde o
   * player deve entrar; sem ele, o audio vai para o fim. `false` se a nota nao
   * existe mais.
   */
  attachAudio(id: string, audio: Recording, at?: NoteInsertPosition | null): Promise<boolean>;
  /** Ao sair da nota: envia rascunho com conteudo (ou descarta vazio) e sincroniza editados. */
  submitNote(id: string): Promise<void>;
  /** Arquiva/desarquiva a nota (sai da lista principal). */
  archiveNote(id: string): Promise<void>;
  unarchiveNote(id: string): Promise<void>;
  /** Remove o audio local de notas ja sincronizadas (o audio continua no servidor). */
  freeSyncedAudio(): Promise<{ notes: number; bytes: number }>;
  /** Remove o audio local de uma nota sincronizada; devolve os bytes liberados. */
  freeAudioForNote(id: string): Promise<number>;
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
    if (
      old &&
      old.updatedAt === item.updatedAt &&
      old.status === item.status &&
      old.notebookId === item.notebookId &&
      (old.tags ?? []).join('\u0000') === (item.tags ?? []).join('\u0000')
    ) {
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

/** Com o app aberto, busca edicoes feitas no servidor (dashboard). */
const SERVER_PULL_INTERVAL_MS = 20_000;

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { config } = useSettings();
  bumpRender('LibraryProvider');
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
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

  const refreshNotebooks = useCallback(async () => {
    const list = await listNotebooks();
    // O banco devolve objetos novos a cada leitura. Manter a identidade quando
    // nada mudou evita re-renderizar a home (e todos os cards) a cada ciclo.
    setNotebooks((prev) => (sameNotebooks(prev, list) ? prev : list));
  }, []);

  const kick = useCallback(() => {
    bumpRender('kick.called');
    // Enquanto a nota esta aberta, upload/rede/SQLite esperam: eles competem
    // com a leitura e a digitacao. A fila e persistente e retoma ao sair.
    if (noteIsOpen()) return;
    // Cadernos pendentes (criados/renomeados/excluidos offline) sobem no mesmo
    // ciclo da fila; se falhar, a linha continua suja para a proxima tentativa.
    void pushNotebooks().then(refreshNotebooks).catch(() => undefined);
    void runUploadQueueOnce().then(refresh).catch(() => undefined);
  }, [refresh, refreshNotebooks]);

  useEffect(() => {
    let alive = true;
    Promise.all([listRecordings(), listNotebooks()])
      .then(([list, notebookList]) => {
        if (!alive) return;
        setRecordings(list);
        setNotebooks(notebookList);
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
    // A nota aberta e local-first: nada de rede/SQLite de fundo competindo.
    if (noteIsOpen()) return;
    bumpRender('transcripts.called');
    void fetchTranscriptsOnce().then(refresh).catch(() => undefined);
  }, [refresh]);

  // Traz notas do servidor para o app (best-effort). Se nada novo chegou, nao
  // mexe na lista local.
  const pullServer = useCallback(() => {
    if (noteIsOpen()) return;
    bumpRender('pullserver.called');
    void pullServerEntries()
      .then(async (changed) => {
        await refreshNotebooks();
        if (changed > 0) return refresh();
        return undefined;
      })
      .catch(() => undefined);
  }, [refresh, refreshNotebooks]);

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

  // Caderno criado/alterado offline tambem tenta de novo periodicamente, mesmo
  // sem nota pendente.
  useEffect(() => {
    if (!notebooks.some((notebook) => notebook.dirty)) return undefined;
    const id = setInterval(() => kick(), WORKER_INTERVAL_MS);
    return () => clearInterval(id);
  }, [notebooks, kick]);

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

  // Nota editada no dashboard aparece no app sem precisar reabrir: com o app em
  // primeiro plano, busca as versoes novas a cada intervalo. Fora de foco, o
  // listener acima ja puxa ao voltar.
  useEffect(() => {
    if (!config) return undefined;
    const id = setInterval(() => {
      if (AppState.currentState === 'active') {
        pullServer();
      }
    }, SERVER_PULL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [config, pullServer]);

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
    async (input: {
      title: string;
      text: string;
      recordedAt?: string;
      notebookId?: string;
    }) => {
      const note = {
        ...buildTextNote({
          id: newId('note_'),
          title: input.title,
          text: input.text,
          recordedAt: input.recordedAt,
          now: new Date(),
        }),
        notebookId: input.notebookId || DEFAULT_NOTEBOOK_ID,
      };
      await upsertRecording(note);
      setRecordings((prev) => [note, ...prev]);
      kick();
      return note;
    },
    [kick],
  );

  const createDraftNote = useCallback(async (notebookId = DEFAULT_NOTEBOOK_ID) => {
    // A nota nasce 100% local. A entrada no servidor e criada no envio (sync),
    // com o id temporal da nota — o app nao depende do servidor pra existir.
    const note = {
      ...buildDraftNote({ id: newId('note_'), now: new Date() }),
      notebookId,
    };
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
      // Abrir a nota nao e editar: sem mudanca real nao grava linha nem mexe em
      // updatedAt (o que fazia a lista inteira se considerar alterada).
      if (!changed) return;
      const updated: Recording = {
        ...current,
        ...patch,
        // Numa nota ja enviada, so marca o que mudou: o autosave tambem roda no
        // mount e nao pode enfileirar um reenvio a toa.
        noteDirty: current.status === 'completed' ? true : current.noteDirty,
        updatedAt: new Date().toISOString(),
      };
      // Persiste sem re-renderizar o app inteiro a cada autosave; a lista se
      // atualiza no refresh ao sair da nota.
      await upsertRecording(updated);
    },
    [],
  );

  const attachAudio = useCallback(
    async (id: string, audio: Recording, at?: NoteInsertPosition | null) => {
      const current = await getRecording(id);
      // A nota pode ter sido apagada enquanto a gravacao acontecia. Quem chama
      // precisa saber: sem isso o audio era descartado em silencio.
      if (!current) return false;
      const ref = audioRefFromPath(audio.filePath);
      if (!ref) return false;
      const updated = attachAudioToNote(
        current,
        {
          ref,
          filePath: audio.filePath,
          durationMs: audio.durationMs,
          sizeBytes: audio.sizeBytes,
        },
        at,
      );
      await upsertRecording(updated);
      setRecordings((prev) => prev.map((r) => (r.id === id ? updated : r)));
      return true;
    },
    [],
  );

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

  const createNotebook = useCallback(
    async (input: { name: string; color?: string }) => {
      const now = new Date().toISOString();
      const notebook: Notebook = {
        id: newId('nb_'),
        name: input.name.trim(),
        color: input.color ?? '',
        isDefault: false,
        createdAt: now,
        updatedAt: now,
        dirty: true,
        synced: false,
      };
      await insertLocalNotebook(notebook);
      setNotebooks((prev) => [...prev, notebook]);
      void pushNotebooks().then(refreshNotebooks).catch(() => undefined);
      return notebook;
    },
    [refreshNotebooks],
  );

  const renameNotebook = useCallback(
    async (id: string, patch: { name?: string; color?: string }) => {
      await updateLocalNotebook(id, patch);
      await refreshNotebooks();
      void pushNotebooks().then(refreshNotebooks).catch(() => undefined);
    },
    [refreshNotebooks],
  );

  const removeNotebook = useCallback(
    async (id: string) => {
      await deleteLocalNotebook(id);
      await Promise.all([refresh(), refreshNotebooks()]);
      void pushNotebooks().then(refreshNotebooks).catch(() => undefined);
    },
    [refresh, refreshNotebooks],
  );

  const moveNoteToNotebook = useCallback(
    async (id: string, notebookId: string) => {
      const current = await getRecording(id);
      if (!current || current.notebookId === notebookId) return;
      const updated: Recording = {
        ...current,
        notebookId,
        // Nota ja enviada: o sync leva o caderno. Rascunho local leva junto na
        // criacao da entrada no servidor.
        notebookDirty: current.entryId ? true : undefined,
        updatedAt: new Date().toISOString(),
      };
      await upsertRecording(updated);
      setRecordings((prev) => prev.map((r) => (r.id === id ? updated : r)));
      if (current.entryId) kick();
    },
    [kick],
  );

  const setNoteTags = useCallback(
    async (id: string, tags: string[]) => {
      const seen = new Set<string>();
      const normalized = tags
        .map((tag) => tag.trim())
        .filter((tag) => {
          const key = tag.toLowerCase();
          if (!tag || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
      const current = await getRecording(id);
      if (!current) return;
      const before = (current.tags ?? []).join('\u0000');
      if (before === normalized.join('\u0000')) return;
      const updated: Recording = {
        ...current,
        tags: normalized.length > 0 ? normalized : undefined,
        tagsDirty: current.entryId ? true : undefined,
        updatedAt: new Date().toISOString(),
      };
      await upsertRecording(updated);
      setRecordings((prev) => prev.map((r) => (r.id === id ? updated : r)));
      if (current.entryId) kick();
    },
    [kick],
  );

  const freeAudioForNote = useCallback(
    async (id: string) => {
      const current =
        (await getRecording(id)) ?? recordingsRef.current.find((item) => item.id === id);
      if (!current) return 0;
      if (!canFreeLocalAudio(current)) return 0;

      const freed = deleteSessionAudioFiles(id);
      if (freed.files === 0) return 0;

      const updated: Recording = {
        ...current,
        filePath: undefined,
        sizeBytes: undefined,
        updatedAt: new Date().toISOString(),
      };
      await upsertRecording(updated);
      emitRecording(updated);
      await refresh();
      return freed.bytes;
    },
    [refresh],
  );

  const freeSyncedAudio = useCallback(async () => {
    const list = await listRecordings();
    let notes = 0;
    let bytes = 0;
    for (const recording of list) {
      if (!canFreeLocalAudio(recording)) continue;
      const freed = deleteSessionAudioFiles(recording.id);
      if (freed.files === 0) continue;
      const updated: Recording = {
        ...recording,
        filePath: undefined,
        sizeBytes: undefined,
        updatedAt: new Date().toISOString(),
      };
      await upsertRecording(updated);
      emitRecording(updated);
      notes += 1;
      bytes += freed.bytes;
    }
    await refresh();
    return { notes, bytes };
  }, [refresh]);

  const value = useMemo<LibraryValue>(
    () => ({
      recordings,
      notebooks,
      ready,
      refresh,
      refreshNotebooks,
      createNotebook,
      renameNotebook,
      removeNotebook,
      moveNoteToNotebook,
      setNoteTags,
      enqueue,
      createTextNote,
      createDraftNote,
      updateNote,
      attachAudio,
      submitNote,
      archiveNote,
      unarchiveNote,
      freeSyncedAudio,
      freeAudioForNote,
      retry,
      remove,
      kick,
      pull: pullServer,
    }),
    [
      recordings,
      notebooks,
      ready,
      refresh,
      refreshNotebooks,
      createNotebook,
      renameNotebook,
      removeNotebook,
      moveNoteToNotebook,
      setNoteTags,
      enqueue,
      createTextNote,
      createDraftNote,
      updateNote,
      attachAudio,
      submitNote,
      archiveNote,
      unarchiveNote,
      freeSyncedAudio,
      freeAudioForNote,
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
