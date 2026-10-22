/**
 * Sincronizacao da nota com o servidor: nucleo puro, sem nada nativo.
 *
 * O corpo e **markdown**, o mesmo texto que o dashboard mostra. Antes o app
 * traduzia markdown para JSON de blocos e de volta a cada gravacao, e era
 * justamente ai que as coisas se perdiam (linha em branco entre paragrafos,
 * numeracao, aninhamento, imagem `local:` que sumia no dashboard).
 *
 * Conflito: cada campo (titulo, data, corpo) tem versao propria, guardada desde a
 * leitura. Se o servidor ja mudou depois disso, ele responde 409, **nao grava
 * nada**, e o erro sobe com a lista dos campos que brigaram. Quem chama decide;
 * este modulo nunca escolhe por conta propria.
 */

import type { ConflictError } from "./api";
import type { ConflictField, Recording } from "./types";

/** As chamadas que a sincronizacao usa do cliente HTTP (facilita o fake no teste). */
export interface NoteSyncApi {
  updateEntry(
    id: string,
    body: {
      title?: string;
      recorded_at?: string;
      notebook_id?: string;
      archived?: boolean;
      versions?: { title?: string; recorded_at?: string };
    },
  ): Promise<{ title: string; recorded_at: string }>;
  setEntryTags(entryId: string, tags: string[]): Promise<void>;
  listNotes(
    entryId: string,
  ): Promise<
    { id: string; body_version?: string; content_markdown?: string }[]
  >;
  createNote(
    entryId: string,
    title: string,
    markdown: string,
  ): Promise<{ id: string; body_version?: string }>;
  updateNote(
    noteId: string,
    markdown: string,
    baseVersion?: string,
  ): Promise<string>;
}

/** Substitui as referencias `local:` por `attachment:<id>` (os anexos ja subiram). */
export type ImageResolver = (
  note: Recording,
) => Promise<{ markdown: string; attachments: Record<string, string>; pending: string[] }>;

export interface SyncNoteResult {
  /** Id da nota (corpo) no servidor. */
  noteId: string;
  /** Mapa referencia da imagem -> id do anexo, para nao reenviar. */
  attachments: Record<string, string>;
  /** Anexos que ainda nao subiram: a nota precisa continuar suja. */
  pendingAttachments?: string[];
  /** Versoes gravadas: a proxima sincronizacao comeca daqui. */
  versions: NoteVersions;
}

/** Versoes por campo: o que o app leu do servidor e ainda nao sobrescreveu. */
export interface NoteVersions {
  title?: string;
  recordedAt?: string;
  body?: string;
}

/**
 * Envia titulo/data e corpo de uma nota que ja tem entrada no servidor.
 *
 * Com `force`, ignora as versoes: e o "manter o meu" do conflito, quando a
 * decisao ja foi do usuario.
 */
export async function syncNoteWith(
  api: NoteSyncApi,
  note: Recording,
  resolveImages: ImageResolver,
  options: { force?: boolean } = {},
): Promise<SyncNoteResult | undefined> {
  if (!note.entryId) return undefined;

  const resolved = await resolveImages(note);
  const markdown = resolved.markdown;
  const versions: NoteVersions = {};
  // Sem versao quando o usuario ja decidiu manter o que e dele.
  const known: Pick<Recording, "titleVersion" | "recordedAtVersion"> =
    options.force ? { titleVersion: "", recordedAtVersion: "" } : note;

  // Titulo e data: campos da entrada, com versao propria cada um. Arquivar vem
  // junto: e interruptor, entao nao entra em versao nem em conflito.
  //
  // Conflito aqui nao aborta o sync: o servidor gravou esses campos depois, e
  // eles ficam com ele (o pull atualiza o app). O corpo segue por ultimo-que-
  // escreve-vence, que e o que o usuario espera do texto.
  try {
    const entryVersions = await api.updateEntry(note.entryId, {
      title: note.title,
      recorded_at: note.recordedAt,
      archived: note.archived ?? false,
      versions: {
        title: known.titleVersion ?? "",
        recorded_at: known.recordedAtVersion ?? "",
      },
    });
    versions.title = entryVersions.title;
    versions.recordedAt = entryVersions.recorded_at;
  } catch (error) {
    if (!isNoteConflict(error)) throw error;
  }

  // Caderno vai em um PATCH separado, sem versao: um conflito de titulo nao pode
  // impedir a mudanca de caderno (e vice-versa).
  if (note.notebookDirty && note.notebookId) {
    await api.updateEntry(note.entryId, { notebook_id: note.notebookId });
  }

  // Tags: o PUT substitui o conjunto inteiro (ultima gravacao vence). Vai depois
  // dos campos da entrada para uma falha de tag nao impedir titulo/data.
  if (note.tagsDirty) {
    await api.setEntryTags(note.entryId, note.tags ?? []);
  }

  // O corpo mora na nota (recurso filho da entrada).
  const notes =
    note.noteId && !options.force
      ? [{ id: note.noteId, body_version: note.bodyVersion }]
      : await api.listNotes(note.entryId);
  const target = notes[0];
  if (!target) {
    return createBody(
      api,
      note.entryId,
      note.title,
      markdown,
      resolved.attachments,
      resolved.pending,
      versions,
    );
  }

  try {
    // Sem versao de base: a ultima gravacao vence. O texto que o usuario acabou
    // de ver/editado substitui o do servidor, sem dialogo de conflito.
    versions.body = await api.updateNote(target.id, markdown);
  } catch (error) {
    // A nota nao existe mais no servidor (id local velho, nota apagada de la,
    // banco do servidor reiniciado): cria de novo em vez de reprovar para
    // sempre, o que deixaria o texto preso no aparelho sem chegar a nenhum lado.
    if (!isMissing(error)) throw error;
    return createBody(
      api,
      note.entryId,
      note.title,
      markdown,
      resolved.attachments,
      resolved.pending,
      versions,
    );
  }
  return {
    noteId: target.id,
    attachments: resolved.attachments,
    pendingAttachments: resolved.pending,
    versions,
  };
}

