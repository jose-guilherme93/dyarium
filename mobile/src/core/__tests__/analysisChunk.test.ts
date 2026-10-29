import {
  EMOTIONS,
  THEMES,
  buildChunkMessages,
  chunkCacheKey,
  groundChunk,
  parseChunkJson,
  type ChunkExtraction,
} from '../analysisChunk';

function extraction(partial: Partial<ChunkExtraction> = {}): ChunkExtraction {
  return {
    tone: 0,
    emotions: [],
    themes: [],
    people: [],
    places: [],
    events: [],
    decisions: [],
    tasks: [],
    ideas: [],
    epiphanies: [],
    moments: [],
    ...partial,
  };
}

describe('parseChunkJson', () => {
  it('normaliza vocabulario fechado, acentos e limites', () => {
    const parsed = parseChunkJson(
      JSON.stringify({
        tom: -140,
        pessoas: [{ nome: ' Ana ' }, { nome: 'ana' }],
        lugares: [{ nome: 'Praia' }],
        emocoes: ['Tristeza', 'inventada', 'saudade'],
        temas: ['Família', 'trabalho', 'inventado'],
        eventos: ['enterro da Ana'],
        decisoes: ['vou viajar em julho', 'comprar a passagem'],
        tarefas: ['comprar a passagem'],
        ideias: [],
        epifanias: ['nunca falei o que eu sentia'],
        momentos: ['ela dormindo no sofa'],
      }),
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.tone).toBe(-100);
    expect(parsed?.people).toEqual(['Ana']);
    expect(parsed?.places).toEqual(['Praia']);
    expect(parsed?.emotions).toEqual(['tristeza', 'saudade']);
    expect(parsed?.themes).toEqual(['familia', 'trabalho']);
    expect(parsed?.events).toEqual(['enterro da Ana']);
    expect(parsed?.decisions).toEqual(['vou viajar em julho', 'comprar a passagem']);
    expect(parsed?.epiphanies).toEqual(['nunca falei o que eu sentia']);
    expect(parsed?.moments).toEqual(['ela dormindo no sofa']);
    for (const emotion of parsed?.emotions ?? []) expect(EMOTIONS).toContain(emotion);
    for (const theme of parsed?.themes ?? []) expect(THEMES).toContain(theme);
  });

  it('aceita a palavra do modelo pequeno no lugar do nome fechado', () => {
    const parsed = parseChunkJson(
      JSON.stringify({
        tom: 'negativo',
        emocoes: ['feliz', 'triste', 'preocupado', 'com raiva'],
        temas: ['emprego', 'família', 'dinheiro'],
      }),
    );
    expect(parsed?.tone).toBe(-50);
    expect(parsed?.emotions).toEqual(['alegria', 'tristeza']);
    expect(parsed?.themes).toEqual(['trabalho', 'familia']);
  });

  it('aceita as chaves em ingles quando o modelo ignora o schema', () => {
    const parsed = parseChunkJson(
      JSON.stringify({
        tone: 35,
        people: [{ nome: 'Ana' }],
        places: [{ nome: 'Praia' }],
        emotions: ['saudade'],
        themes: ['viagens'],
        events: ['enterro da Ana'],
        decisions: ['vou viajar'],
        tasks: ['comprar a passagem'],
        ideas: ['voltar em dezembro'],
        epiphanies: ['nunca falei o que sentia'],
        moments: ['ela dormindo no sofa'],
      }),
    );
    expect(parsed).toMatchObject({
      tone: 35,
      people: ['Ana'],
      places: ['Praia'],
      emotions: ['saudade'],
      themes: ['viagem'],
      events: ['enterro da Ana'],
      decisions: ['vou viajar'],
      tasks: ['comprar a passagem'],
      ideas: ['voltar em dezembro'],
      epiphanies: ['nunca falei o que sentia'],
      moments: ['ela dormindo no sofa'],
    });
  });

  it('devolve null sem JSON ou sem tom', () => {
    expect(parseChunkJson('nao sei')).toBeNull();
    expect(parseChunkJson('{"pessoas":[]}')).toBeNull();
  });

  it('corta listas acima do teto do contrato', () => {
    const parsed = parseChunkJson(
      JSON.stringify({
        tom: 10,
        pessoas: [{ nome: 'Ana' }, { nome: 'Bia' }, { nome: 'Caio' }, { nome: 'Dudu' }],
        emocoes: ['alegria', 'amor', 'calma'],
        momentos: ['um', 'dois'],
      }),
    );
    expect(parsed?.people).toHaveLength(3);
    expect(parsed?.emotions).toHaveLength(2);
    expect(parsed?.moments).toHaveLength(1);
  });
});

