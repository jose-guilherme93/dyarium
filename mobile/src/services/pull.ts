/**
 * Pull das notas do servidor para o app.
 *
 * - Adiciona entradas que ainda nao existem localmente (casadas por id local e
 *   por entryId), com o corpo da nota convertido em markdown.
 * - Atualiza as que ja existem quando o servidor mudou o texto, o titulo, a data
 *   ou o arquivamento (edicao feita no dashboard). A ultima edicao vence: nota
 *   limpa aceita a versao nova; nota com edicao pendente so perde o campo que o
 *   servidor gravou depois da ultima edicao local.
 * - Remove do app as notas que o servidor confirma como apagadas (a lixeira dele).
 *   Uma entrada ausente da lista NAO apaga nada: e o que protege o aparelho de um
 *   servidor novo, reinstalado ou restaurado.
 *
 * Best-effort e idempotente. Devolve quantas mudancas houve.
 */

import { DyariumApi, type FetchLike, type ServerEntry } from '@/core/api';
import {
  duplicateEntryRecordings,
  entryToRecording,
  isBlankServerEntry,
  mergeServerNote,
  recordingsDeletedOnServer,
} from '@/core/pull';
import type { Recording } from '@/core/types';

import { deleteRecordingRow, listRecordings, upsertRecording } from './db';
import { refreshAuthorSettings } from './authorSettings';
import { syncServerAnalyses } from './analysis';
import { syncServerTranscripts } from './transcripts';
import { deleteSessionFiles } from './files';
import { pullNotebooks } from './notebookSync';
import { loadServerConfig } from './secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

/** Evita dois pulls ao mesmo tempo (o periodico e o de foco podem se cruzar). */
let pulling = false;

export async function pullServerEntries(): Promise<number> {
  if (pulling) return 0;
  pulling = true;
  try {
    return await pullOnce();
  } finally {
    pulling = false;
  }
}

const PULL_PAGE_SIZE = 500;
// Teto de seguranca: uma biblioteca absurda nao pode prender o app num laco.
const PULL_MAX_PAGES = 100;

interface PagedResult {
  items: ServerEntry[];
  /** false quando o teto de paginas foi atingido: a lista veio incompleta. */
  complete: boolean;
}

async function listAllPages(
  load: (cursor?: string) => Promise<{ entries: ServerEntry[]; next_cursor?: string }>,
): Promise<PagedResult> {
  const items: ServerEntry[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < PULL_MAX_PAGES; page += 1) {
    const result = await load(cursor);
    items.push(...result.entries);
    if (!result.next_cursor) return { items, complete: true };
    cursor = result.next_cursor;
  }
  return { items, complete: false };
}

async function pullOnce(): Promise<number> {
  const config = await loadServerConfig();
  if (!config) return 0;
  // Cadernos primeiro: a entrada pode apontar para um caderno novo, e a lista
  // local precisa dele para exibir nome/cor.
  await pullNotebooks().catch(() => undefined);
  // Nome do dono e o padrao das notas viajam juntos: a analise local precisa
  // deles mesmo sem rede e sem reabrir as configuracoes.
  await refreshAuthorSettings().catch(() => undefined);
  const api = new DyariumApi(config, doFetch);
  // Pagina ate o fim: antes o pull parava em 2000 notas e as mais antigas
  // nunca chegavam ao aparelho.
  const entriesPage = await listAllPages((cursor) => api.listEntriesPage(PULL_PAGE_SIZE, cursor));
  const entries = entriesPage.items;
  // Inclui a lixeira local: uma nota apagada aqui nao pode ser recriada pelo
  // pull enquanto o servidor ainda nao confirmou a exclusao.
  const local = await listRecordings(true);

  let changed = 0;
  const removed = new Set<string>();

  // O mesmo audio importado duas vezes vira uma unica entrada no servidor
  // (dedupe por SHA-256), mas o aparelho ficava com duas linhas e dois cartoes.
  for (const recording of duplicateEntryRecordings(local.filter((r) => !r.deletedAt))) {
    deleteSessionFiles(recording.id);
    await deleteRecordingRow(recording.id);
    removed.add(recording.id);
    changed += 1;
  }

  // Exclusoes: so o que o servidor confirma como apagado, e so quando a lista
  // veio completa (nao truncada). Se a lixeira nao puder ser lida, nao apagamos
  // nada: na duvida, o dado fica. A nota entra na lixeira local pelo mesmo
  // prazo, em vez de sumir de vez.
  const deletedPage = await listAllPages((cursor) =>
    api.listDeletedEntriesPage(PULL_PAGE_SIZE, cursor),
  ).catch(() => null);
  if (deletedPage?.complete) {
    const deletedAt = new Map<string, string>();
    for (const entry of deletedPage.items) {
      if (entry.id) deletedAt.set(entry.id, entry.deleted_at ?? entry.updated_at);
    }
    for (const recording of recordingsDeletedOnServer(
      local.filter((r) => !r.deletedAt),
      deletedAt,
    )) {
      const when = recording.entryId ? deletedAt.get(recording.entryId) : undefined;
      await upsertRecording({ ...recording, deletedAt: when ?? new Date().toISOString() });
      changed += 1;
    }
  }

  const known = new Set<string>();
  const localByEntry = new Map<string, Recording>();
  for (const recording of local) {
    if (removed.has(recording.id)) continue;
    // Notas na lixeira entram no `known` para o pull nao criar uma copia ativa,
    // mas nao sao mescladas: quem manda nelas e a restauracao do usuario.
    known.add(recording.id);
    if (recording.entryId) {
      known.add(recording.entryId);
      if (!recording.deletedAt) localByEntry.set(recording.entryId, recording);
    }
  }

  for (const entry of entries) {
    if (!entry.id) continue;

    const existing = localByEntry.get(entry.id);
    if (existing) {
      let note;
      // A listagem traz a versao do corpo; so busca o texto quando ela mudou.
      if (entry.versions?.body && entry.versions.body !== existing.bodyVersion) {
        try {
          note = (await api.listNotes(entry.id))[0];
        } catch {
          continue;
        }
      }
      const merged = mergeServerNote(existing, entry, note);
      if (merged) {
        await upsertRecording(merged);
        changed += 1;
      }
      continue;
    }

    if (known.has(entry.id)) continue;
    let note;
    try {
      const notes = await api.listNotes(entry.id);
      note = notes[0];
    } catch {
      // sem nota associada: segue so com o titulo
    }
    if (isBlankServerEntry(entry, note)) continue;
    await upsertRecording(entryToRecording(entry, note));
    changed += 1;
  }

  // Transcricoes e analises novas do servidor: `transcript_at` e `analysis_at`
  // sao os sinais. Guarda no banco e avisa a nota aberta; nao e o caminho de
  // exibicao.
  await syncServerTranscripts(entries, local).catch(() => undefined);
  await syncServerAnalyses(entries).catch(() => undefined);

  return changed;
}
