import type { Recording } from '@/core/types';

import {
  fetchTranscriptsOnce,
  refreshServerTranscript,
  requestServerTranscript,
  sendPendingTranscriptsToServer,
  syncServerTranscripts,
  transcribeRecordingOnServer,
} from '../transcripts';
import { ApiError } from '@/core/api';

const mockListRecordings = jest.fn<Promise<Recording[]>, []>();
const mockGetRecording = jest.fn<Promise<Recording | null>, [string]>();
const mockUpsertRecording = jest.fn<Promise<void>, [Recording]>();
const mockGetTranscript = jest.fn();
const mockRetranscribe = jest.fn();
const mockLoadServerConfig = jest.fn();
const mockEmitRecording = jest.fn();
const mockNotify = jest.fn();
const mockGetTranscriptSyncAt = jest.fn<Promise<string | null>, [string]>();
const mockSetTranscriptSyncAt = jest.fn<Promise<void>, [string, string]>();
const mockTrackServer = jest.fn();
const mockFinishServer = jest.fn();
const mockFailServer = jest.fn();

jest.mock('../db', () => ({
  listRecordings: () => mockListRecordings(),
  getRecording: (...args: [string]) => mockGetRecording(...args),
  upsertRecording: (...args: [Recording]) => mockUpsertRecording(...args),
  getTranscriptSyncAt: (...args: [string]) => mockGetTranscriptSyncAt(...args),
  setTranscriptSyncAt: (...args: [string, string]) => mockSetTranscriptSyncAt(...args),
}));

jest.mock('../secure', () => ({
  loadServerConfig: () => mockLoadServerConfig(),
}));

jest.mock('../remoteTranscription', () => ({
  trackServerTranscription: (...args: [Recording]) => mockTrackServer(...args),
  finishServerTranscription: (...args: [string]) => mockFinishServer(...args),
  failServerTranscription: (...args: [string, string]) => mockFailServer(...args),
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
    code?: string;
    constructor(statusOrMessage: number | string, codeOrStatus?: string | number, message?: string) {
      if (typeof statusOrMessage === 'number') {
        super(message ?? (typeof codeOrStatus === 'string' ? codeOrStatus : 'erro'));
        this.status = statusOrMessage;
        this.code = typeof codeOrStatus === 'string' ? codeOrStatus : undefined;
      } else {
        super(statusOrMessage);
        this.status = typeof codeOrStatus === 'number' ? codeOrStatus : 0;
      }
    }
  },
  DyariumApi: class {
    getTranscript(...args: unknown[]): Promise<unknown> {
      return mockGetTranscript(...args);
    }
    retranscribe(...args: unknown[]): Promise<unknown> {
      return mockRetranscribe(...args);
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
    // Marca de transcricao pronta: a fila local nao refaz o texto do servidor.
    expect(saved.hasTranscript).toBe(true);
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


describe('syncServerTranscripts', () => {
  const serverEntry = {
    id: 'e1',
    title: 'do servidor',
    status: 'ready',
    source: 'audio',
    original_filename: 'a.m4a',
    content_type: 'audio/mp4',
    size_bytes: 1,
    duration_seconds: 1,
    recorded_at: '2026-10-20T10:00:00.000Z',
    created_at: '2026-10-20T10:00:00.000Z',
    updated_at: '2026-10-20T10:00:00.000Z',
    transcript_at: '2026-10-20T11:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadServerConfig.mockResolvedValue({ baseUrl: 'https://dyarium.test', token: 't' });
    mockGetTranscriptSyncAt.mockResolvedValue(null);
    mockSetTranscriptSyncAt.mockResolvedValue(undefined);
    mockUpsertRecording.mockResolvedValue(undefined);
  });

  it('adota a transcricao que ainda nao existe no aparelho e marca o sinal', async () => {
    mockGetTranscript.mockResolvedValue({
      model: 'whisper',
      language: 'pt',
      text: 'texto do servidor',
      segments: [{ start_ms: 0, end_ms: 1000, text: 'texto do servidor' }],
    });

    await expect(syncServerTranscripts([serverEntry], [recording])).resolves.toBe(1);
    expect(mockUpsertRecording).toHaveBeenCalledWith(
      expect.objectContaining({ transcriptOrigin: 'server', hasTranscript: true }),
    );
    expect(mockSetTranscriptSyncAt).toHaveBeenCalledWith('e1', serverEntry.transcript_at);
  });

  it('nao busca de novo quando o sinal e o mesmo', async () => {
    mockGetTranscriptSyncAt.mockResolvedValue(serverEntry.transcript_at);

    await expect(syncServerTranscripts([serverEntry], [recording])).resolves.toBe(0);
    expect(mockGetTranscript).not.toHaveBeenCalled();
  });

  it('nao sobrescreve transcricao feita no aparelho', async () => {
    await syncServerTranscripts(
      [serverEntry],
      [{ ...recording, transcript: 'minha', transcriptOrigin: 'local', hasTranscript: true }],
    );
    expect(mockGetTranscript).not.toHaveBeenCalled();
  });

  it('copia local sem marcador e carimbada sem baixar de novo', async () => {
    mockGetTranscriptSyncAt.mockResolvedValue(null);

    await expect(
      syncServerTranscripts(
        [serverEntry],
        [
          {
            ...recording,
            transcript: 'ja tenho esta transcricao',
            transcriptStatus: 'ready',
            transcriptOrigin: 'server',
            hasTranscript: true,
          },
        ],
      ),
    ).resolves.toBe(0);
    expect(mockGetTranscript).not.toHaveBeenCalled();
    expect(mockSetTranscriptSyncAt).toHaveBeenCalledWith('e1', serverEntry.transcript_at);
  });

  it('marcador antigo com copia local ainda busca a versao nova do servidor', async () => {
    mockGetTranscriptSyncAt.mockResolvedValue('2026-10-20T10:30:00.000Z');
    mockGetTranscript.mockResolvedValue({
      model: 'whisper',
      language: 'pt',
      text: 'texto revisado',
      segments: [],
    });

    await syncServerTranscripts(
      [serverEntry],
      [
        {
          ...recording,
          transcript: 'texto antigo',
          transcriptStatus: 'ready',
          transcriptOrigin: 'server',
          hasTranscript: true,
        },
      ],
    );
    expect(mockGetTranscript).toHaveBeenCalledWith('e1');
  });

  it('falha de rede mantem o sinal para o proximo pull', async () => {
    mockGetTranscript.mockRejectedValue(new Error('network'));
    await syncServerTranscripts([serverEntry], [recording]);
    expect(mockSetTranscriptSyncAt).not.toHaveBeenCalled();
  });
});

describe('pedir transcricao ao servidor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadServerConfig.mockResolvedValue({ baseUrl: 'https://dyarium.test', token: 't' });
    mockUpsertRecording.mockResolvedValue(undefined);
  });

  it('cria a fila do servidor para uma nota que subiu sem ela', async () => {
    mockRetranscribe.mockResolvedValue({ status: 'queued' });

    await requestServerTranscript('e1');

    expect(mockRetranscribe).toHaveBeenCalledWith('e1');
  });

  it('sem servidor, nao chama a rede', async () => {
    mockLoadServerConfig.mockResolvedValue(null);

    await expect(requestServerTranscript('e1')).rejects.toMatchObject({ code: 'no_server' });
    expect(mockRetranscribe).not.toHaveBeenCalled();
  });

  it('move so as notas pendentes que ja tem entrada no servidor', async () => {
    mockRetranscribe.mockResolvedValue({ status: 'queued' });
    mockListRecordings.mockResolvedValue([
      { ...recording, filePath: '/audio/rec_1.aac' },
      {
        ...recording,
        id: 'rec_2',
        entryId: undefined,
        filePath: '/audio/rec_2.aac',
        transcriptStatus: 'pending',
      },
    ]);

    const result = await sendPendingTranscriptsToServer();

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(mockRetranscribe).toHaveBeenCalledTimes(1);
    expect(mockUpsertRecording).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rec_1', transcriptOrigin: 'server', transcriptStatus: 'pending' }),
    );
  });
});