describe('groundChunk', () => {
  const block =
    'Fui ao enterro da Ana. Depois passei na casa da minha mae e decidi que vou viajar em julho. Preciso comprar a passagem. Ela dormia no sofa.';

  it('mantem o que existe no bloco e derruba o que o modelo inventou', () => {
    const grounded = groundChunk(
      extraction({
        people: ['Ana', 'Joao'],
        places: ['casa da minha mae', 'Paris'],
        events: ['enterro da Ana'],
        moments: ['Ela dormia no sofa.', 'o mar estava calmo'],
        decisions: ['vou viajar em julho'],
        tasks: ['comprar a passagem'],
        epiphanies: ['nunca falei o que eu sentia'],
      }),
      block,
    );

    expect(grounded.extraction.people).toEqual(['Ana']);
    expect(grounded.extraction.places).toEqual(['casa da minha mae']);
    expect(grounded.extraction.moments).toEqual(['Ela dormia no sofa.']);
    expect(grounded.extraction.decisions).toEqual(['vou viajar em julho']);
    expect(grounded.extraction.tasks).toEqual(['comprar a passagem']);
    expect(grounded.extraction.epiphanies).toEqual([]);
    expect(grounded.dropped).toBe(4);
  });

  it('nao aceita nome que so aparece dentro de outra palavra', () => {
    const grounded = groundChunk(
      extraction({ people: ['Ana'] }),
      'Na semana passada eu fiquei em casa o dia inteiro.',
    );
    expect(grounded.extraction.people).toEqual([]);
    expect(grounded.dropped).toBe(1);
  });

  it('exige 0.85 de evidencia para uma frase entrar', () => {
    const block = 'vou viajar em julho com a familia';
    const weak = groundChunk(
      extraction({ decisions: ['comprar um carro novo'], tasks: ['viajar de carro'] }),
      block,
    );
    expect(weak.extraction.decisions).toEqual([]);
    expect(weak.extraction.tasks).toEqual([]);

    const strong = groundChunk(extraction({ decisions: ['vou viajar em julho'] }), block);
    expect(strong.extraction.decisions).toEqual(['vou viajar em julho']);
  });

  it('momento com 3 de 4 palavras fica de fora', () => {
    const grounded = groundChunk(
      extraction({ moments: ['ela dormia no sofa'] }),
      'ela dormia no chao da sala',
    );
    expect(grounded.extraction.moments).toEqual([]);
  });

  it('compara nome sem acento e sem caixa', () => {
    const grounded = groundChunk(extraction({ people: ['ANA', 'joao'] }), 'fui com a Ana');
    expect(grounded.extraction.people).toEqual(['ANA']);
  });

  it('um fato entra em uma lista so: decisao vence tarefa e ideia', () => {
    const grounded = groundChunk(
      extraction({
        decisions: ['vou viajar em julho'],
        epiphanies: ['vou viajar em julho'],
        tasks: ['vou viajar em julho'],
        ideas: ['vou viajar em julho'],
      }),
      block,
    );
    expect(grounded.extraction.decisions).toEqual(['vou viajar em julho']);
    expect(grounded.extraction.epiphanies).toEqual([]);
    expect(grounded.extraction.tasks).toEqual([]);
    expect(grounded.extraction.ideas).toEqual([]);
  });

  it('aceita momento com pequena diferenca de pontuacao', () => {
    const grounded = groundChunk(
      extraction({ moments: ['ela dormia no sofa'] }),
      'Ela dormia no sofá, cansada.',
    );
    expect(grounded.extraction.moments).toEqual(['ela dormia no sofa']);
  });
});

describe('mensagem do bloco e cache', () => {
  it('leva titulo e contexto, sem o bloco virar instrucao', () => {
    const messages = buildChunkMessages({
      title: 'Um dia',
      block: { text: 'texto do bloco', context: 'frase anterior' },
    });
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Responda SOMENTE');
    expect(messages[1].content).toContain('Titulo da nota: Um dia');
    expect(messages[1].content).toContain('Bloco anterior');
    expect(messages[1].content).toContain('<bloco>\ntexto do bloco\n</bloco>');
  });

  it('o prompt curto mantem o contrato e as listas fechadas', () => {
    const input = { title: 'Um dia', block: { text: 'texto do bloco', context: '' } };
    const full = buildChunkMessages(input)[0].content;
    const compact = buildChunkMessages(input, { compact: true })[0].content;

    expect(compact.length).toBeLessThan(full.length);
    expect(compact).toContain('Responda SOMENTE');
    expect(compact).toContain(EMOTIONS[0]);
    expect(compact).toContain(THEMES[0]);
    expect(compact).toContain('"tom"');
  });

  it('a chave do cache muda com o modelo e a versao do prompt', () => {
    const block = { hash: 'abc' };
    expect(chunkCacheKey(block, 1, 'm')).toBe('abc:1:m');
    expect(chunkCacheKey(block, 2, 'm')).not.toBe(chunkCacheKey(block, 1, 'm'));
    expect(chunkCacheKey(block, 1, 'outro')).not.toBe(chunkCacheKey(block, 1, 'm'));
  });
});
