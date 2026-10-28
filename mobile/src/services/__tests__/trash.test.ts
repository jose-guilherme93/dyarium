import type { Recording } from '@/core/types';

import { purgeExpiredTrash } from '../trash';

const mockListTrashed = jest.fn<Promise<Recording[]>, []>();
const mockDeleteRow = jest.fn<Promise<void>, [string]>(async () => undefined);
const mockDeleteFiles = jest.fn();

jest.mock('@/services/db', () => ({
  listTrashedRecordings: () => mockListTrashed(),
  deleteRecordingRow: (id: string) => mockDeleteRow(id),
}));

jest.mock('@/services/files', () => ({
  deleteSessionFiles: (id: string) => mockDeleteFiles(id),
}));

function note(id: string, deletedAt: string): Recording {
  return {
    id,
    title: id,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    recordedAt: '2026-10-01T10:00:00.000Z',
    dir: '',
    segmentCount: 0,
    offset: 0,
    attempts: 0,
    status: 'completed',
    deletedAt,
  };
}

describe('purgeExpiredTrash', () => {
  const NOW = Date.parse('2026-10-28T12:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('libera arquivos e linha so depois dos 7 dias', async () => {
    mockListTrashed.mockResolvedValue([
      note('velha', new Date(NOW - 7 * 24 * 60 * 60 * 1000).toISOString()),
      note('recente', new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString()),
    ]);

    await expect(purgeExpiredTrash(NOW)).resolves.toBe(1);
    expect(mockDeleteFiles).toHaveBeenCalledWith('velha');
    expect(mockDeleteRow).toHaveBeenCalledWith('velha');
    expect(mockDeleteFiles).not.toHaveBeenCalledWith('recente');
    expect(mockDeleteRow).not.toHaveBeenCalledWith('recente');
  });
});
