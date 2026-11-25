import { listRecordings } from "../../../mobile/src/core/repo";
import { formatBytes } from "../lib/format";
import type { VaultSummary } from "../local/vaultCloud";
import { ATTACHMENTS_STORE, COVERS_STORE, storeList } from "../lib/idb";
import type { StoredAttachment } from "./attachments";
import type { StoredCover } from "./covers";

export interface LocalVaultStats {
  notes: number;
  audioNotes: number;
  audioSeconds: number;
  attachments: number;
  attachmentBytes: number;
  covers: number;
  coverBytes: number;
  noteBytes: number;
  bytes: number;
}

/** Fontes que representam uma nota de audio (o app grava "microphone"/"share"). */

export async function vaultStats(): Promise<LocalVaultStats> {
  const recordings = await listRecordings(false);
  const encoder = new TextEncoder();

  let audioNotes = 0;
  let audioSeconds = 0;
  let noteBytes = 0;
  for (const recording of recordings) {
    if (recording.source === "microphone" || recording.source === "share") {
      audioNotes += 1;
    }
    if (typeof recording.durationMs === "number" && Number.isFinite(recording.durationMs)) {
      audioSeconds += recording.durationMs / 1000;
    }
    if (recording.text) {
      noteBytes += encoder.encode(recording.text).length;
    }
  }

  const anexos = await storeList<StoredAttachment>(ATTACHMENTS_STORE);
  let attachmentBytes = 0;
  for (const [, anexo] of anexos) {
    if (typeof anexo?.size_bytes === "number" && Number.isFinite(anexo.size_bytes)) {
      attachmentBytes += anexo.size_bytes;
    }
  }

  const capas = await storeList<StoredCover>(COVERS_STORE);
  let covers = 0;
  let coverBytes = 0;
  for (const [, capa] of capas) {
    if (capa?.blob) {
      covers += 1;
      if (typeof capa.blob.size === "number" && Number.isFinite(capa.blob.size)) {
        coverBytes += capa.blob.size;
      }
    }
  }

  return {
    notes: recordings.length,
    audioNotes,
    audioSeconds,
    attachments: anexos.length,
    attachmentBytes,
    covers,
    coverBytes,
    noteBytes,
    bytes: noteBytes + attachmentBytes + coverBytes,
  };
}


/** "12,4 MB · 400 notas"; sem tamanho ainda, so a contagem. */
export function tamanho(resumo: VaultSummary | null): string {
  if (!resumo) return "sessão vencida";
  const notas =
    resumo.notes === 1 ? "1 nota" : `${resumo.notes.toLocaleString("pt-BR")} notas`;
  if (resumo.bytes <= 0) return notas;
  return `${formatBytes(resumo.bytes)} · ${notas}`;
}
