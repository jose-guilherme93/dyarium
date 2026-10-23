import type { Recording } from '@/core/types';

const mockSessionFiles = jest.fn();

jest.mock('expo-file-system', () => ({
  Directory: class {
    get exists(): boolean {
      return false;
    }

    list(): unknown[] {
      return [];
    }
  },
  File: class {
    get size(): number {
      return 0;
    }
  },
  Paths: {
    cache: 'file:///cache',
    document: 'file:///docs',
    get availableDiskSpace(): number {
      return 0;
    },
    get totalDiskSpace(): number {
      return 0;
    },
  },
}));

jest.mock('../files', () => ({
  sessionFiles: (...args: unknown[]) => mockSessionFiles(...args),
  directoryBytes: () => 0,
}));

jest.mock('../analysisModels', () => ({
  installedAnalysisModelsBytes: () => 0,
}));

jest.mock('../db', () => ({
  databaseBytes: () => 0,
}));

jest.mock('../transcriptionModels', () => ({
  installedModelsBytes: () => 0,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { scanImageBytes } = require('../storageScan') as typeof import('../storageScan');

function note(id: string, text: string): Recording {
  return { id, text } as Recording;
}

describe('scanImageBytes', () => {
  beforeEach(() => {
    mockSessionFiles.mockReset();
  });

  it('nao le a pasta de notas sem imagem no texto', () => {
    mockSessionFiles.mockReturnValue([]);

    expect(scanImageBytes([note('a', 'so texto'), note('b', '')])).toEqual({});
    expect(mockSessionFiles).not.toHaveBeenCalled();
  });

  it('soma somente arquivos de imagem das notas que tem imagem', () => {
    mockSessionFiles.mockReturnValue([
      { name: 'foto.JPG', size: 1200 },
      { name: 'audio.aac', size: 9000 },
      { name: 'outra.png', size: 300 },
    ]);

    expect(scanImageBytes([note('a', 'veja ![foto](local:foto.jpg)')])).toEqual({
      a: 1500,
    });
  });

  it('varre apenas as notas com imagem numa lista mista', () => {
    mockSessionFiles.mockReturnValue([{ name: 'foto.webp', size: 42 }]);

    scanImageBytes([
      note('texto', 'sem midia'),
      note('foto', '![f](attachment:f.webp)'),
      note('audio', ''),
    ]);

    expect(mockSessionFiles).toHaveBeenCalledTimes(1);
    expect(mockSessionFiles).toHaveBeenCalledWith('foto');
  });
});