/** Cria a nota da entrada e devolve o resultado com a versao do corpo criado. */
async function createBody(
  api: NoteSyncApi,
  entryId: string,
  title: string,
  markdown: string,
  attachments: Record<string, string>,
  pending: string[],
  versions: NoteVersions,
): Promise<SyncNoteResult> {
  const created = await api.createNote(entryId, title, markdown);
  versions.body = created.body_version ?? "";
  return {
    noteId: created.id,
    attachments,
    pendingAttachments: pending,
    versions,
  };
}

/** O servidor respondeu 404: o recurso nao existe la. */
function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { status?: number }).status === 404;
}

/**
 * Estado do servidor para o conflito: o que o outro lado gravou. Serve ao "ficar
 * com o de la", que precisa saber o que vai trocar antes de trocar.
 */
export async function fetchServerNote(
  api: Pick<NoteSyncApi, "listNotes"> & {
    getEntry(
      id: string,
    ): Promise<{
      title: string;
      recorded_at: string | null;
      created_at: string;
      versions?: { title?: string; recorded_at?: string; body?: string };
    }>;
  },
  entryId: string,
): Promise<{
  title?: string;
  recordedAt?: string;
  markdown: string;
  titleVersion?: string;
  recordedAtVersion?: string;
  bodyVersion?: string;
}> {
  const entry = await api.getEntry(entryId);
  const notes = await api.listNotes(entryId);
  return {
    title: entry.title,
    recordedAt: entry.recorded_at ?? entry.created_at,
    markdown: notes[0]?.content_markdown ?? "",
    titleVersion: entry.versions?.title,
    recordedAtVersion: entry.versions?.recorded_at,
    bodyVersion: notes[0]?.body_version ?? entry.versions?.body,
  };
}

/** `true` quando o erro e um conflito: o servidor recusou por ter mudado. */
export function isNoteConflict(error: unknown): error is ConflictError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { status?: number }).status === 409 &&
    Array.isArray((error as { fields?: unknown }).fields)
  );
}

/** Campos em conflito do erro; lista vazia para qualquer outro erro. */
export function conflictFields(error: unknown): ConflictField[] {
  return isNoteConflict(error) ? (error as ConflictError).fields : [];
}

/**
 * O que gravar depois de uma sincronizacao que deu certo.
 *
 * `fresh` e a nota relida do banco depois do envio: se o usuario digitou durante
 * o envio, a edicao mais nova manda e o `noteDirty` fica de pe, para o proximo
 * sync levar o que ele escreveu. As versoes gravadas substituem as antigas.
 */
export function applySyncResult(fresh: Recording, sent: Recording, result: SyncNoteResult): Recording {
  const editedDuringSync = fresh.updatedAt !== sent.updatedAt;
  // Anexo que nao subiu mantem a nota suja mesmo com o texto gravado: sem isso
  // a foto ficava presa em `local:` e o proximo sync nunca mais tentava.
  const pendingImages = (result.pendingAttachments?.length ?? 0) > 0;
  return {
    ...fresh,
    noteId: result.noteId,
    attachments: { ...(fresh.attachments ?? {}), ...result.attachments },
    titleVersion: result.versions.title ?? fresh.titleVersion,
    recordedAtVersion: result.versions.recordedAt ?? fresh.recordedAtVersion,
    bodyVersion: result.versions.body ?? fresh.bodyVersion,
    syncConflict: undefined,
    noteDirty: editedDuringSync || pendingImages ? true : undefined,
    notebookDirty: editedDuringSync ? fresh.notebookDirty : undefined,
    tagsDirty: editedDuringSync ? fresh.tagsDirty : undefined,
  };
}

/**
 * O que gravar depois de um conflito: a nota continua suja (o texto local ainda
 * nao chegou ao servidor) e ganha a lista dos campos que brigaram, para a tela
 * perguntar ao usuario. Nao volta para a fila — reenviar daria 409 de novo.
 */
export function applySyncConflict(fresh: Recording, fields: ConflictField[]): Recording {
  return { ...fresh, syncConflict: fields, noteDirty: true };
}

/** Tirar o conflito da nota depois de o usuario escolher. */
export function clearNoteConflict(fresh: Recording): Recording {
  return { ...fresh, syncConflict: undefined };
}

/**
 * "Manter o meu": reenvia a nota sem versao (a decisao ja foi do usuario) e
 * devolve o que persistir. A gravacao forcada sobe as versoes no servidor;
 * guardar as antigas faria o proximo sync mandar versao vencida, tomar 409 de
 * novo e o dialogo voltar para sempre.
 */
export async function keepMine(
  note: Recording,
  reread: () => Promise<Recording | null | undefined>,
  forceSync: (note: Recording) => Promise<SyncNoteResult | undefined>,
): Promise<Recording | undefined> {
  const result = await forceSync(note);
  if (!result) return undefined;
  const fresh = (await reread()) ?? note;
  return applySyncResult(fresh, note, result);
}
