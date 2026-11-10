/**
 * Testes de comportamento externo de `share` e `files` (copia de audio
 * compartilhado). Mocka `expo-file-system`, `expo-file-system/legacy` e
 * `expo-sharing`; nao toca em disco.
 */

const mockCopy = jest.fn();
const mockCreate = jest.fn();
const mockDelete = jest.fn();
const mockOpen = jest.fn();
const mockFiles = new Set<string>();
const mockSizes = new Map<string, number>();
const mockLastModified = new Map<string, number>();

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts
        .map((part) => (typeof part === 'string' ? part : (part as { uri?: string })?.uri ?? ''))
        .join('/');
    }
    get exists(): boolean {
      return mockFiles.has(this.uri);
    }
    get size(): number {
      if (mockSizes.has(this.uri)) return mockSizes.get(this.uri) as number;
      return this.uri.includes('original') ? 18432 : 0;
    }
    get lastModified(): number {
      return mockLastModified.get(this.uri) ?? 0;
    }
    async copy(destination: { uri: string }): Promise<void> {
      mockCopy(this.uri, destination.uri);
    }
    create(): void {
      mockCreate(this.uri);
    }
    delete(): void {
      mockDelete(this.uri);
      mockFiles.delete(this.uri);
    }
    open(): unknown {
      return mockOpen(this.uri);
    }
  }

  class MockDirectory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts
        .map((part) => (typeof part === 'string' ? part : (part as { uri?: string })?.uri ?? ''))
        .join('/');
    }
    get exists(): boolean {
      return true;
    }
    create(): void {
      // diretorio sempre existe no teste
    }
    list(): unknown[] {
      return [];
    }
  }

  return {
    File: MockFile,
    Directory: MockDirectory,
    FileMode: { ReadOnly: 0, Append: 1, Write: 2 },
    Paths: { document: 'file:///docs', cache: 'file:///cache' },
  };
});

const mockLegacyCopyAsync = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  copyAsync: (...args: unknown[]) => mockLegacyCopyAsync(...args),
}));

const mockGetResolvedSharedPayloadsAsync = jest.fn();
const mockClearSharedPayloads = jest.fn();
jest.mock('expo-sharing', () => ({
  getResolvedSharedPayloadsAsync: () => mockGetResolvedSharedPayloadsAsync(),
  clearSharedPayloads: () => mockClearSharedPayloads(),
}));

type FilesModule = typeof import('../files');
type ShareModule = typeof import('../share');

let files: FilesModule;
let share: ShareModule;

describe('copySharedAudio', () => {
  beforeEach(() => {
    mockCopy.mockReset();
    mockCreate.mockReset();
    mockDelete.mockReset();
    mockOpen.mockReset();
    mockLegacyCopyAsync.mockReset().mockResolvedValue(undefined);
    mockFiles.clear();
    mockSizes.clear();
    mockLastModified.clear();
    jest.resetModules();
    files = require('../files') as FilesModule;
  });

  it('copia file:// pela API nova e nao usa o legacy', async () => {
    const result = await files.copySharedAudio('file:///tmp/audio.aac', 'sess1', 'aac');

    expect(mockCopy).toHaveBeenCalledWith('file:///tmp/audio.aac', expect.stringContaining('original.aac'));
    expect(mockLegacyCopyAsync).not.toHaveBeenCalled();
    expect(result.uri).toContain('original.aac');
    expect(result.size).toBe(18432);
  });

  it('copia content:// pelo legacy e nao tenta a API nova', async () => {
    const result = await files.copySharedAudio('content://media/1', 'sess2', 'aac');

    expect(mockLegacyCopyAsync).toHaveBeenCalledWith({
      from: 'content://media/1',
      to: expect.stringContaining('original.aac'),
    });
    expect(mockCopy).not.toHaveBeenCalled();
    expect(result.uri).toContain('original.aac');
    expect(result.size).toBe(18432);
  });

  it('cai para o legacy quando a API nova falha em file://', async () => {
    mockCopy.mockImplementationOnce(() => {
      throw new Error('falha nova');
    });

    await files.copySharedAudio('file:///tmp/audio.aac', 'sess3', 'aac');

    expect(mockLegacyCopyAsync).toHaveBeenCalled();
  });
});

