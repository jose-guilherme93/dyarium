/**
 * Curadoria de entidades: normalizacao de nome, memoria de rejeicoes e
 * recuperacao lexical. Puro e testavel, sem imports nativos, porque o dashboard
 * importa o mesmo nucleo.
 *
 * O contrato vive em `docs/curadoria-de-entidades.md`: `kind` e lista fechada
 * (person, place, theme, decision), `name` e o nome real, `label` e so exibicao
 * e uma rejeicao diz "este nome nunca e entidade deste tipo", aplicada por
 * script antes de persistir.
 */

import { foldText } from './analysisPrompt';
import type { EntityKind } from './graphModel';

export type { EntityKind } from './graphModel';

/** Nome recusado para um tipo, com o relogio do sync (LWW). */
export interface EntityRejection {
  kind: EntityKind;
  name: string;
  /** Normalizado por `entityNameKey`: minusculas, sem acento, espacos colapsados. */
  nameKey: string;
  updatedAt: string;
}

/**
 * Chave normalizada de um nome, a mesma do `name_key` de `entity_rejections`:
 * minusculas, sem acento, espacos colapsados e pontas aparadas.
 *
 * Nao remove pontuacao do meio, igual ao servidor; o casamento lexical usa
 * `foldText` para comparar palavras inteiras.
 */
export function entityNameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    // O servidor usa `normalizeAlias`, que apara pontuacao nas pontas. Sem
    // isso, "Paulo Ramos." e "Paulo Ramos" seriam rejeicoes diferentes.
    .replace(/^[^0-9a-zà-öø-ÿ]+|[^0-9a-zà-öø-ÿ]+$/gi, '');
}

/** Chave de um nome dentro de um tipo, usada pelo mapa de nomes canonicos. */
export function entityNameMapKey(kind: EntityKind, name: string): string {
  return `${kind}\u0000${entityNameKey(name)}`;
}

/** Link minimo que o filtro de rejeicoes precisa enxergar. */
export interface RejectableLink {
  kind: EntityKind;
  name: string;
}

/**
 * Chave de comparacao de uma rejeicao. O `nameKey` pode vir do servidor; quando
 * vier vazio, o proprio nome e normalizado.
 */
function rejectionKey(kind: EntityKind, name: string, nameKey?: string): string {
  return `${kind}\u0000${nameKey && nameKey !== '' ? nameKey : entityNameKey(name)}`;
}

/** O nome esta rejeitado para aquele tipo? */
export function isEntityRejected(
  kind: EntityKind,
  name: string,
  rejections: readonly EntityRejection[] | undefined,
): boolean {
  if (!rejections || rejections.length === 0) return false;
  const key = rejectionKey(kind, name);
  return rejections.some((item) => rejectionKey(item.kind, item.name, item.nameKey) === key);
}

/**
 * Descarta os vinculos cujo `(kind, name_key)` foi rejeitado, antes de resolver
 * ou criar a entidade. Devolve uma lista nova, preservando os campos extras.
 */
export function filterRejectedLinks<T extends RejectableLink>(
  links: readonly T[],
  rejections: readonly EntityRejection[] | undefined,
): T[] {
  if (!rejections || rejections.length === 0) return [...links];
  const rejected = new Set(
    rejections.map((item) => rejectionKey(item.kind, item.name, item.nameKey)),
  );
  return links.filter((link) => !rejected.has(rejectionKey(link.kind, link.name)));
}

/** Mapa de nomes canonicos por `kind` e nome normalizado. */
export type CanonicalNameMap = Readonly<Record<string, string>>;

/**
 * Resolve um nome pelo mapa de nomes canonicos da tabela `entities`. Sem
 * correspondencia, devolve a grafia original: e o que uma extracao nova deve
 * manter ate o dono nomear.
 */
export function canonicalEntityName(
  map: CanonicalNameMap | undefined,
  kind: EntityKind,
  name: string,
): string {
  if (!map) return name;
  const resolved = map[entityNameMapKey(kind, name)];
  return resolved !== undefined ? resolved : name;
}

/** Uma entrada da memoria do dicionario do diario. */
export interface EntityMemoryEntry {
  kind: EntityKind;
  /** Nome real/canonico exibido. */
  name: string;
  /** Rotulo livre de exibicao (escola, gata, personagem). */
  label?: string;
  /** Grafias antigas que ainda apontam para esta entidade. */
  aliases?: string[];
  /** Tipos em que o nome ja foi rejeitado. */
  rejected?: EntityKind[];
}

/** O que o catalogo de um cliente entrega para montar a memoria. */
export interface EntityMemorySource {
  kind: EntityKind;
  name: string;
  label?: string;
  aliases?: string[];
}

/**
 * Monta o dicionario que a LLM le: nomes reais com rotulo/apelidos e as
 * rejeicoes. Uma rejeicao sem entidade vira uma entrada so dela ("você: nunca
 * pessoa"), para o bloco que cita o pronome tambem receber a regra.
 */
export function buildEntityMemory(
  entities: readonly EntityMemorySource[],
  rejections: readonly { kind: EntityKind; name: string }[] | undefined,
): EntityMemoryEntry[] {
  const out: EntityMemoryEntry[] = [];
  const byKey = new Map<string, EntityMemoryEntry>();
  for (const entity of entities) {
    const entry: EntityMemoryEntry = {
      kind: entity.kind,
      name: entity.name,
      label: entity.label?.trim() || undefined,
      aliases: entity.aliases?.filter((alias) => alias.trim() !== ''),
    };
    const key = entityNameMapKey(entity.kind, entity.name);
    if (byKey.has(key)) continue;
    byKey.set(key, entry);
    out.push(entry);
  }
  for (const rejection of rejections ?? []) {
    const key = entityNameMapKey(rejection.kind, rejection.name);
    const existing = byKey.get(key);
    if (existing) {
      existing.rejected = [...new Set([...(existing.rejected ?? []), rejection.kind])];
      continue;
    }
    const entry: EntityMemoryEntry = {
      kind: rejection.kind,
      name: rejection.name,
      rejected: [rejection.kind],
    };
    byKey.set(key, entry);
    out.push(entry);
  }
  return out;
}

/** O nome (ou um alias) aparece como sequencia de palavras inteiras no texto. */
function appearsAsWords(haystack: readonly string[], phrase: string): boolean {
  const needle = foldText(phrase).split(' ').filter(Boolean);
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let same = true;
    for (let offset = 0; same && offset < needle.length; offset += 1) {
      same = haystack[start + offset] === needle[offset];
    }
    if (same) return true;
  }
  return false;
}

/**
 * Recuperacao lexical por bloco: devolve so as entradas cujo nome ou alias
 * aparece literalmente no texto. O casamento e por palavra inteira, com a mesma
 * normalizacao de `foldText` (minusculas, sem acento, pontuacao separada).
 */
export function retrieveMemoryForText(
  text: string,
  memory: readonly EntityMemoryEntry[],
): EntityMemoryEntry[] {
  const words = foldText(text).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const out: EntityMemoryEntry[] = [];
  for (const entry of memory) {
    const spellings = [entry.name, ...(entry.aliases ?? [])];
    if (spellings.some((spelling) => appearsAsWords(words, spelling))) {
      out.push(entry);
    }
  }
  return out;
}
