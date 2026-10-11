import { storageUsage } from '../storage';
import type { Recording } from '../types';

function rec(partial: Partial<Recording>): Recording {
  return {
    id: 'r',
    title: 't',
    recordedAt: '2026-01-01T00:00:00.000Z',
    dir: '',
    segmentCount: 0,
    status: 'completed',
    offset: 0,
    attempts: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('storageUsage', () => {
  it('soma o audio local e conta as sincronizadas', () => {
    const usage = storageUsage([
      rec({ id: 'a', filePath: 'x.aac', sizeBytes: 100, status: 'completed' }),
      rec({ id: 'b', filePath: 'y.aac', sizeBytes: 200, status: 'queued' }),
      rec({ id: 'c', status: 'completed' }),
    ]);
    expect(usage.noteCount).toBe(3);
    expect(usage.withAudio).toBe(2);
    expect(usage.syncedWithAudio).toBe(1);
    expect(usage.audioBytes).toBe(300);
  });

  it('sem audio devolve zeros', () => {
    const usage = storageUsage([rec({ id: 'c', status: 'completed' })]);
    expect(usage.withAudio).toBe(0);
    expect(usage.audioBytes).toBe(0);
  });
});
