import type { AnalysisBlock } from '../analysisPlan';
import { canonicalEntityKey, composeAnalysis, toneLabelFor } from '../analysisCompose';
import type { ChunkExtraction } from '../analysisChunk';

function block(
  index: number,
  text: string,
  options: { kind?: 'text' | 'transcript'; startMs?: number; endMs?: number; chars?: number } = {},
): AnalysisBlock {
  return {
    index,
    kind: options.kind ?? 'text',
    heading: '',
    text,
    context: '',
    chars: options.chars ?? text.length,
    startMs: options.startMs ?? null,
    endMs: options.endMs ?? null,
    hash: `h${index}`,
  };
}

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

function fact(blockValue: AnalysisBlock, partial: Partial<ChunkExtraction> = {}) {
  return { block: blockValue, extraction: extraction(partial) };
}

describe('tom da nota', () => {
  it('pondera pelo tamanho do bloco', () => {
    const a = block(0, 'a'.repeat(100));
    const b = block(1, 'b'.repeat(300));
    const doc = composeAnalysis({
      blocks: [a, b],
      facts: [fact(a, { tone: 100 }), fact(b, { tone: -100 })],
      model: 'm',
    });
    expect(doc.tone).toBe(-50);
    expect(doc.toneLabel).toBe('negativo');
  });

  it('classifica perto de zero como neutro', () => {
    expect(toneLabelFor(0)).toBe('neutro');
    expect(toneLabelFor(14)).toBe('neutro');
    expect(toneLabelFor(15)).toBe('positivo');
    expect(toneLabelFor(-15)).toBe('negativo');
  });
});

describe('pessoas', () => {
  it('conta mencoes, blocos, tom medio e primeiro/ultimo instante', () => {
    const a = block(0, 'Falei com a Ana. A Ana riu.', { kind: 'transcript', startMs: 1000, endMs: 4000 });
    const b = block(1, 'A Ana foi embora.', { kind: 'transcript', startMs: 9000, endMs: 12000 });
    const doc = composeAnalysis({
      blocks: [a, b],
      facts: [fact(a, { tone: 40, people: ['Ana'] }), fact(b, { tone: -60, people: ['Ana'] })],
      model: 'm',
    });
    expect(doc.people).toEqual([
      { name: 'Ana', mentions: 3, blocks: 2, tone: -10, firstMs: 1000, lastMs: 12000 },
    ]);
  });

  it('nao conta o nome dentro de outra palavra', () => {
    const a = block(0, 'na semana passada eu fiquei em casa');
    const doc = composeAnalysis({
      blocks: [a],
      // A extracao ja chega ancorada; a contagem tambem precisa ser por palavra.
      facts: [fact(a, { people: ['Ana'] })],
      model: 'm',
    });
    expect(doc.people[0].mentions).toBe(0);
  });

  it('usa a grafia que o aparelho ja conhece e junta honorifico', () => {
    const a = block(0, 'Dona Maria chegou.');
    const doc = composeAnalysis({
      blocks: [a],
      facts: [fact(a, { people: ['Dona Maria'] })],
      model: 'm',
      known: { people: ['Maria'] },
    });
    expect(doc.people.map((person) => person.name)).toEqual(['Maria']);
    expect(canonicalEntityKey('Dona Maria')).toBe('maria');
  });

  it('ordena por mencoes e corta em oito', () => {
    const blocks = Array.from({ length: 10 }, (_, index) =>
      block(index, `Pessoa${index} apareceu duas vezes: Pessoa${index}.`),
    );
    const doc = composeAnalysis({
      blocks,
      facts: blocks.map((value, index) =>
        fact(value, { people: [`Pessoa${index}`] }),
      ),
      model: 'm',
    });
    expect(doc.people).toHaveLength(8);
    expect(doc.people[0].mentions).toBeGreaterThanOrEqual(doc.people[7].mentions);
  });
});

describe('lugares, emocoes e temas', () => {
  it('junta o mesmo lugar e guarda o primeiro instante', () => {
    const a = block(0, 'Fui a Praia.', { kind: 'transcript', startMs: 500, endMs: 2000 });
    const b = block(1, 'Voltei da praia.', { kind: 'transcript', startMs: 8000, endMs: 9000 });
    const doc = composeAnalysis({
      blocks: [a, b],
      facts: [fact(a, { places: ['Praia'] }), fact(b, { places: ['praia'] })],
      model: 'm',
    });
    expect(doc.places).toEqual([
      { name: 'Praia', mentions: 2, blocks: 2, firstMs: 500, lastMs: 9000 },
    ]);
  });

  it('emocao tem participacao nos blocos lidos e tom medio', () => {
    const blocks = [0, 1, 2, 3].map((index) => block(index, `bloco ${index} com texto`));
    const doc = composeAnalysis({
      blocks,
      facts: [
        fact(blocks[0], { tone: 20, emotions: ['alegria'] }),
        fact(blocks[1], { tone: 60, emotions: ['alegria'] }),
        fact(blocks[2], { tone: -40, emotions: ['tristeza'] }),
        fact(blocks[3], { tone: 0 }),
      ],
      model: 'm',
    });
    expect(doc.emotions).toEqual([
      { name: 'alegria', blocks: 2, share: 0.5, tone: 40 },
      { name: 'tristeza', blocks: 1, share: 0.25, tone: -40 },
    ]);
  });

  it('tema conta blocos', () => {
    const a = block(0, 'trabalho e familia');
    const b = block(1, 'mais trabalho');
    const doc = composeAnalysis({
      blocks: [a, b],
      facts: [
        fact(a, { themes: ['trabalho', 'familia'] }),
        fact(b, { themes: ['trabalho'] }),
      ],
      model: 'm',
    });
    expect(doc.themes).toEqual([
      { name: 'trabalho', blocks: 2 },
      { name: 'familia', blocks: 1 },
    ]);
  });
});

