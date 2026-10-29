import type { ServerAnalysis } from '@/core/api';

import {
  fetchNoteAnalysis,
  pushLocalAnalyses,
  pushNoteAnalysis,
  requestServerAnalysis,
  syncServerAnalyses,
} from '../analysis';

const mockGetAnalysis = jest.fn<Promise<ServerAnalysis>, [string]>();
const mockSaveCachedAnalyses = jest.fn<Promise<void>, [unknown[]]>();
const mockDeleteCachedServerAnalysis = jest.fn<Promise<void>, [string]>();
const mockLoadServerConfig = jest.fn();
const mockPutAnalysis = jest.fn();
const mockListCachedAnalyses = jest.fn();
const mockGetAnalysisSyncAt = jest.fn<Promise<string | null>, [string]>();
const mockSetAnalysisSyncAt = jest.fn<Promise<void>, [string, string]>();
const mockGetCachedAnalysis = jest.fn();
const mockRequestAnalysis = jest.fn();

jest.mock('@/core/api', () => {
  const actual = jest.requireActual('@/core/api');
  return {
    ...actual,
    DyariumApi: class {
      getAnalysis(...args: [string]): Promise<ServerAnalysis> {
        return mockGetAnalysis(...args);
      }
      putAnalysis(...args: unknown[]): Promise<{ stored: boolean; origin?: string }> {
        return mockPutAnalysis(...args);
      }
      requestAnalysis(...args: [string]): Promise<{ status: string }> {
        return mockRequestAnalysis(...args);
      }
    },
  };
});

jest.mock('../db', () => ({
  listCachedAnalyses: async () => mockListCachedAnalyses(),
  saveCachedAnalyses: async (...args: [unknown[]]) => mockSaveCachedAnalyses(...args),
  deleteCachedServerAnalysis: async (...args: [string]) =>
    mockDeleteCachedServerAnalysis(...args),
  getAnalysisSyncAt: (...args: [string]) => mockGetAnalysisSyncAt(...args),
  setAnalysisSyncAt: (...args: [string, string]) => mockSetAnalysisSyncAt(...args),
  getCachedAnalysis: (...args: [string]) => mockGetCachedAnalysis(...args),
}));

jest.mock('../secure', () => ({
  loadServerConfig: () => mockLoadServerConfig(),
}));

const { ApiError } = jest.requireActual('@/core/api') as typeof import('@/core/api');

const target = {
  entryId: 'e1',
  title: 'nota',
  recordedAt: '2026-10-20T10:00:00.000Z',
};

const analysis: ServerAnalysis = {
  model: 'llm',
  sentiment: 0.2,
  emotions: null,
  people: null,
  places: null,
  summary: 'resumo',
  comprehension: 80,
  comprehension_source: 'review',
};

describe('fetchNoteAnalysis', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadServerConfig.mockResolvedValue({ baseUrl: 'https://dyarium.test', token: 't' });
  });

  it('guarda a analise do servidor no aparelho', async () => {
    mockGetAnalysis.mockResolvedValue(analysis);

    await expect(fetchNoteAnalysis(target)).resolves.toEqual(analysis);
    expect(mockSaveCachedAnalyses).toHaveBeenCalledWith([
      expect.objectContaining({ entryId: 'e1', analysis }),
    ]);
    expect(mockDeleteCachedServerAnalysis).not.toHaveBeenCalled();
  });

  it('apaga a copia local quando o servidor nao tem mais analise', async () => {
    mockGetAnalysis.mockRejectedValue(new ApiError(404, 'not_found', 'analise indisponivel'));

    await expect(fetchNoteAnalysis(target)).resolves.toBeNull();
    expect(mockDeleteCachedServerAnalysis).toHaveBeenCalledWith('e1');
    expect(mockSaveCachedAnalyses).not.toHaveBeenCalled();
  });

  it('mantem a copia local quando a falha e de rede', async () => {
    mockGetAnalysis.mockRejectedValue(new TypeError('network request failed'));

    await expect(fetchNoteAnalysis(target)).resolves.toBeNull();
    expect(mockDeleteCachedServerAnalysis).not.toHaveBeenCalled();
  });
});

describe('pushNoteAnalysis', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadServerConfig.mockResolvedValue({ baseUrl: 'https://dyarium.test', token: 't' });
  });

  it('sobe a analise local sem substituir a do servidor', async () => {
    mockPutAnalysis.mockResolvedValue({ stored: true, origin: 'app' });

    await expect(pushNoteAnalysis('e1', analysis)).resolves.toBe(true);
    expect(mockPutAnalysis).toHaveBeenCalledWith('e1', { ...analysis, replace: false });
  });

  it('refazer pede substituicao explicita', async () => {
    mockPutAnalysis.mockResolvedValue({ stored: true, origin: 'app' });

    await pushNoteAnalysis('e1', analysis, true);
    expect(mockPutAnalysis).toHaveBeenCalledWith('e1', { ...analysis, replace: true });
  });

  it('sem servidor nao tenta nada', async () => {
    mockLoadServerConfig.mockResolvedValue(null);

    await expect(pushNoteAnalysis('e1', analysis)).resolves.toBe(false);
    expect(mockPutAnalysis).not.toHaveBeenCalled();
  });
});

