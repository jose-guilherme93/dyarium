import fixtureJson from '../../../../fixtures/entity-derivation.json';

import type { ServerAnalysis } from '../api';
import { deriveEntityLinks, ownerKey } from '../graphEntities';

interface ParityCase {
  name: string;
  owner: string[];
  analysis: Partial<ServerAnalysis>;
  links: {
    kind: string;
    name: string;
    count: number;
    relation?: string;
    sentiment?: number;
  }[];
}

const fixture = fixtureJson as { cases: ParityCase[] };

function linkString(link: {
  kind: string;
  name: string;
  count: number;
  relation?: string;
  sentiment?: number;
}): string {
  const parts = [link.kind, link.name.trim(), `count=${link.count}`];
  if (link.relation) parts.push(`relation=${link.relation.trim()}`);
  if (typeof link.sentiment === 'number') parts.push(`sentiment=${link.sentiment}`);
  return parts.join('|');
}

/**
 * O mesmo arquivo lido por internal/analysisbuild/build_parity_test.go. Se o
 * app e o servidor derivarem entidades diferentes da mesma analise, um dos
 * dois testes fica vermelho.
 */
describe('derivação de entidades (paridade com o servidor)', () => {
  it.each(fixture.cases.map((testCase) => [testCase.name, testCase] as const))(
    '%s',
    (_name, testCase) => {
      const owner = new Set(testCase.owner.map(ownerKey));
      const links = deriveEntityLinks(
        {
          people: testCase.analysis.people ?? null,
          people_detail: testCase.analysis.people_detail ?? null,
          places: testCase.analysis.places ?? null,
          places_detail: testCase.analysis.places_detail ?? null,
          themes: testCase.analysis.themes ?? null,
          decisions: testCase.analysis.decisions ?? null,
        },
        owner,
      );
      expect(links.map(linkString)).toEqual(testCase.links.map(linkString));
    },
  );
});
