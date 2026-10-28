import { activeSegmentIndex, mergeTranscript } from '../transcript';
import {
  hasFinalTranscript,
  needsTranscript,
  shouldAutoTranscribe,
  type Recording,
} from '../types';

function base(overrides: Partial<Recording> = {}): Recording {
  return {
    id: 'r1',
    title: '11/10/2026 00:00',
    recordedAt: '2026-10-11T00:00:00.000Z',
    dir: 'sess/r1',
    segmentCount: 1,
    status: 'completed',
    offset: 0,
    attempts: 0,
    createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z',
    ...overrides,
  };
}

describe('needsTranscript', () => {
  it('precisa quando enviada e sem transcricao pronta', () => {
    expect(needsTranscript(base({ entryId: 'en1' }))).toBe(true);
    expect(needsTranscript(base({ entryId: 'en1', transcriptStatus: 'pending' }))).toBe(true);
  });

  it('nao precisa quando a transcricao ja esta pronta', () => {
    expect(needsTranscript(base({ entryId: 'en1', transcriptStatus: 'ready' }))).toBe(false);
  });

  it('nao precisa em nota escrita (sem audio)', () => {
    expect(
      needsTranscript(
        base({ entryId: 'en1', segmentCount: 0, contentType: 'text/plain', transcriptStatus: 'pending' }),
      ),
    ).toBe(false);
  });

  it('precisa em audio vindo do servidor (content-type de audio)', () => {
    expect(
      needsTranscript(
        base({ entryId: 'en1', segmentCount: 0, contentType: 'audio/mp4', transcriptStatus: 'pending' }),
      ),
    ).toBe(true);
  });

  it('nao precisa sem entryId (ainda nao enviada)', () => {
    expect(needsTranscript(base({ status: 'queued' }))).toBe(false);
  });

  it('nao precisa enquanto nao concluiu o envio', () => {
    expect(needsTranscript(base({ entryId: 'en1', status: 'uploading' }))).toBe(false);
  });
});

describe('activeSegmentIndex', () => {
  const segments = [
    { start_ms: 0, end_ms: 1000, text: 'a' },
    { start_ms: 1000, end_ms: 2500, text: 'b' },
    { start_ms: 2500, end_ms: 4000, text: 'c' },
  ];

  it('devolve o segmento que ja comecou', () => {
    expect(activeSegmentIndex(segments, 0)).toBe(0);
    expect(activeSegmentIndex(segments, 1200)).toBe(1);
    expect(activeSegmentIndex(segments, 9999)).toBe(2);
  });

  it('devolve -1 antes do primeiro segmento ou sem segmentos', () => {
    expect(activeSegmentIndex([{ start_ms: 800, end_ms: 900, text: 'x' }], 200)).toBe(-1);
    expect(activeSegmentIndex([], 500)).toBe(-1);
  });
});

describe('mergeTranscript', () => {
  it('preserva a transcricao local pronta durante o upload (nao volta para pending)', () => {
    const target = base({ status: 'completed', entryId: 'en1' });
    const fresh = base({
      transcript: 'texto pronto',
      transcriptSegments: [{ start_ms: 0, end_ms: 1000, text: 'texto pronto' }],
      transcriptStatus: 'ready',
      transcriptOrigin: 'local',
      hasTranscript: true,
    });
    const merged = mergeTranscript(target, fresh);
    expect(merged.transcriptStatus).toBe('ready');
    expect(merged.transcript).toBe('texto pronto');
    expect(merged.hasTranscript).toBe(true);
    expect(merged.transcriptOrigin).toBe('local');
  });

  it('marca pending quando ainda nao ha transcricao', () => {
    const merged = mergeTranscript(base({ status: 'completed' }), base({}));
    expect(merged.transcriptStatus).toBe('pending');
  });

  it('trata texto sem status como pronto', () => {
    const merged = mergeTranscript(base({}), base({ transcript: 'oi' }));
    expect(merged.transcriptStatus).toBe('ready');
  });
});

/**
 * O acervo e varrido no boot e em segundo plano. Uma nota que o servidor ja
 * transcreveu nao pode ser transcrita de novo no aparelho so porque o modelo
 * local foi baixado depois.
 */
describe('hasFinalTranscript', () => {
  it('conta texto do servidor e texto local como prontos', () => {
    expect(hasFinalTranscript(base({ transcriptStatus: 'ready' }))).toBe(true);
    expect(hasFinalTranscript(base({ hasTranscript: true }))).toBe(true);
    expect(hasFinalTranscript(base({ transcriptStatus: 'pending' }))).toBe(false);
  });
});

describe('shouldAutoTranscribe', () => {
  const audio = { filePath: '/a.aac', status: 'completed' as const };

  it('transcreve o audio nosso que ainda nao tem texto', () => {
    expect(shouldAutoTranscribe(base({ ...audio }))).toBe(true);
    expect(shouldAutoTranscribe(base({ ...audio, entryId: 'en1', transcriptOrigin: 'local' }))).toBe(
      true,
    );
  });

  it('nunca refaz nota que o servidor transcreveu', () => {
    expect(
      shouldAutoTranscribe(
        base({ ...audio, entryId: 'en1', transcriptStatus: 'ready', transcriptOrigin: 'server' }),
      ),
    ).toBe(false);
    // Mesmo sem a marca explicita: o texto pronto basta.
    expect(
      shouldAutoTranscribe(base({ ...audio, entryId: 'en1', transcriptStatus: 'ready' })),
    ).toBe(false);
  });

  it('espera o servidor quando a nota ja esta la sem marca de posse local', () => {
    expect(shouldAutoTranscribe(base({ ...audio, entryId: 'en1', transcriptStatus: 'pending' }))).toBe(
      false,
    );
    expect(
      shouldAutoTranscribe(
        base({ ...audio, entryId: 'en1', transcriptStatus: 'pending', transcriptOrigin: 'server' }),
      ),
    ).toBe(false);
  });

  it('nao mexe em nota sem audio local', () => {
    expect(shouldAutoTranscribe(base({ entryId: 'en1' }))).toBe(false);
  });
});