describe('fileModifiedMs', () => {
  beforeEach(() => {
    mockLastModified.clear();
    jest.resetModules();
    files = require('../files') as FilesModule;
  });

  it('retorna undefined para content:// sem lancar', () => {
    expect(files.fileModifiedMs('content://media/1')).toBeUndefined();
  });

  it('retorna os ms quando a API nova informa lastModified', () => {
    mockLastModified.set('file:///tmp/audio.aac', 1700000000000);
    expect(files.fileModifiedMs('file:///tmp/audio.aac')).toBe(1700000000000);
  });

  it('retorna undefined quando lastModified nao e positivo', () => {
    expect(files.fileModifiedMs('file:///tmp/sem-data.aac')).toBeUndefined();
  });
});

describe('prepareSharedAudios', () => {
  beforeEach(() => {
    mockCopy.mockReset();
    mockLegacyCopyAsync.mockReset().mockResolvedValue(undefined);
    mockGetResolvedSharedPayloadsAsync.mockReset();
    mockClearSharedPayloads.mockReset();
    mockFiles.clear();
    mockSizes.clear();
    mockLastModified.clear();
    jest.resetModules();
    files = require('../files') as FilesModule;
    share = require('../share') as ShareModule;
  });

  it('preenche filePath e sizeBytes quando a copia funciona (file://)', async () => {
    mockGetResolvedSharedPayloadsAsync.mockResolvedValue([
      {
        contentType: 'audio',
        contentUri: 'file:///tmp/gravacao.aac',
        contentMimeType: 'audio/aac',
        originalName: 'gravacao.aac',
        contentSize: 18432,
      },
    ]);
    mockLastModified.set('file:///tmp/gravacao.aac', 1700000000000);

    const prepared = await share.prepareSharedAudios(new Date('2026-10-10T22:00:00.000Z'));

    expect(prepared.drafts).toHaveLength(1);
    const draft = prepared.drafts[0];
    expect(draft.supported).toBe(true);
    expect(draft.filePath).toContain('original.aac');
    expect(draft.sizeBytes).toBe(18432);
    expect(draft.id).toBeTruthy();
    expect(draft.dir).toBeTruthy();
    expect(draft.reason).toBeUndefined();
    expect(mockClearSharedPayloads).toHaveBeenCalled();
  });

  it('copia payload content:// via legacy e preenche o rascunho', async () => {
    mockGetResolvedSharedPayloadsAsync.mockResolvedValue([
      {
        contentType: 'audio',
        contentUri: 'content://media/1',
        contentMimeType: 'audio/aac',
        originalName: 'nota.m4a',
        contentSize: 123,
      },
    ]);

    const prepared = await share.prepareSharedAudios();

    expect(mockLegacyCopyAsync).toHaveBeenCalled();
    const draft = prepared.drafts[0];
    expect(draft.supported).toBe(true);
    expect(draft.filePath).toContain('original.m4a');
    expect(draft.sizeBytes).toBe(18432);
  });

  it('marca rascunho como nao suportado com reason util quando a copia falha', async () => {
    mockLegacyCopyAsync.mockRejectedValueOnce(new Error('falha'));
    mockGetResolvedSharedPayloadsAsync.mockResolvedValue([
      {
        contentType: 'audio',
        contentUri: 'content://media/2',
        contentMimeType: 'audio/aac',
        originalName: 'x.aac',
        contentSize: 1,
      },
    ]);

    const prepared = await share.prepareSharedAudios();

    const draft = prepared.drafts[0];
    expect(draft.supported).toBe(false);
    expect(draft.reason).toBe('Não foi possível copiar o áudio.');
    expect(draft.filePath).toBeUndefined();
    expect(draft.sizeBytes).toBeUndefined();
  });
});