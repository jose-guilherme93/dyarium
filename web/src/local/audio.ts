/**
 * Audio no cofre local: gravar e enviar sem servidor.
 *
 * O app envia o arquivo por chunks; aqui o byte cai direto no IndexedDB, no
 * mesmo anexo `kind: "original"` que a interface ja desenha. A nota ganha os
 * campos que o cartao usa (`source`, `content_type`, `file_name`, `size_bytes`,
 * `status`) para nao parecer uma nota de texto vazia.
 *
 * A duracao fica 0 de proposito: quem informa o tempo real e o proprio
 * `<audio>`, ao carregar o blob. Medi-la aqui exigiria decodificar o arquivo
 * inteiro so para abrir a nota.
 */

import { ATTACHMENTS_STORE, storeGet } from "../lib/idb";

import {
  localAttachmentUrl,
  listLocalAttachments,
  saveLocalAttachment,
  type StoredAttachment,
} from "./attachments";

import { createEntry } from "./notes";

import { getRecording, upsertRecording } from "../../../mobile/src/core/repo";
import type {
  Recording,
  RecordingSource,
  TranscriptSegment,
} from "../../../mobile/src/core/types";

import type { Attachment, Audio, Segment, Transcript } from "../types";

export interface LocalAudioResult {
  entry_id: string;
  attachment_id: string;
}

/** Anexo que e audio de verdade: o `kind` separa do que for derivado. */
function ehAudio(anexo: Attachment): boolean {
  return anexo.kind === "original" && anexo.content_type.startsWith("audio/");
}

function toSegment(segment: TranscriptSegment, idx: number): Segment {
  return {
    idx,
    start_ms: segment.start_ms,
    end_ms: segment.end_ms,
    text: segment.text,
    revised: segment.revised,
    edited: segment.edited,
    reviewed: segment.reviewed,
    capture: segment.capture,
  };
}

/**
 * Transcricao do aparelho no formato que a web ja le. O cofre local nao guarda
 * o caminho do modelo; `transcriptOrigin` diz quem produziu, e "local" e o
 * unico nome que sabemos dar sem inventar.
 */
function transcriptOf(recording: Recording | null): Transcript | undefined {
  if (!recording) return undefined;
  const segmentos = recording.transcriptSegments ?? [];
  const texto = (recording.transcript ?? "").trim();
  if (!texto && segmentos.length === 0) return undefined;
  return {
    model: recording.transcriptOrigin === "local" ? "local" : "",
    language: recording.transcriptLanguage ?? "",
    text: texto || segmentos.map((segmento) => segmento.text).join(" "),
    trim_silence: false,
    duration_seconds: 0,
    segments: segmentos.length > 0 ? segmentos.map(toSegment) : undefined,
  };
}

/** A transcricao e da gravacao original; numa pilha, ela vai para o anexo dela. */
function anexoDaTranscricao(audios: Attachment[], recording: Recording | null): string {
  const original = recording?.serverAttachmentId;
  if (original && audios.some((anexo) => anexo.id === original)) return original;
  return audios[0]?.id ?? "";
}

export async function entryAudios(entryId: string): Promise<Audio[]> {
  const audios = (await listLocalAttachments(entryId)).filter(ehAudio);
  if (audios.length === 0) return [];
  const recording = await getRecording(entryId);
  const transcricao = transcriptOf(recording);
  const alvo = anexoDaTranscricao(audios, recording);
  return audios.map((anexo) => ({
    id: anexo.id,
    content_type: anexo.content_type,
    size_bytes: anexo.size_bytes,
    duration_seconds: 0,
    created_at: anexo.created_at,
    transcript: anexo.id === alvo ? transcricao : undefined,
  }));
}

export async function saveLocalAudio(entryId: string, file: Blob): Promise<Attachment> {
  return saveLocalAttachment(entryId, file);
}

/** Nome do arquivo sem extensao vira titulo; vazio cai na data/hora local. */
function tituloDoArquivo(file: File): string {
  return file.name.replace(/\.[^./\\]+$/, "").trim();
}

function tituloDaData(agora: Date): string {
  const dois = (valor: number) => String(valor).padStart(2, "0");
  return `${dois(agora.getDate())}/${dois(agora.getMonth() + 1)}/${agora.getFullYear()} ${dois(
    agora.getHours(),
  )}:${dois(agora.getMinutes())}`;
}

export interface UploadLocalAudioOptions {
  entryId?: string;
  title?: string;
  notebookId?: string;
  onProgress?: (sent: number, total: number) => void;
}

export async function uploadLocalAudio(
  file: File,
  options: UploadLocalAudioOptions = {},
): Promise<LocalAudioResult> {
  const { entryId: avulsa, title, notebookId, onProgress } = options;

  let entryId = avulsa;
  if (!entryId) {
    const nota = await createEntry({
      title: title?.trim() || tituloDoArquivo(file) || tituloDaData(new Date()),
      notebookId,
    });
    entryId = nota.id;
  }

  const recording = await getRecording(entryId);
  if (!recording) {
    // Sem a nota, o anexo ficaria orfao no IndexedDB e ninguem o mostraria.
    throw new Error("nota local não encontrada");
  }

  const anexo = await saveLocalAttachment(entryId, file);

  await upsertRecording({
    ...recording,
    // A web e o servidor chamam de "audio" a nota que tem som; o tipo local so
    // lista os caminhos de captura do app, entao o valor do contrato entra
    // como veio (o SQL grava texto).
    source: "audio" as RecordingSource,
    contentType: anexo.content_type,
    fileName: file.name || undefined,
    sizeBytes: anexo.size_bytes,
    status: "completed",
    // Nota nova nasce sem texto; numa nota existente o corpo fica como estava.
    text: recording.text ?? "",
    updatedAt: new Date().toISOString(),
  });

  // O anexo local nao tem envio parcial: quando termina, terminou inteiro.
  onProgress?.(file.size, file.size);

  return { entry_id: entryId, attachment_id: anexo.id };
}

export async function audioBlobOf(entryId: string): Promise<Blob | null> {
  const alvo = (await listLocalAttachments(entryId)).find(ehAudio);
  if (!alvo) return null;
  const guardado = await storeGet<StoredAttachment>(ATTACHMENTS_STORE, alvo.id);
  return guardado?.blob ?? null;
}

/** Atalho sincrono: o `src` do player e lido no render, sem esperar o blob. */
export function audioFromAttachment(id: string): string {
  return localAttachmentUrl(id);
}
