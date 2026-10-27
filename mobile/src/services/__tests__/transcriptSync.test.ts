import type { Recording } from '@/core/types';

import { pushPendingTranscriptsOnce, pushTranscript } from '../transcriptSync';

const mockGetRecording = jest.fn<Promise<Recording | null>, [string]>();
const mockListRecordings = jest.fn<Promise<Recording[]>, []>();
const mockLoadServerConfig = jest.fn();
const mockGetEntry = jest.fn();
const mockPutTranscript = jest.fn().mockResolvedValue(undefined);
const mockPutRevisions = jest.fn().mockResolvedValue(undefined);

jest.mock('../db', () => ({
  getRecording: (...args: [string]) => mockGetRecording(...args),
  listRecordings: () => mockListRecordings(),
}));

jest.mock('../secure', () => ({
  loadServerConfig: () => mockLoadServerConfig(),
}));

jest.mock('@/core/api', () => ({
  DyariumApi: class {
    getEntry(...args: unknown[]): Promise<unknown> {
      return mockGetEntry(...args);
    }
    putTranscript(...args: unknown[]): Promise<void> {
      return mockPutTranscript(...args);
    }
    putTranscriptRevisions(...args: unknown[]): Promise<void> {
      return mockPutRevisions(...args);
    }
  },
}));

const recording: Recording = {
  id: 'rec_1',
  title: 'revisao',
  recordedAt: '2026-10-20T10:00:00.000Z',
  dir: '',
  segmentCount: 0,
  status: 'completed',
  offset: 0,
  attempts: 0,
  entryId: 'e1',
  serverAttachmentId: 'a1',
  transcript: 'A sede do PT (Partido dos Trabalhadores).\nForam 3 pessoas.',
  transcriptSegments: [
    {
      start_ms: 0,
      end_ms: 1000,
      text: 'a sede do pt',
      revised: 'A sede do PT (Partido dos Trabalhadores).',
    },
    { start_ms: 1000, end_ms: 2000, text: 'foram 3 pessoas', edited: true },
  ],
  transcriptReview: {
    model: 'llm-local',
    promptVersion: 1,
    literal: false,
    comprehension: 80,
    hash: 'abc',
  },
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
};

function serverEntry(transcriptText: string) {
  return { audios: [{ id: 'a1', transcript: { text: transcriptText } }] };
}

