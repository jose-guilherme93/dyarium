/**
 * Painel de detalhe da entidade.
 *
 * O que prova a relacao nao e um numero: sao os trechos em que a pessoa, o
 * lugar ou o tema aparecem, com o tempo do audio quando veio da transcricao e
 * com a leitura da analise acima. O painel guarda a lista inteira, agrupada por
 * nota: e ela que o usuario rola. Diferente do corte do servidor, aqui entram
 * todos os trechos em que a entidade aparece.
 */

import type { EntityLink, GraphEntry, GraphEntity } from './graphModel';

export interface EntityExcerpt {
  /** Chave local da nota (`recordings.id`), usada para abrir. */
  entryId: string;
  title: string;
  date: string;
  source: 'transcript' | 'text';
  text: string;
  term: string;
  startMs?: number;
  comment?: string;
}

/** Um grupo de trechos da mesma nota, como o painel do web. */
export interface EntityExcerptGroup {
  entryId: string;
  title: string;
  date: string;
  comment?: string;
  items: EntityExcerpt[];
}

export interface EntityNote {
  entryId: string;
  title: string;
  date: string;
  count: number;
}

export interface EntityPanel {
  entity: GraphEntity;
  mentions: number;
  notes: number;
  sentiment?: number;
  lastSeen?: string;
  /** Todos os trechos, na ordem dos grupos. */
  excerpts: EntityExcerpt[];
  /** Os trechos agrupados por nota, para a folha rolavel. */
  groups: EntityExcerptGroup[];
  notesList: EntityNote[];
}

const MARKDOWN_PREFIX = /^\s*(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s*)/;

