/**
 * Derivacao das entidades de uma analise.
 *
 * E a mesma regra do servidor (`internal/analysisbuild`): pessoas com a
 * contagem e o tom do detalhe, lugares com a contagem, temas e decisoes com
 * peso 1, decisao repetida na nota contando uma vez so. O dono do diario nunca
 * vira bola de pessoa: as grafias marcadas como "sou eu" saem daqui.
 *
 * A paridade com o Go e provada por `fixtures/entity-derivation.json`, lido
 * pelos testes dos dois lados.
 */

import type { ServerAnalysis } from './api';
import type { EntityKind } from './graphModel';

export interface DerivedEntityLink {
  kind: EntityKind;
  name: string;
  count: number;
  relation?: string;
  sentiment?: number;
}

type AnalysisEntities = Pick<
  ServerAnalysis,
  'people' | 'people_detail' | 'places' | 'places_detail' | 'themes' | 'decisions'
>;

/** Chave de comparacao do dono: minuscula e sem espacos nas pontas. */
export function ownerKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Converte o documento da analise nas ligacoes nota -> entidade. */
export function deriveEntityLinks(
  analysis: AnalysisEntities,
  ownerKeys: ReadonlySet<string> = new Set(),
): DerivedEntityLink[] {
  const links: DerivedEntityLink[] = [];
  const people = analysis.people_detail ?? [];
  if (people.length > 0) {
    for (const person of people) {
      const name = person.name.trim();
      if (!name || ownerKeys.has(ownerKey(name))) continue;
      links.push({
        kind: 'person',
        name,
        count: Math.max(1, person.count ?? 1),
        relation: person.relation?.trim() || undefined,
        sentiment: typeof person.sentiment === 'number' ? person.sentiment : undefined,
      });
    }
  } else {
    for (const raw of analysis.people ?? []) {
      const name = raw.trim();
      if (!name || ownerKeys.has(ownerKey(name))) continue;
      links.push({ kind: 'person', name, count: 1 });
    }
  }

  const places = analysis.places_detail ?? [];
  if (places.length > 0) {
    for (const place of places) {
      const name = place.name.trim();
      if (!name) continue;
      links.push({ kind: 'place', name, count: Math.max(1, place.count ?? 1) });
    }
  } else {
    for (const raw of analysis.places ?? []) {
      const name = raw.trim();
      if (!name) continue;
      links.push({ kind: 'place', name, count: 1 });
    }
  }

  for (const theme of analysis.themes ?? []) {
    const name = theme.name.trim();
    if (!name) continue;
    links.push({ kind: 'theme', name, count: 1 });
  }

  const seen = new Set<string>();
  for (const raw of analysis.decisions ?? []) {
    const name = raw.trim();
    const key = ownerKey(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    links.push({ kind: 'decision', name, count: 1 });
  }

  return links;
}