describe('decisoes, tarefas, ideias e eventos', () => {
  it('deduplica frases parecidas e conta repeticoes', () => {
    const a = block(0, 'decidi que vou viajar em julho');
    const b = block(1, 'vou viajar em julho');
    const doc = composeAnalysis({
      blocks: [a, b],
      facts: [
        fact(a, { decisions: ['vou viajar em julho'] }),
        fact(b, { decisions: ['vou viajar em julho com ela'] }),
      ],
      model: 'm',
    });
    expect(doc.decisions).toHaveLength(1);
    expect(doc.decisions[0].blocks).toBe(2);
  });

  it('epifania e deduplicada e conta repeticoes', () => {
    const a = block(0, 'percebi que nunca falei o que eu sentia');
    const b = block(1, 'nunca falei o que eu sentia mesmo');
    const doc = composeAnalysis({
      blocks: [a, b],
      facts: [
        fact(a, { epiphanies: ['nunca falei o que eu sentia'] }),
        fact(b, { epiphanies: ['nunca falei o que eu sentia mesmo'] }),
      ],
      model: 'm',
    });
    expect(doc.epiphanies).toHaveLength(1);
    expect(doc.epiphanies[0].blocks).toBe(2);
  });

  it('evento leva o instante do primeiro bloco de fala', () => {
    const a = block(0, 'enterro da Ana', { kind: 'transcript', startMs: 3000, endMs: 5000 });
    const doc = composeAnalysis({
      blocks: [a],
      facts: [fact(a, { events: ['enterro da Ana'] })],
      model: 'm',
    });
    expect(doc.events).toEqual([{ name: 'enterro da Ana', blocks: 1, startMs: 3000 }]);
  });
});

describe('momentos', () => {
  it('no maximo oito, espalhados e em ordem de leitura', () => {
    const scenes = [
      'praia',
      'mercado',
      'hospital',
      'trabalho',
      'festa',
      'viagem',
      'escola',
      'igreja',
      'familia',
      'cinema',
    ];
    const blocks = Array.from({ length: 10 }, (_, index) =>
      block(index, `cena do ${scenes[index]}`, {
        kind: 'transcript',
        startMs: index * 1000,
        endMs: index * 1000 + 800,
      }),
    );
    const doc = composeAnalysis({
      blocks,
      facts: blocks.map((value) => fact(value, { moments: [value.text], tone: 0 })),
      model: 'm',
    });
    expect(doc.moments).toHaveLength(8);
    expect(doc.moments.map((moment) => moment.blockIndex)).toEqual(
      [...doc.moments.map((moment) => moment.blockIndex)].sort((a, b) => a - b),
    );
    expect(new Set(doc.moments.map((moment) => Math.floor(moment.blockIndex / 2))).size).toBeGreaterThan(1);
  });
});

describe('cobertura', () => {
  it('conta blocos lidos e marca parcial', () => {
    const blocks = [0, 1, 2].map((index) => block(index, `texto ${index}`));
    const doc = composeAnalysis({
      blocks,
      facts: [fact(blocks[0]), fact(blocks[1])],
      model: 'm',
    });
    expect(doc.blocksRead).toBe(2);
    expect(doc.blocksTotal).toBe(3);
    expect(doc.charsRead).toBeLessThan(doc.charsTotal);
    expect(doc.complete).toBe(false);
  });

  it('marca completa quando todos os blocos foram lidos', () => {
    const blocks = [0, 1].map((index) => block(index, `texto ${index}`));
    const doc = composeAnalysis({ blocks, facts: blocks.map((value) => fact(value)), model: 'm' });
    expect(doc.complete).toBe(true);
  });

  it('soma a duracao de audio coberta', () => {
    const a = block(0, 'um', { kind: 'transcript', startMs: 0, endMs: 2000 });
    const b = block(1, 'dois', { kind: 'transcript', startMs: 9000, endMs: 12000 });
    const doc = composeAnalysis({ blocks: [a, b], facts: [fact(a)], model: 'm' });
    expect(doc.audioCoveredMs).toBe(2000);
    expect(doc.audioTotalMs).toBe(5000);
  });
});
