import type { ServerAnalysis } from '@/core/api';

import { fetchNoteAnalysis } from '../analysis';

const mockGetAnalysis = jest.fn<Promise<ServerAnalysis>, [string]>();
const mockSaveCachedAnalyses = jest.fn<Promise<void>, [unknown[]]>();
const mockDeleteCachedServerAnalysis = jest.fn<Promise<void>, [string]>();
const mockLoadServerConfig = jest.fn();

jest.mock('@/core/api', () => {
  const actual = jest.requireActual('@/core/api');
  return {
    ...actual,
    DyariumApi: class {
      getAnalysis(...args: [string]): Promise<ServerAnalysis> {
        return mockGetAnalysis(...args);
      }
    },
  };
});

jest.mock('../db', () => ({
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
