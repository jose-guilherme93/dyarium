/**
 * Modelo do mapa de relacoes do aparelho.
 *
 * O grafo nao vem do servidor: ele e derivado das analises que ja estao no
 * SQLite local. Estes tipos sao o que o nucleo puro recebe e devolve, sem
 * nenhum import nativo, para poder ser testado com fakes.
 */

import type { ServerAnalysis } from './api';
import type { TranscriptSegment } from './types';

export type EntityKind = 'person' | 'place' | 'theme' | 'decision';
export type GraphNodeKind = 'user' | EntityKind | 'note';
export type GraphEdgeKind = 'relation' | 'cooccurrence' | 'mention';

/** Entidade canonica, igual a tabela `entities` do servidor. */
export interface GraphEntity {
  id: string;
  kind: EntityKind;
  name: string;
  icon: string;
  /** Relogio do servidor; vazio nas entidades criadas antes da coluna. */
  updatedAt: string;
}

/** Uma mencao de entidade numa nota (`entry_entities`). */
export interface EntityLink {
  entryId: string;
  entityId: string;
  count: number;
  relation?: string;
  sentiment?: number;
}

/** A nota como o mapa precisa dela: identificacao, texto e analise. */
export interface GraphEntry {
  /** Chave usada pelos vinculos: id da analise (local ou entry id). */
  id: string;
  /** `recordings.id`, a chave estavel para abrir a nota na tela. */
  localId?: string;
  /** Id da entrada no servidor, quando a nota ja subiu. */
  entryId?: string;
  title: string;
  recordedAt: string;
  notebookId: string;
  author?: string;
  /** Tom da analise, lido do SQLite sem parsear o payload inteiro. */
  sentiment?: number;
  /** Ha analise guardada para a nota. */
  hasAnalysis?: boolean;
  text?: string;
  transcript?: string;
  transcriptSegments?: TranscriptSegment[];
  /** Presente so quando a nota foi hidratada para o painel. */
  analysis?: ServerAnalysis;
}

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  icon?: string;
  mentions: number;
  notes: number;
  sentiment?: number;
  lastSeen?: string;
  date?: string;
  author?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: GraphEdgeKind;
  weight: number;
}

export interface GraphData {
  center: GraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
  totalNodes: number;
  totalEdges: number;
}

export interface GraphOptions {
  /** Tipos visiveis; ausente mostra todos. O centro nunca e filtrado. */
  kinds?: ReadonlySet<EntityKind>;
  /** Id de um no (`person:<id>`) para abrir o grafo local da entidade. */
  focus?: string;
  /** Pares de co-ocorrencia por entidade, como no servidor. */
  edgesPerNode?: number;
  /** Entidades desenhadas no grafo do dia a dia (as mais mencionadas). */
  nodeLimit?: number;
  /** Notas mostradas no foco; o painel continua listando todas. */
  noteLimit?: number;
}

export const ENTITY_KINDS: EntityKind[] = ['person', 'place', 'theme', 'decision'];

/** No do centro: o dono do diario, que nao e pessoa do mapa. */
export function userNode(label: string): GraphNode {
  return { id: 'user', kind: 'user', label: label.trim() || 'Você', mentions: 0, notes: 0 };
}

/** Id de no com prefixo de tipo, igual ao contrato do servidor. */
export function nodeId(kind: string, id: string): string {
  return `${kind}:${id}`;
}

/** Separa `person:01J...` em tipo e id. */
export function splitNodeId(id: string): { kind: string; id: string } | null {
  const at = id.indexOf(':');
  if (at <= 0) return null;
  return { kind: id.slice(0, at), id: id.slice(at + 1) };
}

export function isEntityKind(value: string): value is EntityKind {
  return value === 'person' || value === 'place' || value === 'theme' || value === 'decision';
}

/** Rotulo curto do tipo, o mesmo do web. */
export function kindLabel(kind: GraphNodeKind): string {
  switch (kind) {
    case 'person':
      return 'Pessoa';
    case 'place':
      return 'Lugar';
    case 'theme':
      return 'Tema';
    case 'decision':
      return 'Decisão';
    case 'note':
      return 'Nota';
    default:
      return 'Você';
  }
}

/** Nome do autor da nota, resolvido como no painel do web. */
export function authorLabel(
  author: string | undefined,
  ownerName: string,
  allNotesMine: boolean,
): string {
  const role = author || (allNotesMine ? 'self' : '');
  const owner = ownerName.trim() || 'Você';
  switch (role) {
    case 'self':
      return owner;
    case 'other':
      return 'Outros';
    case 'mixed':
      return `${owner} e outros`;
    default:
      return 'Sem autor';
  }
}
