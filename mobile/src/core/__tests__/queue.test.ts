import {
  isDue,
  markCompleted,
  markDead,
  markFailed,
  markProgress,
  markQueued,
  markRecorded,
  markUploading,
  pickNextToUpload,
} from '../queue';
import { canRetry, type Recording } from '../types';

function base(overrides: Partial<Recording> = {}): Recording {
  return {
    id: 'r1',
    title: '10/10/2026 21:00',
    recordedAt: '2026-10-10T21:00:00.000Z',
    dir: 'sess/r1',
    segmentCount: 3,
    status: 'recorded',
    offset: 0,
    attempts: 0,
    createdAt: '2026-10-10T21:00:00.000Z',
    updatedAt: '2026-10-10T21:00:00.000Z',
    ...overrides,
  };
}

const NOW = new Date('2026-10-10T22:00:00.000Z');

describe('transicoes da fila', () => {
  it('markRecorded guarda arquivo, tamanho e duracao', () => {
    const r = markRecorded(base(), 'sess/r1/recording.aac', 4096, 65_000, NOW);
    expect(r.status).toBe('recorded');
    expect(r.filePath).toBe('sess/r1/recording.aac');
    expect(r.sizeBytes).toBe(4096);
    expect(r.durationMs).toBe(65_000);
  });

  it('markQueued coloca na fila', () => {
    expect(markQueued(base(), NOW).status).toBe('queued');
  });

  it('markUploading e markProgress guardam offset', () => {
    const up = markUploading(base(), 'up_1', 0, NOW);
    expect(up.status).toBe('uploading');
    expect(up.uploadId).toBe('up_1');
    expect(markProgress(up, 2048, NOW).offset).toBe(2048);
  });

  it('markCompleted limpa erro e agenda', () => {
    const failed = { ...base(), lastError: 'x', nextAttemptAt: '2026-10-10T23:00:00.000Z' };
    const done = markCompleted(failed, 'en_1', NOW);
    expect(done.status).toBe('completed');
    expect(done.entryId).toBe('en_1');
    expect(done.lastError).toBeUndefined();
    expect(done.nextAttemptAt).toBeUndefined();
  });

  it('markFailed incrementa tentativas e agenda retry', () => {
    const failed = markFailed(base(), 'rede', NOW);
    expect(failed.status).toBe('failed');
    expect(failed.attempts).toBe(1);
    expect(failed.lastError).toBe('rede');
    expect(failed.nextAttemptAt).toBe('2026-10-10T22:00:02.000Z'); // base 2s
  });

  it('markDead nao agenda nova tentativa automatica', () => {
    const dead = markDead(base(), 'formato nao suportado', NOW);
    expect(dead.status).toBe('dead');
    expect(dead.attempts).toBe(1);
    expect(dead.lastError).toBe('formato nao suportado');
    expect(dead.nextAttemptAt).toBeUndefined();
  });
});

describe('isDue', () => {
  it('queued sem agenda esta devido', () => {
    expect(isDue(base({ status: 'queued' }), NOW)).toBe(true);
  });
  it('failed respeita nextAttemptAt', () => {
    expect(
      isDue(base({ status: 'failed', nextAttemptAt: '2026-10-10T21:59:00.000Z' }), NOW),
    ).toBe(true);
    expect(
      isDue(base({ status: 'failed', nextAttemptAt: '2026-10-10T22:01:00.000Z' }), NOW),
    ).toBe(false);
  });
  it('completed nunca esta devido', () => {
    expect(isDue(base({ status: 'completed' }), NOW)).toBe(false);
  });
  it('dead nunca esta devido (falha permanente)', () => {
    expect(isDue(base({ status: 'dead' }), NOW)).toBe(false);
  });
});

describe('pickNextToUpload', () => {
  it('prioriza uma retomada (uploading)', () => {
    const uploading = base({ id: 'up', status: 'uploading' });
    const queued = base({ id: 'q', status: 'queued' });
    expect(pickNextToUpload([queued, uploading], NOW)?.id).toBe('up');
  });

  it('escolhe a mais antiga entre as devidas', () => {
    const older = base({ id: 'a', status: 'queued', createdAt: '2026-10-10T20:00:00.000Z' });
    const newer = base({ id: 'b', status: 'queued', createdAt: '2026-10-10T21:00:00.000Z' });
    expect(pickNextToUpload([newer, older], NOW)?.id).toBe('a');
  });

  it('ignora as que nao estao devidas', () => {
    const notDue = base({ id: 'x', status: 'failed', nextAttemptAt: '2026-10-11T00:00:00.000Z' });
    expect(pickNextToUpload([notDue], NOW)).toBeUndefined();
  });

  it('ignora as mortas (falha permanente)', () => {
    expect(pickNextToUpload([base({ id: 'd', status: 'dead' })], NOW)).toBeUndefined();
  });
});

describe('canRetry', () => {
  it('permite reenviar estados com envio pendente', () => {
    for (const status of ['recorded', 'queued', 'uploading', 'failed', 'dead'] as const) {
      expect(canRetry(base({ status }))).toBe(true);
    }
  });

  it('nao reenvia o que ja foi enviado nem gravacao ativa', () => {
    expect(canRetry(base({ status: 'completed' }))).toBe(false);
    expect(canRetry(base({ status: 'recording' }))).toBe(false);
    expect(canRetry(base({ status: 'interrupted' }))).toBe(false);
  });
});
