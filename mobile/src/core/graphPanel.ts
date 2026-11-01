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
export function buildEntityPanel(
  entity: GraphEntity,
  entries: GraphEntry[],
  links: EntityLink[],
  aliases: string[] = [],
): EntityPanel {
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
    .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1));

  let mentions = 0;
  let sentimentSum = 0;
  let sentimentCount = 0;
  let lastSeen = '';
  for (const link of links) {
    if (link.entityId !== entity.id) continue;
    mentions += Math.max(1, link.count);
    if (typeof link.sentiment === 'number') {
      sentimentSum += link.sentiment;
      sentimentCount += 1;
    }
    const seen = byId.get(link.entryId)?.recordedAt ?? '';
    if (seen > lastSeen) lastSeen = seen;
  }

  const excerpts: EntityExcerpt[] = [];
  const groups: EntityExcerptGroup[] = [];
  const notesList: EntityNote[] = [];

  for (const entry of notes) {
    const comment = commentOf(entry);
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

    if (items.length > 0) {
      groups.push({
        entryId: entry.id,
        title: entry.title,
        date: entry.recordedAt,
        comment,
        items,
      });
      excerpts.push(...items);
    }

    notesList.push({
      entryId: entry.id,
      title: entry.title,
      date: entry.recordedAt,
      count: mentionsByEntry.get(entry.id) ?? 1,
    });
  }

  return {
    entity,
    mentions,
    notes: notes.length,
    sentiment: sentimentCount > 0 ? sentimentSum / sentimentCount : undefined,
    lastSeen: lastSeen || undefined,
    excerpts,
    groups,
    notesList,
  };
}

/** Formata o instante de um trecho de fala como `m:ss`. */
export function formatExcerptTime(startMs: number | undefined): string {
  if (typeof startMs !== 'number' || startMs < 0) return 'texto';
  const total = Math.floor(startMs / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
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
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
