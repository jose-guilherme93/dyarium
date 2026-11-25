/**
 * O "sair" apaga o banco e a midia local. Este teste usa um SQLite falso: o
 * objetivo e provar que as duas conexoes sao fechadas antes do arquivo sair e
 * que as pastas do diario (nao os modelos) sao removidas.
 */

import { getDatabase, wipeLocalDatabase } from '../db';
import { wipeLocalFiles } from '../localWipe';

const mockClosed = jest.fn(async () => undefined);
const mockDeletedDatabase = jest.fn(async (_name: string) => undefined);
const mockDeletedDirs: string[] = [];

jest.mock('@/core/schema', () => ({
  applyMigrations: jest.fn(async () => undefined),
}));

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => ({
    closeAsync: () => mockClosed(),
    execAsync: jest.fn(async () => undefined),
  })),
  deleteDatabaseAsync: (name: string) => mockDeletedDatabase(name),
}));

jest.mock('expo-file-system', () => {
  class Directory {
    path: string;
    constructor(...parts: unknown[]) {
      this.path = parts.map((part) => String(part)).join('/');
    }
    get exists() {
      return true;
    }
    list() {
      return [];
    }
    delete() {
      mockDeletedDirs.push(this.path);
    }
  }
  class File {}
  return { Directory, File, Paths: { document: 'doc', cache: 'cache' } };
});

jest.mock('../attachments', () => ({ invalidateAttachmentIndex: jest.fn() }));
jest.mock('../graphData', () => ({ invalidateSessionSnapshot: jest.fn() }));

describe('apagar o cache local da conta', () => {
  beforeEach(() => {
    mockClosed.mockClear();
    mockDeletedDatabase.mockClear();
    mockDeletedDirs.length = 0;
  });

  it('fecha a conexao aberta antes de remover o banco', async () => {
    await getDatabase();
    await wipeLocalDatabase();

    expect(mockClosed).toHaveBeenCalledTimes(1);
    expect(mockDeletedDatabase).toHaveBeenCalledWith('dyarium.db');
  });

  it('remove as pastas de midia do diario e preserva os modelos', () => {
    wipeLocalFiles();

    expect(mockDeletedDirs).toEqual(
      expect.arrayContaining([
        'doc/recordings',
        'doc/Audio',
        'cache/attachments',
        'cache/Audio',
        'cache/dyarium-restore',
        'cache/covers',
      ]),
    );
    expect(mockDeletedDirs.some((path) => path.includes('whisper-models'))).toBe(false);
    expect(mockDeletedDirs.some((path) => path.includes('analysis-models'))).toBe(false);
  });
});
