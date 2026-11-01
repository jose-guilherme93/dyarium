import type { EntityLink, GraphEntry, GraphEntity } from '../graphModel';
import {
  buildEntityPanel,
  formatExcerptTime,
  formatNoteDate,
} from '../graphPanel';

const maria: GraphEntity = {
  id: 'e-maria',
  kind: 'person',
  name: 'Maria',
  icon: '',
  updatedAt: '',
};

function entry(id: string, recordedAt: string, extra: Partial<GraphEntry> = {}): GraphEntry {
  return {
    id,
    title: `Nota ${id}`,
    recordedAt,
    notebookId: 'nb',
    ...extra,
  };
}

const links: EntityLink[] = [
  { entryId: 'n1', entityId: 'e-maria', count: 3, sentiment: 0.4, relation: 'irmã' },
  { entryId: 'n2', entityId: 'e-maria', count: 1, sentiment: 0.2 },
  { entryId: 'n3', entityId: 'e-outra', count: 1 },
];

describe('buildEntityPanel', () => {
  it('junta os trechos da transcrição e do texto onde a entidade aparece', () => {
    const entries = [
      entry('n1', '2026-10-20T10:00:00Z', {
        analysis: { reading: 'Fala sobre a irmã.', summary: 'resumo' } as never,
        transcriptSegments: [
          { start_ms: 1500, end_ms: 3000, text: 'Falei com a Maria hoje.' },
          { start_ms: 3000, end_ms: 4000, text: 'Nada a ver.' },
        ],
        text: 'A Maria ligou de manhã. Depois fui ao mercado.',
      }),
      entry('n2', '2026-10-21T10:00:00Z', {
        transcriptSegments: [{ start_ms: 500, end_ms: 900, text: 'Maria chegou.' }],
      }),
    ];

    const panel = buildEntityPanel(maria, entries, links);

    expect(panel.mentions).toBe(4);
    expect(panel.notes).toBe(2);
    expect(panel.sentiment).toBeCloseTo(0.3);
    expect(panel.lastSeen).toBe('2026-10-21T10:00:00Z');

    const transcript = panel.excerpts.filter((excerpt) => excerpt.source === 'transcript');
    const text = panel.excerpts.filter((excerpt) => excerpt.source === 'text');
    expect(transcript.map((excerpt) => excerpt.text)).toEqual([
      'Maria chegou.',
      'Falei com a Maria hoje.',
    ]);
    expect(text.map((excerpt) => excerpt.text)).toEqual(['A Maria ligou de manhã.']);
    expect(panel.excerpts.find((excerpt) => excerpt.text.includes('Falei'))).toMatchObject({
      entryId: 'n1',
      startMs: 1500,
      comment: 'Fala sobre a irmã.',
    });
    // A lista da folha mostra todas as notas, não só as que têm trecho.
    expect(panel.notesList.map((note) => note.entryId)).toEqual(['n2', 'n1']);
  });

  it('encontra a grafia antiga resolvida por alias', () => {
    const entries = [
      entry('n1', '2026-10-20T10:00:00Z', {
        transcriptSegments: [{ start_ms: 0, end_ms: 100, text: 'Mariana contou tudo.' }],
      }),
    ];
    const panel = buildEntityPanel(maria, entries, links, ['Mariana']);
    expect(panel.excerpts[0]).toMatchObject({ term: 'Mariana', source: 'transcript' });
  });

  it('não inventa trecho quando o nome não aparece', () => {
    const entries = [
      entry('n1', '2026-10-20T10:00:00Z', {
        transcriptSegments: [{ start_ms: 0, end_ms: 100, text: 'Fui ao mercado.' }],
      }),
    ];
    const panel = buildEntityPanel(maria, entries, links);
    expect(panel.excerpts).toHaveLength(0);
    expect(panel.notesList).toHaveLength(1);
  });

  it('lista todas as notas da relação, sem cortar nem agrupar errado', () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      entry(`n${index}`, '2026-10-20T10:00:00Z', {
        transcriptSegments: [
          { start_ms: 0, end_ms: 100, text: 'Maria uma.' },
          { start_ms: 100, end_ms: 200, text: 'Maria duas.' },
          { start_ms: 200, end_ms: 300, text: 'Maria três.' },
        ],
      }),
    );
    const manyLinks: EntityLink[] = many.map((item) => ({
      entryId: item.id,
      entityId: 'e-maria',
      count: 1,
    }));
    const panel = buildEntityPanel(maria, many, manyLinks);
    expect(panel.notesList).toHaveLength(20);
    expect(panel.groups).toHaveLength(20);
    // Todas as referências: os 3 trechos de cada nota.
    expect(panel.excerpts).toHaveLength(60);
    for (const group of panel.groups) expect(group.items).toHaveLength(3);
  });
});

describe('formatExcerptTime', () => {
  it('formata o instante do áudio como m:ss', () => {
    expect(formatExcerptTime(0)).toBe('0:00');
    expect(formatExcerptTime(65_000)).toBe('1:05');
  });

  it('marca trecho escrito sem tempo', () => {
    expect(formatExcerptTime(undefined)).toBe('texto');
  });
});

describe('formatNoteDate', () => {
  it('mostra dd/mm/aa e ignora data inválida', () => {
    expect(formatNoteDate('2026-10-20T10:00:00Z')).toMatch(/^20\/10\/26$/);
    expect(formatNoteDate(undefined)).toBe('');
    expect(formatNoteDate('nao-e-data')).toBe('');
  });
});
