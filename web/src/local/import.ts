/**
 * Importacao de um servidor para o cofre do navegador.
 *
 * Um sentido so: le o manifesto e as notas do ambiente antigo e grava no banco
 * local com o mesmo id. Rodar de novo atualiza, nunca duplica. Corpo vazio do
 * servidor nao apaga o texto que ja existe aqui.
 */

import {
  getRecording,
  updateChapterFields,
  updateRecordingNote,
  upsertRecording,
} from "../../../mobile/src/core/repo";
import type { Recording, TranscriptSegment } from "../../../mobile/src/core/types";

import { ATTACHMENTS_STORE, storeGet } from "../lib/idb";

import { saveAnalysisSnapshot } from "./analyze";
import { saveAttachmentBlob } from "./attachments";
import { localCoverBlob, saveLocalCover } from "./covers";
import { getLocalNotebook, upsertLocalNotebook } from "./notebooks";

import type { Analysis, Entry, Notebook } from "../types";

export interface ImportManifestEntry {
  id: string;
}

/** Trecho da fala como o servidor devolve; `revised` so vem quando difere. */
export interface ImportTranscriptSegment {
  start_ms: number;
  end_ms: number;
  text: string;
  edited?: boolean;
  /** Texto da revisao da IA naquele trecho; vazio quando nao mudou nada. */
  revised?: string;
  reviewed?: boolean;
}

/** Transcricao pronta no outro lado, no formato de `GET .../transcript`. */
export interface ImportTranscript {
  text: string;
  segments: ImportTranscriptSegment[];
}

