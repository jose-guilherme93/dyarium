import { dismissActivity, getActivitiesSnapshot } from '../activity';
import {
  finishServerTranscription,
  trackServerTranscription,
} from '../remoteTranscription';
import type { Recording } from '@/core/types';

jest.mock('../db', () => ({
  saveActivityRow: jest.fn(async () => undefined),
  listActivityRows: jest.fn(async () => []),
  deleteActivityRow: jest.fn(async () => undefined),
  deleteFinishedActivityRows: jest.fn(async () => undefined),
  markActivityRowsSeen: jest.fn(async () => undefined),
  pruneActivityRows: jest.fn(async () => undefined),
}));

function recording(overrides: Partial<Recording> = {}): Recording {
  return {
    id: 'r1',
    title: 'Nota no servidor',
    recordedAt: '2026-11-14T10:00:00.000Z',
    dir: '',
    segmentCount: 1,
    status: 'completed',
    offset: 0,
    attempts: 0,
    entryId: 'e1',
    filePath: 'file:///a.aac',
    createdAt: '2026-11-14T10:00:00.000Z',
    updatedAt: '2026-11-14T10:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  for (const activity of getActivitiesSnapshot()) dismissActivity(activity.id);
});

describe('transcricao no servidor', () => {
  it('mostra a nota como No servidor, sem inventar porcentagem', () => {
    trackServerTranscription(recording());

    const [activity] = getActivitiesSnapshot();
    expect(activity).toMatchObject({
      id: 'transcription:r1',
      kind: 'transcription',
      status: 'running',
      detail: 'No servidor',
    });
    expect(activity?.progress).toBeUndefined();
  });

  it('acompanhar de novo nao reinicia o cronometro', () => {
    trackServerTranscription(recording());
    const first = getActivitiesSnapshot()[0];

    trackServerTranscription(recording());

    const [second] = getActivitiesSnapshot();
    expect(second?.startedAt).toBe(first?.startedAt);
    expect(getActivitiesSnapshot()).toHaveLength(1);
  });

  it('fecha a atividade quando o texto chega', () => {
    trackServerTranscription(recording());
    finishServerTranscription('r1');

    expect(getActivitiesSnapshot()[0]).toMatchObject({
      status: 'done',
      detail: 'Transcrição pronta',
    });
  });

  it('nota que ainda nao subiu nao cria atividade', () => {
    trackServerTranscription(recording({ entryId: undefined }));

    expect(getActivitiesSnapshot()).toHaveLength(0);
  });
});