class ApiErrorLike extends ApiError {
  constructor(status: number, message: string) {
    super(status, 'conflict', message);
  }
}

describe('transcrever no servidor a pedido', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadServerConfig.mockResolvedValue({ baseUrl: 'https://dyarium.test', token: 't' });
    mockUpsertRecording.mockResolvedValue(undefined);
  });

  it('usa o texto que o servidor ja entregou, sem criar fila nova', async () => {
    mockGetTranscript.mockResolvedValue({
      model: 'whisper',
      language: 'pt',
      text: 'ja estava pronto',
      segments: [{ start_ms: 0, end_ms: 1000, text: 'ja estava pronto' }],
    });
    const ready = { ...recording, transcriptStatus: 'ready' as const };

    const result = await transcribeRecordingOnServer(ready);

    expect(result).toEqual({ status: 'ready' });
    expect(mockRetranscribe).not.toHaveBeenCalled();
    expect(mockFinishServer).toHaveBeenCalledWith('rec_1');
  });

  it('cria a fila e marca a nota como pending do servidor', async () => {
    mockRetranscribe.mockResolvedValue({ status: 'queued' });
    mockGetRecording.mockResolvedValue({ ...recording, transcriptStatus: 'pending' });

    const result = await transcribeRecordingOnServer({ ...recording, transcriptStatus: 'pending' });

    expect(result).toEqual({ status: 'queued' });
    expect(mockTrackServer).toHaveBeenCalled();
    expect(mockUpsertRecording).toHaveBeenCalledWith(
      expect.objectContaining({ transcriptOrigin: 'server', transcriptStatus: 'pending' }),
    );
  });

  it('servidor recusando devolve o codigo, sem transcrever aqui', async () => {
    mockRetranscribe.mockRejectedValue(new ApiErrorLike(409, 'conflict'));

    const result = await transcribeRecordingOnServer({ ...recording, transcriptStatus: 'pending' });

    expect(result).toEqual({ status: 'rejected', code: 409 });
    expect(mockFailServer).toHaveBeenCalled();
  });

  it('nota sem entrada no servidor nao chama a rede', async () => {
    const result = await transcribeRecordingOnServer({ ...recording, entryId: undefined });

    expect(result).toEqual({ status: 'no_entry' });
    expect(mockRetranscribe).not.toHaveBeenCalled();
  });
});