describe('pushLocalAnalyses', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadServerConfig.mockResolvedValue({ baseUrl: 'https://dyarium.test', token: 't' });
    mockPutAnalysis.mockResolvedValue({ stored: true, origin: 'app' });
  });

  it('so envia analises locais de notas que ja existem no servidor', async () => {
    mockListCachedAnalyses.mockResolvedValue([
      { entryId: 'e1', origin: 'local', analysis },
      { entryId: 'note_123', origin: 'local', analysis },
      { entryId: 'e2', origin: 'server', analysis },
    ]);

    await expect(pushLocalAnalyses()).resolves.toBe(1);
    expect(mockPutAnalysis).toHaveBeenCalledTimes(1);
    expect(mockPutAnalysis.mock.calls[0][0]).toBe('e1');
  });

  it('sem servidor nao faz backfill', async () => {
    mockLoadServerConfig.mockResolvedValue(null);

    await expect(pushLocalAnalyses()).resolves.toBe(0);
    expect(mockListCachedAnalyses).not.toHaveBeenCalled();
  });
});


describe('syncServerAnalyses', () => {
  const entry = {
    id: 'e1',
    title: 'nota',
    status: 'ready',
    source: 'audio',
    original_filename: 'a.m4a',
    content_type: 'audio/mp4',
    size_bytes: 1,
    duration_seconds: 1,
    recorded_at: '2026-10-20T10:00:00.000Z',
    created_at: '2026-10-20T10:00:00.000Z',
    updated_at: '2026-10-20T10:00:00.000Z',
    analysis_at: '2026-10-20T10:05:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadServerConfig.mockResolvedValue({ baseUrl: 'https://dyarium.test', token: 't' });
    mockGetAnalysis.mockResolvedValue(analysis);
    mockSaveCachedAnalyses.mockResolvedValue(undefined);
    mockSetAnalysisSyncAt.mockResolvedValue(undefined);
    mockDeleteCachedServerAnalysis.mockResolvedValue(undefined);
    mockGetCachedAnalysis.mockResolvedValue(null);
  });

  it('busca uma vez quando o analysis_at mudou e marca o sinal', async () => {
    mockGetAnalysisSyncAt.mockResolvedValue('2026-10-20T10:00:00.000Z');

    await expect(syncServerAnalyses([entry])).resolves.toBe(1);
    expect(mockGetAnalysis).toHaveBeenCalledWith('e1');
    expect(mockSetAnalysisSyncAt).toHaveBeenCalledWith('e1', entry.analysis_at);
  });

  it('nao busca de novo quando o sinal e o mesmo', async () => {
    mockGetAnalysisSyncAt.mockResolvedValue(entry.analysis_at);

    await expect(syncServerAnalyses([entry])).resolves.toBe(0);
    expect(mockGetAnalysis).not.toHaveBeenCalled();
  });

  it('analise local vence: marca o sinal sem pedir nada', async () => {
    mockGetAnalysisSyncAt.mockResolvedValue(null);
    mockGetCachedAnalysis.mockResolvedValue({ origin: 'local' });

    await expect(syncServerAnalyses([entry])).resolves.toBe(0);
    expect(mockGetAnalysis).not.toHaveBeenCalled();
    expect(mockSetAnalysisSyncAt).toHaveBeenCalledWith('e1', entry.analysis_at);
  });

  it('404 apaga a copia e nao retenta o mesmo sinal', async () => {
    mockGetAnalysisSyncAt.mockResolvedValue(null);
    mockGetAnalysis.mockRejectedValue(new ApiError(404, 'not_found', 'analise indisponivel'));

    await expect(syncServerAnalyses([entry])).resolves.toBe(0);
    expect(mockDeleteCachedServerAnalysis).toHaveBeenCalledWith('e1');
    expect(mockSetAnalysisSyncAt).toHaveBeenCalledWith('e1', entry.analysis_at);
  });

  it('falha de rede deixa o sinal para o proximo pull', async () => {
    mockGetAnalysisSyncAt.mockResolvedValue(null);
    mockGetAnalysis.mockRejectedValue(new TypeError('network request failed'));

    await expect(syncServerAnalyses([entry])).resolves.toBe(0);
    expect(mockSetAnalysisSyncAt).not.toHaveBeenCalled();
  });

  it('entrada sem analise nao e consultada', async () => {
    await expect(syncServerAnalyses([{ ...entry, analysis_at: '' }])).resolves.toBe(0);
    expect(mockGetAnalysis).not.toHaveBeenCalled();
  });
});

describe('requestServerAnalysis', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadServerConfig.mockResolvedValue({ baseUrl: 'https://dyarium.test', token: 't' });
  });

  it('pede a analise remota e devolve o status enfileirado', async () => {
    mockRequestAnalysis.mockResolvedValue({ status: 'analyzing' });

    await expect(requestServerAnalysis('e1')).resolves.toEqual({ status: 'analyzing' });
    expect(mockRequestAnalysis).toHaveBeenCalledWith('e1');
  });

  it('sem servidor configurado nao chama a rede', async () => {
    mockLoadServerConfig.mockResolvedValue(null);

    await expect(requestServerAnalysis('e1')).rejects.toMatchObject({ code: 'no_server' });
    expect(mockRequestAnalysis).not.toHaveBeenCalled();
  });

  it('propaga o erro do servidor (analise desligada)', async () => {
    mockRequestAnalysis.mockRejectedValue(new ApiError(409, 'analyze_disabled', 'analise desligada'));

    await expect(requestServerAnalysis('e1')).rejects.toMatchObject({ status: 409 });
  });
});
