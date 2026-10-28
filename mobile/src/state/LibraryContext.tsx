import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { newId } from '@/core/id';
import { DEFAULT_NOTEBOOK_ID, sameNotebooks, type Notebook } from '@/core/notebooks';
import { buildDraftNote, buildTextNote, noteHasContent } from '@/core/note';
import { attachAudioToNote, audioRefFromPath, canFreeLocalAudio } from '@/core/noteAudio';
import type { NoteInsertPosition } from '@/core/noteDocument';
import { markQueued } from '@/core/queue';
import { isUploadable, needsNoteSync, needsTranscript, type AuthorRole, type Recording } from '@/core/types';
import { bumpRender } from '@/dev/perf';
import { deleteRecordingRow, getRecording, listRecordings, updateRecordingNote, upsertRecording } from '@/services/db';
import { deleteServerEntry, restoreServerEntry } from '@/services/entries';
import { deleteSessionAudioFiles, deleteSessionFiles } from '@/services/files';
import {
  deleteLocalNotebook,
  insertLocalNotebook,
  listNotebooks,
  updateLocalNotebook,
} from '@/services/notebooks';
import { pushNotebooks } from '@/services/notebookSync';
import { analysisModelById } from '@/core/analysisModels';
import { reviewNeedsResume } from '@/core/transcriptReview';
import { pushLocalAnalyses } from '@/services/analysis';
import { isAnalysisModelInstalled } from '@/services/analysisModels';
import { localAnalysisAvailable } from '@/services/localAnalysis';
import { maybeTranscribeLocally, transcribePendingLocally } from '@/services/localTranscription';
import { reviewRecording } from '@/services/transcriptReview';
import { noteIsOpen } from '@/services/noteVisibility';
import { pullServerEntries } from '@/services/pull';
import { pushPendingTranscriptsOnce } from '@/services/transcriptSync';
import { fetchTranscriptsOnce } from '@/services/transcripts';
import { emitRecording, observeUploads, runUploadQueueOnce } from '@/services/uploaderLoop';
import { purgeExpiredTrash } from '@/services/trash';

import { useSettings } from './SettingsContext';

interface LibraryValue {
  recordings: Recording[];
  notebooks: Notebook[];
  ready: boolean;
  /** Relê a lista do banco e devolve a lista mesclada que a tela desenha. */
  refresh(): Promise<Recording[]>;
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
  /** Troca o autor da nota (vazio volta ao padrao da instancia). */
  setNoteAuthor(id: string, author: AuthorRole): Promise<void>;
  /** Coloca uma gravacao recem-finalizada na fila e dispara o envio. */
  enqueue(recording: Recording): Promise<void>;
  /** Cria uma nota somente texto e a coloca na fila. */
  createTextNote(input: {
    title: string;
    text: string;
    recordedAt?: string;
    notebookId?: string;
    capture?: { sourceId: string; startMs: number };
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
  /** Manda a nota para a lixeira; ela pode voltar por 7 dias. */
  remove(id: string): Promise<void>;
  /** Tira a nota da lixeira e a devolve para a lista. */
  restoreFromTrash(id: string): Promise<void>;
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
      old.author === item.author &&
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
  const {
    config,
    reviewTranscript: reviewEnabled,
    literalTranscript,
    analysisModel,
    analysisLowPower,
  } = useSettings();
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
    // Devolve a lista ja mesclada, e nao a do banco: quem aquece cache com ela
    // (o Painel de metricas) precisa dos mesmos objetos que vao ser desenhados.
    const merged = mergeRecordings(recordingsRef.current, list);
    setRecordings((prev) => (prev === recordingsRef.current ? merged : mergeRecordings(prev, list)));
    return merged;
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
    // Cadernos pendentes (criados/renomeados/excluidos offline) sobem **antes**
    // da fila: uma nota que aponta para um caderno ainda inexistente no servidor
    // levaria 422 invalid_notebook e ficaria falha para sempre.
    void pushNotebooks()
      .then(refreshNotebooks)
      .catch(() => undefined)
      .finally(() => {
        void runUploadQueueOnce().then(refresh).catch(() => undefined);
      });
  }, [refresh, refreshNotebooks]);

