import type { Recording } from '@/core/types';

import { fetchTranscriptsOnce, refreshServerTranscript } from '../transcripts';

const mockListRecordings = jest.fn<Promise<Recording[]>, []>();
const mockGetRecording = jest.fn<Promise<Recording | null>, [string]>();
const mockUpsertRecording = jest.fn<Promise<void>, [Recording]>();
const mockGetTranscript = jest.fn();
const mockLoadServerConfig = jest.fn();
const mockEmitRecording = jest.fn();
const mockNotify = jest.fn();

jest.mock('../db', () => ({
  listRecordings: () => mockListRecordings(),
  getRecording: (...args: [string]) => mockGetRecording(...args),
  upsertRecording: (...args: [Recording]) => mockUpsertRecording(...args),
}));

jest.mock('../secure', () => ({
  loadServerConfig: () => mockLoadServerConfig(),
}));

jest.mock('../uploaderLoop', () => ({
  emitRecording: (...args: [Recording]) => mockEmitRecording(...args),
}));

jest.mock('../notifications', () => ({
  notify: (...args: [string, string]) => mockNotify(...args),
}));

jest.mock('@/core/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  DyariumApi: class {
    getTranscript(...args: unknown[]): Promise<unknown> {
      return mockGetTranscript(...args);
    }
  },
}));

const recording: Recording = {
  id: 'rec_1',
  title: 'do servidor',
  recordedAt: '2026-10-20T10:00:00.000Z',
  dir: '',
  segmentCount: 0,
  status: 'completed',
  offset: 0,
  attempts: 0,
  entryId: 'e1',
  contentType: 'audio/aac',
  transcriptStatus: 'pending',
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
};

const segments = [
  {
    start_ms: 0,
    end_ms: 1000,
    text: 'a sede do pt',
    reviewed: true,
    revised: 'A sede do PT.',
  },
  { start_ms: 1000, end_ms: 2000, text: 'foram 3 pessoas', reviewed: true },
];

describe('fetchTranscriptsOnce', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadServerConfig.mockResolvedValue({ baseUrl: 'https://dyarium.test', token: 't' });
    mockGetRecording.mockResolvedValue(recording);
  });

  it('marca a transcricao do servidor como origem server', async () => {
    mockListRecordings.mockResolvedValue([recording]);
    mockGetTranscript.mockResolvedValue({
      model: 'whisper',
      language: 'pt',
      text: 'A sede do PT.\nforam 3 pessoas',
      segments,
      revised: true,
      revised_model: 'glm-5.3-flash',
      revised_prompt_version: 1,
      revised_comprehension: 80,
      revised_rejected: 0,
      revised_through: 2,
      revised_finished: true,
      revised_pending: 0,
    });

    await fetchTranscriptsOnce();

    expect(mockUpsertRecording).toHaveBeenCalledTimes(1);
    const saved = mockUpsertRecording.mock.calls[0][0];
    expect(saved.transcriptOrigin).toBe('server');
    expect(saved.transcriptStatus).toBe('ready');
    expect(saved.transcriptSegments).toHaveLength(2);
    expect(saved.transcriptReview).toMatchObject({
      model: 'glm-5.3-flash',
      promptVersion: 1,
      comprehension: 80,
      reviewedThrough: 2,
      rejected: 0,
      rejectedIdx: [],
    });
    expect(saved.transcriptReview?.finishedAt).toBeTruthy();
    expect(mockEmitRecording).toHaveBeenCalledWith(saved);
  });

  it('passada parcial do servidor nao vira terminada nem recusada', async () => {
    mockListRecordings.mockResolvedValue([{ ...recording, id: 'rec_2', entryId: 'e2' }]);
    mockGetTranscript.mockResolvedValue({
      model: 'whisper',
      language: 'pt',
      text: 'a sede do pt',
      segments: [
        { start_ms: 0, end_ms: 1000, text: 'a sede do pt', reviewed: true },
        { start_ms: 1000, end_ms: 2000, text: 'ainda cru', reviewed: false },
      ],
      revised: true,
      revised_model: 'glm-5.3-flash',
      revised_prompt_version: 1,
      revised_comprehension: -1,
      revised_rejected: 0,
      revised_through: 1,
      revised_finished: false,
      revised_pending: 1,
    });

    await fetchTranscriptsOnce();

    const saved = mockUpsertRecording.mock.calls[0][0];
    expect(saved.transcriptReview?.finishedAt).toBeUndefined();
    expect(saved.transcriptReview?.reviewedThrough).toBe(1);
    expect(saved.transcriptReview?.rejectedIdx).toEqual([]);
  });
});

describe('refreshServerTranscript', () => {
  const ready: Recording = {
    ...recording,
    transcriptStatus: 'ready',
    transcriptOrigin: 'server',
    transcript: 'a sede do pt',
    transcriptSegments: [{ start_ms: 0, end_ms: 1000, text: 'a sede do pt' }],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadServerConfig.mockResolvedValue({ baseUrl: 'https://dyarium.test', token: 't' });
  });

  it('atualiza a copia local quando o servidor revisou depois do pull', async () => {
    mockGetTranscript.mockResolvedValue({
      model: 'whisper',
      language: 'pt',
      text: 'A sede do PT.',
      segments: [
        {
          start_ms: 0,
          end_ms: 1000,
          text: 'a sede do pt',
          reviewed: true,
          revised: 'A sede do PT.',
        },
      ],
      revised: true,
      revised_model: 'glm-5.3-flash',
      revised_prompt_version: 1,
      revised_comprehension: 84,
      revised_rejected: 0,
      revised_through: 1,
      revised_finished: true,
      revised_pending: 0,
    });

    const merged = await refreshServerTranscript(ready);

    expect(merged?.transcript).toBe('A sede do PT.');
    expect(merged?.transcriptReview?.comprehension).toBe(84);
    expect(mockUpsertRecording).toHaveBeenCalledTimes(1);
    expect(mockEmitRecording).toHaveBeenCalledTimes(1);
    // Revisao nova nao e transcricao nova: sem aviso no sino.
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('nao mexe na nota quando o servidor nao tem revisao', async () => {
    mockGetTranscript.mockResolvedValue({
      model: 'whisper',
      language: 'pt',
      text: 'a sede do pt',
      segments: [{ start_ms: 0, end_ms: 1000, text: 'a sede do pt' }],
    });

    expect(await refreshServerTranscript(ready)).toBeNull();
    expect(mockUpsertRecording).not.toHaveBeenCalled();
  });

  it('nao busca transcricao de nota que ainda nao esta pronta', async () => {
    expect(await refreshServerTranscript(recording)).toBeNull();
    expect(mockGetTranscript).not.toHaveBeenCalled();
  });
});
