/**
 * Mapa de relacoes derivado do cofre local.
 *
 * No modo local nao existe servidor para montar o grafo: as notas e as
 * analises ja estao no navegador (`ANALYSIS_STORE`), entao o mapa e calculado
 * aqui, no mesmo formato que `GET /api/v1/graph` devolve.
 *
 * As regras seguem `internal/store/graph.go`:
 * - o centro e o dono; cada entidade aparece uma vez;
 * - centro -> entidade pesa o numero de notas que mencionam a entidade;
 * - duas entidades que dividem uma nota ganham uma aresta de co-ocorrencia,
 *   com teto por bola (um tema central nao pode conectar com tudo);
 * - o foco abre a entidade com as notas dela como evidencia: centro -> foco e
 *   nota -> entidade, sem um segundo centro.
 *
 * O id do no e o mesmo contrato do servidor (`kind:chave`, ver `nodeId` em
 * `mobile/src/core/graphModel.ts`). A chave e o nome normalizado (sem acento,
 * minusculo, espacos viram `-`), entao grafias diferentes da mesma entidade
 * caem na mesma bola mesmo sem banco de entidades para resolver aliases.
 */

import { DEFAULT_NOTEBOOK_ID } from "../../../mobile/src/core/notebooks";
import { listRecordings } from "../../../mobile/src/core/repo";
import type { Recording } from "../../../mobile/src/core/types";

import { listLocalAnalyses } from "./analyze";
import { listLocalNotebooks } from "./notebooks";
import { loadLocalSettings } from "./settings";

import type {
  Analysis,
  AuthorRole,
  EntityDetail,
  EntityEntry,
  EntityKind,
  EntityMention,
  GraphEdge,
  GraphNode,
  GraphResponse,
} from "../types";

/** Mesmos tetos do servidor (`GraphOptions.defaults`). */
const NODE_LIMIT = 250;
const NOTE_LIMIT = 100;
const EDGE_LIMIT = 1500;
const EDGES_PER_NODE = 12;
/** O servidor le no maximo 20 mil pares de co-ocorrencia. */
const MAX_PAIRS = 20_000;

const ENTITY_KINDS: readonly EntityKind[] = ["person", "place", "theme", "decision"];

export interface LocalGraphOptions {
  /** Restringe a um caderno. */
  notebookId?: string;
  /** Data minima (ISO, inclusive), o `from` do servidor. */
  period?: string;
  /** Termo que o nome da bola precisa conter. */
  query?: string;
  /** No id (`person:marina`) para abrir o grafo local da entidade. */
  focus?: string;
  /** Deixa os capitulos de livro fora do mapa do diario. */
  excludeBooks?: boolean;
}

/** Mencoes de uma entidade dentro de uma nota. */
interface NoteLink {
  id: string;
  kind: EntityKind;
  key: string;
  /** Grafia que a analise usou nesta nota. */
  name: string;
  count: number;
  sentiment: number;
}

/** Uma nota com analise e os vinculos que ela sustenta. */
interface NoteRow {
  recording: Recording;
  analysis: Analysis;
  when: string;
  links: NoteLink[];
}

/** Agregado de uma entidade, o que vira bola no mapa. */
interface Bucket {
  id: string;
  kind: EntityKind;
  key: string;
  /** Grafias vistas e quantas vezes cada uma apareceu. */
  spellings: Map<string, number>;
  mentions: number;
  notes: number;
  sentimentSum: number;
  sentimentCount: number;
  lastSeen: string;
}