function cleanSentence(value: string): string {
  return value.replace(MARKDOWN_PREFIX, '').replace(/\*\*|__|`/g, '').trim();
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map(cleanSentence)
    .filter((sentence) => sentence.length > 0);
}

function matchTerm(text: string, terms: string[]): string | null {
  const lower = text.toLowerCase();
  for (const term of terms) {
    if (term && lower.includes(term.toLowerCase())) return term;
  }
  return null;
}

/** Leitura curta da nota que explica o trecho. */
function commentOf(entry: GraphEntry): string | undefined {
  const analysis = entry.analysis;
  if (!analysis) return undefined;
  const reading = (analysis.reading ?? '').trim();
  if (reading) return reading;
  const summary = (analysis.summary ?? '').trim();
  return summary || undefined;
}

export interface EntityPanelStats {
  mentions: number;
  notes: number;
  sentiment?: number;
  lastSeen?: string;
}

/**
 * Numeros da entidade sobre TODAS as mencoes, sem hidratar nota nenhuma.
 *
 * Fica separado da montagem do painel para a pagina hidratar so as notas
 * visiveis sem encolher mencoes, notas, tom ou ultima vista do recorte inteiro.
 */
export function entityStats(
  entityId: string,
  entries: GraphEntry[],
  links: EntityLink[],
): EntityPanelStats {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const noteIds = new Set<string>();
  let mentions = 0;
  let sentimentSum = 0;
  let sentimentCount = 0;
  let lastSeen = '';
  for (const link of links) {
    if (link.entityId !== entityId) continue;
    mentions += Math.max(1, link.count);
    if (byId.has(link.entryId)) noteIds.add(link.entryId);
    if (typeof link.sentiment === 'number') {
      sentimentSum += link.sentiment;
      sentimentCount += 1;
    }
    const seen = byId.get(link.entryId)?.recordedAt ?? '';
    if (seen > lastSeen) lastSeen = seen;
  }
  return {
    mentions,
    notes: noteIds.size,
    sentiment: sentimentCount > 0 ? sentimentSum / sentimentCount : undefined,
    lastSeen: lastSeen || undefined,
  };
}

/** Trechos de uma nota que casam com a entidade, na ordem em que aparecem. */
function excerptsOfEntry(
  entry: GraphEntry,
  terms: string[],
  comment: string | undefined,
): EntityExcerpt[] {
  const items: EntityExcerpt[] = [];

  for (const segment of entry.transcriptSegments ?? []) {
    const text = (segment.revised || segment.text || '').trim();
    if (!text) continue;
    const term = matchTerm(text, terms);
    if (!term) continue;
    items.push({
      entryId: entry.id,
      title: entry.title,
      date: entry.recordedAt,
      source: 'transcript',
      text,
      term,
      startMs: segment.start_ms,
      comment,
    });
  }

  const body = entry.text ?? entry.transcript ?? '';
  if (body.trim()) {
    for (const sentence of sentences(body)) {
      const term = matchTerm(sentence, terms);
      if (!term) continue;
      items.push({
        entryId: entry.id,
        title: entry.title,
        date: entry.recordedAt,
        source: 'text',
        text: sentence,
        term,
        comment,
      });
    }
  }

  return items;
}

export interface EntityPanelSlice {
  panel: EntityPanel;
  /** Trechos encontrados nas notas recebidas, antes do limite da pagina. */
  totalItems: number;
}

/**
 * Monta o painel com no maximo `itemLimit` trechos.
 *
 * O limite e por trecho, nao por nota: uma nota pode render 188 trechos e o
 * usuario nao quer 188 linhas de uma vez. Um grupo pode ficar pela metade; o
 * resto sai no "Ver mais".
 */
function buildPanelSlice(
  entity: GraphEntity,
  entries: GraphEntry[],
  links: EntityLink[],
  aliases: string[],
  stats: EntityPanelStats | undefined,
  itemLimit: number | undefined,
): EntityPanelSlice {
  // A grafia mais longa vence: "Mariana" nao vira "Maria" quando as duas
  // resolvem para a mesma pessoa.
  const terms = [entity.name, ...aliases].filter(Boolean).sort((a, b) => b.length - a.length);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const mentionsByEntry = new Map<string, number>();
  for (const link of links) {
    if (link.entityId !== entity.id) continue;
    mentionsByEntry.set(link.entryId, (mentionsByEntry.get(link.entryId) ?? 0) + link.count);
  }

  const notes = [...mentionsByEntry.keys()]
    .map((id) => byId.get(id))
    .filter((entry): entry is GraphEntry => Boolean(entry))
    .sort((a, b) =>
      a.recordedAt === b.recordedAt
        ? a.id < b.id
          ? -1
          : 1
        : a.recordedAt < b.recordedAt
          ? 1
          : -1,
    );

  // Com `stats` os totais vem do recorte inteiro; sem ele, sao calculados aqui
  // como sempre foram.
  const totals = stats ?? entityStats(entity.id, entries, links);

  const excerpts: EntityExcerpt[] = [];
  const groups: EntityExcerptGroup[] = [];
  const notesList: EntityNote[] = [];
  let totalItems = 0;

  for (const entry of notes) {
    const comment = commentOf(entry);
    const items = excerptsOfEntry(entry, terms, comment);
    totalItems += items.length;

    const room =
      itemLimit === undefined ? items.length : Math.max(0, itemLimit - excerpts.length);
    if (items.length > 0 && room > 0) {
      const kept = items.length > room ? items.slice(0, room) : items;
      groups.push({
        entryId: entry.id,
        title: entry.title,
        date: entry.recordedAt,
        comment,
        items: kept,
      });
      excerpts.push(...kept);
    }

    notesList.push({
      entryId: entry.id,
      title: entry.title,
      date: entry.recordedAt,
      count: mentionsByEntry.get(entry.id) ?? 1,
    });
  }

  return {
    panel: {
      entity,
      mentions: totals.mentions,
      notes: totals.notes,
      sentiment: totals.sentiment,
      lastSeen: totals.lastSeen,
      excerpts,
      groups,
      notesList,
    },
    totalItems,
  };
}

export function buildEntityPanel(
  entity: GraphEntity,
  entries: GraphEntry[],
  links: EntityLink[],
  aliases: string[] = [],
  stats?: EntityPanelStats,
): EntityPanel {
  return buildPanelSlice(entity, entries, links, aliases, stats, undefined).panel;
}

/** Painel cortado em trechos, para a tela abrir so a primeira pagina. */
export function buildEntityPanelPage(
  entity: GraphEntity,
  entries: GraphEntry[],
  links: EntityLink[],
  aliases: string[],
  stats: EntityPanelStats | undefined,
  itemLimit: number,
): EntityPanelSlice {
  return buildPanelSlice(entity, entries, links, aliases, stats, Math.max(1, itemLimit));
}

/** Formata o instante de um trecho de fala como `m:ss`. */
export function formatExcerptTime(startMs: number | undefined): string {
  if (typeof startMs !== 'number' || startMs < 0) return 'texto';
  const total = Math.floor(startMs / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Nota que o botao "Abrir nota" do painel deve abrir: a mais recente entre as
 * que citam a entidade, ja resolvida para a chave local (`recordings.id`).
 *
 * O painel carrega o `entryId` do snapshot do grafo, que nem sempre e o id do
 * registro local: nota que subiu para o servidor tem `id` local e `entryId` do
 * servidor, e um snapshot antigo pode ter ficado com a chave do outro lado.
 * Por isso a resolucao passa pela biblioteca em vez de confiar no valor.
 * Devolve null quando nenhuma nota associada existe no aparelho.
 */
export function resolveNoteId(
  panel: EntityPanel | null | undefined,
  recordings: { id: string; entryId?: string }[],
): string | null {
  const notes = panel?.notesList ?? [];
  if (notes.length === 0 || recordings.length === 0) return null;
  const byId = new Map<string, string>();
  for (const recording of recordings) {
    byId.set(recording.id, recording.id);
    if (recording.entryId) byId.set(recording.entryId, recording.id);
  }
  for (const note of notes) {
    const localId = byId.get(note.entryId);
    if (localId) return localId;
  }
  return null;
}

/** Data curta de nota, no fuso do aparelho. */
export function formatNoteDate(iso: string | undefined): string {
  if (!iso) return '';
  // `YYYY-MM-DD` e um dia, nao um instante UTC: sem isto, a oeste de Greenwich
  // a data voltaria um dia.
  const dayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  const date = dayOnly
    ? new Date(Number(dayOnly[1]), Number(dayOnly[2]) - 1, Number(dayOnly[3]))
    : new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
