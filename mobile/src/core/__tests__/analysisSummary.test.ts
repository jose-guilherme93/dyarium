import type { AnalysisBlock } from '../analysisPlan';
import type { ComposedAnalysis } from '../analysisCompose';
import {
  acceptSummary,
  buildSummaryMessages,
  derivedSentence,
  focusBlock,
  parseSummaryJson,
  summaryDigest,
} from '../analysisSummary';

function block(index: number, text: string): AnalysisBlock {
  return {
    index,
    kind: index === 0 ? 'transcript' : 'text',
    heading: '',
    text,
    context: '',
    chars: text.length,
    startMs: index === 0 ? 1000 : null,
    endMs: index === 0 ? 2000 : null,
    hash: `h${index}`,
  };
}

const digestBlocks = [block(0, 'ela dormindo no sofa enquanto eu sabia'), block(1, 'fim da nota')];

function doc(partial: Partial<ComposedAnalysis> = {}): ComposedAnalysis {
  return {
    contractVersion: 2,
    model: 'm',
    models: ['m'],
    tone: -40,
    toneLabel: 'negativo',
    sentence: '',
    sentenceSource: 'derived',
    people: [{ name: 'Ana', mentions: 3, blocks: 2, tone: -20, firstMs: 1000, lastMs: 4000 }],
    places: [{ name: 'Praia', mentions: 1, blocks: 1, firstMs: null, lastMs: null }],
    emotions: [{ name: 'saudade', blocks: 2, share: 0.5, tone: -20 }],
    themes: [
      { name: 'familia', blocks: 2 },
      { name: 'viagem', blocks: 1 },
    ],
    events: [{ name: 'enterro da Ana', blocks: 1, startMs: 1000 }],
    decisions: [{ text: 'vou viajar em julho', blocks: 1, startMs: null }],
    tasks: [{ text: 'comprar a passagem', blocks: 1, startMs: null }],
    ideas: [],
    epiphanies: [{ text: 'nunca falei o que eu sentia', blocks: 1, startMs: null }],
    moments: [
      { text: 'ela dormindo no sofa', startMs: 1000, blockIndex: 0, salience: 90 },
    ],
    blocksRead: 2,
    blocksTotal: 2,
    charsRead: 100,
    charsTotal: 100,
    audioCoveredMs: 1000,
    audioTotalMs: 1000,
    complete: true,
    ...partial,
  };
}

describe('frase derivada', () => {
  it('sai dos campos, com tom, pessoa dominante e acontecimento', () => {
    expect(derivedSentence(doc())).toBe(
      'Uma nota de tom negativo, sobre Ana, marcada por enterro da Ana.',
    );
  });

  it('cai para a epifania ou os temas quando nao ha acontecimento', () => {
    expect(derivedSentence(doc({ people: [], themes: [] }))).toBe(
      'Uma nota de tom negativo, marcada por enterro da Ana.',
    );
    expect(derivedSentence(doc({ people: [], themes: [], events: [] }))).toBe(
      'Uma nota de tom negativo, em que nunca falei o que eu sentia.',
    );
    expect(derivedSentence(doc({ people: [], themes: [], events: [], epiphanies: [] }))).toBe(
      'Uma nota de tom negativo.',
    );
  });
});

describe('aceite da frase', () => {
  const source = 'ela dormindo no sofa enquanto eu sabia que ia embora para sempre';

  it('aceita interpretacao curta', () => {
    expect(acceptSummary('Uma despedida anunciada pelo autor, sobre Ana.', source)).toBe(true);
  });

  it('recusa copia do material de origem', () => {
    expect(
      acceptSummary('ela dormindo no sofa enquanto eu sabia que ia embora para sempre', source),
    ).toBe(false);
  });

  it('recusa nome proprio que nao esta nos dados', () => {
    const empty = doc({ people: [], places: [], events: [] });
    const digest = summaryDigest(empty, digestBlocks, { title: 'Nota', author: '' });
    expect(
      acceptSummary('Uma despedida anunciada pelo autor, sobre Ana.', source, digest),
    ).toBe(false);
  });

  it('aceita o nome que veio nos dados', () => {
    const digest = summaryDigest(doc(), digestBlocks, { title: 'Nota', author: '' });
    expect(
      acceptSummary('Uma despedida anunciada pelo autor, sobre Ana.', source, digest),
    ).toBe(true);
  });

  it('recusa frase vazia, longa demais ou com palavras demais', () => {
    expect(acceptSummary('curta', source)).toBe(false);
    expect(acceptSummary('x'.repeat(240), source)).toBe(false);
    expect(acceptSummary(Array.from({ length: 30 }, () => 'palavra').join(' '), source)).toBe(false);
  });
});

describe('parseSummaryJson', () => {
  it('le a frase do formato pedido', () => {
    expect(parseSummaryJson('{"frase":"  Uma despedida.  "}')).toBe('Uma despedida.');
    expect(parseSummaryJson('{"frase":""}')).toBeNull();
    expect(parseSummaryJson('nada')).toBeNull();
  });
});

describe('digest', () => {
  const blocks = [
    block(0, 'ela dormindo no sofa enquanto eu sabia'),
    block(1, 'texto final da nota'),
  ];

  it('leva o resumo dos campos e um trecho limitado', () => {
    const digest = summaryDigest(doc(), blocks, { title: 'Despedida', author: 'Ana' });
    expect(digest.titulo).toBe('Despedida');
    expect(digest.tom).toBe('negativo');
    expect(digest.pessoas).toEqual([{ nome: 'Ana', mencoes: 3 }]);
    expect(digest.temas).toEqual(['familia', 'viagem']);
    expect(digest.epifanias).toEqual(['nunca falei o que eu sentia']);
    expect(digest.momentos).toEqual([{ texto: 'ela dormindo no sofa', tempo: '00:01' }]);
    expect(digest.trecho.length).toBeLessThanOrEqual(403);
    expect(digest.final).toBe('texto final da nota');
  });

  it('sem momento, o foco e o primeiro bloco', () => {
    const focus = focusBlock(doc({ moments: [] }), blocks);
    expect(focus?.index).toBe(0);
  });

  it('o prompt nao cita nome de exemplo para o modelo copiar', () => {
    const messages = buildSummaryMessages({
      digest: summaryDigest(doc(), blocks, { title: 'Despedida', author: 'Ana' }),
    });
    expect(messages[0].content).not.toContain('sobre Ana');
  });

  it('monta uma unica mensagem de sistema com o JSON do digest', () => {
    const messages = buildSummaryMessages({
      digest: summaryDigest(doc(), blocks, { title: 'Despedida', author: 'Ana' }),
    });
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain('UMA frase');
    expect(messages[1].content).toContain('"Ana"');
  });
});
