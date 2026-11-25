/**
 * O cliente que a importacao do Notion usa no modo local.
 *
 * O teste de `lib/notionImport.test.ts` usa um duble e por isso nao enxerga o
 * que o cofre grava de verdade (foi assim que o titulo se perdeu). Aqui ficam
 * as funcoes reais, num lugar so, usadas pela `api.ts` e pelo teste de ponta a
 * ponta.
 */

import type { Entry } from "../types";
import type { NotionApi } from "../lib/notionImport";

import * as books from "./notebooks";
import * as local from "./notes";

export interface ImportEntryInput {
  id: string;
  title: string;
  notebookId?: string;
  recordedAt?: string;
}

/**
 * Entrada do import: o id e o da pagina do Notion, entao reimportar o mesmo
 * export cai na mesma nota em vez de criar uma segunda.
 */
export async function importEntryLocally(
  input: ImportEntryInput,
): Promise<{ entry: Entry; created: boolean }> {
  const existente = await local.getEntry(input.id);
  if (existente) return { entry: existente, created: false };
  return {
    entry: await local.createEntry({
      id: input.id,
      title: input.title,
      notebookId: input.notebookId,
      recordedAt: input.recordedAt,
    }),
    created: true,
  };
}

/** Fiacao completa, igual a que `api.ts` expoe no modo local. */
export function localNotionClient(uploadAttachment: NotionApi["uploadAttachment"]): NotionApi {
  return {
    listNotebooks: async () => ({ notebooks: await books.listLocalNotebooks() }),
    createNotebook: (input) =>
      books.createLocalNotebook({ name: input.name, color: input.color, kind: "notes" }),
    deleteNotebook: (id) => books.deleteLocalNotebook(id),
    createImportEntry: (input) => importEntryLocally(input),
    listNotes: async (entryId) => ({ notes: await local.listNotes(entryId) }),
    uploadAttachment,
    deleteAttachment: async () => undefined,
    createNote: async (entryId, title, markdown) => {
      const note = await local.createNote(entryId, title, markdown);
      if (!note) throw new Error("nota nao gravada");
      return note;
    },
    setEntryTags: async (entryId, tags) => {
      await local.setEntryTags(entryId, tags);
      return { status: "ok" };
    },
    patchEntry: async (id, patch) => {
      await local.patchEntry(id, patch);
      return { status: "ok" };
    },
    updateNote: async (noteId, markdown) => {
      await local.saveNote(noteId, markdown);
      return { status: "ok", versions: {} };
    },
  };
}
