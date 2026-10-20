const mockFiles = new Set<string>();
const mockList = jest.fn();

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;

    constructor(base: string | { uri: string }, name?: string) {
      const dir = typeof base === 'string' ? base : base.uri;
      this.uri = name ? `${dir}/${name}` : dir;
    }

    get exists(): boolean {
      return mockFiles.has(this.uri);
    }
  }

  class MockDirectory {
    uri: string;

    constructor(base: string | { uri: string }, name?: string) {
      const dir = typeof base === 'string' ? base : base.uri;
      this.uri = name ? `${dir}/${name}` : dir;
    }

    get exists(): boolean {
      return true;
    }

    create(): void {
      // diretorio sempre existe no teste
    }

    list(): unknown[] {
      mockList();
      return [];
    }
  }

  return {
    File: MockFile,
    Directory: MockDirectory,
    FileMode: { Append: 1, ReadOnly: 2 },
    Paths: { cache: 'file:///cache', document: 'file:///docs' },
  };
});

jest.mock('../files', () => ({
  sessionDirectory: () => ({ uri: 'file:///docs/nota' }),
}));

jest.mock('../secure', () => ({
  loadServerConfig: jest.fn(),
}));

type AttachmentsModule = typeof import('../attachments');
let attachments: AttachmentsModule;

describe('attachments', () => {
  beforeEach(() => {
    mockFiles.clear();
    mockList.mockClear();
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    attachments = require('../attachments') as AttachmentsModule;
  });

  it('acha o anexo pelo caminho direto, sem listar a pasta inteira', () => {
    mockFiles.add('file:///cache/attachments/abc.jpg');

    expect(attachments.cachedAttachmentUri('abc')).toBe('file:///cache/attachments/abc.jpg');
    expect(attachments.cachedAttachmentUri('abc')).toBe('file:///cache/attachments/abc.jpg');
    expect(mockList).not.toHaveBeenCalled();
  });

  it('procura as extensoes conhecidas e devolve null sem listar', () => {
    mockFiles.add('file:///cache/attachments/def.webp');

    expect(attachments.cachedAttachmentUri('def')).toBe('file:///cache/attachments/def.webp');
    expect(attachments.cachedAttachmentUri('nao-existe')).toBeNull();
    expect(mockList).not.toHaveBeenCalled();
  });

  it('invalida o cache quando um arquivo novo chega', () => {
    expect(attachments.cachedAttachmentUri('ghi')).toBeNull();

    mockFiles.add('file:///cache/attachments/ghi.png');
    attachments.invalidateAttachmentIndex();

    expect(attachments.cachedAttachmentUri('ghi')).toBe('file:///cache/attachments/ghi.png');
    expect(mockList).not.toHaveBeenCalled();
  });
});