describe('pushTranscript', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRecording.mockResolvedValue(recording);
    mockLoadServerConfig.mockResolvedValue({ baseUrl: 'https://dyarium.test', token: 't' });
  });

  it('sobe so a revisao quando o texto cru ja esta no servidor', async () => {
    mockGetEntry.mockResolvedValue(serverEntry('a sede do pt\nforam 3 pessoas'));

    await pushTranscript('rec_1');

    expect(mockPutTranscript).not.toHaveBeenCalled();
    expect(mockPutRevisions).toHaveBeenCalledWith('e1', {
      attachment_id: 'a1',
      model: 'llm-local',
      prompt_version: 1,
      literal: false,
      comprehension: 80,
      rejected: 0,
      reviewed_through: 2,
      segments: [{ idx: 0, text: 'A sede do PT (Partido dos Trabalhadores).' }],
    });
  });

  it('manda o texto cru (nunca o revisado) e marca o trecho editado', async () => {
    mockGetEntry.mockResolvedValue(serverEntry('A sede do PT (Partido dos Trabalhadores).'));

    await pushTranscript('rec_1');

    expect(mockPutTranscript).toHaveBeenCalledWith('e1', {
      attachment_id: 'a1',
      language: undefined,
      text: 'a sede do pt\nforam 3 pessoas',
      segments: [
        { start_ms: 0, end_ms: 1000, text: 'a sede do pt', edited: undefined },
        { start_ms: 1000, end_ms: 2000, text: 'foram 3 pessoas', edited: true },
      ],
    });
    // O trecho escrito a mao nao pode ser revisado pelo servidor.
    expect(mockPutRevisions.mock.calls[0][1].segments).toEqual([
      { idx: 0, text: 'A sede do PT (Partido dos Trabalhadores).' },
    ]);
  });

  it('nao sobe transcricao pela metade enquanto ela esta pendente', async () => {
    mockGetRecording.mockResolvedValue({
      ...recording,
      transcriptStatus: 'pending',
      hasTranscript: false,
      transcript: 'texto parcial',
      transcriptSegments: [{ start_ms: 0, end_ms: 1000, text: 'texto parcial' }],
      transcriptReview: undefined,
    });

    await pushTranscript('rec_1');

    expect(mockGetEntry).not.toHaveBeenCalled();
    expect(mockPutTranscript).not.toHaveBeenCalled();
    expect(mockPutRevisions).not.toHaveBeenCalled();
  });

  it('nao substitui no servidor uma transcricao completa por uma local truncada', async () => {
    mockGetRecording.mockResolvedValue({
      ...recording,
      transcript: 'texto curto',
      transcriptSegments: [{ start_ms: 0, end_ms: 1000, text: 'texto curto' }],
      transcriptReview: undefined,
    });
    mockGetEntry.mockResolvedValue(serverEntry('texto completo '.repeat(20)));

    await pushTranscript('rec_1');

    expect(mockPutTranscript).not.toHaveBeenCalled();
    expect(mockPutRevisions).not.toHaveBeenCalled();
  });

  it('nao envia nada quando o servidor ja tem o texto e nao ha revisao', async () => {
    mockGetRecording.mockResolvedValue({
      ...recording,
      transcript: 'texto simples',
      transcriptSegments: undefined,
      transcriptReview: undefined,
    });
    mockGetEntry.mockResolvedValue(serverEntry('texto simples'));

    await pushTranscript('rec_1');

    expect(mockPutTranscript).not.toHaveBeenCalled();
    expect(mockPutRevisions).not.toHaveBeenCalled();
  });
});

describe('pushPendingTranscriptsOnce', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadServerConfig.mockResolvedValue({ baseUrl: 'https://dyarium.test', token: 't' });
    mockGetEntry.mockResolvedValue({ audios: [{ id: 'a1' }] });
  });

  it('sobe a transcricao local que ainda nao esta no servidor', async () => {
    mockListRecordings.mockResolvedValue([recording]);
    mockGetRecording.mockResolvedValue(recording);

    await pushPendingTranscriptsOnce();

    expect(mockPutTranscript).toHaveBeenCalledTimes(1);
    expect(mockPutTranscript).toHaveBeenCalledWith(
      'e1',
      expect.objectContaining({ text: 'a sede do pt\nforam 3 pessoas' }),
    );
  });

  it('nao mexe em nota que veio do servidor', async () => {
    mockListRecordings.mockResolvedValue([
      { ...recording, transcriptOrigin: 'server' },
    ]);

    await pushPendingTranscriptsOnce();

    expect(mockGetRecording).not.toHaveBeenCalled();
    expect(mockPutTranscript).not.toHaveBeenCalled();
  });

  it('nao sobe uma transcricao pendente', async () => {
    mockListRecordings.mockResolvedValue([
      { ...recording, transcriptStatus: 'pending', hasTranscript: false },
    ]);
    mockGetRecording.mockResolvedValue({
      ...recording,
      transcriptStatus: 'pending',
      hasTranscript: false,
    });

    await pushPendingTranscriptsOnce();

    expect(mockPutTranscript).not.toHaveBeenCalled();
  });

  it('para na primeira falha de rede em vez de insistir em todas', async () => {
    mockListRecordings.mockResolvedValue([recording, { ...recording, id: 'rec_2' }]);
    mockGetRecording.mockImplementation(async (id) => ({ ...recording, id }));
    // Sem audios e sem transcricao no servidor, o push tenta o PUT.
    mockPutTranscript.mockRejectedValueOnce(new Error('offline'));

    await pushPendingTranscriptsOnce();

    expect(mockGetRecording).toHaveBeenCalledTimes(1);
    expect(mockPutTranscript).toHaveBeenCalledTimes(1);
  });
});
