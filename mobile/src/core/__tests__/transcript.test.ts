import { needsTranscript, type Recording } from '../types';

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

  it('nao precisa quando a transcricao falhou de vez', () => {
    expect(needsTranscript(base({ entryId: 'en1', transcriptStatus: 'failed' }))).toBe(false);
  });

  it('precisa para uma nota que so existe no servidor', () => {
    expect(needsTranscript(base({ entryId: 'en1', status: 'remote' }))).toBe(true);
  });

  it('nao precisa sem entryId (ainda nao enviada)', () => {
    expect(needsTranscript(base({ status: 'queued' }))).toBe(false);
  });

  it('nao precisa enquanto nao concluiu o envio', () => {
    expect(needsTranscript(base({ entryId: 'en1', status: 'uploading' }))).toBe(false);
  });
});