/** Nome sem acento, minusculo e sem pontuacao: a chave estavel da entidade. */
export function entityKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function isEntityKind(value: string): value is EntityKind {
  return (ENTITY_KINDS as readonly string[]).includes(value);
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function recordedWhen(recording: Recording): string {
  return recording.recordedAt || recording.createdAt || "";
}

function notebookOf(recording: Recording): string {
  return recording.notebookId ?? DEFAULT_NOTEBOOK_ID;
}

/** Grafia mais frequente; empate cai para a primeira em ordem alfabetica. */
function displayName(bucket: Bucket): string {
  let best = "";
  let bestCount = -1;
  for (const [name, count] of bucket.spellings) {
    if (count > bestCount || (count === bestCount && name.localeCompare(best, "pt-BR") < 0)) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

/** Chuva de entidades: pessoas, lugares e temas da analise, sem repetir. */
function linksOf(analysis: Analysis): NoteLink[] {
  const links = new Map<string, NoteLink>();
  const add = (kind: EntityKind, name: string, count: number, sentiment: number) => {
    const clean = name.trim();
    const key = entityKey(clean);
    if (!key) return;
    const id = `${kind}:${key}`;
    const current = links.get(id);
    if (current) {
      current.count += count;
      return;
    }
    links.set(id, { id, kind, key, name: clean, count, sentiment });
  };

  const analysisSentiment = finite(analysis.sentiment, 0);
  // O detalhe e a fonte melhor (count/sentiment por pessoa); a lista simples
  // cobre analises antigas que so gravaram os nomes.
  const people = analysis.people_detail?.length
    ? analysis.people_detail
    : (analysis.people ?? []).map((name) => ({
        name,
        count: 1,
        relation: "",
        sentiment: analysisSentiment,
      }));
  for (const person of people) {
    add(
      "person",
      person.name,
      Math.max(1, Math.round(finite(person.count, 1))),
      finite(person.sentiment, analysisSentiment),
    );
  }

  const places = analysis.places_detail?.length
    ? analysis.places_detail
    : (analysis.places ?? []).map((name) => ({ name, count: 1 }));
  for (const place of places) {
    add(
      "place",
      place.name,
      Math.max(1, Math.round(finite(place.count, 1))),
      analysisSentiment,
    );
  }

  for (const theme of analysis.themes ?? []) {
    add("theme", theme.name, 1, analysisSentiment);
  }

  return [...links.values()];
}

/** Notas vivas do nucleo com analise, ja filtradas pelo recorte do mapa. */
async function collectNotes(options: LocalGraphOptions): Promise<NoteRow[]> {
  const [recordings, analyses, books] = await Promise.all([
    listRecordings(false),
    listLocalAnalyses(),
    options.excludeBooks
      ? listLocalNotebooks().then(
          (cadernos) => new Set(cadernos.filter((c) => c.kind === "book").map((c) => c.id)),
        )
      : Promise.resolve<Set<string> | null>(null),
  ]);
  const byId = new Map(analyses.map((item) => [item.entry_id, item.analysis]));

  const rows: NoteRow[] = [];
  for (const recording of recordings) {
    const notebook = notebookOf(recording);
    if (options.notebookId && notebook !== options.notebookId) continue;
    if (books?.has(notebook)) continue;
    const when = recordedWhen(recording);
    if (options.period && when && when < options.period) continue;
    const analysis = byId.get(recording.id);
    if (!analysis) continue;
    const links = linksOf(analysis);
    // Nota sem entidade nao inventa bola nem aresta.
    if (links.length === 0) continue;
    rows.push({ recording, analysis, when, links });
  }
  return rows;
}

/** Agrega as entidades das notas em bolas, na ordem do mapa. */
function aggregate(rows: NoteRow[]): Map<string, Bucket> {
  const buckets = new Map<string, Bucket>();
  for (const row of rows) {
    for (const link of row.links) {
      let bucket = buckets.get(link.id);
      if (!bucket) {
        bucket = {
          id: link.id,
          kind: link.kind,
          key: link.key,
          spellings: new Map(),
          mentions: 0,
          notes: 0,
          sentimentSum: 0,
          sentimentCount: 0,
          lastSeen: "",
        };
        buckets.set(link.id, bucket);
      }
      bucket.spellings.set(link.name, (bucket.spellings.get(link.name) ?? 0) + 1);
      bucket.mentions += Math.max(1, link.count);
      bucket.notes += 1;
      if (Number.isFinite(link.sentiment)) {
        bucket.sentimentSum += link.sentiment;
        bucket.sentimentCount += 1;
      }
      if (row.when > bucket.lastSeen) bucket.lastSeen = row.when;
    }
  }
  return buckets;
}

function toNode(bucket: Bucket): GraphNode {
  return {
    id: bucket.id,
    kind: bucket.kind,
    label: displayName(bucket),
    mentions: bucket.mentions,
    notes: bucket.notes,
    sentiment: bucket.sentimentCount > 0 ? bucket.sentimentSum / bucket.sentimentCount : undefined,
    last_seen: bucket.lastSeen || null,
  };
}

function userNode(label: string, notes: number): GraphNode {
  return { id: "user", kind: "user", label, mentions: 0, notes };
}

function byStrength(a: Bucket, b: Bucket): number {
  return b.mentions - a.mentions || displayName(a).localeCompare(displayName(b), "pt-BR");
}

function matchesQuery(bucket: Bucket, query?: string): boolean {
  const term = (query ?? "").trim().toLowerCase();
  if (!term) return true;
  return displayName(bucket).toLowerCase().includes(term);
}

interface Pair {
  a: string;
  b: string;
  weight: number;
}

/** Pares de entidades que dividem nota, do mais forte para o mais fraco. */
function cooccurrencePairs(rows: NoteRow[], kept: ReadonlySet<string>): Pair[] {
  const shared = new Map<string, Pair>();
  for (const row of rows) {
    const ids = [...new Set(row.links.map((link) => link.id))]
      .filter((id) => kept.has(id))
      .sort();
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const key = `${ids[i]}\u0000${ids[j]}`;
        const pair = shared.get(key);
        if (pair) pair.weight += 1;
        else shared.set(key, { a: ids[i], b: ids[j], weight: 1 });
      }
    }
  }
  return [...shared.values()].sort(
    (x, y) => y.weight - x.weight || x.a.localeCompare(y.a) || x.b.localeCompare(y.b),
  );
}

function centerLabelOf(ownerName: string | undefined): string {
  return (ownerName ?? "").trim() || "Você";
}

/**
 * Mapa do cofre: o ego do dono ou uma entidade expandida (`focus`).
 *
 * Sem servidor nao existe `truncated` por paginas: o mapa inteiro ja esta no
 * navegador. O sinal vale para o que o desenho cortou (teto de bolas, de notas
 * no foco ou de pares), como o servidor devolve.
 */
export async function buildLocalGraph(options: LocalGraphOptions = {}): Promise<GraphResponse> {
  const [rows, settings] = await Promise.all([collectNotes(options), loadLocalSettings()]);
  const centerLabel = centerLabelOf(settings.owner_name);
  const buckets = aggregate(rows);

  if (options.focus) {
    return buildFocusGraph(rows, buckets, centerLabel, options.focus);
  }

  const sorted = [...buckets.values()].filter((bucket) => matchesQuery(bucket, options.query)).sort(byStrength);
  const totalNodes = sorted.length;
  const kept = sorted.slice(0, NODE_LIMIT);
  const keptIds = new Set(kept.map((bucket) => bucket.id));

  const edges: GraphEdge[] = kept.map((bucket) => ({
    source: "user",
    target: bucket.id,
    kind: "relation",
    weight: bucket.notes,
  }));

  const allPairs = cooccurrencePairs(rows, keptIds);
  const perNode = new Map<string, number>();
  let pairsTruncated = allPairs.length > MAX_PAIRS;
  let pairs: Pair[] = allPairs;
  if (pairs.length > MAX_PAIRS) {
    pairs = pairs.slice(0, MAX_PAIRS);
  }
  for (const pair of pairs) {
    const left = perNode.get(pair.a) ?? 0;
    const right = perNode.get(pair.b) ?? 0;
    if (left >= EDGES_PER_NODE || right >= EDGES_PER_NODE) {
      pairsTruncated = true;
      continue;
    }
    perNode.set(pair.a, left + 1);
    perNode.set(pair.b, right + 1);
    edges.push({ source: pair.a, target: pair.b, kind: "cooccurrence", weight: pair.weight });
  }

  return {
    center: userNode(centerLabel, rows.length),
    nodes: kept.map(toNode),
    edges,
    total_nodes: totalNodes,
    total_edges: totalNodes + allPairs.length,
    truncated: totalNodes > kept.length || pairsTruncated,
  };
}

/** Grafo local de uma entidade: ela, as notas dela e o que essas notas citam. */
function buildFocusGraph(
  rows: NoteRow[],
  buckets: Map<string, Bucket>,
  centerLabel: string,
  focus: string,
): GraphResponse {
  const at = focus.indexOf(":");
  const kind = at > 0 ? focus.slice(0, at) : "";
  const focusBucket = buckets.get(focus);
  const center = userNode(centerLabel, rows.length);

  if (at <= 0 || !isEntityKind(kind) || !focusBucket) {
    return { center, nodes: [], edges: [], total_nodes: 0, total_edges: 0, truncated: false };
  }

  const focusNotes = rows
    .filter((row) => row.links.some((link) => link.id === focus))
    .sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0));
  const notesTruncated = focusNotes.length > NOTE_LIMIT;
  const visibleNotes = focusNotes.slice(0, NOTE_LIMIT);

  const focusNode: GraphNode = {
    id: focusBucket.id,
    kind: focusBucket.kind,
    label: displayName(focusBucket),
    mentions: focusBucket.mentions,
    notes: focusBucket.notes,
    sentiment:
      focusBucket.sentimentCount > 0
        ? focusBucket.sentimentSum / focusBucket.sentimentCount
        : undefined,
    last_seen: focusBucket.lastSeen || null,
  };

  if (visibleNotes.length === 0) {
    return {
      center,
      nodes: [focusNode],
      edges: [{ source: "user", target: focusNode.id, kind: "relation", weight: focusNode.notes }],
      total_nodes: 1,
      total_edges: 1,
      truncated: false,
    };
  }

  const neighborBuckets = [...aggregate(visibleNotes).values()]
    .filter((bucket) => bucket.id !== focus)
    .sort(byStrength);
  const entitiesTruncated = neighborBuckets.length > NODE_LIMIT;
  const neighbors = neighborBuckets.slice(0, NODE_LIMIT);

  const noteNodes: GraphNode[] = visibleNotes.map((row) => ({
    id: `note:${row.recording.id}`,
    kind: "note",
    label: row.recording.title || "Sem título",
    mentions: 0,
    notes: 1,
    date: row.when || null,
    author: (row.recording.author ?? "") as AuthorRole,
  }));

  const visibleIds = new Set<string>(["user", focus, ...neighbors.map((bucket) => bucket.id)]);
  const edges: GraphEdge[] = [
    { source: "user", target: focus, kind: "relation", weight: focusNode.notes },
  ];
  let linksTruncated = false;
  for (const row of visibleNotes) {
    const noteId = `note:${row.recording.id}`;
    for (const link of row.links) {
      if (!visibleIds.has(link.id)) continue;
      if (edges.length >= EDGE_LIMIT) {
        linksTruncated = true;
        break;
      }
      edges.push({
        source: noteId,
        target: link.id,
        kind: "mention",
        weight: Math.max(1, link.count),
      });
    }
    if (linksTruncated) break;
  }

  const nodes = [focusNode, ...neighbors.map(toNode), ...noteNodes];
  return {
    center,
    nodes,
    edges,
    total_nodes: nodes.length,
    total_edges: edges.length,
    truncated: notesTruncated || entitiesTruncated || linksTruncated,
  };
}

