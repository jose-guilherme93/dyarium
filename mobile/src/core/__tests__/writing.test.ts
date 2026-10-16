import type { Recording } from '../types';
import { analyzeWriting, plainText } from '../writing';

function base(overrides: Partial<Recording> = {}): Recording {
  return {
    id: 'r1',
    title: 'Nota',
    recordedAt: '2026-10-10T12:00:00.000Z',
    dir: '',
    segmentCount: 0,
    status: 'completed',
    offset: 0,
    attempts: 0,
    createdAt: '2026-10-10T12:00:00.000Z',
    updatedAt: '2026-10-10T12:00:00.000Z',
    ...overrides,
  };
}

const norm = (value: string) => value.replace(/\s+/g, ' ').trim();

describe('plainText', () => {
  it('tira markdown e mantem as palavras (links viram rotulo)', () => {
    expect(norm(plainText('**oi** _mundo_'))).toBe('oi mundo');
    expect(norm(plainText('veja [aqui](https://x)'))).toBe('veja aqui');
    expect(norm(plainText('![foto](local:a.jpg) depois'))).toBe('depois');
    expect(norm(plainText('- item\n- outro'))).toBe('item outro');
  });
});

describe('analyzeWriting', () => {
  const now = new Date('2026-10-10T12:00:00.000Z');

  it('conta palavras, frases, unicas e a palavra mais usada', () => {
    const metrics = analyzeWriting(
      [base({ text: 'O projeto cresceu. O projeto vai bem! Você viu?' })],
      now,
    );
    expect(metrics.withText).toBe(1);
    expect(metrics.words).toBe(9);
    expect(metrics.sentences).toBe(3);
    expect(metrics.questions).toBe(1);
    expect(metrics.exclamations).toBe(1);
    expect(metrics.topWords[0]).toEqual({ label: 'projeto', value: 2 });
    expect(metrics.longestNote?.words).toBe(9);
    expect(metrics.lexicalRichness).toBeGreaterThan(0);
  });

  it('conta imagens, links e listas', () => {
    const metrics = analyzeWriting(
      [base({ text: 'veja ![foto](local:a.jpg) e [aqui](https://x)!\n- item' })],
      now,
    );
    expect(metrics.images).toBe(1);
    expect(metrics.links).toBe(1);
    expect(metrics.listItems).toBe(1);
    // um "!" e da exclamação; o outro e da imagem (nao conta)
    expect(metrics.exclamations).toBe(1);
  });

  it('separa escrita de transcricao', () => {
    const metrics = analyzeWriting(
      [base({ text: 'duas palavras', transcript: 'uma fala bem maior aqui', filePath: 'file://a' })],
      now,
    );
    expect(metrics.withAudio).toBe(1);
    expect(metrics.withText).toBe(1);
    expect(metrics.withTranscript).toBe(1);
    expect(metrics.words).toBe(2);
    expect(metrics.transcriptWords).toBe(5);
    expect(metrics.averageTranscriptWords).toBe(5);
  });

  it('calcula dias ativos e sequencia', () => {
    const metrics = analyzeWriting(
      [
        base({ id: 'a', recordedAt: '2026-10-01T12:00:00.000Z' }),
        base({ id: 'b', recordedAt: '2026-10-02T12:00:00.000Z' }),
        base({ id: 'c', recordedAt: '2026-10-03T12:00:00.000Z' }),
        base({ id: 'd', recordedAt: '2026-10-05T12:00:00.000Z' }),
      ],
      new Date('2026-10-05T18:00:00.000Z'),
    );
    expect(metrics.activeDays).toBe(4);
    expect(metrics.longestStreak).toBe(3);
    expect(metrics.currentStreak).toBe(1);
  });

  it('nao quebra sem dados', () => {
    const metrics = analyzeWriting([], now);
    expect(metrics.notes).toBe(0);
    expect(metrics.words).toBe(0);
    expect(metrics.topWords).toEqual([]);
    expect(metrics.insights).toEqual([]);
    expect(metrics.topWeekday).toBeNull();
  });

  it('gera insights sobre a escrita', () => {
    const metrics = analyzeWriting(
      [base({ text: 'escrevi bastante sobre o projeto hoje mesmo' })],
      now,
    );
    expect(metrics.insights.length).toBeGreaterThan(0);
    expect(metrics.insights[0]).toContain('palavras');
  });
});
