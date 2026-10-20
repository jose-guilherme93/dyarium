import { analysisContentHash } from '../analysisPrompt';
import {
  buildMetricsReport,
  metricsRange,
  type AnalysisFact,
} from '../metrics';
import type { Recording, ServerAudio } from '../types';

function base(overrides: Partial<Recording> = {}): Recording {
  return {
    id: 'r1',
    title: 'Nota',
    recordedAt: '2026-10-19T12:00:00.000Z',
    dir: '',
    segmentCount: 0,
    status: 'completed',
    offset: 0,
    attempts: 0,
    createdAt: '2026-10-19T12:00:00.000Z',
    updatedAt: '2026-10-19T12:00:00.000Z',
    ...overrides,
  };
}

function audio(overrides: Partial<ServerAudio> = {}): ServerAudio {
  return {
    id: 'a1',
    content_type: 'audio/aac',
    size_bytes: 1,
    duration_seconds: 60,
    created_at: '2026-10-19T12:00:00.000Z',
    ...overrides,
  };
}

const now = new Date('2026-10-19T18:00:00.000Z');

describe('metricsRange', () => {
  it('fecha a janela no dia de hoje e inclui o dia inteiro', () => {
    expect(metricsRange('7d', now).from.getDate()).toBe(13);
    expect(metricsRange('7d', now).to.getTime()).toBe(now.getTime());
    expect(metricsRange('365d', now).from.getFullYear()).toBe(2025);
  });
});