/** O que o importador precisa do outro lado. HTTP na web, dublê no teste. */
export interface ImportSource {
  manifest(cursor?: string): Promise<{ entries: ImportManifestEntry[]; next?: string }>;
  /** Cadernos do outro lado; sem a rota (404) a lista vem vazia. */
  notebooks?(): Promise<Notebook[]>;
  /** Imagem da capa do caderno; null quando ele nao tem capa (404). */
  cover?(id: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  entry(id: string): Promise<Entry>;
  body(id: string): Promise<string>;
  deleted(): Promise<Entry[]>;
  /** Audio original da nota, quando o outro lado tem. null = nao tem. */
  audio?(id: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  /** Fala ja transcrita; null quando a nota nao tem transcricao. */
  transcript?(id: string): Promise<ImportTranscript | null>;
  /** Analise ja feita; null quando a nota nao foi analisada. */
  analysis?(id: string): Promise<Analysis | null>;
}

export interface ImportProgress {
  done: number;
  total: number;
}

export interface ImportResult {
  created: number;
  updated: number;
  trashed: number;
  /** Notas que falharam por inteiro: o detalhe ou o corpo nao vieram. */
  failed: number;
  total: number;
  /** Cadernos trazidos (criados ou atualizados); a nota encontra o deles aqui. */
  notebooks: number;
  /** Capas de caderno baixadas nesta rodada. */
  covers: number;
  /** Capas cujo download falhou; o caderno e as notas entraram igual. */
  coversFailed: number;
  /** Notas que ficaram com o audio original aqui (baixado agora ou ja presente). */
  audios: number;
  /** Notas cujo download do audio falhou; o texto delas entrou igual. */
  audiosFailed: number;
  /** Notas que ficaram com a transcricao do servidor no cofre. */
  transcripts: number;
  /** Notas cuja transcricao nao veio; elas entraram sem a fala. */
  transcriptsFailed: number;
  /** Notas que ficaram com a analise do servidor no cofre. */
  analyses: number;
  /** Notas cuja analise nao veio; elas entraram sem a analise. */
  analysesFailed: number;
}

/** Teto de paginas: 40 x 500 cobre qualquer biblioteca pessoal. */
const MAX_PAGINAS = 40;

/** Notas baixadas ao mesmo tempo. Cada uma custa ~3 requisicoes. */
const CONCORRENCIA = 6;

/** Id deterministico: reimportar atualiza o mesmo anexo, nunca duplica. */
function audioIdOf(entryId: string): string {
  return `att_${entryId}`;
}

/** O `audio.ts` acha o original pelo `serverAttachmentId`; sem ele o som nao toca. */
async function ligarAudio(entryId: string, attachmentId: string): Promise<void> {
  const atual = await getRecording(entryId);
  if (!atual || atual.serverAttachmentId === attachmentId) return;
  await upsertRecording({ ...atual, serverAttachmentId: attachmentId });
}

function recordingFromEntry(entry: Entry, existente: Recording | null): Recording {
  const base: Recording = existente ?? {
    id: entry.id,
    title: entry.title,
    recordedAt: entry.recorded_at ?? entry.created_at,
    dir: "",
    segmentCount: 0,
    status: "completed",
    source: "text",
    offset: 0,
    attempts: 0,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
  };
  return {
    ...base,
    id: entry.id,
    title: entry.title,
    recordedAt: entry.recorded_at ?? entry.created_at,
    notebookId: entry.notebook_id ?? base.notebookId,
    tags: entry.tags ?? base.tags,
    archived: entry.archived ?? base.archived,
    icon: entry.icon ?? base.icon,
    author: entry.author ?? base.author,
    // Estrutura do livro: capitulo, ordem e planejamento vivem na nota.
    chapterKind: entry.chapter_kind ?? base.chapterKind,
    chapterPosition: entry.chapter_position ?? base.chapterPosition,
    chapterStatus: entry.chapter_status ?? base.chapterStatus,
    chapterGoalWords: entry.chapter_goal_words ?? base.chapterGoalWords,
    chapterSynopsis: entry.chapter_synopsis ?? base.chapterSynopsis,
    chapterBeats: entry.chapter_beats ?? base.chapterBeats,
    chapterNotes: entry.chapter_notes ?? base.chapterNotes,
    // A fila de upload nao vem do servidor: aqui a nota ja e dado local.
    source: entry.source === "microphone" || entry.source === "share" ? entry.source : "text",
    status: "completed",
    updatedAt: entry.updated_at,
  };
}

/** Trecho no formato do cofre (`transcriptSegments`), sem o `idx` do servidor. */
function segmentoGravado(segmento: ImportTranscriptSegment): TranscriptSegment {
  return {
    start_ms: segmento.start_ms,
    end_ms: segmento.end_ms,
    text: segmento.text,
    ...(segmento.revised ? { revised: segmento.revised } : {}),
    ...(segmento.edited ? { edited: true } : {}),
    ...(segmento.reviewed ? { reviewed: true } : {}),
  };
}

/**
 * Grava a fala do servidor na nota, sem tocar no texto escrito.
 *
 * Uma transcricao feita aqui (`transcriptOrigin` local) vence: ela pode ter
 * revisao e trechos editados a mao, e reimportar nao pode apaga-los.
 */
async function gravarTranscricao(
  entryId: string,
  transcricao: ImportTranscript,
): Promise<void> {
  const atual = await getRecording(entryId);
  if (!atual || atual.transcriptOrigin === "local") return;
  await upsertRecording({
    ...atual,
    transcript: transcricao.text,
    transcriptSegments: transcricao.segments.map(segmentoGravado),
    transcriptStatus: "ready",
    transcriptOrigin: "server",
    hasTranscript: true,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * A capa local so serve quando e da mesma versao do servidor: baixar de novo
 * gastaria a imagem inteira para nada. O blob tambem precisa existir — o
 * caderno pode dizer que tem capa e a rodada anterior ter parado no meio.
 */
async function capaLocalNaVersao(
  local: Notebook | null,
  versao: string | null | undefined,
): Promise<boolean> {
  if (!local?.has_cover) return false;
  if ((local.cover_updated_at ?? "") !== (versao ?? "")) return false;
  try {
    await localCoverBlob(local.id);
    return true;
  } catch {
    return false;
  }
}

export async function importEntries(
  source: ImportSource,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportResult> {
  const manifesto: ImportManifestEntry[] = [];
  let cursor: string | undefined;
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
    const resposta = await source.manifest(cursor);
    manifesto.push(...(resposta.entries ?? []));
    cursor = resposta.next;
    if (!cursor) break;
  }

  const resultado: ImportResult = {
    created: 0,
    updated: 0,
    trashed: 0,
    failed: 0,
    total: manifesto.length,
    notebooks: 0,
    covers: 0,
    coversFailed: 0,
    audios: 0,
    audiosFailed: 0,
    transcripts: 0,
    transcriptsFailed: 0,
    analyses: 0,
    analysesFailed: 0,
  };
  let done = 0;

  // Cadernos primeiro: a nota aponta para o id do caderno, e sem a linha local
  // ela cairia em "Notas ao acaso" mesmo tendo dono no servidor.
  for (const notebook of (await source.notebooks?.()) ?? []) {
    const baixarCapa = source.cover;
    const temCapa = Boolean(baixarCapa && notebook.has_cover);
    // Lido antes do upsert: ele grava a versao remota, e depois disso nao da
    // mais para saber se a capa local e da mesma versao. So consulta o banco
    // quando ha capa para conferir.
    const anterior = temCapa ? await getLocalNotebook(notebook.id) : null;
    const situacao = await upsertLocalNotebook(notebook);
    if (situacao === "created") resultado.created += 1;
    if (situacao === "updated") resultado.updated += 1;
    if (situacao !== "unchanged") resultado.notebooks += 1;

    if (baixarCapa && notebook.has_cover) {
      try {
        if (!(await capaLocalNaVersao(anterior, notebook.cover_updated_at))) {
          const capa = await baixarCapa(notebook.id);
          if (capa) {
            // Copia tipada: o `Blob` nao aceita o `Uint8Array` generico.
            const blob = new Blob([new Uint8Array(capa.bytes)], { type: capa.contentType });
            await saveLocalCover(notebook.id, blob);
            resultado.covers += 1;
          }
        }
      } catch {
        // Capa que falha nao derruba o caderno nem as notas: o resumo conta.
        resultado.coversFailed += 1;
      }
    }
  }

  /** Grava uma nota: detalhe, corpo, audio, transcricao e analise, quando existem. */
  const gravarNota = async (item: ImportManifestEntry): Promise<void> => {
    const entry = await source.entry(item.id);
    const existente = await getRecording(entry.id);
    const gravacao = recordingFromEntry(entry, existente);
    await upsertRecording(gravacao);
    // O upsert nao conhece as colunas do capitulo; elas vao numa escrita so.
    await updateChapterFields(entry.id, {
      chapterKind: gravacao.chapterKind,
      chapterPosition: gravacao.chapterPosition,
      chapterStatus: gravacao.chapterStatus,
      chapterGoalWords: gravacao.chapterGoalWords,
      chapterSynopsis: gravacao.chapterSynopsis,
      chapterBeats: gravacao.chapterBeats,
      chapterNotes: gravacao.chapterNotes,
    });

    const corpo = await source.body(entry.id);
    if (corpo.trim()) {
      await updateRecordingNote(entry.id, { text: corpo });
    }

    const baixarAudio = source.audio;
    // O detalhe ja diz se a nota tem audio: pedir o arquivo de 419 notas sem
    // audio e uma requisicao desperdicada por nota, e a importacao fica lenta.
    const temAudio = entry.audios ? entry.audios.length > 0 : true;
    if (baixarAudio && temAudio) {
      const audioId = audioIdOf(entry.id);
      try {
        // Ja baixado numa rodada anterior: nem toca na rede.
        if (await storeGet(ATTACHMENTS_STORE, audioId)) {
          await ligarAudio(entry.id, audioId);
          resultado.audios += 1;
        } else {
          const audio = await baixarAudio(entry.id);
          if (audio) {
            // Copia tipada como `Uint8Array<ArrayBuffer>`, que o `Blob` aceita.
            const blob = new Blob([new Uint8Array(audio.bytes)], { type: audio.contentType });
            await saveAttachmentBlob({
              id: audioId,
              entry_id: entry.id,
              kind: "original",
              content_type: audio.contentType,
              size_bytes: blob.size,
              created_at: entry.created_at,
              blob,
            });
            await ligarAudio(entry.id, audioId);
            resultado.audios += 1;
          }
        }
      } catch {
        // Audio que falha nao derruba o texto: a nota entra e o resumo conta.
        resultado.audiosFailed += 1;
      }
    }

    // Transcricao so existe onde ha audio; pedir para nota de texto e uma ida
    // ao servidor por nota que so pode terminar em 404.
    if (source.transcript && temAudio) {
      try {
        const transcricao = await source.transcript(entry.id);
        if (transcricao) {
          await gravarTranscricao(entry.id, transcricao);
          resultado.transcripts += 1;
        }
      } catch {
        // Fala que falha nao derruba a nota: ela entra e o resumo conta.
        resultado.transcriptsFailed += 1;
      }
    }

    if (source.analysis) {
      try {
        const analise = await source.analysis(entry.id);
        if (analise) {
          await saveAnalysisSnapshot(entry.id, analise);
          resultado.analyses += 1;
        }
      } catch {
        // Analise que falha nao derruba a nota: ela entra e o resumo conta.
        resultado.analysesFailed += 1;
      }
    }

    if (existente) resultado.updated += 1;
    else resultado.created += 1;
  };

  /**
   * Importa uma nota sem deixar que ela derrube a tarefa.
   *
   * O detalhe pode nao vir, o corpo pode estourar o prazo: a nota conta em
   * `failed` e a proxima segue. O progresso anda de qualquer forma, senao uma
   * nota presa pareceria uma tarefa presa.
   */
  const importarUm = async (item: ImportManifestEntry): Promise<void> => {
    try {
      await gravarNota(item);
    } catch {
      resultado.failed += 1;
    }
    done += 1;
    onProgress?.({ done, total: resultado.total });
  };

  // Importar uma nota por vez gastava minutos: cada uma custa tres idas ao
  // servidor. Seis em paralelo cortam o tempo sem afogar o servidor nem o
  // navegador (as escritas no banco local ja sao serializadas por ele).
  let proximo = 0;
  const trabalhadores = Array.from(
    { length: Math.min(CONCORRENCIA, manifesto.length) },
    async () => {
      for (;;) {
        const indice = proximo;
        proximo += 1;
        if (indice >= manifesto.length) return;
        await importarUm(manifesto[indice]);
      }
    },
  );
  await Promise.all(trabalhadores);

  for (const entry of await source.deleted()) {
    const existente = await getRecording(entry.id);
    const quando = entry.deleted_at ?? new Date().toISOString();
    await upsertRecording({ ...recordingFromEntry(entry, existente), deletedAt: quando });
    resultado.trashed += 1;
  }

  return resultado;
}