/** Trecho da nota que contem o termo, limitado a uma frase curta. */
function sentenceAround(text: string, term: string): string {
  const at = text.toLowerCase().indexOf(term.toLowerCase());
  if (at < 0) return "";
  let start = at;
  while (start > 0 && !/[.!?\n]/.test(text[start - 1])) start -= 1;
  let end = at + term.length;
  while (end < text.length && !/[.!?\n]/.test(text[end])) end += 1;
  return text.slice(start, end).trim().slice(0, 280);
}

/** O trecho onde o termo aparece: texto escrito, fala com tempo ou resumo. */
function excerptOf(
  row: NoteRow,
  term: string,
): { source: "transcript" | "text"; text: string; start_ms?: number; end_ms?: number } | null {
  const written = (row.recording.text ?? "").trim();
  if (written) {
    const text = sentenceAround(written, term);
    if (text) return { source: "text", text };
  }
  for (const segment of row.recording.transcriptSegments ?? []) {
    const speech = (segment.revised?.trim() || segment.text || "").trim();
    if (!speech) continue;
    const text = sentenceAround(speech, term);
    if (!text) continue;
    return { source: "transcript", text, start_ms: segment.start_ms, end_ms: segment.end_ms };
  }
  const spoken = (row.recording.transcript ?? "").trim();
  if (spoken) {
    const text = sentenceAround(spoken, term);
    if (text) return { source: "text", text };
  }
  // A analise citou a entidade mas o texto nao esta mais na nota: fica a
  // leitura da analise como contexto, nunca um trecho inventado.
  const reading = (row.analysis.reading ?? "").trim() || (row.analysis.summary ?? "").trim();
  return reading ? { source: "text", text: reading } : null;
}

