import type { ServerAnalysis } from '@/core/api';

import { fetchNoteAnalysis, pushLocalAnalyses, pushNoteAnalysis } from '../analysis';

const mockGetAnalysis = jest.fn<Promise<ServerAnalysis>, [string]>();
const mockSaveCachedAnalyses = jest.fn<Promise<void>, [unknown[]]>();
const mockDeleteCachedServerAnalysis = jest.fn<Promise<void>, [string]>();
const mockLoadServerConfig = jest.fn();
const mockPutAnalysis = jest.fn();
const mockListCachedAnalyses = jest.fn();

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
    },
  };
});

jest.mock('../db', () => ({
  listCachedAnalyses: async () => mockListCachedAnalyses(),
  saveCachedAnalyses: async (...args: [unknown[]]) => mockSaveCachedAnalyses(...args),
  deleteCachedServerAnalysis: async (...args: [string]) =>
    mockDeleteCachedServerAnalysis(...args),
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
