import type { EntityKind } from '../graphModel';
import {
  buildEntityMemory,
  canonicalEntityName,
  entityNameKey,
  entityNameMapKey,
  filterRejectedLinks,
  isEntityRejected,
  retrieveMemoryForText,
  type EntityMemoryEntry,
  type EntityRejection,
} from '../entities';

function rejection(kind: EntityKind, name: string, updatedAt = ''): EntityRejection {
  return { kind, name, nameKey: entityNameKey(name), updatedAt };
}

describe('normalizacao do nome', () => {
  it('ignora caixa e acento: voce e Você tem a mesma chave', () => {
    expect(entityNameKey('Você')).toBe('voce');
    expect(entityNameKey('voce')).toBe('voce');
    expect(entityNameKey('  Você  ')).toBe('voce');
  });

  it('colapsa espacos e apara as pontas', () => {
    expect(entityNameKey('  João   Pedro  Gomes ')).toBe('joao pedro gomes');
    expect(entityNameKey('Paulo\tRamos')).toBe('paulo ramos');
    expect(entityNameKey('Paulo Ramos.')).toBe('paulo ramos');
    expect(entityNameKey('"Paulo Ramos"')).toBe('paulo ramos');
  });

  it('a chave do mapa separa o tipo do nome normalizado', () => {
    expect(entityNameMapKey('person', 'Você')).toBe(`person\0voce`);
    expect(entityNameMapKey('place', 'Você')).not.toBe(entityNameMapKey('person', 'Você'));
  });
});

describe('rejeicao por tipo', () => {
  it('Paulo Ramos e barrado como pessoa e permitido como lugar', () => {
    const rejections = [rejection('person', 'Paulo Ramos')];
    expect(isEntityRejected('person', 'Paulo Ramos', rejections)).toBe(true);
    expect(isEntityRejected('person', '  paulo   ramos ', rejections)).toBe(true);
    expect(isEntityRejected('place', 'Paulo Ramos', rejections)).toBe(false);
  });

  it('filtra so os vinculos do tipo rejeitado', () => {
    const rejections = [rejection('person', 'Paulo Ramos')];
    const links = [
      { kind: 'person' as const, name: 'Paulo Ramos', count: 2 },
      { kind: 'place' as const, name: 'Paulo Ramos', count: 1 },
      { kind: 'person' as const, name: 'Maria', count: 1 },
    ];
    expect(filterRejectedLinks(links, rejections)).toEqual([
      { kind: 'place', name: 'Paulo Ramos', count: 1 },
      { kind: 'person', name: 'Maria', count: 1 },
    ]);
  });

  it('sem rejeicoes, nada e descartado', () => {
    const links = [{ kind: 'person' as const, name: 'Maria', count: 1 }];
    expect(filterRejectedLinks(links, [])).toEqual(links);
  });
});

describe('nome canonico', () => {
  it('resolve a grafia antiga para o nome real e mantem o original sem mapa', () => {
    const map = { [entityNameMapKey('person', 'Mari')]: 'Mariana' };
    expect(canonicalEntityName(map, 'person', 'Mari')).toBe('Mariana');
    expect(canonicalEntityName(map, 'person', 'Outra')).toBe('Outra');
    expect(canonicalEntityName(undefined, 'person', 'Mari')).toBe('Mari');
  });
});

describe('memoria do dicionario', () => {
  it('junta nome real, rotulo, apelidos e a rejeicao do mesmo nome', () => {
    const memory = buildEntityMemory(
      [{ kind: 'place', name: 'Paulo Ramos', label: 'escola', aliases: ['Paulinho'] }],
      [
        { kind: 'person', name: 'Paulo Ramos' },
        { kind: 'person', name: 'você' },
      ],
    );
    expect(
      memory.find((item) => item.name === 'Paulo Ramos' && item.kind === 'place'),
    ).toMatchObject({
      label: 'escola',
      aliases: ['Paulinho'],
    });
    expect(
      memory.find((item) => item.name === 'Paulo Ramos' && item.kind === 'person'),
    ).toMatchObject({ rejected: ['person'] });
    expect(memory.find((item) => item.name === 'você')).toMatchObject({
      rejected: ['person'],
    });
  });
});

describe('recuperacao lexical por bloco', () => {
  const memory: EntityMemoryEntry[] = [
    { kind: 'place', name: 'Paulo Ramos', label: 'escola', aliases: ['Paulinho'] },
    { kind: 'person', name: 'João Pedro Gomes da Silva', aliases: ['joaozinho', 'pedrinho gomes'] },
    { kind: 'person', name: 'Ana' },
  ];

  it('so entram os nomes e aliases que aparecem literalmente no bloco', () => {
    const found = retrieveMemoryForText(
      'Voltei para o Paulo Ramos e encontrei o Joaozinho na saida.',
      memory,
    );
    expect(found.map((item) => item.name)).toEqual([
      'Paulo Ramos',
      'João Pedro Gomes da Silva',
    ]);
  });

  it('acento e caixa nao mudam o casamento', () => {
    const found = retrieveMemoryForText('Passei na ESCOLA com o PAULO RAMOS.', memory);
    expect(found.map((item) => item.name)).toEqual(['Paulo Ramos']);
  });

  it('casa nome inteiro, nunca pedaco de palavra', () => {
    expect(retrieveMemoryForText('na semana passada eu fiquei em casa', memory)).toEqual([]);
    expect(retrieveMemoryForText('a Ana chegou', memory).map((item) => item.name)).toEqual([
      'Ana',
    ]);
  });

  it('texto vazio nao devolve nada', () => {
    expect(retrieveMemoryForText('   ', memory)).toEqual([]);
  });
});