/** Entidade do cofre com a lista de notas onde aparece, para a ficha do mapa. */
export async function buildLocalEntityDetail(
  kind: EntityKind,
  name: string,
): Promise<EntityDetail | null> {
  const rows = await collectNotes({});
  const id = `${kind}:${entityKey(name)}`;
  const bucket = aggregate(rows).get(id);
  if (!bucket) return null;

  const entryCounts = new Map<string, EntityEntry>();
  for (const row of rows) {
    const links = row.links.filter((link) => link.id === id);
    if (links.length === 0) continue;
    const count = links.reduce((total, link) => total + Math.max(1, link.count), 0);
    const current = entryCounts.get(row.recording.id);
    if (current) {
      current.count += count;
      continue;
    }
    entryCounts.set(row.recording.id, {
      id: row.recording.id,
      title: row.recording.title,
      date: row.when || null,
      count,
    });
  }
  const entryList = [...entryCounts.values()].sort((a, b) =>
    (a.date ?? "") < (b.date ?? "") ? 1 : (a.date ?? "") > (b.date ?? "") ? -1 : 0,
  );
  const label = displayName(bucket);
  const aliases = [...bucket.spellings.keys()].filter((spelling) => spelling !== label);

  return {
    id: bucket.id,
    kind: bucket.kind,
    name: label,
    label: "",
    entries: entryList.length,
    mentions: bucket.mentions,
    sentiment: bucket.sentimentCount > 0 ? bucket.sentimentSum / bucket.sentimentCount : 0,
    last_seen: bucket.lastSeen || null,
    updated_at: null,
    aliases,
    entry_list: entryList,
  };
}

/** Trechos da entidade nas notas do cofre, no formato que a ficha desenha. */
export async function buildLocalEntityMentions(
  kind: EntityKind,
  name: string,
): Promise<EntityMention[]> {
  const rows = await collectNotes({});
  const id = `${kind}:${entityKey(name)}`;
  const mentions: EntityMention[] = [];
  for (const row of rows) {
    const links = row.links.filter((link) => link.id === id);
    if (links.length === 0) continue;
    const term = links[0].name;
    const excerpt = excerptOf(row, term);
    if (!excerpt) continue;
    mentions.push({
      entry_id: row.recording.id,
      title: row.recording.title,
      date: row.when || null,
      source: excerpt.source,
      text: excerpt.text,
      term,
      ...(excerpt.start_ms !== undefined ? { start_ms: excerpt.start_ms } : {}),
      ...(excerpt.end_ms !== undefined ? { end_ms: excerpt.end_ms } : {}),
      comment: (row.analysis.reading ?? "").trim() || undefined,
    });
  }
  mentions.sort((a, b) => ((a.date ?? "") < (b.date ?? "") ? 1 : (a.date ?? "") > (b.date ?? "") ? -1 : 0));
  return mentions;
}