  useEffect(() => {
    let alive = true;
    // A lixeira local so libera audio/linha depois dos 7 dias. A limpeza vem
    // antes da leitura para a lista ja nascer sem uma nota expirada.
    purgeExpiredTrash()
      .catch(() => 0)
      .then(() => Promise.all([listRecordings(), listNotebooks()]))
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
      // Uma nota apagada enquanto subia nao pode voltar para a lista pelo
      // evento do uploader: a lixeira e a unica dona dela ate restaurar.
      if (updated.deletedAt) {
        setRecordings((prev) => prev.filter((r) => r.id !== updated.id));
        return;
      }
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
  // Transcricao feita no aparelho (inclusive por versao anterior do app, ou
  // envio que falhou offline) sobe para o servidor. Sem isso o dashboard
  // mostrava a nota transcrita sem texto.
  const pushTranscripts = useCallback(() => {
    if (noteIsOpen()) return;
    // O envio pode adotar a transcricao refeita no servidor: recarrega a lista
    // para o texto certo aparecer sem esperar o proximo ciclo.
    void pushPendingTranscriptsOnce().then(refresh).catch(() => undefined);
  }, [refresh]);

  // Uma revisao interrompida (app morto no meio) retoma no boot, como a
  // transcricao. Sem isso o chip ficava em "revisando" para sempre e o texto
  // nunca terminava de ser limpo.
  const resumeReviews = useCallback(async () => {
    if (!reviewEnabled || noteIsOpen()) return;
    // Revisao e trabalho pesado: sem o app na frente nao da para abrir o
    // servico em primeiro plano (Android 12+) e o processo seria encerrado.
    if (AppState.currentState !== 'active') return;
    if (!localAnalysisAvailable() || !isAnalysisModelInstalled(analysisModel)) return;
    const model = analysisModelById(analysisModel);
    if (!model) return;
    const list = await listRecordings().catch(() => [] as Recording[]);
    for (const recording of list) {
      if (recording.transcriptOrigin === 'server') continue;
      if (!recording.transcriptSegments?.length) continue;
      if (!reviewNeedsResume(recording.transcriptReview, recording.transcriptOrigin)) continue;
      try {
        await reviewRecording(recording, model, {
          literal: literalTranscript,
          lowPower: analysisLowPower,
          title: recording.title,
        });
      } catch {
        // retoma na proxima abertura
      }
      break;
    }
  }, [reviewEnabled, literalTranscript, analysisModel, analysisLowPower]);

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
    if (!ready || !config) return undefined;
    // A lista e a prioridade do boot. Envio, transcricao e pull entram depois
    // que a tela assentou, e cada um desiste se uma nota abrir no meio.
    const timer = setTimeout(() => {
      kick();
      pullTranscripts();
      pushTranscripts();
      pullServer();
      // O que ficou pela metade antes de o app morrer continua de onde parou.
      // A fila local so roda com o app na frente: trabalho pesado iniciado do
      // fundo nao consegue abrir o servico em primeiro plano no Android 12+.
      void transcribePendingLocally().catch(() => undefined);
      void resumeReviews().catch(() => undefined);
      // Analises feitas no aparelho antes da conexao sobem agora (idempotente).
      void pushLocalAnalyses().catch(() => undefined);
    }, 2000);
    return () => clearTimeout(timer);
  }, [ready, config, kick, pullTranscripts, pushTranscripts, pullServer, resumeReviews]);

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
        pushTranscripts();
        pullServer();
      }
    });
    return () => subscription.remove();
  }, [kick, pullTranscripts, pushTranscripts, pullServer]);

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
      // A transcricao no aparelho comeca aqui, logo depois de a nota existir:
      // esperar o proximo boot fazia o texto so aparecer minutos depois.
      void maybeTranscribeLocally(queued.id).catch(() => undefined);
    },
    [kick],
  );

  const createTextNote = useCallback(
    async (input: {
      title: string;
      text: string;
      recordedAt?: string;
      notebookId?: string;
      /** Nota/instante de onde um trecho de transcricao foi capturado. */
      capture?: { sourceId: string; startMs: number };
    }) => {
      const note = {
        ...buildTextNote({
          id: newId('note_'),
          title: input.title,
          text: input.text,
          recordedAt: input.recordedAt,
          capture: input.capture,
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
      // Update direcionado: o autosave nao pode ler e reescrever a linha inteira
      // (transcricao, segmentos e anexos) a cada pausa da digitacao.
      await updateRecordingNote(id, patch);
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
      const current =
        recordingsRef.current.find((r) => r.id === id) ?? (await getRecording(id));
      if (!current) return;
      // Apagar e logico: os arquivos ficam no aparelho ate a janela da lixeira
      // fechar, senao restaurar uma nota devolveria o texto sem o audio.
      const deletedAt = new Date().toISOString();
      const trashed: Recording = { ...current, deletedAt, updatedAt: deletedAt };
      await upsertRecording(trashed);
      setRecordings((prev) => prev.filter((r) => r.id !== id));
      // O servidor tem a mesma lixeira de 7 dias; a chamada e best-effort para
      // apagar offline nao impedir a nota de sair da lista local agora.
      if (current.entryId) {
        void deleteServerEntry(current.entryId).catch(() => undefined);
      }
    },
    [],
  );

  /** Rascunho vazio nunca foi uma nota: sai direto, sem passar pela lixeira. */
  const discardDraft = useCallback(async (id: string) => {
    deleteSessionFiles(id);
    await deleteRecordingRow(id);
    setRecordings((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const restoreFromTrash = useCallback(
    async (id: string) => {
      const current = await getRecording(id);
      if (!current?.deletedAt) return;
      const restored: Recording = {
        ...current,
        deletedAt: undefined,
        updatedAt: new Date().toISOString(),
      };
      await upsertRecording(restored);
      await refresh();
      // Desfaz a exclusao logica no servidor. Sem isso o proximo pull veria a
      // entrada na lixeira dele e apagaria a nota de novo.
      if (current.entryId) {
        void restoreServerEntry(current.entryId).catch(() => undefined);
      }
    },
    [refresh],
  );

  const submitNote = useCallback(
    async (id: string) => {
      const current = (await getRecording(id)) ?? recordings.find((r) => r.id === id);
      if (!current) return;
      if (current.status === 'draft') {
        if (!noteHasContent(current)) {
          await discardDraft(id);
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
    [recordings, enqueue, discardDraft, kick],
  );

  const setArchived = useCallback(async (id: string, archived: boolean) => {
    const current = await getRecording(id);
    if (!current) return;
    if (Boolean(current.archived) === archived) return;
    const updated: Recording = {
      ...current,
      archived: archived || undefined,
      // O sync manda o interruptor so quando ele mudou. O pull respeita o flag:
      // arquivar no aparelho nao volta atras antes de o servidor confirmar.
      archivedDirty: true,
      updatedAt: new Date().toISOString(),
    };
    await upsertRecording(updated);
    setRecordings((prev) => prev.map((r) => (r.id === id ? updated : r)));
    if (current.entryId) kick();
  }, [kick]);

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
        // Mesmo sem entrada criada ainda: a nota sobe depois com o conjunto.
        // Sem o flag, as tags ficavam so no aparelho e o pull as apagava.
        tagsDirty: true,
        updatedAt: new Date().toISOString(),
      };
      await upsertRecording(updated);
      setRecordings((prev) => prev.map((r) => (r.id === id ? updated : r)));
      if (current.entryId) kick();
    },
    [kick],
  );

  const setNoteAuthor = useCallback(
    async (id: string, author: AuthorRole) => {
      const current = await getRecording(id);
      if (!current) return;
      if ((current.author ?? '') === author) return;
      const updated: Recording = {
        ...current,
        author,
        // O pull respeita a escolha pendente: trocar no aparelho nao volta
        // atras antes de o servidor confirmar.
        authorDirty: true,
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
      setNoteAuthor,
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
      restoreFromTrash,
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
      setNoteAuthor,
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
      restoreFromTrash,
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