describe('buildMetricsReport', () => {
  it('recorta as tres janelas pela data do evento', () => {
    const report = buildMetricsReport({
      now,
      recordings: [
        base({ id: 'a', recordedAt: '2026-10-18T12:00:00.000Z', text: 'um dois' }),
        base({ id: 'b', recordedAt: '2026-10-05T12:00:00.000Z', text: 'tres quatro cinco' }),
        base({ id: 'c', recordedAt: '2026-06-01T12:00:00.000Z', text: 'seis' }),
        base({ id: 'd', recordedAt: '2025-01-01T12:00:00.000Z', text: 'fora' }),
      ],
    });

    expect(report.windows['7d'].writing.notes).toBe(1);
    expect(report.windows['30d'].writing.notes).toBe(2);
    expect(report.windows['365d'].writing.notes).toBe(3);
    expect(report.windows['7d'].writing.words).toBe(2);
    expect(report.windows['30d'].writing.words).toBe(5);
    expect(report.windows['365d'].writing.words).toBe(6);
    expect(report.windows['7d'].from).toBe('2026-10-13');
    expect(report.windows['7d'].to).toBe('2026-10-19');
  });

  it('usa created_at quando recorded_at nao e uma data', () => {
    const report = buildMetricsReport({
      now,
      recordings: [
        base({
          id: 'sem-data',
          recordedAt: 'nao-e-data',
          createdAt: '2026-10-19T10:00:00.000Z',
          text: 'hoje',
        }),
      ],
    });
    expect(report.windows['7d'].writing.notes).toBe(1);
  });

  it('separa texto escrito de fala transcrita', () => {
    const report = buildMetricsReport({
      now,
      recordings: [
        base({ id: 'texto', text: 'duas palavras' }),
        base({
          id: 'audio',
          filePath: 'file://a.aac',
          durationMs: 60_000,
          transcript: 'falei tres palavras',
          transcriptOrigin: 'local',
        }),
      ],
    });

    const writing = report.windows['7d'].writing;
    expect(writing.notes).toBe(2);
    expect(writing.withText).toBe(1);
    expect(writing.withAudio).toBe(1);
    expect(writing.withTranscript).toBe(1);
    expect(writing.words).toBe(2);
    expect(report.windows['7d'].voice.words).toBe(3);
    expect(report.windows['7d'].voice.transcriptShare).toBeCloseTo(3 / 5);
  });

  it('agrega voz local e do servidor sem contar o audio duas vezes', () => {
    const report = buildMetricsReport({
      now,
      recordings: [
        base({
          id: 'local',
          filePath: 'file://local.aac',
          durationMs: 120_000,
          transcript: 'uma duas tres quatro',
          transcriptOrigin: 'local',
        }),
        base({
          id: 'servidor',
          serverAudios: [
            audio({ id: 's1', duration_seconds: 180, transcript: { text: 'cinco seis sete oito nove' } }),
            audio({ id: 's2', duration_seconds: 60 }),
          ],
        }),
      ],
    });

    const voice = report.windows['7d'].voice;
    expect(voice.audioCount).toBe(3);
    expect(voice.audioMinutes).toBe(6);
    expect(voice.transcribedMinutes).toBe(5);
    expect(voice.coverage).toBeCloseTo(300 / 360);
    expect(voice.words).toBe(9);
    expect(voice.wordsPerMinute).toBeCloseTo(1.8);
    expect(voice.wordsPerAudio).toBeCloseTo(4.5);
    expect(voice.originLocal).toBe(1);
    expect(voice.originServer).toBe(1);
    expect(report.windows['7d'].writing.withAudio).toBe(2);
    expect(report.windows['7d'].writing.withTranscript).toBe(2);
  });

  it('conta imagens, bytes e notas com imagem sem apoio de texto', () => {
    const report = buildMetricsReport({
      now,
      imageBytes: { i1: 1_000, i2: 500 },
      recordings: [
        base({ id: 'i1', text: 'veja ![a](local:a.jpg) e ![b](local:b.jpg)' }),
        base({ id: 'i2', text: '![c](local:c.jpg)' }),
      ],
    });

    const images = report.windows['7d'].images;
    expect(images.count).toBe(3);
    expect(images.notesWithImage).toBe(2);
    expect(images.notesWithImageNoText).toBe(1);
    expect(images.bytesTotal).toBe(1_500);
    expect(images.bytesAverage).toBe(500);
    expect(images.perNote).toBe(1.5);
  });

  it('mede cobertura e desatualizacao da analise', () => {
    const hash = analysisContentHash({ title: 'Dia bom', text: 'hoje foi bom' });
    const facts: AnalysisFact[] = [
      {
        entryId: 'r1',
        origin: 'local',
        contentHash: hash,
        model: 'qwen',
        sentiment: 0.6,
        sentimentLabel: 'positivo',
      },
      {
        entryId: 'r2',
        origin: 'local',
        contentHash: 'hash-antigo',
        model: 'qwen',
        sentiment: -0.2,
        sentimentLabel: 'negativo',
      },
      {
        entryId: 'r4',
        origin: 'server',
        createdAt: '2026-10-10T12:00:00.000Z',
        model: 'local-fallback',
        sentiment: 0,
      },
    ];

    const report = buildMetricsReport({
      now,
      analyses: facts,
      recordings: [
        base({ id: 'r1', title: 'Dia bom', text: 'hoje foi bom' }),
        base({ id: 'r2', text: 'hoje foi ruim' }),
        base({ id: 'r3', text: 'sem analise' }),
        base({
          id: 'r4',
          text: 'nota do servidor',
          updatedAt: '2026-10-19T12:00:00.000Z',
        }),
      ],
    });

    const analysis = report.windows['7d'].analysis;
    expect(analysis.notesWithContent).toBe(4);
    expect(analysis.notesAnalyzed).toBe(3);
    expect(analysis.coverage).toBe(0.75);
    expect(analysis.stale).toBe(2);
    expect(analysis.simplified).toBe(1);
    expect(analysis.lastAnalyzedAt).toBe('2026-10-10T12:00:00.000Z');
  });

  it('usa a analise como fonte de sentimento e agrega emocoes', () => {
    const report = buildMetricsReport({
      now,
      analyses: [
        {
          entryId: 'a',
          origin: 'server',
          sentiment: 0.8,
          sentimentLabel: 'positivo',
          emotions: { alegria: 0.9, calma: 0.4 },
        },
        {
          entryId: 'b',
          origin: 'server',
          sentiment: -0.5,
          sentimentLabel: 'negativo',
          emotions: { tristeza: 0.8 },
        },
      ],
      recordings: [base({ id: 'a', text: 'dia bom' }), base({ id: 'b', text: 'dia ruim' })],
    });

    const sentiment = report.windows['7d'].sentiment;
    expect(sentiment.source).toBe('analysis');
    expect(sentiment.analyzed).toBe(2);
    expect(sentiment.positive).toBe(1);
    expect(sentiment.negative).toBe(1);
    expect(sentiment.average).toBeCloseTo(0.15);
    expect(sentiment.topPositive?.title).toBe('Nota');
    expect(sentiment.topNegative?.title).toBe('Nota');
    expect(sentiment.emotions.map((item) => item.label).sort()).toEqual([
      'alegria',
      'calma',
      'tristeza',
    ]);
    expect(sentiment.emotions.find((item) => item.label === 'alegria')?.tone).toBe('positive');
    expect(sentiment.emotions.find((item) => item.label === 'tristeza')?.tone).toBe('negative');
    expect(sentiment.series).toHaveLength(7);
    expect(sentiment.series.reduce((total, point) => total + point.notes, 0)).toBe(2);
  });

  it('cai para o lexico local quando nao ha analise e nao mistura as fontes', () => {
    const lexical = buildMetricsReport({
      now,
      recordings: [
        base({ id: 'a', text: 'que dia maravilhoso' }),
        base({ id: 'b', text: 'dia triste' }),
        base({ id: 'c', text: 'sem sinal' }),
      ],
    });
    expect(lexical.windows['7d'].sentiment.source).toBe('lexical');
    expect(lexical.windows['7d'].sentiment.analyzed).toBe(3);
    expect(lexical.windows['7d'].sentiment.positive).toBe(1);
    expect(lexical.windows['7d'].sentiment.negative).toBe(1);

    const mixed = buildMetricsReport({
      now,
      analyses: [{ entryId: 'a', origin: 'server', sentiment: 0.9, sentimentLabel: 'positivo' }],
      recordings: [
        base({ id: 'a', text: 'dia triste' }),
        base({ id: 'b', text: 'dia maravilhoso' }),
      ],
    });
    expect(mixed.windows['7d'].sentiment.source).toBe('analysis');
    expect(mixed.windows['7d'].sentiment.analyzed).toBe(1);
  });

  it('agrega temas, pessoas e lugares das analises da janela', () => {
    const report = buildMetricsReport({
      now,
      recordings: [
        base({ id: 'a', text: 'trabalho com Ana' }),
        base({ id: 'c', text: 'outra conversa com Ana' }),
        base({ id: 'b', recordedAt: '2026-09-01T12:00:00.000Z', text: 'viagem' }),
      ],
      analyses: [
        {
          entryId: 'a',
          sentiment: 0.2,
          themes: ['trabalho', 'família'],
          people: ['Ana'],
          places: ['escritório'],
        },
        {
          entryId: 'c',
          sentiment: 0.1,
          themes: ['trabalho'],
          people: ['Ana'],
          places: [],
        },
        {
          entryId: 'b',
          sentiment: 0,
          themes: ['viagem'],
          people: [],
          places: ['praia'],
        },
      ],
    });

    expect(report.windows['7d'].topics.themes).toEqual([
      { label: 'trabalho', count: 2 },
      { label: 'família', count: 1 },
    ]);
    expect(report.windows['7d'].topics.people).toEqual([{ label: 'Ana', count: 2 }]);
    expect(report.windows['7d'].topics.places).toEqual([{ label: 'escritório', count: 1 }]);
    expect(report.windows['365d'].topics.themes).toContainEqual({ label: 'viagem', count: 1 });
  });

  it('compara com a janela anterior e monta no maximo tres frases', () => {
    const hundred = 'um dois tres quatro cinco seis sete oito nove dez';
    const report = buildMetricsReport({
      now,
      recordings: [
        base({ id: 'atual', recordedAt: '2026-10-17T12:00:00.000Z', text: hundred }),
        base({ id: 'anterior', recordedAt: '2026-09-09T12:00:00.000Z', text: 'um dois tres quatro cinco' }),
        base({
          id: 'voz',
          recordedAt: '2026-10-18T12:00:00.000Z',
          filePath: 'file://voz.aac',
          durationMs: 120_000,
          transcript: 'uma duas tres',
          transcriptOrigin: 'local',
        }),
      ],
    });

    const summary = report.windows['30d'].summary;
    expect(summary[0]).toContain('10 palavras em 1 nota');
    expect(summary[0]).toContain('100% mais que nos 30 dias anteriores');
    expect(summary[1]).toContain('Você gravou 2 min e transcreveu tudo');
    expect(summary).toHaveLength(3);
  });

  it('omite a variacao quando a janela anterior nao tem base', () => {
    const report = buildMetricsReport({
      now,
      recordings: [base({ text: 'um dois tres quatro cinco' })],
    });
    expect(report.windows['30d'].summary[0]).toBe('Você escreveu 5 palavras em 1 nota.');
  });

  it('calcula a sequencia no historico completo, nao na janela', () => {
    const report = buildMetricsReport({
      now,
      recordings: [
        base({ id: '1', recordedAt: '2026-10-15T12:00:00.000Z', text: 'a' }),
        base({ id: '2', recordedAt: '2026-10-16T12:00:00.000Z', text: 'b' }),
        base({ id: '3', recordedAt: '2026-10-17T12:00:00.000Z', text: 'c' }),
        base({ id: '4', recordedAt: '2026-10-18T12:00:00.000Z', text: 'd' }),
        base({ id: '5', recordedAt: '2026-10-19T12:00:00.000Z', text: 'e' }),
        base({ id: 'antiga', recordedAt: '2026-08-01T12:00:00.000Z', text: 'f' }),
      ],
    });

    expect(report.streak.current).toBe(5);
    expect(report.streak.longest).toBe(5);
    expect(report.streak.wroteToday).toBe(true);
    expect(report.windows['7d'].writing.notes).toBe(5);
  });
});
