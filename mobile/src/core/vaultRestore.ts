/**
 * Decide o que aplicar de um cofre vindo do Drive, sem tocar em banco, disco
 * ou rede. A decisao separada do IO e o que permite testar as regras de
 * conflito e os casos de anexo antes de qualquer escrita no aparelho.
 *
 * Nada aqui apaga: o plano so tem escritas. Ausencia no cofre pode ser "o outro
 * cliente ainda nao subiu", nunca "foi apagado".
 */

import {
  attachmentKind,
  notebookFolders,
  restoreAttachments,
  type VaultFileEntry,
  type VaultManifest,
} from './vaultManifest';
import { shouldRestoreNote, type VaultSnapshot, type VaultSnapshotNote } from './vaultSnapshot';
import type { Recording } from './types';

export interface PlannedNotebook {
  id: string;
  name: string;
  kind: 'notes' | 'book' | 'mcp';
}

export interface VaultRestoreInput {
  snapshot: VaultSnapshot;
  manifest: VaultManifest | null;
  /** Inclui notas apagadas: o tombstone local decide se uma nota volta. */
  localNotes: ReadonlyMap<string, Recording>;
  knownNotebooks: ReadonlySet<string>;
  /** Anexos que ja existem no cache do aparelho. */
  existingAttachmentIds: ReadonlySet<string>;
}

export interface VaultRestorePlan {
  notes: VaultSnapshotNote[];
  notebooks: PlannedNotebook[];
  attachments: VaultFileEntry[];
  skippedNotes: number;
  counts: {
    notes: number;
    notebooks: number;
    attachments: number;
    bytes: number;
  };
}

const PLACEHOLDER = 'Importado';

/**
 * - nota local mais nova (ou apagada depois) fica;
 * - caderno vem do nome da pasta quando existe; sem pista, vira um caderno
 *   "Importado" com o id original;
 * - audio so entra quando a nota ainda nao tem audio; imagem entra sempre;
 * - anexo de nota que nao existe nem vai entrar e ignorado.
 */
export function planVaultRestore(input: VaultRestoreInput): VaultRestorePlan {
  const { snapshot, manifest, localNotes, knownNotebooks, existingAttachmentIds } = input;

  const noteNotebook = new Map<string, string>();
  for (const note of snapshot.notes) {
    if (note.notebookId) noteNotebook.set(note.id, note.notebookId);
  }
  const folders = manifest ? notebookFolders(manifest, noteNotebook) : new Map();

  const notes: VaultSnapshotNote[] = [];
  let skippedNotes = 0;
  for (const note of snapshot.notes) {
    if (shouldRestoreNote(localNotes.get(note.id) ?? null, note)) notes.push(note);
    else skippedNotes += 1;
  }

  const notebooks: PlannedNotebook[] = [];
  const created = new Set<string>();
  for (const note of notes) {
    const id = note.notebookId;
    if (!id || knownNotebooks.has(id) || created.has(id)) continue;
    created.add(id);
    const folder = folders.get(id);
    notebooks.push(
      folder
        ? { id, name: folder.name, kind: folder.kind }
        : { id, name: PLACEHOLDER, kind: 'notes' },
    );
  }

  const appliedIds = new Set(notes.map((note) => note.id));
  const attachments: VaultFileEntry[] = [];
  const audioPlanned = new Set<string>();
  let bytes = 0;
  if (manifest) {
    for (const entry of restoreAttachments(manifest)) {
      if (existingAttachmentIds.has(entry.id)) continue;
      const owner = entry.entry_id;
      if (!owner || (!appliedIds.has(owner) && !localNotes.has(owner))) continue;
      const kind = attachmentKind(entry.content_type);
      if (!kind) continue;
      if (kind === 'audio') {
        // O app toca um audio por nota (filePath). Extras do cofre ficam para
        // uma versao que trate a pilha inteira; hoje nao ha onde pendurar.
        if (localNotes.get(owner)?.filePath || audioPlanned.has(owner)) continue;
        audioPlanned.add(owner);
      }
      attachments.push(entry);
      bytes += entry.size;
    }
  }

  return {
    notes,
    notebooks,
    attachments,
    skippedNotes,
    counts: {
      notes: notes.length,
      notebooks: notebooks.length,
      attachments: attachments.length,
      bytes,
    },
  };
}
