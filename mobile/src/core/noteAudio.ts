/**
 * Anexar uma gravacao a uma nota: o audio vira um no do documento.
 *
 * A nota deixa de ter "um audio dela" e passa a ter uma lista de audios na
 * ordem em que aparecem no corpo. A primeira gravacao de uma nota nova tambem
 * preenche `filePath`/`sizeBytes`/`durationMs`, que e o que o upload usa para
 * criar a entrada; as seguintes ficam apenas no documento e sobem como anexo
 * no sync.
 */

import { localAudioName, pendingLocalAudioNames } from './attachments';
import { insertNoteNode, replaceAudioRef, type NoteInsertPosition } from './noteDocument';
import type { Recording } from './types';

/** No de audio minimo para migrar/representar um audio no documento. */
export interface AudioNodeRef {
  ref: string;
  durationMs: number;
}

/**
 * Audios que uma nota antiga guardava fora do corpo (`filePath` e a pilha do
 * servidor) viram nos. Notas novas ja nascem com o marcador e nao passam por
 * aqui.
 */
export function audioNodesForNote(note: Recording): AudioNodeRef[] {
  const localRef = audioRefFromPath(note.filePath);
  if (!localRef) return [];
  // O arquivo local e a fonte, mesmo que o anexo ja esteja no servidor: tocar
  // nao pode depender de rede. O sync troca para `attachment:` quando subir.
  // A pilha adicional do dashboard (varios audios de uma nota criada la)
  // continua no topo, sem virar marcador no corpo.
  return [
    {
      ref: localRef,
      durationMs: Math.max(0, Math.round(note.durationMs ?? 0)),
    },
  ];
}

/** Acrescenta audios no fim do documento, na ordem recebida. */
export function appendAudioNodes(markdown: string, nodes: AudioNodeRef[]): string {
  let value = markdown;
  for (const node of nodes) {
    value = insertNoteNode(value, {
      kind: 'audio',
      id: 'append',
      ref: node.ref,
      durationMs: node.durationMs,
    });
  }
  return value;
}

interface CachedBody {
  text: string;
  filePath: string | undefined;
  value: string;
}

const bodyWithAudioCache = new WeakMap<Recording, CachedBody>();

/**
 * Corpo da nota com os audios legados ja convertidos em nos do documento.
 *
 * A tela da nota precisa do mesmo corpo no estado inicial do editor e na
 * hidratacao; sem cache, uma nota antiga era parseada e serializada duas vezes
 * no caminho de abertura. O WeakMap usa a identidade da nota, que muda quando o
 * texto muda, entao o valor nunca fica velho. Comparar texto e caminho tambem
 * cobre um chamador que edite o objeto no lugar; no caso normal as duas strings
 * sao a mesma referencia e a comparacao e imediata.
 */
export function noteBodyWithAudio(note: Recording): string {
  const stored = note.text ?? '';
  const cached = bodyWithAudioCache.get(note);
  if (cached && cached.text === stored && cached.filePath === note.filePath) {
    return cached.value;
  }
  // A migracao so existe para gravacoes com arquivo local. Se o documento ja
  // tem um marcador de audio, nao ha o que acrescentar.
  const value =
    !note.filePath || /(^|\n)!audio\[/.test(stored)
      ? stored
      : appendAudioNodes(stored, audioNodesForNote(note));
  bodyWithAudioCache.set(note, { text: stored, filePath: note.filePath, value });
  return value;
}

/** Referencia `local:` a partir do caminho do arquivo ja movido para a nota. */
export function audioRefFromPath(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  const name = filePath.split('/').pop()?.split('?')[0]?.trim();
  return name ? `local:${name}` : undefined;
}

export interface AudioAttachment {
  /** Referencia canonica no markdown (`local:<arquivo>`). */
  ref: string;
  /** Caminho local do audio ja movido para a pasta da nota. */
  filePath?: string;
  durationMs?: number;
  sizeBytes?: number;
}

/**
 * Depois que o audio da propria entrada subiu, o marcador `local:` vira
 * `attachment:<id>` e o mapa guarda o nome do arquivo. O sync do corpo entao
 * reusa o anexo em vez de subir o mesmo audio outra vez.
 */
export function withUploadedAudio(note: Recording, attachmentId: string): Recording {
  const localRef = audioRefFromPath(note.filePath);
  const name = localRef ? localAudioName(localRef) : undefined;
  if (!localRef || !name || !attachmentId || !note.text?.includes(localRef)) return note;
  return {
    ...note,
    text: replaceAudioRef(note.text, localRef, `attachment:${attachmentId}`),
    attachments: { ...(note.attachments ?? {}), [name]: attachmentId },
  };
}

/** A nota pode liberar os arquivos locais sem perder nenhum audio do corpo? */
export function canFreeLocalAudio(note: Recording): boolean {
  if (note.status !== 'completed' || !note.entryId || note.noteDirty) return false;
  return pendingLocalAudioNames(note.text ?? '', note.attachments ?? {}).length === 0;
}

export function attachAudioToNote(
  note: Recording,
  audio: AudioAttachment,
  at?: NoteInsertPosition | null,
): Recording {
  const text = insertNoteNode(
    note.text ?? '',
    {
      kind: 'audio',
      id: 'attach',
      ref: audio.ref,
      durationMs: Math.max(0, Math.round(audio.durationMs ?? 0)),
    },
    at ?? null,
  );

  return {
    ...note,
    text,
    filePath: note.filePath ?? audio.filePath,
    durationMs: note.durationMs ?? audio.durationMs,
    sizeBytes: note.sizeBytes ?? audio.sizeBytes,
    source: 'microphone',
    noteDirty: note.status === 'completed' ? true : note.noteDirty,
    updatedAt: new Date().toISOString(),
  };
}
